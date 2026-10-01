-- SEC: properties chain integrity guard (forward-only).
--
-- Problem:
--   properties_insert_creator accepts any chain_id, and properties_update_member
--   lets every member of a row (including counterparties added by
--   join_chain_property) update every column. A user could therefore insert or
--   move a property into a chain they have no relationship with, then become a
--   participant of that chain via establish_operational_homeowner_for_created_property.
--   linked_property_id could also point across chains, and break_chain_connection
--   followed that link without a chain check.
--
-- Design (Approach E):
--   A BEFORE INSERT / UPDATE OF chain_id, linked_property_id, created_by_user_id
--   trigger on public.properties. The trigger function is SECURITY INVOKER, so
--   current_user is the role that issued the write:
--     authenticated  direct PostgREST write (including writes through views)
--     anon           rejected
--     other roles    trusted: SECURITY DEFINER functions (owner role),
--                    service_role, FK cascades (table owner), migrations
--   Direct-caller detection uses current_user inside the invoker trigger only.
--   The SECURITY DEFINER helpers below always run as their owner, so they never
--   decide whether a write is direct; they use auth.uid() solely to identify the
--   end user once the trigger has established that the write is direct.
--
-- Direct authenticated write rules:
--   INSERT
--     created_by_user_id = auth.uid()
--     caller_may_place_property_in_chain(chain_id)
--     linked_property_id is null or property_in_caller_accessible_chain(linked, chain_id)
--   UPDATE
--     created_by_user_id is immutable
--     chain_id may change only when the caller created the row, owns the source
--       chain with nobody else on it (caller_owns_unshared_chain, which also
--       means no other member of the row), and already participates in the
--       destination chain through another property (is_chain_participant)
--     linked_property_id (when changed, or when chain_id changes) is null or
--       property_in_caller_accessible_chain(linked, new chain_id)
--
-- caller_may_place_property_in_chain deliberately has no assigned-EA arm:
--   estate agents place properties only through SECURITY DEFINER RPCs
--   (create_ea_operational_property, join_ea_operational_chain,
--   create_searching_placeholder_for_sale from 20261001110000).
--
-- Also in this migration:
--   establish_operational_homeowner_for_created_property: rejects estate-agent
--     accounts (estate_agent_cannot_be_homeowner) and adds chain authorisation
--     after the existing creator check (latest body: 20260727100000).
--   break_chain_connection: seller-side upstream update and buyer-side inbound
--     updates constrained to the property's own chain (latest body: 20260930200000).
--   All other statements in both bodies are unchanged; ACLs are restated as-is.
--
-- Does not change RLS policies, table grants, other functions, or data.
--
-- Rollback (manual, in order):
--   1. drop trigger if exists trg_properties_guard_direct_writes on public.properties;
--   2. drop function if exists public._trg_properties_guard_direct_writes();
--   3. Re-run the establish_operational_homeowner_for_created_property section of
--      20260727100000 and the break_chain_connection section of 20260930200000.
--   4. drop function if exists public.property_in_caller_accessible_chain(bigint, bigint);
--      drop function if exists public.caller_may_place_property_in_chain(bigint);
--      drop function if exists public.caller_owns_unshared_chain(bigint);

-- ---------------------------------------------------------------------------
-- 0) Preflight
-- ---------------------------------------------------------------------------

do $$
declare
  v_missing text[] := array[]::text[];
  v_name text;
  v_src text;
  v_invoker_writers text;
begin
  foreach v_name in array array[
    'public.properties',
    'public.chains',
    'public.property_members',
    'public.property_ea_assignments',
    'public.property_delegates',
    'public.ea_branch_members'
  ]
  loop
    if to_regclass(v_name) is null then
      v_missing := array_append(v_missing, v_name);
    end if;
  end loop;

  foreach v_name in array array[
    'auth.uid()',
    'public.is_chain_participant(bigint)',
    'public._is_estate_agent_account(uuid)',
    'public.is_property_member(bigint)',
    'public.is_ea_delegated_editor_on_property(bigint)',
    'public._require_verified_email_for_transaction()',
    'public._establish_operational_homeowner_core(bigint, uuid, text, boolean)',
    'public.establish_operational_homeowner_for_created_property(bigint)',
    'public.break_chain_connection(bigint, text)'
  ]
  loop
    if to_regprocedure(v_name) is null then
      v_missing := array_append(v_missing, v_name);
    end if;
  end loop;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'chains'
      and column_name = 'created_by_user_id'
  ) then
    v_missing := array_append(v_missing, 'chains.created_by_user_id');
  end if;

  if (
    select count(*)
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'properties'
      and column_name in ('chain_id', 'linked_property_id', 'created_by_user_id')
  ) <> 3 then
    v_missing := array_append(v_missing, 'properties.chain_id/linked_property_id/created_by_user_id');
  end if;

  if cardinality(v_missing) > 0 then
    raise exception
      'properties_chain_integrity aborted: missing dependencies (%)',
      array_to_string(v_missing, ', ');
  end if;

  -- The invoker trigger calls these directly as the authenticated role.
  if not has_function_privilege('authenticated', 'auth.uid()', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.is_chain_participant(bigint)', 'EXECUTE')
  then
    raise exception
      'properties_chain_integrity aborted: authenticated lacks EXECUTE on auth.uid() or is_chain_participant(bigint)';
  end if;

  -- Replaced bodies must still be the expected repository versions.
  select p.prosrc
  into v_src
  from pg_proc p
  where p.oid = to_regprocedure('public.establish_operational_homeowner_for_created_property(bigint)');

  if v_src not like '%p.created_by_user_id = auth.uid()%'
     or v_src not like '%_require_verified_email_for_transaction()%'
     or v_src not like '%public._establish_operational_homeowner_core(%'
     or v_src not like '%''start_move''%'
  then
    raise exception
      'properties_chain_integrity aborted: establish_operational_homeowner_for_created_property body differs from 20260727100000';
  end if;

  select p.prosrc
  into v_src
  from pg_proc p
  where p.oid = to_regprocedure('public.break_chain_connection(bigint, text)');

  if v_src not like '%public.is_ea_delegated_editor_on_property(v_property.id)%'
     or v_src not like '%v_upstream_id := v_property.linked_property_id;%'
     or v_src not like '%Chain Connection Broken - Seller Side%'
     or v_src not like '%v_updated_by%'
  then
    raise exception
      'properties_chain_integrity aborted: break_chain_connection body differs from 20260930200000';
  end if;

  -- Every database function that writes properties must be SECURITY DEFINER;
  -- a SECURITY INVOKER writer called by an end user would be subject to the
  -- direct-write rules below.
  select string_agg(p.oid::regprocedure::text, ', ' order by p.oid::regprocedure::text)
  into v_invoker_writers
  from pg_proc p
  inner join pg_namespace n
    on n.oid = p.pronamespace
  where n.nspname = 'public'
    and not p.prosecdef
    and p.proname <> '_trg_properties_guard_direct_writes'
    and p.prosrc ~* '(insert\s+into|update)\s+(public\.)?properties\M';

  if v_invoker_writers is not null then
    raise exception
      'properties_chain_integrity aborted: SECURITY INVOKER functions write properties (%)',
      v_invoker_writers;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1) Helper: caller_owns_unshared_chain
-- ---------------------------------------------------------------------------

create or replace function public.caller_owns_unshared_chain(
  p_chain_id bigint
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    auth.uid() is not null
    and exists (
      select 1
      from public.chains c
      where c.id = p_chain_id
        and c.created_by_user_id = auth.uid()
    )
    and not exists (
      select 1
      from public.properties p
      where p.chain_id = p_chain_id
        and p.created_by_user_id is distinct from auth.uid()
    )
    and not exists (
      select 1
      from public.properties p
      inner join public.property_members pm
        on pm.property_id = p.id
      where p.chain_id = p_chain_id
        and pm.user_id is distinct from auth.uid()
    )
    and not exists (
      select 1
      from public.properties p
      inner join public.property_ea_assignments pea
        on pea.property_id = p.id
      where p.chain_id = p_chain_id
        and pea.status = 'active'
    )
    and not exists (
      select 1
      from public.properties p
      inner join public.property_delegates pd
        on pd.property_id = p.id
      where p.chain_id = p_chain_id
        and pd.status = 'active'
    );
$$;

alter function public.caller_owns_unshared_chain(bigint) owner to postgres;

comment on function public.caller_owns_unshared_chain(bigint) is
  'True when the current user created the chain and nobody else has access to it: every property was created by the caller, no other member, no active EA assignment, no active delegate. Used by the properties direct-write guard for chain_id moves.';

revoke all on function public.caller_owns_unshared_chain(bigint) from public, anon, authenticated;
grant execute on function public.caller_owns_unshared_chain(bigint) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2) Helper: caller_may_place_property_in_chain
-- ---------------------------------------------------------------------------

create or replace function public.caller_may_place_property_in_chain(
  p_chain_id bigint
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    auth.uid() is not null
    and p_chain_id is not null
    and (
      exists (
        select 1
        from public.chains c
        where c.id = p_chain_id
          and c.created_by_user_id = auth.uid()
      )
      or public.is_chain_participant(p_chain_id)
    );
$$;

alter function public.caller_may_place_property_in_chain(bigint) owner to postgres;

comment on function public.caller_may_place_property_in_chain(bigint) is
  'True when the current user created the chain or is a member of a property in it. Gates direct property inserts and establish_operational_homeowner_for_created_property. Estate agents place properties only through SECURITY DEFINER RPCs.';

revoke all on function public.caller_may_place_property_in_chain(bigint) from public, anon, authenticated;
grant execute on function public.caller_may_place_property_in_chain(bigint) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3) Helper: property_in_caller_accessible_chain
-- ---------------------------------------------------------------------------

create or replace function public.property_in_caller_accessible_chain(
  p_property_id bigint,
  p_chain_id bigint
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    auth.uid() is not null
    and p_property_id is not null
    and p_chain_id is not null
    and exists (
      select 1
      from public.properties p
      where p.id = p_property_id
        and p.chain_id = p_chain_id
    )
    and public.caller_may_place_property_in_chain(p_chain_id);
$$;

alter function public.property_in_caller_accessible_chain(bigint, bigint) owner to postgres;

comment on function public.property_in_caller_accessible_chain(bigint, bigint) is
  'True when the property belongs to the given chain and the current user may place properties in that chain. Gates direct writes of properties.linked_property_id.';

revoke all on function public.property_in_caller_accessible_chain(bigint, bigint) from public, anon, authenticated;
grant execute on function public.property_in_caller_accessible_chain(bigint, bigint) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4) Trigger function (SECURITY INVOKER)
-- ---------------------------------------------------------------------------

create or replace function public._trg_properties_guard_direct_writes()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_uid uuid;
begin
  if current_user = 'anon' then
    raise exception 'properties_direct_write_not_authenticated'
      using errcode = '42501';
  end if;

  if current_user <> 'authenticated' then
    return new;
  end if;

  v_uid := auth.uid();

  if v_uid is null then
    raise exception 'properties_direct_write_not_authenticated'
      using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    if new.created_by_user_id is distinct from v_uid then
      raise exception 'properties_insert_creator_mismatch'
        using errcode = '42501';
    end if;

    if not public.caller_may_place_property_in_chain(new.chain_id) then
      raise exception 'properties_insert_chain_not_authorised'
        using errcode = '42501';
    end if;

    if new.linked_property_id is not null
       and not public.property_in_caller_accessible_chain(
         new.linked_property_id,
         new.chain_id
       )
    then
      raise exception 'properties_linked_property_not_in_chain'
        using errcode = '42501';
    end if;

    return new;
  end if;

  if new.created_by_user_id is distinct from old.created_by_user_id then
    raise exception 'properties_created_by_immutable'
      using errcode = '42501';
  end if;

  if new.chain_id is distinct from old.chain_id then
    if new.chain_id is null
       or old.created_by_user_id is distinct from v_uid
       or not public.caller_owns_unshared_chain(old.chain_id)
       or not public.is_chain_participant(new.chain_id)
    then
      raise exception 'properties_chain_move_not_authorised'
        using errcode = '42501';
    end if;
  end if;

  if new.linked_property_id is not null
     and (
       new.linked_property_id is distinct from old.linked_property_id
       or new.chain_id is distinct from old.chain_id
     )
     and not public.property_in_caller_accessible_chain(
       new.linked_property_id,
       new.chain_id
     )
  then
    raise exception 'properties_linked_property_not_in_chain'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

alter function public._trg_properties_guard_direct_writes() owner to postgres;

comment on function public._trg_properties_guard_direct_writes() is
  'SECURITY INVOKER guard for direct authenticated writes to properties.chain_id, linked_property_id and created_by_user_id. Rejects anon; other roles (SECURITY DEFINER owners, FK cascades) pass through.';

revoke all on function public._trg_properties_guard_direct_writes() from public, anon, authenticated;

drop trigger if exists trg_properties_guard_direct_writes
  on public.properties;

create trigger trg_properties_guard_direct_writes
  before insert or update of chain_id, linked_property_id, created_by_user_id
  on public.properties
  for each row
  execute function public._trg_properties_guard_direct_writes();

-- ---------------------------------------------------------------------------
-- 5) RPC: establish_operational_homeowner_for_created_property (chain authz)
-- ---------------------------------------------------------------------------

create or replace function public.establish_operational_homeowner_for_created_property(
  p_property_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email_gate jsonb;
begin
  v_email_gate := public._require_verified_email_for_transaction();

  if v_email_gate is not null then
    return v_email_gate;
  end if;

  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  if public._is_estate_agent_account(auth.uid()) then
    return jsonb_build_object('ok', false, 'error', 'estate_agent_cannot_be_homeowner');
  end if;

  if not exists (
    select 1
    from public.properties p
    where p.id = p_property_id
      and p.created_by_user_id = auth.uid()
      and p.relationship_type in ('sale', 'purchase')
  ) then
    return jsonb_build_object('ok', false, 'error', 'not_authorized');
  end if;

  if not exists (
    select 1
    from public.properties p
    where p.id = p_property_id
      and public.caller_may_place_property_in_chain(p.chain_id)
  ) then
    return jsonb_build_object('ok', false, 'error', 'not_authorized');
  end if;

  return public._establish_operational_homeowner_core(
    p_property_id,
    auth.uid(),
    'start_move',
    false
  );
end;
$$;

comment on function public.establish_operational_homeowner_for_created_property(bigint) is
  'Start Move / bootstrap: grants operational homeowner only for properties the caller created, in a chain the caller may place properties in. Estate-agent accounts are rejected.';

revoke all on function public.establish_operational_homeowner_for_created_property(bigint) from public;
grant execute on function public.establish_operational_homeowner_for_created_property(bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- 6) RPC: break_chain_connection (same-chain updates only)
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
      where id = v_upstream_id
        and chain_id = v_property.chain_id;
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
        and chain_id = v_property.chain_id
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
