-- M1: address reservation classifier (additive).
--
-- Adds a database-side classifier for "is this address already in MoveLoop, and
-- who represents it", used by Start Move routing and by every duplicate check.
--
--   _address_match_key(text) / _postcode_match_key(text)
--     Normalised comparison keys. GDPR erasure and lifecycle anonymisation write
--     the redaction placeholders '[Released property]' / 'REDACTED'; those
--     produce no key, so redacted rows never reserve an address.
--
--   _property_side_representation(bigint) -> (seller_side, buyer_side)
--     seller_side: 'homeowner' | 'ea' | 'none'
--     buyer_side:  'homeowner' | 'via_sale' | 'none'
--     Derived only from identity, counterparty and EA-assignment records; never
--     from created_by_user_id or status.
--
--   _property_reservation_state(bigint) -> text
--     historical | lifecycle_held | awaiting_seller | awaiting_buyer |
--     live_homeowner | live_ea_managed | stale
--
--   property_address_is_reserved(bigint)
--     Now "state is neither historical nor stale". Client EXECUTE revoked.
--
--   property_exists_for_onboarding(text, text, bigint)
--     Matches on the normalised keys.
--
--   check_start_move_address(text, text, text)
--     Start Move routing: available | yours | awaiting_connection |
--     already_represented. Returns a chain id only for 'yours'.
--
--   cleanup_abandoned_onboarding_chain(bigint, boolean default false)
--     Replaces the one-argument version. Chain creator only; refuses chains
--     anyone else can see; p_require_empty refuses any non-empty chain.
--
--   _execute_participation_delink(bigint, text, text, uuid)
--     homeowner_self now persists the 'released' lifecycle state (it was
--     silently refused), so self-released properties classify as historical.
--     Earlier self-releases that were never recorded are backfilled.

-- ---------------------------------------------------------------------------
-- 1) Match keys
-- ---------------------------------------------------------------------------

create or replace function public._address_match_key(p_address text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when p_address is null then null
    when btrim(p_address) = '[Released property]' then null
    else nullif(lower(regexp_replace(btrim(p_address), '\s+', ' ', 'g')), '')
  end;
$$;

comment on function public._address_match_key(text) is
  'Normalised address comparison key: trimmed, lower case, internal whitespace collapsed. The redaction placeholder has no key.';

revoke all on function public._address_match_key(text) from public, anon, authenticated;
grant execute on function public._address_match_key(text) to service_role;

create or replace function public._postcode_match_key(p_postcode text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when p_postcode is null then null
    when upper(btrim(p_postcode)) = 'REDACTED' then null
    else nullif(upper(regexp_replace(p_postcode, '\s+', '', 'g')), '')
  end;
$$;

comment on function public._postcode_match_key(text) is
  'Normalised postcode comparison key: upper case, all whitespace removed. The redaction placeholder has no key.';

revoke all on function public._postcode_match_key(text) from public, anon, authenticated;
grant execute on function public._postcode_match_key(text) to service_role;

-- ---------------------------------------------------------------------------
-- 2) Side representation
-- ---------------------------------------------------------------------------

create or replace function public._property_side_representation(
  p_property_id bigint,
  out seller_side text,
  out buyer_side text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_property public.properties%rowtype;
  v_has_identity boolean;
  v_has_assignment boolean;
begin
  seller_side := 'none';
  buyer_side := 'none';

  select *
  into v_property
  from public.properties
  where id = p_property_id;

  if v_property.id is null then
    return;
  end if;

  v_has_identity := exists (
    select 1
    from public.property_operational_identities poi
    where poi.property_id = v_property.id
      and poi.status = 'active'
  );

  v_has_assignment := exists (
    select 1
    from public.property_ea_assignments pea
    where pea.property_id = v_property.id
      and pea.status = 'active'
  );

  if v_property.relationship_type = 'sale' then
    seller_side := case
      when v_has_identity then 'homeowner'
      when v_has_assignment then 'ea'
      else 'none'
    end;

    buyer_side := case
      when exists (
        select 1
        from public.property_counterparty_participants cp
        where cp.property_id = v_property.id
          and cp.counterparty_role = 'buyer'
          and cp.status = 'active'
      ) then 'homeowner'
      else 'none'
    end;
  elsif v_property.relationship_type = 'purchase' then
    seller_side := case
      when exists (
        select 1
        from public.property_counterparty_participants cp
        where cp.property_id = v_property.id
          and cp.counterparty_role = 'seller'
          and cp.status = 'active'
      ) then 'homeowner'
      when v_has_assignment then 'ea'
      else 'none'
    end;

    buyer_side := case
      when v_has_identity then 'homeowner'
      when exists (
        select 1
        from public.properties s
        left join public.property_lifecycle_states sls
          on sls.property_id = s.id
        where s.chain_id = v_property.chain_id
          and s.linked_property_id = v_property.id
          and s.relationship_type = 'sale'
          and coalesce(sls.operational_state, 'active')
            not in ('released', 'anonymised', 'archived')
          and (
            exists (
              select 1
              from public.property_operational_identities spoi
              where spoi.property_id = s.id
                and spoi.status = 'active'
            )
            or exists (
              select 1
              from public.property_ea_assignments spea
              where spea.property_id = s.id
                and spea.status = 'active'
            )
          )
      ) then 'via_sale'
      else 'none'
    end;
  end if;
end;
$$;

comment on function public._property_side_representation(bigint) is
  'Which sides of a property row are represented. Sale: seller = identity holder, else assigned EA; buyer = active counterparty buyer. Purchase: seller = active counterparty seller, else EA assigned to this row; buyer = identity holder, else a live represented sale linking to it (via_sale). Internal; service_role only.';

revoke all on function public._property_side_representation(bigint) from public, anon, authenticated;
grant execute on function public._property_side_representation(bigint) to service_role;

-- ---------------------------------------------------------------------------
-- 3) Reservation state
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

  if v_property.relationship_type = 'purchase'
    and v_sides.seller_side = 'none'
    and v_sides.buyer_side <> 'none'
  then
    return 'awaiting_seller';
  end if;

  if v_property.relationship_type = 'sale'
    and v_sides.seller_side <> 'none'
    and v_sides.buyer_side = 'none'
  then
    return 'awaiting_buyer';
  end if;

  if v_sides.seller_side = 'homeowner' then
    return 'live_homeowner';
  end if;

  if v_sides.seller_side = 'ea' then
    return 'live_ea_managed';
  end if;

  if v_sides.buyer_side <> 'none' then
    return 'live_homeowner';
  end if;

  return 'stale';
end;
$$;

comment on function public._property_reservation_state(bigint) is
  'Address reservation state of one property row. Lifecycle first (released/anonymised = historical, archived = lifecycle_held); rows without an address key (searching placeholders, redacted rows) are historical; then side representation; stale = neither side represented. Internal; service_role only.';

revoke all on function public._property_reservation_state(bigint) from public, anon, authenticated;
grant execute on function public._property_reservation_state(bigint) to service_role;

-- ---------------------------------------------------------------------------
-- 4) property_address_is_reserved: classifier wrapper, no client EXECUTE
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
  select public._property_reservation_state(p_property_id)
    not in ('historical', 'stale');
$$;

comment on function public.property_address_is_reserved(bigint) is
  'True when a property row still reserves its address: any reservation state other than historical or stale. Released/anonymised, redacted and unrepresented rows do not block reuse.';

revoke all on function public.property_address_is_reserved(bigint) from public, anon, authenticated;
grant execute on function public.property_address_is_reserved(bigint) to service_role;

-- ---------------------------------------------------------------------------
-- 5) property_exists_for_onboarding: normalised keys
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
    where public._address_match_key(p_address) is not null
      and public._postcode_match_key(p_postcode) is not null
      and public._address_match_key(p.address) = public._address_match_key(p_address)
      and public._postcode_match_key(p.postcode) = public._postcode_match_key(p_postcode)
      and (
        p_exclude_property_id is null
        or p.id <> p_exclude_property_id
      )
      and public.property_address_is_reserved(p.id)
  );
$$;

revoke all on function public.property_exists_for_onboarding(text, text, bigint) from public, anon, authenticated;
grant execute on function public.property_exists_for_onboarding(text, text, bigint) to service_role;

-- ---------------------------------------------------------------------------
-- 6) check_start_move_address
-- ---------------------------------------------------------------------------

create or replace function public.check_start_move_address(
  p_address text,
  p_postcode text,
  p_side text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_email_gate jsonb;
  v_user_id uuid;
  v_address_key text;
  v_postcode_key text;
  v_row record;
  v_state text;
  v_sides record;
  v_yours_chain_id bigint;
  v_awaiting boolean := false;
  v_represented boolean := false;
  c_scope constant text := 'check_start_move_address';
  c_limit constant integer := 30;
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

  if p_side is null or p_side not in ('selling', 'buying') then
    return jsonb_build_object('ok', false, 'error', 'invalid_side');
  end if;

  v_address_key := public._address_match_key(p_address);
  v_postcode_key := public._postcode_match_key(p_postcode);

  if v_address_key is null or v_postcode_key is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_address');
  end if;

  if not public._rate_limit_try_consume(c_scope, v_user_id::text, c_limit, c_window) then
    return jsonb_build_object('ok', false, 'error', 'rate_limited');
  end if;

  for v_row in
    select p.id, p.chain_id, p.relationship_type
    from public.properties p
    where public._address_match_key(p.address) = v_address_key
      and public._postcode_match_key(p.postcode) = v_postcode_key
    order by p.id
  loop
    v_state := public._property_reservation_state(v_row.id);

    if v_state in ('historical', 'stale') then
      continue;
    end if;

    if exists (
      select 1 from public.property_operational_identities poi
      where poi.property_id = v_row.id
        and poi.status = 'active'
        and poi.homeowner_user_id = v_user_id
    ) or exists (
      select 1 from public.property_counterparty_participants cp
      where cp.property_id = v_row.id
        and cp.status = 'active'
        and cp.user_id = v_user_id
    ) or exists (
      select 1 from public.property_delegates pd
      where pd.property_id = v_row.id
        and pd.status = 'active'
        and pd.delegate_user_id = v_user_id
    ) or exists (
      select 1
      from public.property_ea_assignments pea
      inner join public.ea_branch_members bm
        on bm.branch_id = pea.branch_id
      where pea.property_id = v_row.id
        and pea.status = 'active'
        and bm.user_id = v_user_id
    ) then
      v_yours_chain_id := coalesce(v_yours_chain_id, v_row.chain_id);
      continue;
    end if;

    if v_state = 'lifecycle_held' then
      v_represented := true;
      continue;
    end if;

    select *
    into v_sides
    from public._property_side_representation(v_row.id);

    if p_side = 'selling'
      and v_row.relationship_type = 'purchase'
      and v_sides.seller_side <> 'homeowner'
      and v_sides.buyer_side <> 'none'
    then
      v_awaiting := true;
    elsif p_side = 'buying'
      and v_row.relationship_type = 'sale'
      and v_sides.buyer_side = 'none'
      and v_sides.seller_side <> 'none'
    then
      v_awaiting := true;
    else
      v_represented := true;
    end if;
  end loop;

  if v_yours_chain_id is not null then
    return jsonb_build_object('ok', true, 'state', 'yours', 'chain_id', v_yours_chain_id);
  end if;

  if v_awaiting then
    return jsonb_build_object('ok', true, 'state', 'awaiting_connection');
  end if;

  if v_represented then
    return jsonb_build_object('ok', true, 'state', 'already_represented');
  end if;

  return jsonb_build_object('ok', true, 'state', 'available');
end;
$$;

comment on function public.check_start_move_address(text, text, text) is
  'Start Move routing for one address. Returns available, yours (with the caller''s chain id), awaiting_connection or already_represented. Yours requires the operational identity, an active counterparty or delegate role, or a seat in the assigned branch; plain membership is not enough. Discloses no members, owners, agents, chain ids or access codes otherwise. Verified email required; rate limited per user.';

revoke all on function public.check_start_move_address(text, text, text) from public, anon;
grant execute on function public.check_start_move_address(text, text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7) cleanup_abandoned_onboarding_chain(bigint, boolean)
-- ---------------------------------------------------------------------------

drop function if exists public.cleanup_abandoned_onboarding_chain(bigint);

create or replace function public.cleanup_abandoned_onboarding_chain(
  p_chain_id bigint,
  p_require_empty boolean default false
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
    from public.chains c
    where c.id = p_chain_id
      and c.created_by_user_id = v_user_id
  ) then
    return jsonb_build_object('ok', false, 'error', 'not_authorized');
  end if;

  if not exists (
    select 1
    from public.properties p
    where p.chain_id = p_chain_id
  ) then
    delete from public.chain_nodes
    where chain_id = p_chain_id;

    delete from public.chains
    where id = p_chain_id
      and created_by_user_id = v_user_id;

    return jsonb_build_object('ok', true, 'empty_chain', true);
  end if;

  if coalesce(p_require_empty, false) then
    return jsonb_build_object('ok', false, 'error', 'chain_not_empty');
  end if;

  if not public.caller_owns_unshared_chain(p_chain_id) then
    return jsonb_build_object('ok', false, 'error', 'other_participants');
  end if;

  if exists (
    select 1
    from public.properties p
    inner join public.property_counterparty_participants cp
      on cp.property_id = p.id
    where p.chain_id = p_chain_id
      and cp.status = 'active'
  ) then
    return jsonb_build_object('ok', false, 'error', 'other_participants');
  end if;

  if exists (
    select 1
    from public.properties p
    inner join public.property_claim_metadata pcm
      on pcm.property_id = p.id
    where p.chain_id = p_chain_id
      and pcm.origin_type = 'estate_agent'
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

comment on function public.cleanup_abandoned_onboarding_chain(bigint, boolean) is
  'Removes an abandoned onboarding chain created by the caller. Non-empty chains must be visible to nobody else (caller_owns_unshared_chain), with no counterparties and no estate-agent origination. p_require_empty = true refuses any non-empty chain (Join Chain after source-chain migration).';

revoke all on function public.cleanup_abandoned_onboarding_chain(bigint, boolean) from public, anon;
grant execute on function public.cleanup_abandoned_onboarding_chain(bigint, boolean) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8) _execute_participation_delink: homeowner_self persists 'released'
-- ---------------------------------------------------------------------------
-- record_property_lifecycle_transition authorises the caller as the operational
-- homeowner. homeowner_self released the identity first, so the transition was
-- refused and the refusal discarded by PERFORM: the property was released
-- without a lifecycle state. The transition is now recorded while the caller is
-- still the operational homeowner and a refusal aborts the whole de-link.
-- Every other branch is unchanged from 20261001130000.

do $$
declare
  v_src text;
begin
  select p.prosrc into v_src
  from pg_proc p
  where p.oid = to_regprocedure('public._execute_participation_delink(bigint, text, text, uuid)');

  if v_src is null
     or v_src not like '%Homeowner left this transaction. The property has been released.%'
     or v_src not like '%perform public.record_property_lifecycle_transition(%'
     or v_src not like '%_release_converged_onward_purchase_with_sale(%'
     or v_src not like '%The invitation can be re-sent.%'
  then
    raise exception
      'address_reservation_classifier aborted: _execute_participation_delink body differs from 20261001130000';
  end if;
end;
$$;

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
  v_transition jsonb;
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
-- 9) Backfill: self-released properties missing their 'released' state
-- ---------------------------------------------------------------------------
-- Idempotent. Only properties whose latest homeowner_self de-link was never
-- recorded and that nobody has represented since; dated to the de-link so the
-- retention clock starts when the homeowner actually left.

with candidates as (
  select distinct on (e.property_id)
    e.property_id,
    e.reason_code,
    e.created_at as released_at,
    pls.operational_state as from_state
  from public.property_delink_events e
  left join public.property_lifecycle_states pls
    on pls.property_id = e.property_id
  where e.metadata ->> 'operation' = 'homeowner_self'
    and coalesce(pls.operational_state, 'active') not in ('released', 'archived', 'anonymised')
    and not exists (
      select 1 from public.property_operational_identities poi
      where poi.property_id = e.property_id and poi.status = 'active'
    )
    and not exists (
      select 1 from public.property_ea_assignments pea
      where pea.property_id = e.property_id and pea.status = 'active'
    )
    and not exists (
      select 1 from public.property_counterparty_participants pcp
      where pcp.property_id = e.property_id and pcp.status = 'active'
    )
  order by e.property_id, e.created_at desc
),
recorded_events as (
  insert into public.property_lifecycle_events (
    property_id,
    from_state,
    to_state,
    trigger,
    scenario,
    reason,
    metadata,
    created_at
  )
  select
    c.property_id,
    coalesce(c.from_state, 'active'),
    'released',
    'homeowner_delink',
    null,
    coalesce(nullif(trim(c.reason_code), ''), 'transition_recorded'),
    jsonb_build_object(
      'operation', 'homeowner_self',
      'reason_code', c.reason_code,
      'backfill', '20261005100000'
    ),
    c.released_at
  from candidates c
  returning property_id
)
insert into public.property_lifecycle_states (
  property_id,
  operational_state,
  lifecycle_reason,
  entered_state_at,
  grace_ends_at,
  archive_eligible_at,
  last_evaluated_at,
  metadata,
  updated_at
)
select
  c.property_id,
  'released',
  coalesce(nullif(trim(c.reason_code), ''), 'transition_recorded'),
  c.released_at,
  null,
  c.released_at,
  now(),
  jsonb_build_object(
    'operation', 'homeowner_self',
    'reason_code', c.reason_code,
    'backfill', '20261005100000'
  ),
  now()
from candidates c
where c.property_id in (select property_id from recorded_events)
on conflict (property_id) do update
set
  operational_state = excluded.operational_state,
  lifecycle_reason = excluded.lifecycle_reason,
  entered_state_at = excluded.entered_state_at,
  grace_ends_at = excluded.grace_ends_at,
  archive_eligible_at = excluded.archive_eligible_at,
  last_evaluated_at = excluded.last_evaluated_at,
  metadata = public.property_lifecycle_states.metadata || excluded.metadata,
  updated_at = now();
