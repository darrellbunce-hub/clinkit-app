-- Phase 4A: Estate agent assignment-scoped operational chain viewer
--
-- Allows branch-assigned estate agents to view the same operational chain
-- workspace as homeowners (read-only at app layer). Visibility requires an
-- active assignment on at least one property in the chain — never chain-wide
-- for all agents.
--
-- Prerequisite: 20260610170000 (is_ea_assigned_to_property)

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.is_ea_assigned_to_chain(
  p_chain_id bigint
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.property_ea_assignments pea
    inner join public.properties p
      on p.id = pea.property_id
    inner join public.ea_branch_members bm
      on bm.branch_id = pea.branch_id
    where p.chain_id = p_chain_id
      and pea.status = 'active'
      and bm.user_id = auth.uid()
  );
$$;

comment on function public.is_ea_assigned_to_chain(bigint) is
  'True when the current user belongs to a branch with an active assignment on any property in the chain.';

create or replace function public.is_chain_operational_viewer(
  p_chain_id bigint
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.is_chain_participant(p_chain_id)
    or public.is_ea_assigned_to_chain(p_chain_id);
$$;

comment on function public.is_chain_operational_viewer(bigint) is
  'True when the user may view operational chain data: property member or branch-assigned estate agent.';

revoke all on function public.is_ea_assigned_to_chain(bigint) from public;
revoke all on function public.is_chain_operational_viewer(bigint) from public;

grant execute on function public.is_ea_assigned_to_chain(bigint) to authenticated;
grant execute on function public.is_chain_operational_viewer(bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- Participant-safe property view (assignment-scoped chain visibility)
-- ---------------------------------------------------------------------------

create or replace view public.chain_properties_participant
with (security_invoker = false)
as
select
  p.id,
  p.chain_id,
  p.chain_position,
  p.stage,
  p.status,
  p.relationship_type,
  p.linked_property_id,
  p.is_searching,
  p.buyer_connected,
  p.seller_connected,
  p.awaiting_buyer,
  p.created_by_user_id,
  case
    when public.is_property_member(p.id) then p.address
    when public.is_ea_assigned_to_property(p.id) then p.address
    else null
  end as address,
  case
    when public.is_property_member(p.id) then p.postcode
    when public.is_ea_assigned_to_property(p.id) then p.postcode
    else null
  end as postcode,
  public.current_user_property_role(p.id) as current_user_role,
  public.is_property_member(p.id) as is_own_property,
  exists (
    select 1
    from public.property_members pm2
    where pm2.property_id = p.id
  ) as has_members
from public.properties p
where
  auth.uid() is not null
  and public.is_chain_operational_viewer(p.chain_id);

comment on view public.chain_properties_participant is
  'Operational chain topology for members and assignment-scoped estate agents; address visible only for own or assigned properties.';

revoke all on public.chain_properties_participant from public;
revoke all on public.chain_properties_participant from anon;
grant select on public.chain_properties_participant to authenticated;

-- ---------------------------------------------------------------------------
-- Buyer Ready summary view (operational viewers)
-- ---------------------------------------------------------------------------

create or replace view public.chain_nodes_chain_summary
with (security_invoker = false)
as
select
  cn.id,
  cn.chain_id,
  cn.node_type,
  cn.position,
  cn.linked_property_id,
  cn.status,
  cn.progress,
  case
    when cn.stage is null then 'Buyer Ready'
    when cn.stage like 'mortgage%' then 'Mortgage preparation'
    when cn.stage in (
      'solicitor_instructed',
      'searches_ordered'
    ) then 'Conveyancing in progress'
    when cn.stage like 'survey%' then 'Survey in progress'
    when cn.stage like 'enquir%'
      or cn.stage like 'contract%' then 'Legal work in progress'
    when cn.stage in (
      'ready_to_exchange',
      'exchange_contracts',
      'completion_date_agreed'
    ) then 'Approaching exchange'
    else 'Buyer Ready'
  end as public_stage_label,
  (
    select a.timestamp
    from public.activities a
    where a.chain_node_id = cn.id
    order by a.timestamp desc
    limit 1
  ) as latest_activity_at
from public.chain_nodes cn
where
  cn.node_type = 'buyer_ready'
  and auth.uid() is not null
  and public.is_chain_operational_viewer(cn.chain_id);

comment on view public.chain_nodes_chain_summary is
  'Participant-safe Buyer Ready projection for operational chain viewers.';

revoke all on public.chain_nodes_chain_summary from public;
revoke all on public.chain_nodes_chain_summary from anon;
grant select on public.chain_nodes_chain_summary to authenticated;

-- ---------------------------------------------------------------------------
-- RLS: chains SELECT (operational viewers)
-- ---------------------------------------------------------------------------

drop policy if exists chains_select_participants
  on public.chains;

create policy chains_select_participants
  on public.chains
  for select
  to authenticated
  using (
    public.is_chain_operational_viewer(id)
  );

-- chains UPDATE unchanged (property members only)

-- ---------------------------------------------------------------------------
-- RLS: chain_nodes SELECT (operational viewers)
-- ---------------------------------------------------------------------------

drop policy if exists chain_nodes_select_participant
  on public.chain_nodes;

create policy chain_nodes_select_participant
  on public.chain_nodes
  for select
  to authenticated
  using (
    public.is_chain_operational_viewer(chain_id)
  );

-- chain_nodes INSERT/UPDATE unchanged (participants only)

-- ---------------------------------------------------------------------------
-- RLS: activities SELECT (operational viewers)
-- ---------------------------------------------------------------------------

drop policy if exists activities_select_chain_participant
  on public.activities;

create policy activities_select_chain_participant
  on public.activities
  for select
  to authenticated
  using (
    (
      property_id is not null
      and exists (
        select 1
        from public.properties p
        where p.id = activities.property_id
          and public.is_chain_operational_viewer(p.chain_id)
      )
    )
    or (
      chain_node_id is not null
      and exists (
        select 1
        from public.chain_nodes cn
        where cn.id = activities.chain_node_id
          and public.is_chain_operational_viewer(cn.chain_id)
      )
    )
  );

-- activities INSERT unchanged (members only)
