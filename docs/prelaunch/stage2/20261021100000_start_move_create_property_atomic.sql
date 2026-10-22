-- PROPOSED — NOT APPLIED. Stage 2 pre-launch review draft.
-- Promote by copying into supabase/migrations/ only after approval.
--
-- Atomic Start Move property creation.
--
-- Start Move inserts each property directly from the browser and then grants
-- the caller's operational homeowner identity with a second call
-- (establish_operational_homeowner_for_created_property). If the second call
-- fails, the property row survives without an owner. An addressed row with no
-- seller side is 'awaiting_seller' (_property_reservation_state), so it keeps
-- its address reserved and the homeowner is locked out of their own address.
--
-- start_move_create_property inserts the row and grants the identity in one
-- transaction. Either both commit or neither does.
--
-- The function is SECURITY DEFINER, so the checks that protect the direct
-- insert do not run for it:
--   * properties_insert_creator (RLS) does not apply to the definer.
--   * _trg_properties_guard_direct_writes returns early unless
--     current_user = 'authenticated'.
-- Every check is therefore re-implemented here. trg_properties_address_reservation
-- still fires for every role and is relied on as a backstop only.
--
-- No existing rows are changed. No existing function is replaced.

-- ---------------------------------------------------------------------------
-- 0) Preflight
-- ---------------------------------------------------------------------------

do $$
begin
  if to_regclass('public.properties') is null
     or to_regclass('public.chains') is null
     or to_regclass('public.property_operational_identities') is null
  then
    raise exception 'start_move_create_property aborted: required tables are missing';
  end if;

  if to_regprocedure('public._require_verified_email_for_transaction()') is null
     or to_regprocedure('public._is_estate_agent_account(uuid)') is null
     or to_regprocedure('public.caller_may_place_property_in_chain(bigint)') is null
     or to_regprocedure('public.caller_owns_unshared_chain(bigint)') is null
     or to_regprocedure('public.property_exists_for_onboarding(text, text, bigint)') is null
     or to_regprocedure('public._address_reservation_conflict(text, text, bigint)') is null
     or to_regprocedure('public._establish_operational_homeowner_core(bigint, uuid, text, boolean)') is null
  then
    raise exception 'start_move_create_property aborted: required helpers are missing';
  end if;

  if not exists (
    select 1
    from pg_trigger t
    where t.tgrelid = 'public.properties'::regclass
      and t.tgname = 'trg_properties_address_reservation'
      and not t.tgisinternal
  ) then
    raise exception 'start_move_create_property aborted: address reservation trigger is missing';
  end if;

  if to_regprocedure('public.start_move_create_property(bigint, text, text, text, boolean)') is not null then
    raise exception 'start_move_create_property aborted: function already exists';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1) start_move_create_property
-- ---------------------------------------------------------------------------

create function public.start_move_create_property(
  p_chain_id bigint,
  p_relationship_type text,
  p_address text,
  p_postcode text,
  p_awaiting_buyer boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_email_gate jsonb;
  v_chain public.chains%rowtype;
  v_address text;
  v_postcode text;
  v_property_id bigint;
  v_grant jsonb;
  v_error text;
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
    return jsonb_build_object('ok', false, 'error', 'estate_agent_cannot_be_homeowner');
  end if;

  if p_relationship_type is null
     or p_relationship_type not in ('sale', 'purchase')
  then
    return jsonb_build_object('ok', false, 'error', 'invalid_relationship_type');
  end if;

  v_address := nullif(trim(p_address), '');
  v_postcode := nullif(trim(p_postcode), '');

  -- properties_stage_address_invariant: non-searching rows need both.
  if v_address is null or v_postcode is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_address');
  end if;

  -- Serialises with cleanup_abandoned_onboarding_chain and with a second
  -- Start Move call for the same chain.
  select *
  into v_chain
  from public.chains c
  where c.id = p_chain_id
  for update;

  -- Start Move only places properties in a chain the caller created
  -- (replaces properties_insert_creator + the direct-write guard).
  if v_chain.id is null
     or v_chain.created_by_user_id is distinct from v_uid
     or not public.caller_may_place_property_in_chain(p_chain_id)
     or not public.caller_owns_unshared_chain(p_chain_id)
  then
    return jsonb_build_object('ok', false, 'error', 'not_authorized');
  end if;

  -- One sale and one purchase per Start Move chain.
  if exists (
    select 1
    from public.properties p
    where p.chain_id = p_chain_id
      and p.relationship_type = p_relationship_type
  ) then
    return jsonb_build_object('ok', false, 'error', 'property_already_in_chain');
  end if;

  -- Same answer as validate_onboarding_property_address: the client routes the
  -- homeowner to the existing chain instead.
  if public.property_exists_for_onboarding(v_address, v_postcode, null) then
    return jsonb_build_object('ok', false, 'error', 'address_unavailable');
  end if;

  begin
    insert into public.properties (
      chain_id,
      chain_position,
      address,
      postcode,
      stage,
      status,
      relationship_type,
      created_by_user_id,
      awaiting_buyer,
      buyer_connected,
      seller_connected,
      is_searching,
      is_current_user,
      last_updated_days
    )
    values (
      p_chain_id,
      case when p_relationship_type = 'sale' then 1 else 2 end,
      v_address,
      v_postcode,
      case when p_relationship_type = 'sale' then 'property_listed' else 'offer_accepted' end,
      'pending_connection',
      p_relationship_type,
      v_uid,
      case when p_relationship_type = 'sale' then coalesce(p_awaiting_buyer, false) else false end,
      p_relationship_type = 'purchase',
      p_relationship_type = 'sale',
      false,
      true,
      0
    )
    returning id into v_property_id;

    v_grant := public._establish_operational_homeowner_core(
      v_property_id,
      v_uid,
      'start_move',
      false
    );

    if coalesce((v_grant ->> 'ok')::boolean, false) is not true then
      raise exception using
        errcode = 'P0001',
        message = 'start_move_create_property_grant_failed',
        detail = coalesce(v_grant ->> 'error', 'grant_failed');
    end if;
  exception
    when unique_violation then
      get stacked diagnostics v_error = message_text;

      if v_error = 'property_address_reserved' then
        return jsonb_build_object('ok', false, 'error', 'address_reserved');
      end if;

      raise;
    when raise_exception then
      get stacked diagnostics v_error = message_text;

      if v_error = 'start_move_create_property_grant_failed' then
        get stacked diagnostics v_error = pg_exception_detail;
        return jsonb_build_object('ok', false, 'error', v_error);
      end if;

      raise;
  end;

  return jsonb_build_object(
    'ok', true,
    'property_id', v_property_id,
    'chain_id', p_chain_id
  );
end;
$$;

alter function public.start_move_create_property(bigint, text, text, text, boolean) owner to postgres;

comment on function public.start_move_create_property(bigint, text, text, text, boolean) is
  'Start Move: inserts the caller''s sale or purchase into their own unshared onboarding chain and grants the operational homeowner identity in one transaction; a failed grant rolls the insert back. Re-implements the direct-insert checks (creator, chain placement, unshared chain), one row per relationship type, the onboarding duplicate check and the address reservation. Verified email required; estate-agent accounts refused.';

revoke all on function public.start_move_create_property(bigint, text, text, text, boolean) from public, anon;
grant execute on function public.start_move_create_property(bigint, text, text, text, boolean) to authenticated, service_role;
