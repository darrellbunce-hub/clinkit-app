-- Link a Start Move sale to the onward purchase created with it.
--
-- Start Move inserts the homeowner's sale and, when they already know their
-- onward property, a purchase in the same chain, but never linked the two.
-- Chain topology walks properties.linked_property_id, so the pair rendered as
-- two segments separated by a false "Awaiting connection" gap, and the
-- seller-side guards that look for a sale linking to a purchase
-- (branch_acts_for_buyer in assign_property_ea_branch and the reconnection
-- paths) could not see the homeowner's own sale. The searching-placeholder,
-- join-chain migration and connected-hop paths already link a sale to its
-- onward purchase this way.
--
-- link_start_move_onward_purchase sets sale.linked_property_id to the
-- purchase in one validated update with both rows locked. It links only rows
-- the caller created in the same chain while holding the active seller
-- identity on the sale and the active buyer identity on the purchase, and only
-- while neither row is linked elsewhere. Repeating the call is a no-op.
--
-- No existing rows are changed by this migration.

-- ---------------------------------------------------------------------------
-- 0) Preflight
-- ---------------------------------------------------------------------------

do $$
begin
  if to_regclass('public.properties') is null
     or to_regclass('public.property_operational_identities') is null
     or to_regclass('public.property_lifecycle_states') is null
  then
    raise exception 'link_start_move_onward_purchase aborted: required tables are missing';
  end if;

  if to_regprocedure('public._require_verified_email_for_transaction()') is null
     or to_regprocedure('public._is_estate_agent_account(uuid)') is null
     or to_regprocedure('public.caller_may_place_property_in_chain(bigint)') is null
  then
    raise exception 'link_start_move_onward_purchase aborted: required helpers are missing';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1) link_start_move_onward_purchase
-- ---------------------------------------------------------------------------

create or replace function public.link_start_move_onward_purchase(
  p_sale_property_id bigint,
  p_purchase_property_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_email_gate jsonb;
  v_sale public.properties%rowtype;
  v_purchase public.properties%rowtype;
begin
  v_email_gate := public._require_verified_email_for_transaction();

  if v_email_gate is not null then
    return v_email_gate;
  end if;

  v_uid := auth.uid();

  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  if public._is_estate_agent_account(v_uid) then
    return jsonb_build_object('ok', false, 'error', 'not_authorized');
  end if;

  if p_sale_property_id is null
     or p_purchase_property_id is null
     or p_sale_property_id = p_purchase_property_id
  then
    return jsonb_build_object('ok', false, 'error', 'invalid_pair');
  end if;

  perform 1
  from public.properties
  where id in (p_sale_property_id, p_purchase_property_id)
  order by id
  for update;

  select *
  into v_sale
  from public.properties
  where id = p_sale_property_id;

  select *
  into v_purchase
  from public.properties
  where id = p_purchase_property_id;

  -- Missing and foreign rows give the same answer.
  if v_sale.id is null
     or v_purchase.id is null
     or v_sale.created_by_user_id is distinct from v_uid
     or v_purchase.created_by_user_id is distinct from v_uid
     or not exists (
       select 1
       from public.property_operational_identities poi
       where poi.property_id = v_sale.id
         and poi.homeowner_user_id = v_uid
         and poi.operational_role = 'seller'
         and poi.status = 'active'
     )
     or not exists (
       select 1
       from public.property_operational_identities poi
       where poi.property_id = v_purchase.id
         and poi.homeowner_user_id = v_uid
         and poi.operational_role = 'buyer'
         and poi.status = 'active'
     )
  then
    return jsonb_build_object('ok', false, 'error', 'not_authorized');
  end if;

  if v_sale.chain_id is null
     or v_sale.chain_id is distinct from v_purchase.chain_id
  then
    return jsonb_build_object('ok', false, 'error', 'chain_mismatch');
  end if;

  if not public.caller_may_place_property_in_chain(v_sale.chain_id) then
    return jsonb_build_object('ok', false, 'error', 'not_authorized');
  end if;

  if v_sale.relationship_type is distinct from 'sale'
     or v_sale.stage = 'searching'
  then
    return jsonb_build_object('ok', false, 'error', 'invalid_sale');
  end if;

  if v_purchase.relationship_type is distinct from 'purchase'
     or v_purchase.stage = 'searching'
     or v_purchase.address is null
  then
    return jsonb_build_object('ok', false, 'error', 'invalid_purchase');
  end if;

  if exists (
    select 1
    from public.property_lifecycle_states pls
    where pls.property_id in (v_sale.id, v_purchase.id)
      and pls.operational_state in ('released', 'anonymised', 'archived')
  ) then
    return jsonb_build_object('ok', false, 'error', 'invalid_pair');
  end if;

  if v_sale.linked_property_id = v_purchase.id then
    return jsonb_build_object('ok', true, 'linked', true, 'idempotent', true);
  end if;

  if v_sale.linked_property_id is not null then
    return jsonb_build_object('ok', false, 'error', 'sale_already_linked');
  end if;

  if v_purchase.linked_property_id is not null
     or exists (
       select 1
       from public.properties p
       where p.linked_property_id = v_purchase.id
         and p.id <> v_sale.id
     )
  then
    return jsonb_build_object('ok', false, 'error', 'purchase_already_linked');
  end if;

  update public.properties
  set linked_property_id = v_purchase.id
  where id = v_sale.id;

  return jsonb_build_object('ok', true, 'linked', true, 'idempotent', false);
end;
$$;

comment on function public.link_start_move_onward_purchase(bigint, bigint) is
  'Start Move: links the caller''s sale to the onward purchase created with it (sale.linked_property_id). Both rows must be created by the caller in the same chain, with the caller''s active seller identity on the sale and buyer identity on the purchase, and neither linked elsewhere. Idempotent. Estate-agent accounts are refused.';

revoke all on function public.link_start_move_onward_purchase(bigint, bigint) from public, anon;
grant execute on function public.link_start_move_onward_purchase(bigint, bigint) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2) Postflight
-- ---------------------------------------------------------------------------

do $$
declare
  v_result text;
  v_definer boolean;
  v_config text[];
begin
  select pg_catalog.format_type(p.prorettype, null), p.prosecdef, p.proconfig
  into v_result, v_definer, v_config
  from pg_proc p
  where p.oid = to_regprocedure('public.link_start_move_onward_purchase(bigint, bigint)');

  if v_result is distinct from 'jsonb'
     or v_definer is distinct from true
     or not ('search_path=public' = any (coalesce(v_config, array[]::text[])))
  then
    raise exception 'link_start_move_onward_purchase postflight: function missing or not SECURITY DEFINER with search_path = public';
  end if;

  if has_function_privilege('anon', 'public.link_start_move_onward_purchase(bigint, bigint)', 'execute') then
    raise exception 'link_start_move_onward_purchase postflight: function is anon-executable';
  end if;

  if not has_function_privilege('authenticated', 'public.link_start_move_onward_purchase(bigint, bigint)', 'execute')
     or not has_function_privilege('service_role', 'public.link_start_move_onward_purchase(bigint, bigint)', 'execute')
  then
    raise exception 'link_start_move_onward_purchase postflight: grants missing';
  end if;
end;
$$;
