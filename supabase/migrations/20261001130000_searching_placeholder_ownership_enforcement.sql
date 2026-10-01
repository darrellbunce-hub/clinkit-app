-- Searching placeholder ownership (3 of 3, enforcement + repair).
--
-- Ownership model enforced here:
--   property_operational_identities is the only source of ownership;
--   property_members is an access cache. Estate-agent accounts never hold an
--   operational identity or owner-class membership. An EA-created searching
--   placeholder is unowned until the sale's homeowner claims; its purchase
--   (after conversion) follows the sale's homeowner.
--
-- Changes (latest replaced bodies in brackets; all other statements unchanged):
--   _establish_operational_homeowner_core    rejects estate-agent accounts
--                                            (estate_agent_cannot_be_homeowner) [20260714150000]
--   _grant_counterparty_participation_core   rejects estate-agent accounts
--                                            (estate_agent_cannot_be_counterparty) [20260727100000]
--   link_sale_to_searching_placeholder       delegated EA (not view-only), creator only while the
--                                            sale has no homeowner, placeholder owner must be
--                                            null or the sale's homeowner [20260613000000]
--   convert_searching_placeholder_for_sale   buyer is always the sale's operational homeowner
--                                            (no auth.uid() fallback); unowned when the sale is
--                                            unowned; atomic [20260714150000]
--   claim_operational_property               converges the linked EA-created onward purchase to
--                                            the claimant (isolated; returns onward_claimed)
--                                            [20260729120000]
--   _execute_participation_delink            estate_agent_remove_homeowner also releases the
--                                            onward purchase that followed the sale [20260727110000]
--   _repair_estate_agent_operational_identities (new, service_role) + one-off execution with
--                                            before/after counts; aborts unless zero remain.
--
-- Requires: 20261001110000 (_is_estate_agent_account, create_searching_placeholder_for_sale).
-- Apply after the application change that calls create_searching_placeholder_for_sale.

-- ---------------------------------------------------------------------------
-- 0) Preflight
-- ---------------------------------------------------------------------------

do $$
declare
  v_missing text[] := array[]::text[];
  v_name text;
  v_src text;
  v_identities integer;
  v_memberships integer;
begin
  foreach v_name in array array[
    'public.properties',
    'public.profiles',
    'public.property_members',
    'public.property_operational_identities',
    'public.property_claim_metadata',
    'public.property_claim_invitations',
    'public.property_delink_events',
    'public.property_delegates',
    'public.property_counterparty_participants'
  ]
  loop
    if to_regclass(v_name) is null then
      v_missing := array_append(v_missing, v_name);
    end if;
  end loop;

  foreach v_name in array array[
    'auth.uid()',
    'public._is_estate_agent_account(uuid)',
    'public.create_searching_placeholder_for_sale(bigint)',
    'public._establish_operational_homeowner_core(bigint, uuid, text, boolean)',
    'public._grant_counterparty_participation_core(bigint, uuid)',
    'public._upsert_property_membership_row(bigint, uuid, text)',
    'public._sync_property_claim_on_homeowner_grant(bigint, uuid)',
    'public._execute_participation_delink(bigint, text, text, uuid)',
    'public._notify_chain_participants_of_delink(bigint, bigint, text)',
    'public._rate_limit_is_blocked(text, text, integer, integer)',
    'public._rate_limit_record_attempt(text, text, integer)',
    'public.link_sale_to_searching_placeholder(bigint, bigint)',
    'public.convert_searching_placeholder_for_sale(bigint, text, text)',
    'public.claim_operational_property(bigint, text)',
    'public.establish_operational_homeowner(bigint, text)',
    'public.get_property_operational_owner_user_id(bigint)',
    'public.is_property_operational_homeowner(bigint)',
    'public.is_property_member(bigint)',
    'public.is_ea_delegated_editor_on_property(bigint)',
    'public.property_exists_for_onboarding(text, text, bigint)',
    'public.get_auth_user_email()',
    'public.hash_invitation_token(text)',
    'public.property_invitation_is_pending(bigint)',
    'public.homeowner_has_meaningful_participation(bigint)',
    'public.is_valid_participation_delink_reason_code(text, text)',
    'public.record_property_lifecycle_transition(bigint, text, text, text, text, jsonb)'
  ]
  loop
    if to_regprocedure(v_name) is null then
      v_missing := array_append(v_missing, v_name);
    end if;
  end loop;

  if cardinality(v_missing) > 0 then
    raise exception
      'searching_placeholder_ownership aborted: missing dependencies (%)',
      array_to_string(v_missing, ', ');
  end if;

  -- Replaced bodies must still be the expected repository versions.
  select p.prosrc into v_src
  from pg_proc p
  where p.oid = to_regprocedure('public._establish_operational_homeowner_core(bigint, uuid, text, boolean)');

  if v_src not like '%operational_homeowner_exists%'
     or v_src not like '%_upsert_property_membership_row(%'
  then
    raise exception
      'searching_placeholder_ownership aborted: _establish_operational_homeowner_core body differs from 20260714150000';
  end if;

  select p.prosrc into v_src
  from pg_proc p
  where p.oid = to_regprocedure('public._grant_counterparty_participation_core(bigint, uuid)');

  if v_src not like '%homeowner_cannot_be_counterparty%'
     or v_src not like '%''join_chain_property''%'
  then
    raise exception
      'searching_placeholder_ownership aborted: _grant_counterparty_participation_core body differs from 20260727100000';
  end if;

  select p.prosrc into v_src
  from pg_proc p
  where p.oid = to_regprocedure('public.link_sale_to_searching_placeholder(bigint, bigint)');

  if v_src not like '%is_ea_assigned_to_property(p_sale_property_id)%'
     or v_src not like '%invalid_searching_placeholder%'
  then
    raise exception
      'searching_placeholder_ownership aborted: link_sale_to_searching_placeholder body differs from 20260613000000';
  end if;

  select p.prosrc into v_src
  from pg_proc p
  where p.oid = to_regprocedure('public.convert_searching_placeholder_for_sale(bigint, text, text)');

  if v_src not like '%''convert_placeholder''%'
     or v_src not like '%v_buyer_user_id := auth.uid();%'
  then
    raise exception
      'searching_placeholder_ownership aborted: convert_searching_placeholder_for_sale body differs from 20260714150000';
  end if;

  select p.prosrc into v_src
  from pg_proc p
  where p.oid = to_regprocedure('public.claim_operational_property(bigint, text)');

  if v_src not like '%claim_property_failed%'
     or v_src not like '%''claim_operational_property''%'
  then
    raise exception
      'searching_placeholder_ownership aborted: claim_operational_property body differs from 20260729120000';
  end if;

  select p.prosrc into v_src
  from pg_proc p
  where p.oid = to_regprocedure('public._execute_participation_delink(bigint, text, text, uuid)');

  if v_src not like '%estate_agent_remove_homeowner%'
     or v_src not like '%The invitation can be re-sent.%'
     or v_src not like '%is_valid_participation_delink_reason_code(%'
  then
    raise exception
      'searching_placeholder_ownership aborted: _execute_participation_delink body differs from 20260727110000';
  end if;

  select count(*)
  into v_identities
  from public.property_operational_identities poi
  where public._is_estate_agent_account(poi.homeowner_user_id);

  select count(*)
  into v_memberships
  from public.property_members pm
  inner join public.properties p
    on p.id = pm.property_id
  where public._is_estate_agent_account(pm.user_id)
    and (
      (p.relationship_type = 'sale' and pm.role = 'seller')
      or (p.relationship_type = 'purchase' and pm.role = 'buyer')
    );

  raise notice
    'searching_placeholder_ownership preflight: % estate-agent operational identities, % estate-agent owner-class memberships',
    v_identities,
    v_memberships;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1) _establish_operational_homeowner_core: reject estate-agent accounts
-- ---------------------------------------------------------------------------

create or replace function public._establish_operational_homeowner_core(
  p_property_id bigint,
  p_homeowner_user_id uuid,
  p_granted_via text,
  p_sync_claim boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_property public.properties%rowtype;
  v_operational_role text;
  v_existing public.property_operational_identities%rowtype;
begin
  if p_homeowner_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'homeowner_required');
  end if;

  if public._is_estate_agent_account(p_homeowner_user_id) then
    return jsonb_build_object('ok', false, 'error', 'estate_agent_cannot_be_homeowner');
  end if;

  select *
  into v_property
  from public.properties
  where id = p_property_id;

  if v_property.id is null then
    return jsonb_build_object('ok', false, 'error', 'property_not_found');
  end if;

  v_operational_role := case
    when v_property.relationship_type = 'sale' then 'seller'
    when v_property.relationship_type = 'purchase' then 'buyer'
    else null
  end;

  if v_operational_role is null then
    return jsonb_build_object('ok', false, 'error', 'not_operational_property');
  end if;

  select *
  into v_existing
  from public.property_operational_identities poi
  where poi.property_id = p_property_id;

  if v_existing.property_id is not null then
    if v_existing.status = 'active' then
      if v_existing.homeowner_user_id = p_homeowner_user_id then
        perform public._upsert_property_membership_row(
          p_property_id,
          p_homeowner_user_id,
          v_operational_role
        );

        if p_sync_claim then
          perform public._sync_property_claim_on_homeowner_grant(
            p_property_id,
            p_homeowner_user_id
          );
        end if;

        return jsonb_build_object(
          'ok', true,
          'property_id', p_property_id,
          'idempotent', true
        );
      end if;

      return jsonb_build_object('ok', false, 'error', 'operational_homeowner_exists');
    end if;

    update public.property_operational_identities
    set
      homeowner_user_id = p_homeowner_user_id,
      operational_role = v_operational_role,
      granted_via = p_granted_via,
      status = 'active',
      granted_at = now(),
      delinked_at = null,
      updated_at = now()
    where property_id = p_property_id;
  else
    insert into public.property_operational_identities (
      property_id,
      homeowner_user_id,
      operational_role,
      granted_via,
      status,
      granted_at
    )
    values (
      p_property_id,
      p_homeowner_user_id,
      v_operational_role,
      p_granted_via,
      'active',
      now()
    );
  end if;

  perform public._upsert_property_membership_row(
    p_property_id,
    p_homeowner_user_id,
    v_operational_role
  );

  if p_sync_claim then
    perform public._sync_property_claim_on_homeowner_grant(
      p_property_id,
      p_homeowner_user_id
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'property_id', p_property_id
  );
end;
$$;

revoke all on function public._establish_operational_homeowner_core(bigint, uuid, text, boolean) from public, anon, authenticated;
grant execute on function public._establish_operational_homeowner_core(bigint, uuid, text, boolean) to service_role;

-- ---------------------------------------------------------------------------
-- 2) _grant_counterparty_participation_core: reject estate-agent accounts
-- ---------------------------------------------------------------------------

create or replace function public._grant_counterparty_participation_core(
  p_property_id bigint,
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_property public.properties%rowtype;
  v_counterparty_role text;
  v_is_homeowner boolean;
begin
  if p_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  if public._is_estate_agent_account(p_user_id) then
    return jsonb_build_object('ok', false, 'error', 'estate_agent_cannot_be_counterparty');
  end if;

  select *
  into v_property
  from public.properties
  where id = p_property_id;

  if v_property.id is null then
    return jsonb_build_object('ok', false, 'error', 'property_not_found');
  end if;

  if not exists (
    select 1
    from public.property_operational_identities poi
    where poi.property_id = p_property_id
      and poi.status = 'active'
  ) then
    return jsonb_build_object('ok', false, 'error', 'no_operational_homeowner');
  end if;

  select exists (
    select 1
    from public.property_operational_identities poi
    where poi.property_id = p_property_id
      and poi.homeowner_user_id = p_user_id
      and poi.status = 'active'
  )
  into v_is_homeowner;

  if v_is_homeowner then
    return jsonb_build_object('ok', false, 'error', 'homeowner_cannot_be_counterparty');
  end if;

  v_counterparty_role := case
    when v_property.relationship_type = 'sale' then 'buyer'
    when v_property.relationship_type = 'purchase' then 'seller'
    else null
  end;

  if v_counterparty_role is null then
    return jsonb_build_object('ok', false, 'error', 'not_counterparty_property');
  end if;

  insert into public.property_counterparty_participants (
    property_id,
    user_id,
    counterparty_role,
    granted_via,
    status,
    granted_at
  )
  values (
    p_property_id,
    p_user_id,
    v_counterparty_role,
    'join_chain_property',
    'active',
    now()
  )
  on conflict (property_id, user_id) do update
  set
    counterparty_role = excluded.counterparty_role,
    status = 'active',
    delinked_at = null;

  perform public._upsert_property_membership_row(
    p_property_id,
    p_user_id,
    v_counterparty_role
  );

  return jsonb_build_object(
    'ok', true,
    'property_id', p_property_id,
    'counterparty_role', v_counterparty_role
  );
end;
$$;

revoke all on function public._grant_counterparty_participation_core(bigint, uuid) from public, anon, authenticated;
grant execute on function public._grant_counterparty_participation_core(bigint, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 3) link_sale_to_searching_placeholder: delegated EA; owner-consistent link
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

  if v_sale.id is null or v_searching.id is null then
    return jsonb_build_object('ok', false, 'error', 'property_not_found');
  end if;

  if v_sale.chain_id <> v_searching.chain_id then
    return jsonb_build_object('ok', false, 'error', 'chain_mismatch');
  end if;

  if v_sale.relationship_type <> 'sale' then
    return jsonb_build_object('ok', false, 'error', 'invalid_sale');
  end if;

  if v_searching.stage <> 'searching'
    or v_searching.address is not null
    or v_searching.postcode is not null then
    return jsonb_build_object('ok', false, 'error', 'invalid_searching_placeholder');
  end if;

  v_sale_owner := public.get_property_operational_owner_user_id(p_sale_property_id);

  if not (
    public.is_property_member(p_sale_property_id)
    or public.is_ea_delegated_editor_on_property(p_sale_property_id)
    or (
      v_sale.created_by_user_id = auth.uid()
      and v_sale_owner is null
    )
  ) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

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
  'Links a sale property to a stage-authoritative searching placeholder (Start Move). Sale member, delegated EA editor, or creator of an unowned sale; the placeholder must be unowned or owned by the sale''s homeowner.';

revoke all on function public.link_sale_to_searching_placeholder(bigint, bigint) from public, anon;
grant execute on function public.link_sale_to_searching_placeholder(bigint, bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- 4) convert_searching_placeholder_for_sale: sale-derived buyer, atomic
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
  v_is_homeowner_seller boolean;
  v_is_delegated_ea boolean;
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

  if v_sale.id is null then
    return jsonb_build_object('ok', false, 'error', 'sale_not_found');
  end if;

  if v_sale.relationship_type is distinct from 'sale' then
    return jsonb_build_object('ok', false, 'error', 'invalid_sale');
  end if;

  select public.is_property_operational_homeowner(p_sale_property_id)
  into v_is_homeowner_seller;

  if not v_is_homeowner_seller then
    select public.is_ea_delegated_editor_on_property(p_sale_property_id)
    into v_is_delegated_ea;

    if not coalesce(v_is_delegated_ea, false) then
      return jsonb_build_object('ok', false, 'error', 'not_authorized');
    end if;
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
    public.get_property_operational_owner_user_id(p_sale_property_id);
  v_placeholder_owner :=
    public.get_property_operational_owner_user_id(v_placeholder_id);

  if v_placeholder_owner is not null
     and v_placeholder_owner is distinct from v_buyer_user_id
  then
    return jsonb_build_object('ok', false, 'error', 'placeholder_owner_mismatch');
  end if;

  select case
    when p.account_type = 'estate_agent' then 'estate_agent'
    else 'homeowner'
  end
  into v_updated_by
  from public.profiles p
  where p.id = auth.uid();

  v_updated_by := coalesce(v_updated_by, 'homeowner');

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
  'Converts the downstream searching placeholder. Authorised via operational seller identity or delegated EA editing. The purchase is owned by the sale''s operational homeowner, or unowned when the sale is unowned. Atomic.';

revoke all on function public.convert_searching_placeholder_for_sale(bigint, text, text) from public, anon;
grant execute on function public.convert_searching_placeholder_for_sale(bigint, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5) Claim convergence: onward purchase follows the claimed sale
-- ---------------------------------------------------------------------------

create or replace function public._converge_onward_purchase_after_claim(
  p_sale_property_id bigint,
  p_homeowner_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sale public.properties%rowtype;
  v_onward public.properties%rowtype;
  v_existing public.property_operational_identities%rowtype;
  v_grant jsonb;
begin
  select *
  into v_sale
  from public.properties
  where id = p_sale_property_id;

  if v_sale.id is null
     or v_sale.relationship_type is distinct from 'sale'
     or v_sale.linked_property_id is null
  then
    return jsonb_build_object('ok', true, 'onward_claimed', false);
  end if;

  select *
  into v_onward
  from public.properties
  where id = v_sale.linked_property_id;

  if v_onward.id is null
     or v_onward.chain_id is distinct from v_sale.chain_id
     or v_onward.relationship_type is distinct from 'purchase'
     or not public._is_estate_agent_account(v_onward.created_by_user_id)
  then
    return jsonb_build_object('ok', true, 'onward_claimed', false);
  end if;

  select *
  into v_existing
  from public.property_operational_identities poi
  where poi.property_id = v_onward.id;

  -- Only an onward row that has never had an identity, or whose identity was
  -- released together with this sale by estate_agent_remove_homeowner.
  if v_existing.property_id is not null
     and not (
       v_existing.status <> 'active'
       and v_existing.metadata ->> 'released_with_sale_property_id' = v_sale.id::text
     )
  then
    return jsonb_build_object('ok', true, 'onward_claimed', false);
  end if;

  v_grant := public._establish_operational_homeowner_core(
    v_onward.id,
    p_homeowner_user_id,
    'ea_origination_claim',
    false
  );

  if not coalesce((v_grant ->> 'ok')::boolean, false) then
    return jsonb_build_object(
      'ok', false,
      'onward_claimed', false,
      'error', coalesce(v_grant ->> 'error', 'grant_failed')
    );
  end if;

  update public.property_operational_identities
  set metadata = metadata - 'released_with_sale_property_id'
  where property_id = v_onward.id;

  return jsonb_build_object(
    'ok', true,
    'onward_claimed', true,
    'onward_property_id', v_onward.id
  );
end;
$$;

comment on function public._converge_onward_purchase_after_claim(bigint, uuid) is
  'Internal: after a sale claim, grants the linked EA-created same-chain onward purchase (never owned, or released with this sale) to the claimant.';

revoke all on function public._converge_onward_purchase_after_claim(bigint, uuid) from public, anon, authenticated;
grant execute on function public._converge_onward_purchase_after_claim(bigint, uuid) to service_role;

create or replace function public.claim_operational_property(
  p_property_id bigint,
  p_invitation_token text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  v_property public.properties%rowtype;
  v_claimable boolean;
  v_hash text;
  v_invitation public.property_claim_invitations%rowtype;
  v_grant jsonb;
  v_onward jsonb;
  v_subject text;
  c_scope constant text := 'claim_property_failed';
  c_limit constant integer := 15;
  c_window constant integer := 900;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  v_subject := auth.uid()::text;

  -- Throttle checked before token/claimability evaluation → no token oracle.
  if public._rate_limit_is_blocked(c_scope, v_subject, c_limit, c_window) then
    return jsonb_build_object('ok', false, 'error', 'too_many_attempts');
  end if;

  if not exists (
    select 1
    from public.profiles pr
    where pr.id = auth.uid()
      and pr.account_type = 'homeowner'
  ) then
    perform public._rate_limit_record_attempt(c_scope, v_subject, c_window);
    return jsonb_build_object('ok', false, 'error', 'homeowner_only');
  end if;

  v_email := public.get_auth_user_email();

  if v_email is null or v_email = '' then
    perform public._rate_limit_record_attempt(c_scope, v_subject, c_window);
    return jsonb_build_object('ok', false, 'error', 'email_required');
  end if;

  if nullif(trim(p_invitation_token), '') is not null then
    v_hash := public.hash_invitation_token(p_invitation_token);

    select *
    into v_invitation
    from public.property_claim_invitations pci
    where pci.property_id = p_property_id
      and pci.invitation_token_hash = v_hash
    order by pci.invitation_created_at desc
    limit 1;

    if v_invitation.id is null then
      perform public._rate_limit_record_attempt(c_scope, v_subject, c_window);
      return jsonb_build_object('ok', false, 'error', 'invalid_token');
    end if;

    if v_invitation.invitation_used_at is not null then
      perform public._rate_limit_record_attempt(c_scope, v_subject, c_window);
      return jsonb_build_object('ok', false, 'error', 'already_used');
    end if;

    if v_invitation.invitation_rejected_at is not null then
      perform public._rate_limit_record_attempt(c_scope, v_subject, c_window);
      return jsonb_build_object('ok', false, 'error', 'invitation_declined');
    end if;

    if v_invitation.invitation_revoked_at is not null then
      perform public._rate_limit_record_attempt(c_scope, v_subject, c_window);
      return jsonb_build_object('ok', false, 'error', 'invalid_token');
    end if;

    if v_invitation.invitation_expires_at <= now() then
      perform public._rate_limit_record_attempt(c_scope, v_subject, c_window);
      return jsonb_build_object('ok', false, 'error', 'expired');
    end if;
  end if;

  select exists (
    select 1
    from public.property_claim_metadata pcm
    where pcm.property_id = p_property_id
      and pcm.origin_type = 'estate_agent'
      and pcm.claim_status in ('unclaimed', 'claim_invited')
      and pcm.invite_email is not null
      and lower(trim(pcm.invite_email)) = v_email
  )
  into v_claimable;

  if not v_claimable then
    perform public._rate_limit_record_attempt(c_scope, v_subject, c_window);
    return jsonb_build_object('ok', false, 'error', 'not_claimable');
  end if;

  if exists (
    select 1
    from public.property_operational_identities poi
    where poi.property_id = p_property_id
      and poi.status = 'active'
  ) then
    perform public._rate_limit_record_attempt(c_scope, v_subject, c_window);
    return jsonb_build_object('ok', false, 'error', 'already_claimed');
  end if;

  select *
  into v_property
  from public.properties
  where id = p_property_id;

  if v_property.id is null then
    perform public._rate_limit_record_attempt(c_scope, v_subject, c_window);
    return jsonb_build_object('ok', false, 'error', 'property_not_found');
  end if;

  v_grant := public.establish_operational_homeowner(
    p_property_id,
    'claim_operational_property'
  );

  if not coalesce((v_grant ->> 'ok')::boolean, false) then
    perform public._rate_limit_record_attempt(c_scope, v_subject, c_window);
    return v_grant;
  end if;

  if v_invitation.id is not null then
    update public.property_claim_invitations
    set
      invitation_used_at = now(),
      updated_at = now()
    where id = v_invitation.id
      and invitation_used_at is null;
  else
    update public.property_claim_invitations
    set
      invitation_used_at = now(),
      updated_at = now()
    where property_id = p_property_id
      and invitation_revoked_at is null
      and invitation_used_at is null
      and invitation_expires_at > now();
  end if;

  -- Isolated: a convergence failure must not roll back the claim.
  begin
    v_onward := public._converge_onward_purchase_after_claim(
      p_property_id,
      auth.uid()
    );
  exception
    when others then
      v_onward := jsonb_build_object('ok', false, 'onward_claimed', false);
  end;

  return jsonb_build_object(
    'ok', true,
    'property_id', p_property_id,
    'chain_id', v_property.chain_id,
    'onward_claimed', coalesce((v_onward ->> 'onward_claimed')::boolean, false)
  );
end;
$$;

revoke all on function public.claim_operational_property(bigint, text) from public, anon;
grant execute on function public.claim_operational_property(bigint, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6) estate_agent_remove_homeowner: onward purchase follows the sale back
-- ---------------------------------------------------------------------------

create or replace function public._release_converged_onward_purchase_with_sale(
  p_sale_property_id bigint,
  p_homeowner_user_id uuid,
  p_reason_code text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sale public.properties%rowtype;
  v_onward public.properties%rowtype;
begin
  select *
  into v_sale
  from public.properties
  where id = p_sale_property_id;

  if v_sale.id is null or v_sale.linked_property_id is null then
    return;
  end if;

  select *
  into v_onward
  from public.properties
  where id = v_sale.linked_property_id;

  if v_onward.id is null
     or v_onward.chain_id is distinct from v_sale.chain_id
     or v_onward.relationship_type is distinct from 'purchase'
     or not public._is_estate_agent_account(v_onward.created_by_user_id)
  then
    return;
  end if;

  if not exists (
    select 1
    from public.property_operational_identities poi
    where poi.property_id = v_onward.id
      and poi.homeowner_user_id = p_homeowner_user_id
      and poi.status = 'active'
  ) then
    return;
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
    v_onward.id,
    v_onward.chain_id,
    auth.uid(),
    'estate_agent',
    p_reason_code,
    jsonb_build_object(
      'operation', 'estate_agent_remove_homeowner',
      'released_with_sale_property_id', v_sale.id
    )
  );

  update public.property_delegates
  set
    status = 'revoked',
    revoked_at = now(),
    updated_at = now()
  where property_id = v_onward.id
    and status in ('pending', 'active');

  delete from public.property_members
  where property_id = v_onward.id
    and user_id = p_homeowner_user_id;

  update public.property_operational_identities
  set
    status = 'released',
    delinked_at = now(),
    updated_at = now(),
    metadata = metadata || jsonb_build_object('released_with_sale_property_id', v_sale.id)
  where property_id = v_onward.id
    and status = 'active';
end;
$$;

comment on function public._release_converged_onward_purchase_with_sale(bigint, uuid, text) is
  'Internal: when an EA removes the homeowner from an EA-originated sale, releases the linked EA-created onward purchase held by the same homeowner so it converges again on the next claim.';

revoke all on function public._release_converged_onward_purchase_with_sale(bigint, uuid, text) from public, anon, authenticated;
grant execute on function public._release_converged_onward_purchase_with_sale(bigint, uuid, text) to service_role;

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
  v_chain_id bigint;
  v_branch_id uuid;
  v_activity_message text;
  v_claim public.property_claim_metadata%rowtype;
  v_identity public.property_operational_identities%rowtype;
begin
  if auth.uid() is null then
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

  if not exists (
    select 1
    from public.properties p
    where p.id = p_property_id
  ) then
    return jsonb_build_object('ok', false, 'error', 'property_not_found');
  end if;

  select chain_id
  into v_chain_id
  from public.properties
  where id = p_property_id;

  if p_operation = 'homeowner_self' then
    if not exists (
      select 1
      from public.property_operational_identities poi
      where poi.property_id = p_property_id
        and poi.homeowner_user_id = auth.uid()
        and poi.status = 'active'
    ) then
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
      auth.uid(),
      'homeowner',
      p_reason_code,
      jsonb_build_object('operation', p_operation)
    );

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

    update public.property_operational_identities
    set
      status = 'released',
      delinked_at = now(),
      updated_at = now()
    where property_id = p_property_id
      and status = 'active';

    delete from public.property_members
    where property_id = p_property_id;

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

    update public.property_ea_assignments
    set
      status = 'revoked',
      revoked_at = now(),
      updated_at = now()
    where property_id = p_property_id
      and status = 'active';

    update public.properties
    set
      status = 'pending_connection',
      buyer_connected = false,
      seller_connected = false
    where id = p_property_id;

    perform public.record_property_lifecycle_transition(
      p_property_id,
      'released',
      'homeowner_delink',
      null,
      p_reason_code,
      jsonb_build_object('operation', p_operation, 'reason_code', p_reason_code)
    );

    v_activity_message :=
      'Homeowner left this transaction. The property has been released.';

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
      'lifecycle_state', 'released'
    );
  end if;

  if p_operation = 'homeowner_remove_ea' then
    if not exists (
      select 1
      from public.property_operational_identities poi
      where poi.property_id = p_property_id
        and poi.homeowner_user_id = auth.uid()
        and poi.status = 'active'
    ) then
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
      auth.uid(),
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
        and bm.user_id = auth.uid()
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
        and bm.user_id = auth.uid()
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
      auth.uid(),
      'estate_agent',
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
      updated_at = now()
    where property_id = p_property_id
      and branch_id = v_branch_id
      and status = 'active';

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
      'branch_id', v_branch_id
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
      and bm.user_id = auth.uid()
    limit 1;

    if v_branch_id is null then
      return jsonb_build_object('ok', false, 'error', 'not_assigned_ea');
    end if;

    if p_branch_id is not null and p_branch_id is distinct from v_branch_id then
      return jsonb_build_object('ok', false, 'error', 'branch_mismatch');
    end if;

    select *
    into v_claim
    from public.property_claim_metadata pcm
    where pcm.property_id = p_property_id;

    if v_claim.origin_type is distinct from 'estate_agent' then
      return jsonb_build_object('ok', false, 'error', 'not_ea_originated');
    end if;

    if public.property_invitation_is_pending(p_property_id) then
      null;
    elsif public.homeowner_has_meaningful_participation(p_property_id) then
      return jsonb_build_object(
        'ok', false,
        'error', 'homeowner_actively_participating'
      );
    else
      select *
      into v_identity
      from public.property_operational_identities poi
      where poi.property_id = p_property_id
        and poi.status = 'active';

      if v_identity.property_id is null then
        return jsonb_build_object('ok', false, 'error', 'no_homeowner_to_remove');
      end if;
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
      auth.uid(),
      'estate_agent',
      p_reason_code,
      jsonb_build_object(
        'operation', p_operation,
        'branch_id', v_branch_id,
        'invitation_pending',
        public.property_invitation_is_pending(p_property_id)
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
-- 7) Repair: estate-agent operational identities and owner-class memberships
-- ---------------------------------------------------------------------------
--
-- Case A: EA-originated purchase (tile or converted) linked from a same-chain
--         sale whose operational homeowner is not an estate agent → identity
--         transferred to that homeowner via _establish_operational_homeowner_core.
-- Case B: any other estate-agent identity → identity and owner-class
--         membership removed; claim metadata naming the agent as claimant is
--         reset so the real homeowner can still claim.
-- Every removal is recorded in property_delink_events (actor_type 'system',
-- actor_user_id null, reason_code 'other', metadata with the previous identity).
-- Rows are deleted, not marked released: 'released' carries lifecycle meaning.

create or replace function public._repair_estate_agent_operational_identities()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_target uuid;
  v_grant jsonb;
  v_transferred integer := 0;
  v_removed integer := 0;
  v_memberships integer := 0;
begin
  for r in
    select
      poi.property_id,
      poi.homeowner_user_id,
      poi.operational_role,
      poi.granted_via,
      poi.status,
      poi.granted_at,
      poi.delinked_at,
      p.chain_id,
      p.relationship_type,
      p.created_by_user_id
    from public.property_operational_identities poi
    inner join public.properties p
      on p.id = poi.property_id
    where public._is_estate_agent_account(poi.homeowner_user_id)
    order by poi.property_id
  loop
    v_target := null;

    if r.relationship_type = 'purchase'
       and (
         public._is_estate_agent_account(r.created_by_user_id)
         or exists (
           select 1
           from public.property_claim_metadata pcm
           where pcm.property_id = r.property_id
             and pcm.origin_type = 'estate_agent'
         )
       )
    then
      select owner_identity.homeowner_user_id
      into v_target
      from public.properties s
      inner join public.property_operational_identities owner_identity
        on owner_identity.property_id = s.id
       and owner_identity.status = 'active'
      where s.linked_property_id = r.property_id
        and s.chain_id = r.chain_id
        and s.relationship_type = 'sale'
        and not public._is_estate_agent_account(owner_identity.homeowner_user_id)
      order by s.id
      limit 1;
    end if;

    delete from public.property_members pm
    where pm.property_id = r.property_id
      and pm.user_id = r.homeowner_user_id
      and pm.role = r.operational_role;

    delete from public.property_operational_identities
    where property_id = r.property_id;

    update public.property_claim_metadata pcm
    set
      claim_status = case
        when pcm.invite_email is not null then 'claim_invited'
        else 'unclaimed'
      end,
      claimed_by_user_id = null,
      claimed_at = null,
      updated_at = now()
    where pcm.property_id = r.property_id
      and pcm.origin_type = 'estate_agent'
      and pcm.claimed_by_user_id = r.homeowner_user_id;

    insert into public.property_delink_events (
      property_id,
      chain_id,
      actor_user_id,
      actor_type,
      reason_code,
      metadata
    )
    values (
      r.property_id,
      r.chain_id,
      null,
      'system',
      'other',
      jsonb_build_object(
        'operation', 'repair_estate_agent_operational_identity',
        'case', case when v_target is not null then 'transfer_to_sale_homeowner' else 'removed' end,
        'previous_identity', jsonb_build_object(
          'homeowner_user_id', r.homeowner_user_id,
          'operational_role', r.operational_role,
          'granted_via', r.granted_via,
          'status', r.status,
          'granted_at', r.granted_at,
          'delinked_at', r.delinked_at
        ),
        'transferred_to_user_id', v_target
      )
    );

    if v_target is not null then
      v_grant := public._establish_operational_homeowner_core(
        r.property_id,
        v_target,
        'ea_origination_claim',
        false
      );

      if not coalesce((v_grant ->> 'ok')::boolean, false) then
        raise exception
          'estate_agent_identity_repair_failed: property % (%)',
          r.property_id,
          coalesce(v_grant ->> 'error', 'grant_failed');
      end if;

      v_transferred := v_transferred + 1;
    else
      v_removed := v_removed + 1;
    end if;
  end loop;

  with removed as (
    delete from public.property_members pm
    using public.properties p
    where p.id = pm.property_id
      and public._is_estate_agent_account(pm.user_id)
      and (
        (p.relationship_type = 'sale' and pm.role = 'seller')
        or (p.relationship_type = 'purchase' and pm.role = 'buyer')
      )
    returning pm.property_id, pm.user_id, pm.role, p.chain_id
  ),
  audited as (
    insert into public.property_delink_events (
      property_id,
      chain_id,
      actor_user_id,
      actor_type,
      reason_code,
      metadata
    )
    select
      removed.property_id,
      removed.chain_id,
      null,
      'system',
      'other',
      jsonb_build_object(
        'operation', 'repair_estate_agent_owner_membership',
        'removed_member_user_id', removed.user_id,
        'removed_member_role', removed.role
      )
    from removed
    returning 1
  )
  select count(*)
  into v_memberships
  from audited;

  return jsonb_build_object(
    'ok', true,
    'identities_transferred', v_transferred,
    'identities_removed', v_removed,
    'memberships_removed', v_memberships
  );
end;
$$;

comment on function public._repair_estate_agent_operational_identities() is
  'Service-role repair: transfers or removes estate-agent operational identities and removes estate-agent owner-class memberships, with property_delink_events audit rows. Idempotent.';

revoke all on function public._repair_estate_agent_operational_identities() from public, anon, authenticated;
grant execute on function public._repair_estate_agent_operational_identities() to service_role;

do $$
declare
  v_result jsonb;
  v_identities integer;
  v_memberships integer;
begin
  v_result := public._repair_estate_agent_operational_identities();

  raise notice 'searching_placeholder_ownership repair: %', v_result;

  select count(*)
  into v_identities
  from public.property_operational_identities poi
  where public._is_estate_agent_account(poi.homeowner_user_id);

  select count(*)
  into v_memberships
  from public.property_members pm
  inner join public.properties p
    on p.id = pm.property_id
  where public._is_estate_agent_account(pm.user_id)
    and (
      (p.relationship_type = 'sale' and pm.role = 'seller')
      or (p.relationship_type = 'purchase' and pm.role = 'buyer')
    );

  if v_identities > 0 or v_memberships > 0 then
    raise exception
      'searching_placeholder_ownership aborted: % estate-agent identities and % estate-agent owner-class memberships remain after repair',
      v_identities,
      v_memberships;
  end if;
end;
$$;
