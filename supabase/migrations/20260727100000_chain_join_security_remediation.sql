-- Chain join security remediation (CJ-001 through CJ-010)
-- Development target; Production apply is a separate approved task.

-- ---------------------------------------------------------------------------
-- Access code lookup-side normalisation (legacy + KN-XXX-XXXX compatible)
-- ---------------------------------------------------------------------------

create or replace function public._access_code_lookup_candidates(p_raw text)
returns text[]
language plpgsql
immutable
set search_path = public
as $$
declare
  v_trimmed text;
  v_upper text;
  v_alnum text;
  v_candidates text[] := array[]::text[];
begin
  v_trimmed := nullif(trim(p_raw), '');
  if v_trimmed is null then
    return v_candidates;
  end if;

  v_upper := upper(v_trimmed);
  v_alnum := regexp_replace(v_upper, '[^A-Z0-9]', '', 'g');

  v_candidates := array[v_trimmed, v_upper];

  -- Canonical KN-XXX-XXXX (7 symbols after KN)
  if v_alnum ~ '^KN[A-Z0-9]{7}$' then
    v_candidates := v_candidates || format(
      'KN-%s-%s',
      substr(v_alnum, 3, 3),
      substr(v_alnum, 6, 4)
    );
  end if;

  -- Legacy homeowner KN-XXX-XXX (6 symbols after KN)
  if v_alnum ~ '^KN[A-Z0-9]{6}$' then
    v_candidates := v_candidates || format(
      'KN-%s-%s',
      substr(v_alnum, 3, 3),
      substr(v_alnum, 6, 3)
    );
  end if;

  -- Legacy EA 7-character code (no KN prefix)
  if length(v_alnum) = 7 and v_alnum !~ '^KN' then
    v_candidates := v_candidates || v_alnum;
  end if;

  return coalesce(
    (
      select array_agg(distinct candidate order by candidate)
      from unnest(v_candidates) as candidate
      where candidate is not null
        and candidate <> ''
    ),
    array[]::text[]
  );
end;
$$;

comment on function public._access_code_lookup_candidates(text) is
  'Lookup-side access code normalisation candidates (does not rewrite stored codes).';

revoke all on function public._access_code_lookup_candidates(text) from public;

-- ---------------------------------------------------------------------------
-- Internal counterparty grant (no client EXECUTE)
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

comment on function public._grant_counterparty_participation_core(bigint, uuid) is
  'Internal join-chain counterparty grant; callable only from approved workflow RPCs.';

revoke all on function public._grant_counterparty_participation_core(bigint, uuid) from public;

-- ---------------------------------------------------------------------------
-- RPC: join_chain_property — atomic validation-first join with generic failures
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
  v_property public.properties%rowtype;
  v_counterparty_role text;
  v_grant jsonb;
  v_email_gate jsonb;
  v_candidates text[];
begin
  v_email_gate := public._require_verified_email_for_transaction();

  if v_email_gate is not null then
    return v_email_gate;
  end if;

  v_user_id := auth.uid();

  if v_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  v_candidates := public._access_code_lookup_candidates(p_access_code);

  if coalesce(array_length(v_candidates, 1), 0) = 0 then
    return jsonb_build_object('ok', false, 'error', 'join_details_not_matched');
  end if;

  select p.*
  into v_property
  from public.properties p
  inner join public.chains c
    on c.id = p.chain_id
  where c.access_code = any (v_candidates)
    and p.address = p_address
    and p.postcode = p_postcode
  limit 1;

  if v_property.id is null then
    return jsonb_build_object('ok', false, 'error', 'join_details_not_matched');
  end if;

  v_grant := public._grant_counterparty_participation_core(
    v_property.id,
    v_user_id
  );

  if not coalesce((v_grant ->> 'ok')::boolean, false) then
    return jsonb_build_object('ok', false, 'error', 'join_details_not_matched');
  end if;

  v_counterparty_role := v_grant ->> 'counterparty_role';

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
    'joining_role', v_counterparty_role
  );
end;
$$;

comment on function public.join_chain_property(text, text, text) is
  'Join a chain property via access code + address + postcode. Generic failure surface at boundary.';

revoke all on function public.join_chain_property(text, text, text) from public;
grant execute on function public.join_chain_property(text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- RPC: grant_counterparty_participation — revoke client EXECUTE (CJ-004)
-- ---------------------------------------------------------------------------

create or replace function public.grant_counterparty_participation(
  p_property_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return jsonb_build_object('ok', false, 'error', 'not_authorized');
end;
$$;

comment on function public.grant_counterparty_participation(bigint) is
  'Deprecated client surface; join must use join_chain_property. Internal grants use _grant_counterparty_participation_core.';

revoke all on function public.grant_counterparty_participation(bigint) from public;
revoke all on function public.grant_counterparty_participation(bigint) from anon;
revoke all on function public.grant_counterparty_participation(bigint) from authenticated;

-- ---------------------------------------------------------------------------
-- RPC: establish_operational_homeowner_for_created_property (CJ-005)
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

  if not exists (
    select 1
    from public.properties p
    where p.id = p_property_id
      and p.created_by_user_id = auth.uid()
      and p.relationship_type in ('sale', 'purchase')
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
  'Start Move / bootstrap: grants operational homeowner only for properties the caller created.';

revoke all on function public.establish_operational_homeowner_for_created_property(bigint) from public;
grant execute on function public.establish_operational_homeowner_for_created_property(bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- RPC: establish_operational_homeowner — restrict direct client bypass (CJ-005)
-- ---------------------------------------------------------------------------

create or replace function public.establish_operational_homeowner(
  p_property_id bigint,
  p_granted_via text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sync_claim boolean;
  v_email_gate jsonb;
begin
  v_email_gate := public._require_verified_email_for_transaction();

  if v_email_gate is not null then
    return v_email_gate;
  end if;

  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  if p_granted_via = 'start_move' then
    return jsonb_build_object('ok', false, 'error', 'not_authorized');
  end if;

  if p_granted_via not in (
    'claim_operational_property',
    'ea_origination_claim',
    'convert_placeholder'
  ) then
    return jsonb_build_object('ok', false, 'error', 'invalid_granted_via');
  end if;

  v_sync_claim := p_granted_via in (
    'claim_operational_property',
    'ea_origination_claim'
  );

  return public._establish_operational_homeowner_core(
    p_property_id,
    auth.uid(),
    p_granted_via,
    v_sync_claim
  );
end;
$$;

revoke all on function public.establish_operational_homeowner(bigint, text) from public;
revoke all on function public.establish_operational_homeowner(bigint, text) from anon;
revoke all on function public.establish_operational_homeowner(bigint, text) from authenticated;

-- ---------------------------------------------------------------------------
-- RPC: validate_onboarding_property_address (CJ-010 scoped duplicate check)
-- ---------------------------------------------------------------------------

create or replace function public.validate_onboarding_property_address(
  p_address text,
  p_postcode text,
  p_chain_id bigint,
  p_exclude_property_id bigint default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_address text;
  v_postcode text;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  v_address := nullif(trim(p_address), '');
  v_postcode := nullif(trim(p_postcode), '');

  if v_address is null or v_postcode is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_address');
  end if;

  if not exists (
    select 1
    from public.chains c
    where c.id = p_chain_id
      and c.created_by_user_id = auth.uid()
  ) then
    return jsonb_build_object('ok', false, 'error', 'not_authorized');
  end if;

  if public.property_exists_for_onboarding(
    v_address,
    v_postcode,
    p_exclude_property_id
  ) then
    return jsonb_build_object('ok', false, 'error', 'address_unavailable');
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

comment on function public.validate_onboarding_property_address(text, text, bigint, bigint) is
  'Start Move duplicate guard scoped to caller-owned onboarding chain; no global address oracle.';

revoke all on function public.validate_onboarding_property_address(text, text, bigint, bigint) from public;
grant execute on function public.validate_onboarding_property_address(text, text, bigint, bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- RPC: property_exists_for_onboarding — revoke client EXECUTE (CJ-010)
-- ---------------------------------------------------------------------------

revoke all on function public.property_exists_for_onboarding(text, text, bigint) from public;
revoke all on function public.property_exists_for_onboarding(text, text, bigint) from anon;
revoke all on function public.property_exists_for_onboarding(text, text, bigint) from authenticated;

-- ---------------------------------------------------------------------------
-- RPC: resolve_chain_for_join — revoke client EXECUTE (CJ-001)
-- ---------------------------------------------------------------------------

revoke all on function public.resolve_chain_for_join(text) from public;
revoke all on function public.resolve_chain_for_join(text) from anon;
revoke all on function public.resolve_chain_for_join(text) from authenticated;
