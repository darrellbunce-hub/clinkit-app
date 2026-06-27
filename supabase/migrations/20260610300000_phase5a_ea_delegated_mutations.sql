-- Phase 5A: Estate agent delegated operational mutations
--
-- Allows branch-assigned estate agents to mutate operational workflows when
-- homeowner_only_updates = false on an active property assignment.
-- View access unchanged (Phase 4A). Homeowner membership checks preserved.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.is_ea_delegated_editor_on_property(
  p_property_id bigint
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
    inner join public.ea_branch_members bm
      on bm.branch_id = pea.branch_id
    where pea.property_id = p_property_id
      and pea.status = 'active'
      and pea.homeowner_only_updates = false
      and bm.user_id = auth.uid()
  );
$$;

comment on function public.is_ea_delegated_editor_on_property(bigint) is
  'True when the current user may post delegated updates on the assigned property.';

create or replace function public.is_ea_delegated_editor_on_chain(
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
      and pea.homeowner_only_updates = false
      and bm.user_id = auth.uid()
  );
$$;

comment on function public.is_ea_delegated_editor_on_chain(bigint) is
  'True when the current user may post delegated updates on any assigned property in the chain.';

revoke all on function public.is_ea_delegated_editor_on_property(bigint) from public;
revoke all on function public.is_ea_delegated_editor_on_chain(bigint) from public;

grant execute on function public.is_ea_delegated_editor_on_property(bigint) to authenticated;
grant execute on function public.is_ea_delegated_editor_on_chain(bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS: properties UPDATE (delegated editors)
-- ---------------------------------------------------------------------------

drop policy if exists properties_update_member
  on public.properties;

create policy properties_update_member
  on public.properties
  for update
  to authenticated
  using (
    public.is_property_member(id)
    or public.is_ea_delegated_editor_on_property(id)
  )
  with check (
    public.is_property_member(id)
    or public.is_ea_delegated_editor_on_property(id)
  );

-- ---------------------------------------------------------------------------
-- RLS: chain_nodes UPDATE (delegated editors)
-- ---------------------------------------------------------------------------

drop policy if exists chain_nodes_update_participant
  on public.chain_nodes;

create policy chain_nodes_update_participant
  on public.chain_nodes
  for update
  to authenticated
  using (
    public.is_chain_participant(chain_id)
    or public.is_ea_delegated_editor_on_chain(chain_id)
  )
  with check (
    public.is_chain_participant(chain_id)
    or public.is_ea_delegated_editor_on_chain(chain_id)
  );

-- ---------------------------------------------------------------------------
-- RLS: chains UPDATE (completion lifecycle — delegated editors)
-- ---------------------------------------------------------------------------

drop policy if exists chains_update_participants
  on public.chains;

create policy chains_update_participants
  on public.chains
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.properties p
      inner join public.property_members pm
        on pm.property_id = p.id
      where p.chain_id = chains.id
        and pm.user_id = auth.uid()
    )
    or public.is_ea_delegated_editor_on_chain(id)
  )
  with check (
    exists (
      select 1
      from public.properties p
      inner join public.property_members pm
        on pm.property_id = p.id
      where p.chain_id = chains.id
        and pm.user_id = auth.uid()
    )
    or public.is_ea_delegated_editor_on_chain(id)
  );

-- ---------------------------------------------------------------------------
-- RLS: activities INSERT (delegated editors)
-- ---------------------------------------------------------------------------

drop policy if exists activities_insert_participant
  on public.activities;

create policy activities_insert_participant
  on public.activities
  for insert
  to authenticated
  with check (
    (
      property_id is not null
      and (
        public.is_property_member(property_id)
        or public.is_ea_delegated_editor_on_property(property_id)
      )
    )
    or (
      chain_node_id is not null
      and exists (
        select 1
        from public.chain_nodes cn
        where cn.id = activities.chain_node_id
          and (
            public.is_chain_participant(cn.chain_id)
            or public.is_ea_delegated_editor_on_chain(cn.chain_id)
          )
      )
    )
  );

-- ---------------------------------------------------------------------------
-- RPC: break_chain_connection (delegated editors + audit role)
-- ---------------------------------------------------------------------------

create or replace function public.break_chain_connection(
  p_property_id bigint,
  p_break_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_property public.properties%rowtype;
  v_upstream_id bigint;
  v_inbound public.properties%rowtype;
  v_update_message text;
  v_updated_by text;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  select *
  into v_property
  from public.properties
  where id = p_property_id;

  if v_property.id is null then
    return jsonb_build_object('ok', false, 'error', 'property_not_found');
  end if;

  if not (
    public.is_property_member(v_property.id)
    or public.is_ea_delegated_editor_on_property(v_property.id)
  ) then
    return jsonb_build_object('ok', false, 'error', 'not_authorized');
  end if;

  select case
    when p.account_type = 'estate_agent' then 'estate_agent'
    else 'homeowner'
  end
  into v_updated_by
  from public.profiles p
  where p.id = auth.uid();

  v_updated_by := coalesce(v_updated_by, 'homeowner');

  v_update_message := case
    when p_break_reason = 'buyer_side'
      then 'Chain Connection Broken - Buyer Side'
    else 'Chain Connection Broken - Seller Side'
  end;

  if p_break_reason = 'seller_side' then
    v_upstream_id := v_property.linked_property_id;

    update public.properties
    set
      status = 'broken_connection',
      linked_property_id = null,
      seller_connected = false
    where id = v_property.id;

    if v_upstream_id is not null then
      update public.properties
      set buyer_connected = false
      where id = v_upstream_id;
    end if;
  else
    update public.properties
    set
      status = 'broken_connection',
      buyer_connected = false
    where id = v_property.id;

    for v_inbound in
      select *
      from public.properties
      where linked_property_id = v_property.id
    loop
      update public.properties
      set
        linked_property_id = null,
        seller_connected = false
      where id = v_inbound.id;
    end loop;
  end if;

  insert into public.activities (
    property_id,
    update,
    updated_by
  )
  values (
    v_property.id,
    v_update_message,
    v_updated_by
  );

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.break_chain_connection(bigint, text) from public;
grant execute on function public.break_chain_connection(bigint, text) to authenticated;
