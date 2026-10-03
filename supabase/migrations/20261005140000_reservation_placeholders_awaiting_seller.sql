-- Reservation follow-up: unrepresented placeholders stay reserved.
--
-- 20261005100000 classified a row with neither side represented as 'stale' and
-- let its address be reused. Under the bounded placeholder lifecycle
-- (20261005130000) an unrepresented row is a placeholder that stays in the
-- chain until it is actually released, so its address stays reserved:
--
--   historical      missing row, searching placeholder, redacted address,
--                   lifecycle released / anonymised
--   lifecycle_held  lifecycle archived
--   awaiting_seller seller side unrepresented (any relationship type,
--                   including a sale with a buyer and no seller)
--   awaiting_buyer  sale with a seller side and no buyer
--   live_homeowner  homeowner seller side
--   live_ea_managed EA seller side
--
-- 'stale' is no longer produced. property_address_is_reserved is therefore
-- "state is not historical"; check_start_move_address keeps skipping
-- 'historical' (its 'stale' branch is now unreachable) and still routes only a
-- purchase awaiting its seller with a represented buyer side to
-- awaiting_connection; a sale awaiting its seller routes to already_represented.
--
-- connect_ea_to_awaiting_property keeps its 20261005110000 behaviour: the
-- purchase must also have a represented buyer side, so the wider
-- 'awaiting_seller' class does not let an EA attach to a buyer-less purchase.
--
-- No data is changed.

-- ---------------------------------------------------------------------------
-- 0) Preflight
-- ---------------------------------------------------------------------------

do $$
declare
  v_name text;
  v_src text;
begin
  foreach v_name in array array[
    'public._address_match_key(text)',
    'public._postcode_match_key(text)',
    'public._property_side_representation(bigint)',
    'public._property_reservation_state(bigint)',
    'public.property_address_is_reserved(bigint)',
    'public.check_start_move_address(text, text, text)',
    'public.connect_ea_to_awaiting_property(text, text, text, uuid)',
    'public._require_verified_email_for_transaction()',
    'public.is_ea_branch_member(uuid)',
    'public._rate_limit_is_blocked(text, text, integer, integer)',
    'public._rate_limit_record_attempt(text, text, integer)',
    'public._access_code_lookup_candidates(text)'
  ]
  loop
    if to_regprocedure(v_name) is null then
      raise exception 'reservation_placeholders_awaiting_seller aborted: % is missing', v_name;
    end if;
  end loop;

  select p.prosrc into v_src
  from pg_proc p
  where p.oid = to_regprocedure('public._property_reservation_state(bigint)');

  if v_src not like '%return ''stale'';%'
     or v_src not like '%return ''lifecycle_held'';%'
  then
    raise exception
      'reservation_placeholders_awaiting_seller aborted: _property_reservation_state differs from 20261005100000';
  end if;

  select p.prosrc into v_src
  from pg_proc p
  where p.oid = to_regprocedure('public.connect_ea_to_awaiting_property(text, text, text, uuid)');

  if v_src not like '%is distinct from ''awaiting_seller''%'
     or v_src not like '%join_chain_failed%'
  then
    raise exception
      'reservation_placeholders_awaiting_seller aborted: connect_ea_to_awaiting_property differs from 20261005110000';
  end if;

  select p.prosrc into v_src
  from pg_proc p
  where p.oid = to_regprocedure('public.check_start_move_address(text, text, text)');

  if v_src not like '%v_state in (''historical'', ''stale'')%'
     or v_src not like '%awaiting_connection%'
  then
    raise exception
      'reservation_placeholders_awaiting_seller aborted: check_start_move_address differs from 20261005100000';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1) Reservation state
-- ---------------------------------------------------------------------------

create or replace function public._property_reservation_state(p_property_id bigint)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_property public.properties%rowtype;
  v_lifecycle text;
  v_sides record;
begin
  select *
  into v_property
  from public.properties
  where id = p_property_id;

  if v_property.id is null then
    return 'historical';
  end if;

  if v_property.stage = 'searching'
    or public._address_match_key(v_property.address) is null
    or public._postcode_match_key(v_property.postcode) is null
  then
    return 'historical';
  end if;

  select pls.operational_state
  into v_lifecycle
  from public.property_lifecycle_states pls
  where pls.property_id = v_property.id;

  if v_lifecycle in ('released', 'anonymised') then
    return 'historical';
  end if;

  if v_lifecycle = 'archived' then
    return 'lifecycle_held';
  end if;

  select *
  into v_sides
  from public._property_side_representation(v_property.id);

  if v_sides.seller_side = 'none' then
    return 'awaiting_seller';
  end if;

  if v_property.relationship_type = 'sale'
    and v_sides.buyer_side = 'none'
  then
    return 'awaiting_buyer';
  end if;

  if v_sides.seller_side = 'homeowner' then
    return 'live_homeowner';
  end if;

  return 'live_ea_managed';
end;
$$;

alter function public._property_reservation_state(bigint) owner to postgres;

comment on function public._property_reservation_state(bigint) is
  'Address reservation state of one property row. Rows without an address key (searching placeholders, redacted rows) and released/anonymised rows are historical; archived = lifecycle_held; seller side unrepresented = awaiting_seller (a placeholder stays reserved until it is released); sale with a seller and no buyer = awaiting_buyer; otherwise live_homeowner / live_ea_managed by seller side. Never returns stale. Internal; service_role only.';

revoke all on function public._property_reservation_state(bigint) from public, anon, authenticated;
grant execute on function public._property_reservation_state(bigint) to service_role;

-- ---------------------------------------------------------------------------
-- 2) property_address_is_reserved
-- ---------------------------------------------------------------------------

create or replace function public.property_address_is_reserved(
  p_property_id bigint
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public._property_reservation_state(p_property_id) <> 'historical';
$$;

alter function public.property_address_is_reserved(bigint) owner to postgres;

comment on function public.property_address_is_reserved(bigint) is
  'True when a property row still reserves its address: any reservation state other than historical. Only released/anonymised, redacted and searching rows free an address; an unrepresented placeholder stays reserved until it is released.';

revoke all on function public.property_address_is_reserved(bigint) from public, anon, authenticated;
grant execute on function public.property_address_is_reserved(bigint) to service_role;

-- ---------------------------------------------------------------------------
-- 3) connect_ea_to_awaiting_property: buyer side still required
-- ---------------------------------------------------------------------------
-- Body is 20261005110000 plus the buyer-side requirement on both the candidate
-- scan and the locked re-check.

create or replace function public.connect_ea_to_awaiting_property(
  p_access_code text,
  p_address text,
  p_postcode text,
  p_branch_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email_gate jsonb;
  v_user_id uuid;
  v_subject text;
  v_candidates text[];
  v_row record;
  v_property public.properties%rowtype;
  c_scope constant text := 'join_chain_failed';
  c_limit constant integer := 10;
  c_window constant integer := 900;
begin
  v_email_gate := public._require_verified_email_for_transaction();

  if v_email_gate is not null then
    return v_email_gate;
  end if;

  v_user_id := auth.uid();

  if v_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  if p_branch_id is null or not public.is_ea_branch_member(p_branch_id) then
    return jsonb_build_object('ok', false, 'error', 'not_ea_branch_member');
  end if;

  v_subject := v_user_id::text;

  if public._rate_limit_is_blocked(c_scope, v_subject, c_limit, c_window) then
    return jsonb_build_object('ok', false, 'error', 'join_details_not_matched');
  end if;

  v_candidates := public._access_code_lookup_candidates(p_access_code);

  if coalesce(array_length(v_candidates, 1), 0) = 0 then
    perform public._rate_limit_record_attempt(c_scope, v_subject, c_window);
    return jsonb_build_object('ok', false, 'error', 'join_details_not_matched');
  end if;

  for v_row in
    select p.id
    from public.properties p
    inner join public.chains c
      on c.id = p.chain_id
    where c.access_code = any (v_candidates)
      and p.relationship_type = 'purchase'
      and public._address_match_key(p.address) = public._address_match_key(p_address)
      and public._postcode_match_key(p.postcode) = public._postcode_match_key(p_postcode)
    order by p.id
  loop
    if public._property_reservation_state(v_row.id) = 'awaiting_seller'
       and (select s.buyer_side from public._property_side_representation(v_row.id) s) <> 'none'
    then
      select *
      into v_property
      from public.properties
      where id = v_row.id
      for update;

      exit;
    end if;
  end loop;

  if v_property.id is null
     or public._property_reservation_state(v_property.id) is distinct from 'awaiting_seller'
     or (select s.buyer_side from public._property_side_representation(v_property.id) s) = 'none'
     or exists (
       select 1
       from public.property_ea_assignments pea
       where pea.property_id = v_property.id
         and pea.status = 'active'
     )
     -- The branch acting for the buyer's sale cannot also take the seller side.
     or exists (
       select 1
       from public.properties s
       inner join public.property_ea_assignments spea
         on spea.property_id = s.id
       where s.chain_id = v_property.chain_id
         and s.linked_property_id = v_property.id
         and spea.branch_id = p_branch_id
         and spea.status = 'active'
     )
  then
    perform public._rate_limit_record_attempt(c_scope, v_subject, c_window);
    return jsonb_build_object('ok', false, 'error', 'join_details_not_matched');
  end if;

  begin
    insert into public.property_ea_assignments (
      property_id,
      branch_id,
      status,
      assigned_by_user_id
    )
    values (
      v_property.id,
      p_branch_id,
      'active',
      v_user_id
    );
  exception
    when unique_violation then
      perform public._rate_limit_record_attempt(c_scope, v_subject, c_window);
      return jsonb_build_object('ok', false, 'error', 'join_details_not_matched');
  end;

  return jsonb_build_object(
    'ok', true,
    'property_id', v_property.id,
    'chain_id', v_property.chain_id
  );
end;
$$;

comment on function public.connect_ea_to_awaiting_property(text, text, text, uuid) is
  'The seller''s EA connects a branch to a purchase awaiting its seller with a represented buyer side, proven by chain access code + normalised address. Writes the assignment only (homeowner_only_updates takes the table default); no identity, no claim metadata. Refuses rows with any active assignment and the branch acting for the buyer''s sale. Failures are generic and share the join_chain_failed budget.';

revoke all on function public.connect_ea_to_awaiting_property(text, text, text, uuid) from public, anon;
grant execute on function public.connect_ea_to_awaiting_property(text, text, text, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4) Postflight
-- ---------------------------------------------------------------------------

do $$
declare
  v_src text;
  v_name text;
begin
  select p.prosrc into v_src
  from pg_proc p
  where p.oid = to_regprocedure('public._property_reservation_state(bigint)');

  if v_src like '%''stale''%'
     or v_src not like '%if v_sides.seller_side = ''none'' then%return ''awaiting_seller'';%'
  then
    raise exception 'reservation_placeholders_awaiting_seller postflight: classifier not replaced';
  end if;

  select p.prosrc into v_src
  from pg_proc p
  where p.oid = to_regprocedure('public.property_address_is_reserved(bigint)');

  if v_src not like '%<> ''historical''%' or v_src like '%stale%' then
    raise exception 'reservation_placeholders_awaiting_seller postflight: property_address_is_reserved not replaced';
  end if;

  select p.prosrc into v_src
  from pg_proc p
  where p.oid = to_regprocedure('public.connect_ea_to_awaiting_property(text, text, text, uuid)');

  if v_src not like '%buyer_side from public._property_side_representation(v_row.id)%'
     or v_src not like '%buyer_side from public._property_side_representation(v_property.id) s) = ''none''%'
  then
    raise exception 'reservation_placeholders_awaiting_seller postflight: connect_ea_to_awaiting_property not replaced';
  end if;

  foreach v_name in array array[
    'public._property_reservation_state(bigint)',
    'public.property_address_is_reserved(bigint)'
  ]
  loop
    if has_function_privilege('anon', v_name, 'execute')
       or has_function_privilege('authenticated', v_name, 'execute')
    then
      raise exception 'reservation_placeholders_awaiting_seller postflight: % is client-executable', v_name;
    end if;
  end loop;

  if has_function_privilege('anon', 'public.connect_ea_to_awaiting_property(text, text, text, uuid)', 'execute') then
    raise exception 'reservation_placeholders_awaiting_seller postflight: connect_ea_to_awaiting_property is anon-executable';
  end if;
end;
$$;
