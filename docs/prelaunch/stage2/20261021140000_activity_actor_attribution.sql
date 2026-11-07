-- PROPOSED — NOT APPLIED. Stage 2 pre-launch review draft.
-- Promote by copying into supabase/migrations/ only after approval.
--
-- Activity actor attribution (Business Rules 9.8, 9.10, 19.23). Separate
-- security fix: independent of 20261021120000 / 20261021130000.
--
-- activities.updated_by is the generic actor label every chain participant
-- sees ("Homeowner", "Estate Agent", "System"). Today it is caller-supplied
-- on every user write path:
--   - direct inserts (activities_insert_operator, 20261005120000) check
--     can_operate_property / owns_chain_node but not updated_by, so an
--     operator can label an update "estate_agent", "system" or any string;
--   - report_operational_delay / resolve_operational_delay store
--     p_actor_role verbatim in activities.updated_by and
--     operational_delays.created_by_role / resolved_by_role;
--   - break_chain_connection (20261005120000) and
--     convert_searching_placeholder_for_sale (20261005110000) take the label
--     from profiles.account_type, which the user can change.
-- The UI maps unknown values to "Homeowner", but the raw value is returned
-- to every chain viewer through the API, so free text (for example an agency
-- name) and false attribution are both possible. A user-written 'system'
-- also escapes the dormancy and last-update clocks.
--
-- Fix: the label is derived from the caller's authority on the property,
-- never from the client or profiles.account_type:
--   estate_agent  the caller is staff of the actively assigned branch and is
--                 not the seller-side homeowner;
--   homeowner     everyone else who can write (seller side, Buyer Ready node
--                 owner).
-- Direct client inserts are rewritten by a BEFORE INSERT trigger; the four
-- RPCs derive the label (p_actor_role stays in the delay signatures, ignored).
-- The remaining definer writers (_insert_participation_delink_activity,
-- _notify_chain_participants_of_delink: service_role only) write 'system'
-- and are untouched, so legitimate system events are preserved.
--
-- The same copies stop answering "not found" before authorisation, so the
-- RPCs no longer reveal whether an arbitrary property, chain node or delay
-- id exists (unknown and foreign ids get the same error).
--
-- No rows are changed. No table grants change. Activity text stays limited
-- by trg_enforce_structured_activity_update (20260910210000).

-- ---------------------------------------------------------------------------
-- 0) Preflight
-- ---------------------------------------------------------------------------

do $$
declare
  v_src text;
  v_fn text;
begin
  if to_regprocedure('public.is_property_seller_side_homeowner(bigint)') is null
     or to_regprocedure('public.is_ea_assigned_to_property(bigint)') is null
     or to_regprocedure('public.report_operational_delay(text, bigint, bigint, text)') is null
     or to_regprocedure('public.resolve_operational_delay(bigint, text)') is null
     or to_regprocedure('public.break_chain_connection(bigint, text)') is null
     or to_regprocedure('public.convert_searching_placeholder_for_sale(bigint, text, text)') is null
     or to_regprocedure('public.can_operate_property(bigint)') is null
  then
    raise exception 'activity_attribution aborted: a required function is missing';
  end if;

  foreach v_fn in array array[
    'public.report_operational_delay(text, bigint, bigint, text)',
    'public.resolve_operational_delay(bigint, text)'
  ] loop
    select p.prosrc into v_src from pg_proc p where p.oid = to_regprocedure(v_fn);
    if v_src not like '%v_actor_role := nullif(btrim(coalesce(p_actor_role, '''')), '''');%'
       or v_src not like '%coalesce(v_actor_role, ''participant'')%'
    then
      raise exception 'activity_attribution aborted: % differs from 20261005120000', v_fn;
    end if;
  end loop;

  select p.prosrc into v_src from pg_proc p
  where p.oid = to_regprocedure('public.report_operational_delay(text, bigint, bigint, text)');
  if v_src not like '%''property_not_found''%'
     or v_src not like '%''chain_node_not_found''%'
  then
    raise exception 'activity_attribution aborted: report_operational_delay differs from 20261005120000';
  end if;

  select p.prosrc into v_src from pg_proc p
  where p.oid = to_regprocedure('public.resolve_operational_delay(bigint, text)');
  if v_src not like '%''delay_not_found''%'
     or v_src not like '%''already_resolved'', true%'
  then
    raise exception 'activity_attribution aborted: resolve_operational_delay differs from 20261005120000';
  end if;

  select p.prosrc into v_src from pg_proc p
  where p.oid = to_regprocedure('public.break_chain_connection(bigint, text)');
  if v_src not like '%when p.account_type = ''estate_agent'' then ''estate_agent''%'
     or v_src not like '%''property_not_found''%'
     or v_src not like '%Chain Connection Broken - Seller Side%'
  then
    raise exception 'activity_attribution aborted: break_chain_connection differs from 20261005120000';
  end if;

  select p.prosrc into v_src from pg_proc p
  where p.oid = to_regprocedure('public.convert_searching_placeholder_for_sale(bigint, text, text)');
  if v_src not like '%when p.account_type = ''estate_agent'' then ''estate_agent''%'
     or v_src not like '%''sale_not_found''%'
     or v_src not like '%''convert_placeholder''%'
     or v_src not like '%''Onward purchase added''%'
  then
    raise exception 'activity_attribution aborted: convert_searching_placeholder_for_sale differs from 20261005110000';
  end if;

  -- Every other end-user-executable function that writes activities must be
  -- one of the four replaced here; anything else would bypass the derived
  -- label and needs review first.
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosrc ~* 'insert\s+into\s+(public\.)?activities\M'
      and has_function_privilege('authenticated', p.oid, 'execute')
      and p.oid not in (
        to_regprocedure('public.report_operational_delay(text, bigint, bigint, text)'),
        to_regprocedure('public.resolve_operational_delay(bigint, text)'),
        to_regprocedure('public.break_chain_connection(bigint, text)'),
        to_regprocedure('public.convert_searching_placeholder_for_sale(bigint, text, text)')
      )
  ) then
    raise exception 'activity_attribution aborted: an unreviewed user-callable function writes activities';
  end if;

  if not exists (
    select 1 from pg_policies pol
    where pol.schemaname = 'public'
      and pol.tablename = 'activities'
      and pol.policyname = 'activities_insert_operator'
      and pol.cmd = 'INSERT'
  ) then
    raise exception 'activity_attribution aborted: activities_insert_operator missing';
  end if;

  -- The trigger covers INSERT only; refuse if end users can also UPDATE or
  -- write through any other policy.
  if exists (
    select 1 from pg_policies pol
    where pol.schemaname = 'public'
      and pol.tablename = 'activities'
      and pol.cmd in ('INSERT', 'UPDATE', 'ALL')
      and pol.policyname <> 'activities_insert_operator'
  ) then
    raise exception 'activity_attribution aborted: unexpected write policy on activities';
  end if;

  if exists (
    select 1 from pg_trigger t
    where t.tgrelid = 'public.activities'::regclass
      and t.tgname = 'trg_activities_enforce_actor_attribution'
  ) then
    raise exception 'activity_attribution aborted: trigger already exists';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1) Derived actor label
-- ---------------------------------------------------------------------------

create or replace function public._activity_actor_role(
  p_property_id bigint
)
returns text
language sql
stable
security invoker
set search_path = public
as $$
  select case
    when p_property_id is not null
      and not public.is_property_seller_side_homeowner(p_property_id)
      and public.is_ea_assigned_to_property(p_property_id)
    then 'estate_agent'
    else 'homeowner'
  end;
$$;

alter function public._activity_actor_role(bigint) owner to postgres;

comment on function public._activity_actor_role(bigint) is
  'Generic actor label for the caller on a property: estate_agent for staff of the actively assigned branch who are not the seller-side homeowner, otherwise homeowner. Uses only existing definer helpers; reveals nothing beyond the caller''s own role.';

revoke all on function public._activity_actor_role(bigint) from public, anon;
grant execute on function public._activity_actor_role(bigint) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2) Direct client inserts: the label is always derived
-- ---------------------------------------------------------------------------

create or replace function public._trg_activities_enforce_actor_attribution()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  -- Only direct client writes. Owner-run server functions (current_user is
  -- the function owner) keep their own label: the four user-callable writers
  -- derive it with _activity_actor_role; the service_role-only notice
  -- helpers write 'system'.
  if current_user = 'authenticated' then
    new.updated_by := public._activity_actor_role(new.property_id);
  end if;

  return new;
end;
$$;

alter function public._trg_activities_enforce_actor_attribution() owner to postgres;

revoke all on function public._trg_activities_enforce_actor_attribution() from public, anon, authenticated;

drop trigger if exists trg_activities_enforce_actor_attribution on public.activities;

create trigger trg_activities_enforce_actor_attribution
  before insert on public.activities
  for each row
  execute function public._trg_activities_enforce_actor_attribution();

-- ---------------------------------------------------------------------------
-- 3) Delay RPCs: derive the label, no existence oracle; the idempotent
--    answer follows authorisation (copied from 20261005120000)
-- ---------------------------------------------------------------------------

create or replace function public.report_operational_delay(
  p_reason text,
  p_property_id bigint default null,
  p_chain_node_id bigint default null,
  p_actor_role text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_chain_id bigint;
  v_property public.properties%rowtype;
  v_node public.chain_nodes%rowtype;
  v_delay public.operational_delays%rowtype;
  v_activity_message text;
  v_actor_role text;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  if not public.is_valid_operational_delay_reason(p_reason) then
    return jsonb_build_object('ok', false, 'error', 'invalid_reason');
  end if;

  if (p_property_id is null and p_chain_node_id is null)
     or (p_property_id is not null and p_chain_node_id is not null) then
    return jsonb_build_object('ok', false, 'error', 'invalid_target');
  end if;

  v_actor_role := public._activity_actor_role(p_property_id);

  if p_property_id is not null then
    select * into v_property
    from public.properties
    where id = p_property_id;

    if not found or not public.can_operate_property(p_property_id) then
      return jsonb_build_object('ok', false, 'error', 'forbidden');
    end if;

    v_chain_id := v_property.chain_id;

    if exists (
      select 1
      from public.operational_delays d
      where d.property_id = p_property_id
        and d.status = 'active'
    ) then
      return jsonb_build_object('ok', false, 'error', 'delay_already_active');
    end if;
  else
    select * into v_node
    from public.chain_nodes
    where id = p_chain_node_id;

    if not found or v_node.user_id is distinct from v_uid then
      return jsonb_build_object('ok', false, 'error', 'forbidden');
    end if;

    if v_node.node_type is distinct from 'buyer_ready' then
      return jsonb_build_object('ok', false, 'error', 'invalid_target');
    end if;

    v_chain_id := v_node.chain_id;

    if exists (
      select 1
      from public.operational_delays d
      where d.chain_node_id = p_chain_node_id
        and d.status = 'active'
    ) then
      return jsonb_build_object('ok', false, 'error', 'delay_already_active');
    end if;
  end if;

  v_activity_message := 'Delay reported — ' || p_reason;

  insert into public.operational_delays (
    chain_id,
    property_id,
    chain_node_id,
    reason,
    status,
    created_by_user_id,
    created_by_role
  )
  values (
    v_chain_id,
    p_property_id,
    p_chain_node_id,
    p_reason,
    'active',
    v_uid,
    v_actor_role
  )
  returning * into v_delay;

  insert into public.activities (
    property_id,
    chain_node_id,
    update,
    updated_by
  )
  values (
    p_property_id,
    p_chain_node_id,
    v_activity_message,
    coalesce(v_actor_role, 'participant')
  );

  return jsonb_build_object(
    'ok', true,
    'delay_id', v_delay.id,
    'status', v_delay.status,
    'reason', v_delay.reason,
    'created_at', v_delay.created_at,
    'activity_message', v_activity_message
  );
end;
$$;

comment on function public.report_operational_delay(text, bigint, bigint, text) is
  'Create an ACTIVE structured operational delay and timeline activity. No free text. Property targets require can_operate_property; Buyer Ready targets require the node owner. Actor label is derived by _activity_actor_role; p_actor_role is accepted for compatibility and ignored. Unknown and foreign targets both return forbidden.';

alter function public.report_operational_delay(text, bigint, bigint, text) owner to postgres;

revoke all on function public.report_operational_delay(text, bigint, bigint, text) from public, anon;
grant execute on function public.report_operational_delay(text, bigint, bigint, text) to authenticated, service_role;

create or replace function public.resolve_operational_delay(
  p_delay_id bigint,
  p_actor_role text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_delay public.operational_delays%rowtype;
  v_activity_message text;
  v_actor_role text;
  v_allowed boolean := false;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  select * into v_delay
  from public.operational_delays
  where id = p_delay_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  if v_delay.property_id is not null then
    v_allowed := public.can_operate_property(v_delay.property_id);
  elsif v_delay.chain_node_id is not null then
    v_allowed := exists (
      select 1
      from public.chain_nodes cn
      where cn.id = v_delay.chain_node_id
        and cn.user_id = v_uid
    );
  end if;

  if not v_allowed then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  -- Idempotent: already resolved — do not corrupt state or insert duplicate activity.
  if v_delay.status = 'resolved' then
    return jsonb_build_object(
      'ok', true,
      'delay_id', v_delay.id,
      'status', 'resolved',
      'reason', v_delay.reason,
      'resolved_at', v_delay.resolved_at,
      'already_resolved', true
    );
  end if;

  v_actor_role := public._activity_actor_role(v_delay.property_id);
  v_activity_message := 'Delay resolved — ' || v_delay.reason;

  update public.operational_delays
  set
    status = 'resolved',
    resolved_at = timezone('utc', now()),
    resolved_by_user_id = v_uid,
    resolved_by_role = v_actor_role
  where id = v_delay.id
  returning * into v_delay;

  insert into public.activities (
    property_id,
    chain_node_id,
    update,
    updated_by
  )
  values (
    v_delay.property_id,
    v_delay.chain_node_id,
    v_activity_message,
    coalesce(v_actor_role, 'participant')
  );

  return jsonb_build_object(
    'ok', true,
    'delay_id', v_delay.id,
    'status', v_delay.status,
    'reason', v_delay.reason,
    'resolved_at', v_delay.resolved_at,
    'activity_message', v_activity_message,
    'already_resolved', false
  );
end;
$$;

comment on function public.resolve_operational_delay(bigint, text) is
  'Resolve an ACTIVE operational delay. Idempotent; retains history; inserts resolve timeline activity. Property targets require can_operate_property; Buyer Ready targets require the node owner. Actor label is derived by _activity_actor_role; p_actor_role is accepted for compatibility and ignored. Unknown and foreign delays both return forbidden; the idempotent answer is given only to callers who may resolve.';

alter function public.resolve_operational_delay(bigint, text) owner to postgres;

revoke all on function public.resolve_operational_delay(bigint, text) from public, anon;
grant execute on function public.resolve_operational_delay(bigint, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4) break_chain_connection: derived label, no existence oracle
--    (copied from 20261005120000)
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

  if v_property.id is null or not public.can_operate_property(v_property.id) then
    return jsonb_build_object('ok', false, 'error', 'not_authorized');
  end if;

  v_updated_by := public._activity_actor_role(v_property.id);

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

comment on function public.break_chain_connection(bigint, text) is
  'Breaks the buyer-side or seller-side connection of a row. Authorised by can_operate_property; same-chain updates only. Unknown and foreign ids both return not_authorized. Actor label is derived by _activity_actor_role.';

alter function public.break_chain_connection(bigint, text) owner to postgres;

revoke all on function public.break_chain_connection(bigint, text) from public, anon;
grant execute on function public.break_chain_connection(bigint, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5) convert_searching_placeholder_for_sale: label from the anchor row, no
--    existence oracle (copied from 20261005110000)
-- ---------------------------------------------------------------------------

create or replace function public.convert_searching_placeholder_for_sale(
  p_sale_property_id bigint,
  p_address text,
  p_postcode text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sale public.properties%rowtype;
  v_placeholder_id bigint;
  v_placeholder public.properties%rowtype;
  v_converted_id bigint;
  v_address text;
  v_postcode text;
  v_updated_by text;
  v_buyer_user_id uuid;
  v_placeholder_owner uuid;
  v_address_exists boolean;
  v_grant jsonb;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  v_address := nullif(trim(p_address), '');
  v_postcode := nullif(trim(p_postcode), '');

  if v_address is null or v_postcode is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_address');
  end if;

  select *
  into v_sale
  from public.properties
  where id = p_sale_property_id;

  if v_sale.id is null or not public.can_operate_property(p_sale_property_id) then
    return jsonb_build_object('ok', false, 'error', 'not_authorized');
  end if;

  if v_sale.relationship_type is null
     or v_sale.relationship_type not in ('sale', 'purchase')
     or v_sale.stage = 'searching'
  then
    return jsonb_build_object('ok', false, 'error', 'invalid_sale');
  end if;

  if not public.can_operate_property(p_sale_property_id) then
    return jsonb_build_object('ok', false, 'error', 'not_authorized');
  end if;

  v_placeholder_id := v_sale.linked_property_id;

  if v_placeholder_id is null then
    return jsonb_build_object('ok', false, 'error', 'no_placeholder');
  end if;

  select *
  into v_placeholder
  from public.properties
  where id = v_placeholder_id;

  if v_placeholder.id is null then
    return jsonb_build_object('ok', false, 'error', 'placeholder_not_found');
  end if;

  if v_placeholder.stage is distinct from 'searching'
    or v_placeholder.address is not null
    or v_placeholder.postcode is not null
  then
    return jsonb_build_object('ok', false, 'error', 'not_searching_placeholder');
  end if;

  if v_placeholder.chain_id is distinct from v_sale.chain_id then
    return jsonb_build_object('ok', false, 'error', 'chain_mismatch');
  end if;

  select public.property_exists_for_onboarding(
    v_address,
    v_postcode,
    v_placeholder_id
  )
  into v_address_exists;

  if v_address_exists then
    return jsonb_build_object('ok', false, 'error', 'duplicate_address');
  end if;

  v_buyer_user_id :=
    public._property_seller_side_user_id(p_sale_property_id);
  v_placeholder_owner :=
    public.get_property_operational_owner_user_id(v_placeholder_id);

  if v_placeholder_owner is not null
     and v_placeholder_owner is distinct from v_buyer_user_id
  then
    return jsonb_build_object('ok', false, 'error', 'placeholder_owner_mismatch');
  end if;

  v_updated_by := public._activity_actor_role(p_sale_property_id);

  begin
    update public.properties
    set
      stage = 'offer_accepted',
      address = v_address,
      postcode = v_postcode,
      status = 'pending_connection',
      relationship_type = 'purchase',
      buyer_connected = true,
      seller_connected = false,
      is_searching = false,
      is_current_user = true,
      awaiting_buyer = false
    where id = v_placeholder_id
      and stage = 'searching'
      and address is null
      and postcode is null
    returning id
    into v_converted_id;

    if v_converted_id is null then
      raise exception using
        errcode = 'SP001',
        message = 'update_failed';
    end if;

    if v_buyer_user_id is not null then
      v_grant := public._establish_operational_homeowner_core(
        v_converted_id,
        v_buyer_user_id,
        'convert_placeholder',
        false
      );

      if not coalesce((v_grant ->> 'ok')::boolean, false) then
        raise exception using
          errcode = 'SP001',
          message = coalesce(v_grant ->> 'error', 'grant_failed');
      end if;
    end if;

    insert into public.activities (
      property_id,
      update,
      updated_by
    )
    values (
      v_converted_id,
      'Onward purchase added',
      v_updated_by
    );
  exception
    when sqlstate 'SP001' then
      return jsonb_build_object('ok', false, 'error', sqlerrm);
  end;

  return jsonb_build_object(
    'ok', true,
    'property_id', v_converted_id,
    'chain_id', v_sale.chain_id
  );
end;
$$;

comment on function public.convert_searching_placeholder_for_sale(bigint, text, text) is
  'Converts the searching placeholder linked from an anchor row (sale, or purchase the caller sells). Authorised by can_operate_property on the anchor. The purchase is owned by the anchor''s seller-side homeowner, or unowned when there is none. Atomic. Unknown and foreign anchors both return not_authorized. Actor label is derived by _activity_actor_role on the anchor row.';

alter function public.convert_searching_placeholder_for_sale(bigint, text, text) owner to postgres;

revoke all on function public.convert_searching_placeholder_for_sale(bigint, text, text) from public, anon;
grant execute on function public.convert_searching_placeholder_for_sale(bigint, text, text) to authenticated;
