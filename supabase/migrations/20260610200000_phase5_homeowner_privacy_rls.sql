-- Phase 5 PR5: Homeowner privacy enforcement
--
-- Participant-scoped property visibility, strict properties RLS,
-- participant-safe view, and security definer RPCs for join/topology workflows.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.is_chain_participant(
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
    from public.properties p
    inner join public.property_members pm
      on pm.property_id = p.id
    where p.chain_id = p_chain_id
      and pm.user_id = auth.uid()
  );
$$;

comment on function public.is_chain_participant(bigint) is
  'True when the current user is a member of any property in the chain.';

revoke all on function public.is_chain_participant(bigint) from public;
grant execute on function public.is_chain_participant(bigint) to authenticated;

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
-- Participant-safe property view
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
-- RLS: properties
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
-- RLS: chains (INSERT for start-move)
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
-- RLS: chain_nodes
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
-- RLS: activities
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
-- RLS: property_members
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

-- ---------------------------------------------------------------------------
-- RPC: resolve_chain_for_join
-- ---------------------------------------------------------------------------

create or replace function public.resolve_chain_for_join(
  p_access_code text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_chain_id bigint;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  select c.id
  into v_chain_id
  from public.chains c
  where c.access_code = p_access_code;

  if v_chain_id is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_access_code');
  end if;

  return jsonb_build_object(
    'ok', true,
    'chain_id', v_chain_id
  );
end;
$$;

revoke all on function public.resolve_chain_for_join(text) from public;
grant execute on function public.resolve_chain_for_join(text) to authenticated;

-- ---------------------------------------------------------------------------
-- RPC: join_chain_property
-- ---------------------------------------------------------------------------

create or replace function public.join_chain_property(
  p_access_code text,
  p_address text,
  p_postcode text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_chain_id bigint;
  v_property public.properties%rowtype;
  v_role text;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  select c.id
  into v_chain_id
  from public.chains c
  where c.access_code = p_access_code;

  if v_chain_id is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_access_code');
  end if;

  select *
  into v_property
  from public.properties p
  where p.chain_id = v_chain_id
    and p.address = p_address
    and p.postcode = p_postcode;

  if v_property.id is null then
    return jsonb_build_object('ok', false, 'error', 'property_not_found');
  end if;

  update public.properties
  set
    status = 'healthy',
    buyer_connected = case
      when v_property.relationship_type in ('sale', 'purchase') then true
      else buyer_connected
    end,
    seller_connected = case
      when v_property.relationship_type = 'purchase' then true
      else seller_connected
    end
  where id = v_property.id;

  v_role := case
    when v_property.relationship_type = 'sale' then 'buyer'
    else 'seller'
  end;

  if not exists (
    select 1
    from public.property_members pm
    where pm.property_id = v_property.id
      and pm.user_id = v_user_id
  ) then
    insert into public.property_members (
      property_id,
      user_id,
      role
    )
    values (
      v_property.id,
      v_user_id,
      v_role
    );
  end if;

  select *
  into v_property
  from public.properties
  where id = v_property.id;

  return jsonb_build_object(
    'ok', true,
    'property_id', v_property.id,
    'chain_id', v_property.chain_id,
    'linked_property_id', v_property.linked_property_id,
    'relationship_type', v_property.relationship_type,
    'joining_role', v_role
  );
end;
$$;

revoke all on function public.join_chain_property(text, text, text) from public;
grant execute on function public.join_chain_property(text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- RPC: property_exists_for_onboarding
-- ---------------------------------------------------------------------------

create or replace function public.property_exists_for_onboarding(
  p_address text,
  p_postcode text,
  p_exclude_property_id bigint default null
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.properties p
    where p.address = p_address
      and p.postcode = p_postcode
      and (
        p_exclude_property_id is null
        or p.id <> p_exclude_property_id
      )
  );
$$;

revoke all on function public.property_exists_for_onboarding(text, text, bigint) from public;
grant execute on function public.property_exists_for_onboarding(text, text, bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- RPC: establish_connected_hop
-- ---------------------------------------------------------------------------

create or replace function public.establish_connected_hop(
  p_purchase_property_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_purchase public.properties%rowtype;
  v_host_buyer_user_id uuid;
  v_host_sale public.properties%rowtype;
  v_previous_downstream_id bigint;
  v_downstream_after_purchase_id bigint;
  v_existing_downstream public.properties%rowtype;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  select *
  into v_purchase
  from public.properties
  where id = p_purchase_property_id;

  if v_purchase.id is null then
    return jsonb_build_object('ok', false, 'error', 'purchase_not_found');
  end if;

  if v_purchase.relationship_type is distinct from 'purchase' then
    return jsonb_build_object('ok', false, 'error', 'not_purchase');
  end if;

  if not public.is_property_member(v_purchase.id) then
    return jsonb_build_object('ok', false, 'error', 'not_authorized');
  end if;

  update public.properties
  set
    status = 'healthy',
    seller_connected = true,
    buyer_connected = true
  where id = v_purchase.id;

  select pm.user_id
  into v_host_buyer_user_id
  from public.property_members pm
  where pm.property_id = v_purchase.id
    and pm.role = 'buyer'
  limit 1;

  if v_host_buyer_user_id is null then
    return jsonb_build_object('ok', true, 'linked', false);
  end if;

  select p.*
  into v_host_sale
  from public.properties p
  inner join public.property_members pm
    on pm.property_id = p.id
  where p.chain_id = v_purchase.chain_id
    and p.relationship_type = 'sale'
    and pm.user_id = v_host_buyer_user_id
    and pm.role = 'seller'
  limit 1;

  if v_host_sale.id is null then
    return jsonb_build_object('ok', true, 'linked', false);
  end if;

  v_previous_downstream_id := v_host_sale.linked_property_id;
  v_downstream_after_purchase_id := null;

  if v_previous_downstream_id is not null
    and v_previous_downstream_id <> v_purchase.id then
    select *
    into v_existing_downstream
    from public.properties
    where id = v_previous_downstream_id;

    if v_existing_downstream.id is not null
      and v_existing_downstream.stage = 'searching'
      and v_existing_downstream.address is null
      and v_existing_downstream.postcode is null then
      v_downstream_after_purchase_id := v_existing_downstream.id;
    end if;
  end if;

  if v_purchase.linked_property_id is not null
    and v_purchase.linked_property_id <> v_downstream_after_purchase_id then
    select *
    into v_existing_downstream
    from public.properties
    where id = v_purchase.linked_property_id;

    if v_existing_downstream.id is not null
      and v_existing_downstream.stage = 'searching'
      and v_existing_downstream.address is null
      and v_existing_downstream.postcode is null then
      v_downstream_after_purchase_id := v_existing_downstream.id;
    end if;
  end if;

  update public.properties
  set
    status = 'healthy',
    seller_connected = true,
    buyer_connected = true,
    linked_property_id = v_purchase.id
  where id = v_host_sale.id;

  update public.properties
  set
    status = 'healthy',
    seller_connected = true,
    buyer_connected = true,
    linked_property_id = v_downstream_after_purchase_id
  where id = v_purchase.id;

  return jsonb_build_object('ok', true, 'linked', true);
end;
$$;

revoke all on function public.establish_connected_hop(bigint) from public;
grant execute on function public.establish_connected_hop(bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- RPC: break_chain_connection
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

  if not public.is_property_member(v_property.id) then
    return jsonb_build_object('ok', false, 'error', 'not_authorized');
  end if;

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
    'homeowner'
  );

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.break_chain_connection(bigint, text) from public;
grant execute on function public.break_chain_connection(bigint, text) to authenticated;

-- ---------------------------------------------------------------------------
-- RPC: cleanup_abandoned_onboarding_chain
-- ---------------------------------------------------------------------------

create or replace function public.cleanup_abandoned_onboarding_chain(
  p_chain_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  if not exists (
    select 1
    from public.properties p
    where p.chain_id = p_chain_id
  ) then
    delete from public.chain_nodes
    where chain_id = p_chain_id;

    delete from public.chains
    where id = p_chain_id;

    return jsonb_build_object('ok', true, 'empty_chain', true);
  end if;

  if not exists (
    select 1
    from public.properties p
    where p.chain_id = p_chain_id
      and p.created_by_user_id = v_user_id
  ) then
    return jsonb_build_object('ok', false, 'error', 'not_authorized');
  end if;

  if exists (
    select 1
    from public.property_members pm
    inner join public.properties p
      on p.id = pm.property_id
    where p.chain_id = p_chain_id
      and pm.user_id <> v_user_id
  ) then
    return jsonb_build_object('ok', false, 'error', 'other_participants');
  end if;

  delete from public.activities
  where property_id in (
    select id from public.properties where chain_id = p_chain_id
  );

  delete from public.activities
  where chain_node_id in (
    select id from public.chain_nodes where chain_id = p_chain_id
  );

  delete from public.property_members
  where property_id in (
    select id from public.properties where chain_id = p_chain_id
  );

  delete from public.properties
  where chain_id = p_chain_id;

  delete from public.chain_nodes
  where chain_id = p_chain_id;

  delete from public.chains
  where id = p_chain_id;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.cleanup_abandoned_onboarding_chain(bigint) from public;
grant execute on function public.cleanup_abandoned_onboarding_chain(bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- RPC: get_next_chain_position
-- ---------------------------------------------------------------------------

create or replace function public.get_next_chain_position(
  p_chain_id bigint
)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select max(p.chain_position)
      from public.properties p
      where p.chain_id = p_chain_id
    ),
    0
  ) + 1;
$$;

revoke all on function public.get_next_chain_position(bigint) from public;
grant execute on function public.get_next_chain_position(bigint) to authenticated;
