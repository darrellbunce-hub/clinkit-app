-- PR5 reconciliation: complete partial apply of phase5 homeowner privacy RLS
--
-- Live dev audit (2026-06-06) found 20260610200000 partially applied:
--   present — is_chain_participant, chain_properties_participant (outdated definition),
--             chain_nodes RLS, chains_insert_authenticated, PR5 RPCs, properties anon revoke
--   missing — current_user_property_role, properties/activities/property_members RLS
--   outdated — chain_properties_participant (inline scalar role subquery → 21000 on duplicates)
--
-- Prerequisite: 20260610170000 (is_property_member, is_ea_assigned_to_property)
-- Supersedes manual re-run of the RLS sections in 20260610200000 and 20260610210000.
-- Idempotent: safe to run when PR5 is already fully applied.

-- ---------------------------------------------------------------------------
-- Helper: current_user_property_role (also in 10200000 / 10210000)
-- ---------------------------------------------------------------------------

create or replace function public.current_user_property_role(
  p_property_id bigint
)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select pm.role
  from public.property_members pm
  where pm.property_id = p_property_id
    and pm.user_id = auth.uid()
  order by
    case pm.role
      when 'seller' then 1
      when 'buyer' then 2
      else 3
    end,
    pm.created_at desc nulls last,
    pm.id
  limit 1;
$$;

comment on function public.current_user_property_role(bigint) is
  'Returns one membership role for the current user on a property; prefers seller/buyer over legacy roles.';

revoke all on function public.current_user_property_role(bigint) from public;
grant execute on function public.current_user_property_role(bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- Participant-safe property view (10210000 fix)
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
    else null
  end as address,
  case
    when public.is_property_member(p.id) then p.postcode
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
  and public.is_chain_participant(p.chain_id);

comment on view public.chain_properties_participant is
  'Chain topology for participants; address/postcode visible only for own properties.';

revoke all on public.chain_properties_participant from public;
revoke all on public.chain_properties_participant from anon;
grant select on public.chain_properties_participant to authenticated;

-- ---------------------------------------------------------------------------
-- RLS: properties (missing from partial apply)
-- ---------------------------------------------------------------------------

alter table public.properties enable row level security;

drop policy if exists properties_select_member_or_agent
  on public.properties;

create policy properties_select_member_or_agent
  on public.properties
  for select
  to authenticated
  using (
    public.is_property_member(id)
    or public.is_ea_assigned_to_property(id)
  );

drop policy if exists properties_insert_creator
  on public.properties;

create policy properties_insert_creator
  on public.properties
  for insert
  to authenticated
  with check (
    created_by_user_id = auth.uid()
  );

drop policy if exists properties_update_member
  on public.properties;

create policy properties_update_member
  on public.properties
  for update
  to authenticated
  using (
    public.is_property_member(id)
  )
  with check (
    public.is_property_member(id)
  );

revoke all on public.properties from anon;
grant select, insert, update on public.properties to authenticated;

-- ---------------------------------------------------------------------------
-- RLS: chains INSERT (idempotent — likely already present)
-- ---------------------------------------------------------------------------

drop policy if exists chains_insert_authenticated
  on public.chains;

create policy chains_insert_authenticated
  on public.chains
  for insert
  to authenticated
  with check (
    auth.uid() is not null
  );

-- ---------------------------------------------------------------------------
-- RLS: chain_nodes (idempotent — likely already present)
-- ---------------------------------------------------------------------------

alter table public.chain_nodes enable row level security;

drop policy if exists chain_nodes_select_participant
  on public.chain_nodes;

create policy chain_nodes_select_participant
  on public.chain_nodes
  for select
  to authenticated
  using (
    public.is_chain_participant(chain_id)
  );

drop policy if exists chain_nodes_insert_participant
  on public.chain_nodes;

create policy chain_nodes_insert_participant
  on public.chain_nodes
  for insert
  to authenticated
  with check (
    auth.uid() is not null
    and (
      public.is_chain_participant(chain_id)
      or not exists (
        select 1
        from public.properties p
        where p.chain_id = chain_id
      )
    )
  );

drop policy if exists chain_nodes_update_participant
  on public.chain_nodes;

create policy chain_nodes_update_participant
  on public.chain_nodes
  for update
  to authenticated
  using (
    public.is_chain_participant(chain_id)
  )
  with check (
    public.is_chain_participant(chain_id)
  );

revoke all on public.chain_nodes from anon;
grant select, insert, update on public.chain_nodes to authenticated;

-- ---------------------------------------------------------------------------
-- RLS: activities (missing from partial apply)
-- ---------------------------------------------------------------------------

alter table public.activities enable row level security;

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
          and public.is_chain_participant(p.chain_id)
      )
    )
    or (
      chain_node_id is not null
      and exists (
        select 1
        from public.chain_nodes cn
        where cn.id = activities.chain_node_id
          and public.is_chain_participant(cn.chain_id)
      )
    )
  );

drop policy if exists activities_insert_participant
  on public.activities;

create policy activities_insert_participant
  on public.activities
  for insert
  to authenticated
  with check (
    (
      property_id is not null
      and public.is_property_member(property_id)
    )
    or (
      chain_node_id is not null
      and exists (
        select 1
        from public.chain_nodes cn
        where cn.id = activities.chain_node_id
          and public.is_chain_participant(cn.chain_id)
      )
    )
  );

revoke all on public.activities from anon;
grant select, insert on public.activities to authenticated;

-- ---------------------------------------------------------------------------
-- RLS: property_members (missing from partial apply)
-- ---------------------------------------------------------------------------

alter table public.property_members enable row level security;

drop policy if exists property_members_select_own
  on public.property_members;

create policy property_members_select_own
  on public.property_members
  for select
  to authenticated
  using (
    user_id = auth.uid()
  );

drop policy if exists property_members_insert_own
  on public.property_members;

create policy property_members_insert_own
  on public.property_members
  for insert
  to authenticated
  with check (
    user_id = auth.uid()
  );

revoke all on public.property_members from anon;
grant select, insert on public.property_members to authenticated;
