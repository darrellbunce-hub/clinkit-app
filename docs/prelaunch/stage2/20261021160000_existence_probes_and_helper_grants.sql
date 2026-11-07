-- PROPOSED — NOT APPLIED. Stage 2 pre-launch review draft.
-- Promote by copying into supabase/migrations/ only after approval.
--
-- Existence probes and unguarded helpers (Business Rules 3.4, 19.23, 24.7;
-- blocker B3). Apply after 20261021150000.
--
-- Every user-callable function below answered "not found" (or another
-- row-specific answer) before checking whether the caller has any role on
-- the row, so any signed-in user could learn whether a property or chain id
-- exists, whether a row is managed by an Estate Agent, or how many
-- positions another chain has. Each now gives an unknown id exactly the
-- answer it gives a real row the caller has no role on. Authorised callers
-- get the same answers as today, in the same order.
--
--   1. confirm_transaction_still_active (20261005130000): unknown ids
--      return not_authorised; the "managed" no-op answer is given only to
--      the dependent side (as for unmanaged rows) or an operator of the row.
--   2. create_searching_placeholder_for_sale (20261005110000): sale_not_found
--      merged into not_authorized, ahead of invalid_sale.
--   3. link_sale_to_searching_placeholder (20261005120000): authorisation on
--      the anchor first (forbidden); a missing placeholder and one in
--      another chain both return chain_mismatch.
--   4. establish_connected_hop (20261005120000): purchase_not_found merged
--      into not_authorized, ahead of not_purchase.
--   5. _execute_participation_delink (20261005120000), the core of the three
--      user-callable delink wrappers: an unknown id returns the operation's
--      own refusal (not_operational_homeowner / branch_required /
--      not_assigned_ea) instead of property_not_found.
--   6. create_ea_operational_property (20260905120000): any branch member
--      learned whether a chain id exists (chain_not_found). A missing chain
--      fails both existing authorisation tests, so the check is removed and
--      the answer is not_authorised_for_chain.
--   7. get_next_chain_position (20260610200000): returned max position + 1
--      for any chain id. Callers who may place or operate a property in the
--      chain, or view it, get the same answer; everyone else gets 1 (the
--      empty-chain answer).
--   8. get_property_operational_owner_user_id (20260714150000): returned the
--      active homeowner's user id for any property to any signed-in user.
--      Its only end-user use is properties_update_operator, which compares
--      it with auth.uid(); that clause becomes the existing equivalent
--      is_property_operational_homeowner(id) (one active identity per
--      property: property_operational_identities_one_active_per_property),
--      and execute moves to service_role. SECURITY DEFINER callers owned by
--      postgres keep working.
--   9. Helpers with no caller check and no end-user caller move to
--      service_role: chain_last_operational_activity_at (never revoked from
--      PUBLIC), property_chain_is_connected (PUBLIC),
--      homeowner_has_meaningful_participation, property_invitation_is_pending
--      (whether a property is agent-originated and unclaimed) and
--      property_has_any_member (whether any property id exists and has
--      members; its only policy use is replaced by 20261021130000, which the
--      preflight requires).
--  10. execute_participation_delink(bigint, text, text, uuid): the current
--      signature was granted to authenticated but never revoked from PUBLIC
--      (20260714170000 revoked the old argument order). Revoked from public
--      and anon; authenticated unchanged.
--
-- Replaced bodies keep their signature, owner, definer, search_path and
-- grants (create or replace keeps the ACL; the postflight compares it).
-- No rows are changed. No table grants change.
--
-- Rollback: re-run the source definitions named in each section heading,
-- restore properties_update_operator from 20261005120000, and re-grant
-- execute to authenticated on the helpers in sections 8 and 9.

-- ---------------------------------------------------------------------------
-- 0) Preflight
-- ---------------------------------------------------------------------------

do $$
declare
  v_fn text;
  v_src text;
  v_result text;
  v_definer boolean;
  v_config text[];
  v_owner text;
  v_acl text;
  v_i integer := 0;
  v_qual text;
  v_check text;
  v_cmd text;
  v_roles name[];
  v_helper_owner oid;
begin
  foreach v_fn in array array[
    'public.confirm_transaction_still_active(bigint)',
    'public.create_searching_placeholder_for_sale(bigint)',
    'public.link_sale_to_searching_placeholder(bigint, bigint)',
    'public.establish_connected_hop(bigint)',
    'public._execute_participation_delink(bigint, text, text, uuid)',
    'public.create_ea_operational_property(bigint, text, text, text, uuid, boolean, text, text, boolean)',
    'public.get_next_chain_position(bigint)'
  ] loop
    v_i := v_i + 1;

    if to_regprocedure(v_fn) is null then
      raise exception 'existence_probes aborted: % is missing', v_fn;
    end if;

    select
      p.prosrc,
      p.prosecdef,
      p.proconfig,
      pg_catalog.pg_get_userbyid(p.proowner),
      coalesce(p.proacl::text, '')
    into v_src, v_definer, v_config, v_owner, v_acl
    from pg_proc p
    where p.oid = to_regprocedure(v_fn);

    if v_definer is distinct from true
       or v_config is distinct from array['search_path=public']
       or v_owner is distinct from 'postgres'
    then
      raise exception 'existence_probes aborted: % definer, search_path or owner differs', v_fn;
    end if;

    if (v_i = 1 and (v_src not like '%''property_not_found''%'
                     or v_src not like '%Managed rows have no clock to confirm.%'
                     or v_src not like '%_is_placeholder_dependent_side_user(p_property_id, v_user_id)%'))
       or (v_i = 2 and (v_src not like '%''sale_not_found''%'
                        or v_src not like '%''invalid_sale''%'
                        or v_src not like '%get_next_chain_position%'))
       or (v_i = 3 and (v_src not like '%''property_not_found''%'
                        or v_src not like '%''chain_mismatch''%'
                        or v_src not like '%''forbidden''%'
                        or v_src not like '%''placeholder_owner_mismatch''%'))
       or (v_i = 4 and (v_src not like '%''purchase_not_found''%'
                        or v_src not like '%''not_purchase''%'
                        or v_src not like '%v_downstream_after_purchase_id%'))
       or (v_i = 5 and (v_src not like '%''property_not_found''%'
                        or v_src not like '%''branch_required''%'
                        or v_src not like '%''not_assigned_ea''%'
                        or v_src not like '%''not_operational_homeowner''%'
                        or v_src not like '%_ea_homeowner_withdrawal_status%'))
       or (v_i = 6 and (v_src not like '%''chain_not_found''%'
                        or v_src not like '%''not_authorised_for_chain''%'
                        or v_src not like '%_create_ea_operational_property_core%'))
       or (v_i = 7 and (v_src not like '%max(p.chain_position)%'
                        or v_src like '%auth.uid()%'))
    then
      raise exception 'existence_probes aborted: % differs from the definition this proposal copies', v_fn;
    end if;

    perform set_config('moveloop.existence_probes_acl_' || v_i, v_acl, false);
  end loop;

  select format_type(p.prorettype, null) into v_result
  from pg_proc p
  where p.oid = to_regprocedure('public.get_next_chain_position(bigint)');
  if v_result is distinct from 'integer' then
    raise exception 'existence_probes aborted: get_next_chain_position return type differs';
  end if;

  if to_regprocedure('public.is_property_operational_homeowner(bigint)') is null
     or to_regprocedure('public._is_placeholder_dependent_side_user(bigint, uuid)') is null
     or to_regprocedure('public.can_operate_property(bigint)') is null
     or to_regprocedure('public.caller_may_place_property_in_chain(bigint)') is null
     or to_regprocedure('public.is_chain_operational_viewer(bigint)') is null
     or to_regprocedure('public.execute_participation_delink(bigint, text, text, uuid)') is null
     or to_regclass('public.property_operational_identities_one_active_per_property') is null
  then
    raise exception 'existence_probes aborted: a required helper or index is missing';
  end if;

  -- properties_update_operator must be the 20261005120000 policy.
  select pol.qual, pol.with_check, pol.cmd, pol.roles
  into v_qual, v_check, v_cmd, v_roles
  from pg_policies pol
  where pol.schemaname = 'public'
    and pol.tablename = 'properties'
    and pol.policyname = 'properties_update_operator';

  if v_cmd is distinct from 'UPDATE'
     or v_roles is distinct from array['authenticated']::name[]
     or v_qual not like '%can_operate_property(id)%'
     or v_qual not like '%get_property_operational_owner_user_id(id) = auth.uid()%'
     or v_check not like '%can_operate_property(id)%'
     or v_check not like '%get_property_operational_owner_user_id(id) = auth.uid()%'
  then
    raise exception 'existence_probes aborted: properties_update_operator differs from 20261005120000';
  end if;

  -- Helpers losing end-user execute: no policy (other than the one replaced
  -- here), view, invoker function or differently-owned function may use them.
  foreach v_fn in array array[
    'get_property_operational_owner_user_id',
    'chain_last_operational_activity_at',
    'property_chain_is_connected',
    'homeowner_has_meaningful_participation',
    'property_invitation_is_pending',
    'property_has_any_member'
  ] loop
    if (
      select count(*) from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = v_fn
    ) <> 1 then
      raise exception 'existence_probes aborted: % is missing or overloaded', v_fn;
    end if;

    if exists (
      select 1 from pg_policies pol
      where pol.schemaname = 'public'
        and not (pol.tablename = 'properties' and pol.policyname = 'properties_update_operator')
        and (coalesce(pol.qual, '') like '%' || v_fn || '(%'
             or coalesce(pol.with_check, '') like '%' || v_fn || '(%')
    ) then
      raise exception 'existence_probes aborted: a policy uses %', v_fn;
    end if;

    if exists (
      select 1 from pg_views v
      where v.schemaname = 'public'
        and v.definition like '%' || v_fn || '(%'
    ) then
      raise exception 'existence_probes aborted: a view uses %', v_fn;
    end if;

    select p.proowner into v_helper_owner
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = v_fn;

    if exists (
      select 1 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname <> v_fn
        and p.prosrc like '%' || v_fn || '(%'
        and (not p.prosecdef or p.proowner <> v_helper_owner)
    ) then
      raise exception 'existence_probes aborted: % is called by an invoker function or another owner', v_fn;
    end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1) confirm_transaction_still_active (copied from 20261005130000)
-- ---------------------------------------------------------------------------

create or replace function public.confirm_transaction_still_active(
  p_property_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_property public.properties%rowtype;
  v_pls public.property_lifecycle_states%rowtype;
begin
  if v_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  select *
  into v_property
  from public.properties
  where id = p_property_id
  for update;

  -- Unknown ids get the answer a caller with no role on the property gets.
  if v_property.id is null then
    return jsonb_build_object('ok', false, 'error', 'not_authorised');
  end if;

  select *
  into v_pls
  from public.property_lifecycle_states
  where property_id = p_property_id
  for update;

  if v_pls.property_id is null
     or v_pls.seller_side_unrepresented_since is null
  then
    -- Managed rows have no clock to confirm. Only the dependent side or an
    -- operator of the row learns that it is managed.
    if not public._is_placeholder_dependent_side_user(p_property_id, v_user_id)
       and not public.can_operate_property(p_property_id)
    then
      return jsonb_build_object('ok', false, 'error', 'not_authorised');
    end if;

    return jsonb_build_object(
      'ok', true,
      'property_id', p_property_id,
      'operational_state', coalesce(v_pls.operational_state, 'active'),
      'idempotent', true,
      'managed', true
    );
  end if;

  if not public._is_placeholder_dependent_side_user(p_property_id, v_user_id) then
    return jsonb_build_object('ok', false, 'error', 'not_authorised');
  end if;

  if v_pls.operational_state not in ('active', 'dormancy_warning') then
    return jsonb_build_object('ok', false, 'error', 'invalid_state_for_confirmation');
  end if;

  if v_pls.operational_state = 'active'
     and exists (
       select 1
       from public.property_lifecycle_still_active_confirmations c
       where c.property_id = p_property_id
         and c.confirmed_at > now() - interval '24 hours'
     )
  then
    return jsonb_build_object(
      'ok', true,
      'property_id', p_property_id,
      'operational_state', 'active',
      'idempotent', true
    );
  end if;

  insert into public.property_lifecycle_still_active_confirmations (
    property_id,
    chain_id,
    user_id,
    confirmation_code
  )
  values (
    p_property_id,
    v_property.chain_id,
    v_user_id,
    'still_active'
  );

  if v_pls.operational_state = 'dormancy_warning' then
    insert into public.property_lifecycle_events (
      property_id,
      from_state,
      to_state,
      trigger,
      scenario,
      reason,
      metadata
    )
    values (
      p_property_id,
      'dormancy_warning',
      'active',
      'still_active_confirmation',
      'connected_dormant',
      'Structured still-active confirmation reset dormancy clock.',
      jsonb_build_object('confirmation_code', 'still_active', 'confirmed_by', v_user_id)
    );
  end if;

  update public.property_lifecycle_states
  set
    operational_state = 'active',
    lifecycle_reason = case
      when operational_state = 'dormancy_warning' then 'still_active_confirmation'
      else lifecycle_reason
    end,
    entered_state_at = case
      when operational_state = 'dormancy_warning' then now()
      else entered_state_at
    end,
    dormancy_warning_at = null,
    dormancy_confirmation_deadline_at = null,
    dormancy_warning_notified_at = null,
    dormancy_warning_notification_claimed_at = null,
    last_still_active_confirmed_at = now(),
    next_evaluation_at = now() + make_interval(
      days => least(
        public.lifecycle_dormant_inactivity_days(),
        public.lifecycle_connected_dormant_days()
      )
    ),
    updated_at = now()
  where property_id = p_property_id;

  return jsonb_build_object(
    'ok', true,
    'property_id', p_property_id,
    'operational_state', 'active'
  );
end;
$$;

comment on function public.confirm_transaction_still_active(bigint) is
  'Structured still-active confirmation for a placeholder by its dependent side. Restarts this row''s clock only, audited, idempotent within 24 hours. Grants no authority; ownership and representation are unchanged. A managed row is a no-op for its dependent side and operators. Unknown ids and callers with no role on the row both receive not_authorised.';

-- ---------------------------------------------------------------------------
-- 2) create_searching_placeholder_for_sale (copied from 20261005110000)
-- ---------------------------------------------------------------------------

create or replace function public.create_searching_placeholder_for_sale(
  p_sale_property_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email_gate jsonb;
  v_sale public.properties%rowtype;
  v_linked public.properties%rowtype;
  v_owner uuid;
  v_placeholder_id bigint;
  v_grant jsonb;
begin
  v_email_gate := public._require_verified_email_for_transaction();

  if v_email_gate is not null then
    return v_email_gate;
  end if;

  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  select *
  into v_sale
  from public.properties
  where id = p_sale_property_id
  for update;

  -- Unknown and foreign ids get the same answer (no existence oracle).
  if v_sale.id is null
     or not public.can_operate_property(p_sale_property_id)
  then
    return jsonb_build_object('ok', false, 'error', 'not_authorized');
  end if;

  if v_sale.relationship_type is null
     or v_sale.relationship_type not in ('sale', 'purchase')
     or v_sale.stage = 'searching'
     or v_sale.chain_id is null
  then
    return jsonb_build_object('ok', false, 'error', 'invalid_sale');
  end if;

  if v_sale.linked_property_id is not null then
    select *
    into v_linked
    from public.properties
    where id = v_sale.linked_property_id;

    if v_linked.id is not null
       and v_linked.chain_id = v_sale.chain_id
       and v_linked.stage = 'searching'
       and v_linked.address is null
       and v_linked.postcode is null
    then
      return jsonb_build_object(
        'ok', true,
        'property_id', v_linked.id,
        'created', false
      );
    end if;

    return jsonb_build_object('ok', false, 'error', 'sale_already_linked');
  end if;

  v_owner := public._property_seller_side_user_id(p_sale_property_id);

  if v_owner is not null and public._is_estate_agent_account(v_owner) then
    v_owner := null;
  end if;

  begin
    insert into public.properties (
      chain_id,
      chain_position,
      stage,
      address,
      postcode,
      relationship_type,
      status,
      created_by_user_id,
      linked_property_id,
      awaiting_buyer,
      buyer_connected,
      seller_connected,
      is_searching,
      is_current_user,
      last_updated_days
    )
    values (
      v_sale.chain_id,
      public.get_next_chain_position(v_sale.chain_id),
      'searching',
      null,
      null,
      'purchase',
      'pending_connection',
      auth.uid(),
      null,
      false,
      false,
      true,
      true,
      true,
      0
    )
    returning id
    into v_placeholder_id;

    update public.properties
    set linked_property_id = v_placeholder_id
    where id = p_sale_property_id;

    if v_owner is not null then
      v_grant := public._establish_operational_homeowner_core(
        v_placeholder_id,
        v_owner,
        case when v_owner = auth.uid() then 'start_move' else 'ea_origination_claim' end,
        false
      );

      if not coalesce((v_grant ->> 'ok')::boolean, false) then
        raise exception using
          errcode = 'SP001',
          message = coalesce(v_grant ->> 'error', 'grant_failed');
      end if;
    end if;
  exception
    when unique_violation then
      return jsonb_build_object('ok', false, 'error', 'searching_placeholder_exists');
    when sqlstate 'SP001' then
      return jsonb_build_object('ok', false, 'error', sqlerrm);
  end;

  return jsonb_build_object(
    'ok', true,
    'property_id', v_placeholder_id,
    'created', true,
    'owned', v_owner is not null
  );
end;
$$;

comment on function public.create_searching_placeholder_for_sale(bigint) is
  'Creates (or returns) the searching placeholder linked from an anchor row: a sale, or a purchase the caller sells. Authorised by can_operate_property on the anchor. Grants an identity only to the anchor''s seller-side homeowner; estate agents never receive one. Unknown and foreign anchor ids both return not_authorized.';

-- ---------------------------------------------------------------------------
-- 3) link_sale_to_searching_placeholder (copied from 20261005120000)
-- ---------------------------------------------------------------------------

create or replace function public.link_sale_to_searching_placeholder(
  p_sale_property_id bigint,
  p_searching_property_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sale public.properties%rowtype;
  v_searching public.properties%rowtype;
  v_sale_owner uuid;
  v_searching_owner uuid;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  select *
  into v_sale
  from public.properties
  where id = p_sale_property_id;

  select *
  into v_searching
  from public.properties
  where id = p_searching_property_id;

  -- Authorise on the anchor before answering anything about either row.
  if v_sale.id is null
     or not public.can_operate_property(p_sale_property_id)
  then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  -- A missing placeholder and one in another chain get the same answer.
  if v_searching.id is null
     or v_sale.chain_id is distinct from v_searching.chain_id
  then
    return jsonb_build_object('ok', false, 'error', 'chain_mismatch');
  end if;

  if v_sale.relationship_type is null
     or v_sale.relationship_type not in ('sale', 'purchase')
     or v_sale.stage = 'searching'
  then
    return jsonb_build_object('ok', false, 'error', 'invalid_sale');
  end if;

  if v_searching.stage <> 'searching'
    or v_searching.address is not null
    or v_searching.postcode is not null then
    return jsonb_build_object('ok', false, 'error', 'invalid_searching_placeholder');
  end if;

  v_sale_owner := public._property_seller_side_user_id(p_sale_property_id);
  v_searching_owner := public.get_property_operational_owner_user_id(p_searching_property_id);

  if v_searching_owner is not null
     and v_searching_owner is distinct from v_sale_owner
  then
    return jsonb_build_object('ok', false, 'error', 'placeholder_owner_mismatch');
  end if;

  update public.properties
  set linked_property_id = p_searching_property_id
  where id = p_sale_property_id;

  return jsonb_build_object('ok', true);
end;
$$;

comment on function public.link_sale_to_searching_placeholder(bigint, bigint) is
  'Links an anchor row (sale, or purchase the caller sells) to a stage-authoritative searching placeholder. Authorised by can_operate_property only. The placeholder must be unowned or owned by the anchor''s seller-side homeowner. Unknown and foreign anchors both return forbidden; a missing placeholder and one in another chain both return chain_mismatch.';

-- ---------------------------------------------------------------------------
-- 4) establish_connected_hop (copied from 20261005120000)
-- ---------------------------------------------------------------------------

create or replace function public.establish_connected_hop(p_purchase_property_id bigint)
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

  -- Unknown and foreign ids get the same answer (no existence oracle).
  if v_purchase.id is null
     or not public.can_operate_property(v_purchase.id)
  then
    return jsonb_build_object('ok', false, 'error', 'not_authorized');
  end if;

  if v_purchase.relationship_type is distinct from 'purchase' then
    return jsonb_build_object('ok', false, 'error', 'not_purchase');
  end if;

  update public.properties
  set
    status = 'healthy',
    seller_connected = true,
    buyer_connected = true
  where id = v_purchase.id;

  select poi.homeowner_user_id
  into v_host_buyer_user_id
  from public.property_operational_identities poi
  where poi.property_id = v_purchase.id
    and poi.status = 'active'
    and poi.operational_role = 'buyer';

  if v_host_buyer_user_id is null then
    return jsonb_build_object('ok', true, 'linked', false);
  end if;

  select p.*
  into v_host_sale
  from public.properties p
  inner join public.property_operational_identities poi
    on poi.property_id = p.id
    and poi.status = 'active'
    and poi.operational_role = 'seller'
    and poi.homeowner_user_id = v_host_buyer_user_id
  where p.chain_id = v_purchase.chain_id
    and p.relationship_type = 'sale'
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

  -- Host sale: link into the connected purchase hop. Preserve buyer_connected so
  -- an unrelated unresolved purchaser (Awaiting Buyer) is not cleared.
  update public.properties
  set
    status = 'healthy',
    seller_connected = true,
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

comment on function public.establish_connected_hop(bigint) is
  'After a seller joins a purchase: marks the hop connected and links the buyer''s host sale to it. Authorised by can_operate_property on the purchase (its seller-side homeowner or their permitted EA). Unknown and foreign ids both return not_authorized.';

-- ---------------------------------------------------------------------------
-- 5) _execute_participation_delink (copied from 20261005120000)
-- ---------------------------------------------------------------------------

create or replace function public._execute_participation_delink(
  p_property_id bigint,
  p_operation text,
  p_reason_code text,
  p_branch_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_property public.properties%rowtype;
  v_chain_id bigint;
  v_branch_id uuid;
  v_activity_message text;
  v_identity public.property_operational_identities%rowtype;
  v_transition jsonb;
  v_sides record;
  v_mistake boolean;
  v_dependants boolean := false;
  v_release boolean := false;
  v_homeowner_remains boolean;
  v_sale_id bigint;
  v_unlinked_sale_ids bigint[] := array[]::bigint[];
  v_withdrawal text;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  if p_operation not in (
    'homeowner_self',
    'homeowner_remove_ea',
    'estate_agent_remove_branch',
    'estate_agent_remove_homeowner'
  ) then
    return jsonb_build_object('ok', false, 'error', 'invalid_operation');
  end if;

  if not public.is_valid_participation_delink_reason_code(
    p_operation,
    p_reason_code
  ) then
    return jsonb_build_object('ok', false, 'error', 'invalid_reason_code');
  end if;

  select *
  into v_property
  from public.properties
  where id = p_property_id
  for update;

  -- Unknown ids get the refusal a caller with no role on the property gets
  -- from the operation's first ownership check below.
  if v_property.id is null then
    return jsonb_build_object(
      'ok', false,
      'error',
      case
        when p_operation in ('homeowner_self', 'homeowner_remove_ea')
          then 'not_operational_homeowner'
        when p_operation = 'estate_agent_remove_branch' and p_branch_id is null
          then 'branch_required'
        else 'not_assigned_ea'
      end
    );
  end if;

  v_chain_id := v_property.chain_id;
  v_mistake := p_reason_code in ('wrong_property', 'added_by_mistake', 'duplicate_property');

  if p_operation = 'homeowner_self' then
    select *
    into v_identity
    from public.property_operational_identities poi
    where poi.property_id = p_property_id
      and poi.homeowner_user_id = v_uid
      and poi.status = 'active';

    if v_identity.property_id is null then
      return jsonb_build_object('ok', false, 'error', 'not_operational_homeowner');
    end if;

    insert into public.property_delink_events (
      property_id,
      chain_id,
      actor_user_id,
      actor_type,
      reason_code,
      metadata
    )
    values (
      p_property_id,
      v_chain_id,
      v_uid,
      'homeowner',
      p_reason_code,
      jsonb_build_object(
        'operation', p_operation,
        'relationship_type', v_property.relationship_type
      )
    );

    -- The buyer leaving a purchase.
    if v_property.relationship_type = 'purchase' then
      -- The leaver's own linking sales, locked after the purchase row.
      perform 1
      from public.properties s
      where s.chain_id is not distinct from v_chain_id
        and s.linked_property_id = p_property_id
        and s.id <> p_property_id
        and exists (
          select 1
          from public.property_operational_identities spoi
          where spoi.property_id = s.id
            and spoi.homeowner_user_id = v_uid
            and spoi.status = 'active'
        )
      order by s.id
      for update;

      select *
      into v_sides
      from public._property_side_representation(p_property_id);

      v_dependants := public._property_placeholder_has_dependants(p_property_id, v_uid);

      v_release := v_sides.seller_side = 'none'
        and not v_dependants
        and (public.get_active_property_claim_invitation(p_property_id)).id is null
        and not exists (
          select 1
          from public.property_counterparty_participants cp
          where cp.property_id = p_property_id
            and cp.status = 'active'
        );

      if v_release then
        v_transition := public.record_property_lifecycle_transition(
          p_property_id,
          'released',
          'homeowner_delink',
          null,
          p_reason_code,
          jsonb_build_object(
            'operation', p_operation,
            'reason_code', p_reason_code,
            'buyer_left', true
          )
        );

        if coalesce((v_transition ->> 'ok')::boolean, false) is not true then
          raise exception 'participation_delink_lifecycle_transition_failed: %',
            coalesce(v_transition ->> 'error', 'unknown');
        end if;
      end if;

      for v_sale_id in
        update public.properties s
        set linked_property_id = null
        where s.chain_id is not distinct from v_chain_id
          and s.linked_property_id = p_property_id
          and s.id <> p_property_id
          and exists (
            select 1
            from public.property_operational_identities spoi
            where spoi.property_id = s.id
              and spoi.homeowner_user_id = v_uid
              and spoi.status = 'active'
          )
        returning s.id
      loop
        v_unlinked_sale_ids := array_append(v_unlinked_sale_ids, v_sale_id);

        perform public._insert_participation_delink_activity(
          v_sale_id,
          'The onward purchase was unlinked from this sale because the buyer left that purchase.',
          'system'
        );
      end loop;

      delete from public.property_members pm
      where pm.property_id = p_property_id
        and (
          pm.user_id = v_uid
          or pm.user_id in (
            select pd.delegate_user_id
            from public.property_delegates pd
            where pd.property_id = p_property_id
              and pd.status in ('pending', 'active')
          )
        );

      update public.property_delegates
      set
        status = 'revoked',
        revoked_at = now(),
        updated_at = now()
      where property_id = p_property_id
        and status in ('pending', 'active');

      update public.property_operational_identities
      set
        status = 'released',
        delinked_at = now(),
        updated_at = now()
      where property_id = p_property_id
        and status = 'active';

      if v_release then
        delete from public.property_members
        where property_id = p_property_id;

        perform public._revoke_open_property_claim_invitations(p_property_id);

        update public.property_claim_metadata pcm
        set
          claim_status = case
            when pcm.origin_type = 'estate_agent' then 'unclaimed'
            else pcm.claim_status
          end,
          claimed_by_user_id = case
            when pcm.origin_type = 'estate_agent' then null
            else pcm.claimed_by_user_id
          end,
          claimed_at = case
            when pcm.origin_type = 'estate_agent' then null
            else pcm.claimed_at
          end,
          updated_at = now()
        where pcm.property_id = p_property_id;

        update public.properties
        set
          status = 'pending_connection',
          buyer_connected = false,
          seller_connected = false
        where id = p_property_id;

        v_activity_message :=
          'Homeowner left this transaction. The property has been released.';
      else
        v_activity_message := 'The buyer left this purchase.';
      end if;

      perform public._notify_chain_participants_of_delink(
        p_property_id,
        v_chain_id,
        v_activity_message
      );

      return jsonb_build_object(
        'ok', true,
        'property_id', p_property_id,
        'operation', p_operation,
        'reason_code', p_reason_code,
        'lifecycle_state', case when v_release then 'released' else 'active' end,
        'placeholder', not v_release,
        'unlinked_sale_ids', to_jsonb(v_unlinked_sale_ids)
      );
    end if;

    -- The seller side leaving a sale (or an untyped row).
    if exists (
      select 1
      from public.property_ea_assignments pea
      where pea.property_id = p_property_id
        and pea.status = 'active'
    ) then
      v_release := false;
    else
      v_dependants := public._property_placeholder_has_dependants(p_property_id, v_uid);
      v_release := v_mistake and not v_dependants;
    end if;

    if v_release then
      v_transition := public.record_property_lifecycle_transition(
        p_property_id,
        'released',
        'homeowner_delink',
        null,
        p_reason_code,
        jsonb_build_object('operation', p_operation, 'reason_code', p_reason_code)
      );

      if coalesce((v_transition ->> 'ok')::boolean, false) is not true then
        raise exception 'participation_delink_lifecycle_transition_failed: %',
          coalesce(v_transition ->> 'error', 'unknown');
      end if;
    end if;

    delete from public.property_members pm
    where pm.property_id = p_property_id
      and (
        pm.user_id = v_uid
        or pm.user_id in (
          select pd.delegate_user_id
          from public.property_delegates pd
          where pd.property_id = p_property_id
            and pd.status in ('pending', 'active')
        )
      );

    update public.property_delegates
    set
      status = 'revoked',
      revoked_at = now(),
      updated_at = now()
    where property_id = p_property_id
      and status in ('pending', 'active');

    update public.property_operational_identities
    set
      status = 'released',
      delinked_at = now(),
      updated_at = now()
    where property_id = p_property_id
      and status = 'active';

    if v_release then
      update public.property_counterparty_participants
      set
        status = 'delinked',
        delinked_at = now()
      where property_id = p_property_id
        and status = 'active';

      delete from public.property_members
      where property_id = p_property_id;

      perform public._revoke_open_property_claim_invitations(p_property_id);

      update public.property_claim_metadata pcm
      set
        claim_status = case
          when pcm.origin_type = 'estate_agent' then 'unclaimed'
          else pcm.claim_status
        end,
        claimed_by_user_id = case
          when pcm.origin_type = 'estate_agent' then null
          else pcm.claimed_by_user_id
        end,
        claimed_at = case
          when pcm.origin_type = 'estate_agent' then null
          else pcm.claimed_at
        end,
        updated_at = now()
      where pcm.property_id = p_property_id;

      update public.properties
      set
        status = 'pending_connection',
        buyer_connected = false,
        seller_connected = false
      where id = p_property_id;

      v_activity_message :=
        'Homeowner left this transaction. The property has been released.';
    else
      -- The seller side is open again: a replacement homeowner can be invited
      -- (by the remaining EA) or can claim with a valid invitation.
      insert into public.property_claim_metadata (
        property_id,
        claim_status,
        claimed_at,
        claimed_by_user_id
      )
      values (
        p_property_id,
        'unclaimed',
        null,
        null
      )
      on conflict (property_id) do update
      set
        claim_status = case
          when public.property_claim_metadata.claim_status = 'claim_invited' then 'claim_invited'
          else 'unclaimed'
        end,
        claimed_at = null,
        claimed_by_user_id = null,
        updated_at = now();

      v_activity_message := case
        when exists (
          select 1
          from public.property_ea_assignments pea
          where pea.property_id = p_property_id
            and pea.status = 'active'
        ) then 'Homeowner left this transaction. The estate agent continues to manage the property.'
        else 'Homeowner left this transaction. The property is awaiting its seller.'
      end;
    end if;

    perform public._notify_chain_participants_of_delink(
      p_property_id,
      v_chain_id,
      v_activity_message
    );

    return jsonb_build_object(
      'ok', true,
      'property_id', p_property_id,
      'operation', p_operation,
      'reason_code', p_reason_code,
      'lifecycle_state', case when v_release then 'released' else 'active' end,
      'ea_retained', exists (
        select 1
        from public.property_ea_assignments pea
        where pea.property_id = p_property_id
          and pea.status = 'active'
      ),
      'placeholder', not v_release and not exists (
        select 1
        from public.property_ea_assignments pea
        where pea.property_id = p_property_id
          and pea.status = 'active'
      )
    );
  end if;

  if p_operation = 'homeowner_remove_ea' then
    if not public.is_property_seller_side_homeowner(p_property_id) then
      return jsonb_build_object('ok', false, 'error', 'not_operational_homeowner');
    end if;

    select pea.branch_id
    into v_branch_id
    from public.property_ea_assignments pea
    where pea.property_id = p_property_id
      and pea.status = 'active'
    limit 1;

    if v_branch_id is null then
      return jsonb_build_object('ok', false, 'error', 'no_active_ea_assignment');
    end if;

    if p_branch_id is not null and p_branch_id is distinct from v_branch_id then
      return jsonb_build_object('ok', false, 'error', 'branch_mismatch');
    end if;

    insert into public.property_delink_events (
      property_id,
      chain_id,
      actor_user_id,
      actor_type,
      reason_code,
      metadata
    )
    values (
      p_property_id,
      v_chain_id,
      v_uid,
      'homeowner',
      p_reason_code,
      jsonb_build_object(
        'operation', p_operation,
        'branch_id', v_branch_id
      )
    );

    update public.property_ea_assignments
    set
      status = 'revoked',
      revoked_at = now(),
      revocation_reason = 'homeowner_removed_ea',
      updated_at = now()
    where property_id = p_property_id
      and branch_id = v_branch_id
      and status = 'active';

    v_activity_message :=
      'Homeowner removed the estate agent branch from this property.';

    perform public._notify_chain_participants_of_delink(
      p_property_id,
      v_chain_id,
      v_activity_message
    );

    return jsonb_build_object(
      'ok', true,
      'property_id', p_property_id,
      'operation', p_operation,
      'reason_code', p_reason_code,
      'branch_id', v_branch_id
    );
  end if;

  if p_operation = 'estate_agent_remove_branch' then
    if p_branch_id is null then
      select pea.branch_id
      into v_branch_id
      from public.property_ea_assignments pea
      inner join public.ea_branch_members bm
        on bm.branch_id = pea.branch_id
      where pea.property_id = p_property_id
        and pea.status = 'active'
        and bm.user_id = v_uid
      limit 1;
    else
      v_branch_id := p_branch_id;
    end if;

    if v_branch_id is null then
      return jsonb_build_object('ok', false, 'error', 'branch_required');
    end if;

    if not exists (
      select 1
      from public.property_ea_assignments pea
      inner join public.ea_branch_members bm
        on bm.branch_id = pea.branch_id
      where pea.property_id = p_property_id
        and pea.branch_id = v_branch_id
        and pea.status = 'active'
        and bm.user_id = v_uid
    ) then
      return jsonb_build_object('ok', false, 'error', 'not_assigned_ea');
    end if;

    insert into public.property_delink_events (
      property_id,
      chain_id,
      actor_user_id,
      actor_type,
      reason_code,
      metadata
    )
    values (
      p_property_id,
      v_chain_id,
      v_uid,
      'estate_agent',
      p_reason_code,
      jsonb_build_object(
        'operation', p_operation,
        'branch_id', v_branch_id
      )
    );

    v_homeowner_remains := public._property_seller_side_user_id(p_property_id) is not null;

    if not v_homeowner_remains then
      v_dependants := public._property_placeholder_has_dependants(p_property_id, null);
      v_release := v_mistake and not v_dependants;
    end if;

    -- Recorded while the caller is still the assigned EA, so the lifecycle
    -- transition is authorised.
    if v_release then
      v_transition := public.record_property_lifecycle_transition(
        p_property_id,
        'released',
        'ea_delink_no_homeowner',
        null,
        p_reason_code,
        jsonb_build_object(
          'operation', p_operation,
          'reason_code', p_reason_code,
          'branch_id', v_branch_id
        )
      );

      if coalesce((v_transition ->> 'ok')::boolean, false) is not true then
        raise exception 'participation_delink_lifecycle_transition_failed: %',
          coalesce(v_transition ->> 'error', 'unknown');
      end if;

      update public.property_delegates
      set
        status = 'revoked',
        revoked_at = now(),
        updated_at = now()
      where property_id = p_property_id
        and status in ('pending', 'active');

      update public.property_counterparty_participants
      set
        status = 'delinked',
        delinked_at = now()
      where property_id = p_property_id
        and status = 'active';

      delete from public.property_members
      where property_id = p_property_id;

      perform public._revoke_open_property_claim_invitations(p_property_id);

      update public.property_claim_metadata pcm
      set
        claim_status = 'unclaimed',
        claimed_by_user_id = null,
        claimed_at = null,
        updated_at = now()
      where pcm.property_id = p_property_id;

      update public.properties
      set
        status = 'pending_connection',
        buyer_connected = false,
        seller_connected = false
      where id = p_property_id;
    end if;

    update public.property_ea_assignments
    set
      status = 'revoked',
      revoked_at = now(),
      revocation_reason = 'branch_left',
      updated_at = now()
    where property_id = p_property_id
      and branch_id = v_branch_id
      and status = 'active';

    if v_release then
      perform public._insert_participation_delink_activity(
        p_property_id,
        'Property released for future transactions. Historic chain data retained.',
        'system'
      );
    end if;

    v_activity_message :=
      'Estate agent branch released operational management of this property.';

    perform public._notify_chain_participants_of_delink(
      p_property_id,
      v_chain_id,
      v_activity_message
    );

    return jsonb_build_object(
      'ok', true,
      'property_id', p_property_id,
      'operation', p_operation,
      'reason_code', p_reason_code,
      'branch_id', v_branch_id,
      'lifecycle_state', case when v_release then 'released' else 'active' end,
      'placeholder', not v_homeowner_remains and not v_release
    );
  end if;

  if p_operation = 'estate_agent_remove_homeowner' then
    select pea.branch_id
    into v_branch_id
    from public.property_ea_assignments pea
    inner join public.ea_branch_members bm
      on bm.branch_id = pea.branch_id
    where pea.property_id = p_property_id
      and pea.status = 'active'
      and bm.user_id = v_uid
    limit 1;

    if v_branch_id is null then
      return jsonb_build_object('ok', false, 'error', 'not_assigned_ea');
    end if;

    if p_branch_id is not null and p_branch_id is distinct from v_branch_id then
      return jsonb_build_object('ok', false, 'error', 'branch_mismatch');
    end if;

    v_withdrawal := public._ea_homeowner_withdrawal_status(p_property_id);

    if v_withdrawal not in ('invitation_pending', 'removable') then
      return jsonb_build_object('ok', false, 'error', v_withdrawal);
    end if;

    insert into public.property_delink_events (
      property_id,
      chain_id,
      actor_user_id,
      actor_type,
      reason_code,
      metadata
    )
    values (
      p_property_id,
      v_chain_id,
      v_uid,
      'estate_agent',
      p_reason_code,
      jsonb_build_object(
        'operation', p_operation,
        'branch_id', v_branch_id,
        'invitation_pending', v_withdrawal = 'invitation_pending'
      )
    );

    update public.property_delegates
    set
      status = 'revoked',
      revoked_at = now(),
      updated_at = now()
    where property_id = p_property_id
      and status in ('pending', 'active');

    select *
    into v_identity
    from public.property_operational_identities poi
    where poi.property_id = p_property_id
      and poi.status = 'active';

    if v_identity.property_id is not null then
      delete from public.property_members
      where property_id = p_property_id
        and user_id = v_identity.homeowner_user_id;

      update public.property_operational_identities
      set
        status = 'released',
        delinked_at = now(),
        updated_at = now()
      where property_id = p_property_id
        and status = 'active';

      perform public._release_converged_onward_purchase_with_sale(
        p_property_id,
        v_identity.homeowner_user_id,
        p_reason_code
      );
    end if;

    update public.property_claim_invitations pci
    set
      invitation_revoked_at = coalesce(pci.invitation_revoked_at, now()),
      updated_at = now()
    where pci.property_id = p_property_id
      and pci.invitation_used_at is null
      and pci.invitation_revoked_at is null;

    update public.property_claim_metadata pcm
    set
      claim_status = 'claim_invited',
      claimed_by_user_id = null,
      claimed_at = null,
      updated_at = now()
    where pcm.property_id = p_property_id;

    v_activity_message :=
      'Estate agent withdrew the homeowner association for this property. The invitation can be re-sent.';

    perform public._notify_chain_participants_of_delink(
      p_property_id,
      v_chain_id,
      v_activity_message
    );

    return jsonb_build_object(
      'ok', true,
      'property_id', p_property_id,
      'operation', p_operation,
      'reason_code', p_reason_code,
      'branch_id', v_branch_id,
      'invitation_reset', true
    );
  end if;

  return jsonb_build_object('ok', false, 'error', 'unsupported_operation');
end;
$$;

revoke all on function public._execute_participation_delink(bigint, text, text, uuid) from public, anon, authenticated;
grant execute on function public._execute_participation_delink(bigint, text, text, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 6) create_ea_operational_property (copied from 20260905120000)
-- ---------------------------------------------------------------------------

create or replace function public.create_ea_operational_property(
  p_chain_id bigint,
  p_relationship_type text,
  p_address text,
  p_postcode text,
  p_branch_id uuid,
  p_homeowner_only_updates boolean default false,
  p_invite_email text default null,
  p_invite_display_name text default null,
  p_awaiting_buyer boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_branch_authorised boolean;
  v_empty_self_originated boolean;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  if not public.is_ea_branch_member(p_branch_id) then
    return jsonb_build_object('ok', false, 'error', 'not_ea_branch_member');
  end if;

  -- Canonical mutate authority: this branch already operates on the chain.
  select exists (
    select 1
    from public.property_ea_assignments pea
    inner join public.properties p
      on p.id = pea.property_id
    where p.chain_id = p_chain_id
      and pea.branch_id = p_branch_id
      and pea.status = 'active'
  )
  into v_branch_authorised;

  -- Narrow origination exception: first property on an empty chain this user created.
  select
    exists (
      select 1
      from public.chains c
      where c.id = p_chain_id
        and c.created_by_user_id = auth.uid()
    )
    and not exists (
      select 1
      from public.properties p
      where p.chain_id = p_chain_id
    )
  into v_empty_self_originated;

  if not v_branch_authorised and not v_empty_self_originated then
    return jsonb_build_object('ok', false, 'error', 'not_authorised_for_chain');
  end if;

  return public._create_ea_operational_property_core(
    p_chain_id,
    p_relationship_type,
    p_address,
    p_postcode,
    p_branch_id,
    p_homeowner_only_updates,
    p_invite_email,
    p_invite_display_name,
    p_awaiting_buyer
  );
end;
$$;

comment on function public.create_ea_operational_property(
  bigint, text, text, text, uuid, boolean, text, text, boolean
) is
  'EA creates an operational property on a chain the branch is authorised to operate on (active assignment), or the first property on an empty chain created by the caller. Unknown and foreign chain ids both return not_authorised_for_chain.';

-- ---------------------------------------------------------------------------
-- 7) get_next_chain_position (replaces 20260610200000)
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
  -- Callers with no role in the chain get the empty-chain answer.
  select case
    when auth.uid() is not null
      and (
        public.caller_may_place_property_in_chain(p_chain_id)
        or public.is_chain_operational_viewer(p_chain_id)
        or exists (
          select 1
          from public.properties op
          where op.chain_id = p_chain_id
            and public.can_operate_property(op.id)
        )
      )
    then coalesce(
      (
        select max(p.chain_position)
        from public.properties p
        where p.chain_id = p_chain_id
      ),
      0
    ) + 1
    else 1
  end;
$$;

comment on function public.get_next_chain_position(bigint) is
  'Next chain position for a chain the caller may place, operate or view a property in; 1 (the empty-chain answer) for every other chain id.';

-- ---------------------------------------------------------------------------
-- 8) Owner resolver: policy uses the boolean self-check; no end-user execute
--    (policy copied from 20261005120000)
-- ---------------------------------------------------------------------------

drop policy if exists properties_update_operator on public.properties;

create policy properties_update_operator
  on public.properties
  for update
  to authenticated
  using (
    public.can_operate_property(id)
    or (
      stage = 'searching'
      and public.is_property_operational_homeowner(id)
    )
  )
  with check (
    public.can_operate_property(id)
    or (
      stage = 'searching'
      and public.is_property_operational_homeowner(id)
    )
  );

revoke all on function public.get_property_operational_owner_user_id(bigint) from public, anon, authenticated;
grant execute on function public.get_property_operational_owner_user_id(bigint) to service_role;

-- ---------------------------------------------------------------------------
-- 9) Helpers with no caller check: no end-user execute
-- ---------------------------------------------------------------------------

revoke all on function public.chain_last_operational_activity_at(bigint) from public, anon, authenticated;
grant execute on function public.chain_last_operational_activity_at(bigint) to service_role;

revoke all on function public.property_chain_is_connected(bigint) from public, anon, authenticated;
grant execute on function public.property_chain_is_connected(bigint) to service_role;

revoke all on function public.homeowner_has_meaningful_participation(bigint) from public, anon, authenticated;
grant execute on function public.homeowner_has_meaningful_participation(bigint) to service_role;

revoke all on function public.property_invitation_is_pending(bigint) from public, anon, authenticated;
grant execute on function public.property_invitation_is_pending(bigint) to service_role;

revoke all on function public.property_has_any_member(bigint) from public, anon, authenticated;
grant execute on function public.property_has_any_member(bigint) to service_role;

-- ---------------------------------------------------------------------------
-- 10) execute_participation_delink: no PUBLIC / anon execute
-- ---------------------------------------------------------------------------

revoke all on function public.execute_participation_delink(bigint, text, text, uuid) from public, anon;
grant execute on function public.execute_participation_delink(bigint, text, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 11) Postflight
-- ---------------------------------------------------------------------------

do $$
declare
  v_fn text;
  v_src text;
  v_definer boolean;
  v_config text[];
  v_owner text;
  v_acl text;
  v_i integer := 0;
  v_qual text;
  v_check text;
begin
  foreach v_fn in array array[
    'public.confirm_transaction_still_active(bigint)',
    'public.create_searching_placeholder_for_sale(bigint)',
    'public.link_sale_to_searching_placeholder(bigint, bigint)',
    'public.establish_connected_hop(bigint)',
    'public._execute_participation_delink(bigint, text, text, uuid)',
    'public.create_ea_operational_property(bigint, text, text, text, uuid, boolean, text, text, boolean)',
    'public.get_next_chain_position(bigint)'
  ] loop
    v_i := v_i + 1;

    select
      p.prosrc,
      p.prosecdef,
      p.proconfig,
      pg_catalog.pg_get_userbyid(p.proowner),
      coalesce(p.proacl::text, '')
    into v_src, v_definer, v_config, v_owner, v_acl
    from pg_proc p
    where p.oid = to_regprocedure(v_fn);

    if v_definer is distinct from true
       or v_config is distinct from array['search_path=public']
       or v_owner is distinct from 'postgres'
       or v_acl is distinct from current_setting('moveloop.existence_probes_acl_' || v_i, true)
    then
      raise exception 'existence_probes postflight: % owner, definer, search_path or grants changed', v_fn;
    end if;

    if (v_i = 1 and (v_src like '%property_not_found%'
                     or strpos(v_src, 'and not public.can_operate_property(p_property_id)') = 0
                     or strpos(v_src, 'and not public.can_operate_property(p_property_id)') > strpos(v_src, '''managed'', true')))
       or (v_i = 2 and (v_src like '%sale_not_found%'
                        or strpos(v_src, 'or not public.can_operate_property(p_sale_property_id)') = 0
                        or strpos(v_src, 'or not public.can_operate_property(p_sale_property_id)') > strpos(v_src, '''invalid_sale''')))
       or (v_i = 3 and (v_src like '%property_not_found%'
                        or strpos(v_src, '''forbidden''') = 0
                        or strpos(v_src, '''forbidden''') > strpos(v_src, '''chain_mismatch''')
                        or strpos(v_src, '''chain_mismatch''') > strpos(v_src, '''invalid_sale''')))
       or (v_i = 4 and (v_src like '%purchase_not_found%'
                        or strpos(v_src, '''not_authorized''') = 0
                        or strpos(v_src, '''not_authorized''') > strpos(v_src, '''not_purchase''')))
       or (v_i = 5 and v_src like '%property_not_found%')
       or (v_i = 6 and v_src like '%chain_not_found%')
       or (v_i = 7 and v_src not like '%is_chain_operational_viewer(p_chain_id)%')
    then
      raise exception 'existence_probes postflight: % body not as intended', v_fn;
    end if;

    perform set_config('moveloop.existence_probes_acl_' || v_i, '', false);
  end loop;

  select pol.qual, pol.with_check into v_qual, v_check
  from pg_policies pol
  where pol.schemaname = 'public'
    and pol.tablename = 'properties'
    and pol.policyname = 'properties_update_operator';

  if v_qual is null
     or v_qual like '%get_property_operational_owner_user_id%'
     or v_check like '%get_property_operational_owner_user_id%'
     or v_qual not like '%is_property_operational_homeowner(id)%'
     or v_check not like '%is_property_operational_homeowner(id)%'
  then
    raise exception 'existence_probes postflight: properties_update_operator not as intended';
  end if;

  foreach v_fn in array array[
    'public.get_property_operational_owner_user_id(bigint)',
    'public.chain_last_operational_activity_at(bigint)',
    'public.property_chain_is_connected(bigint)',
    'public.homeowner_has_meaningful_participation(bigint)',
    'public.property_invitation_is_pending(bigint)',
    'public.property_has_any_member(bigint)'
  ] loop
    if has_function_privilege('anon', v_fn, 'execute')
       or has_function_privilege('authenticated', v_fn, 'execute')
       or not has_function_privilege('service_role', v_fn, 'execute')
    then
      raise exception 'existence_probes postflight: % grants not as intended', v_fn;
    end if;
  end loop;

  if has_function_privilege('anon', 'public.execute_participation_delink(bigint, text, text, uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.execute_participation_delink(bigint, text, text, uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.is_property_operational_homeowner(bigint)', 'execute')
  then
    raise exception 'existence_probes postflight: execute_participation_delink or policy helper grants not as intended';
  end if;
end;
$$;
