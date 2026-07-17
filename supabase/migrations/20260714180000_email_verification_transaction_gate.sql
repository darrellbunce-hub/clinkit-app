-- Email verification gate for live property transaction participation.
--
-- Rule: account access is allowed before verification; participation in live
-- property transactions requires a confirmed email (auth.users.email_confirmed_at).

-- ---------------------------------------------------------------------------
-- Helper: verified-email check for transaction RPCs
-- ---------------------------------------------------------------------------

create or replace function public._require_verified_email_for_transaction()
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select case
    when auth.uid() is null then
      jsonb_build_object('ok', false, 'error', 'not_authenticated')
    when not exists (
      select 1
      from auth.users u
      where u.id = auth.uid()
        and u.email_confirmed_at is not null
    ) then
      jsonb_build_object('ok', false, 'error', 'email_verification_required')
    else null::jsonb
  end;
$$;

comment on function public._require_verified_email_for_transaction() is
  'Returns a jsonb error payload when the caller must verify email before transaction participation; null when allowed.';

revoke all on function public._require_verified_email_for_transaction() from public;
grant execute on function public._require_verified_email_for_transaction() to authenticated;

-- ---------------------------------------------------------------------------
-- RPC: establish_operational_homeowner
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

  if p_granted_via not in (
    'start_move',
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

-- ---------------------------------------------------------------------------
-- RPC: grant_counterparty_participation
-- ---------------------------------------------------------------------------

create or replace function public.grant_counterparty_participation(
  p_property_id bigint
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
  v_is_homeowner boolean;
  v_email_gate jsonb;
begin
  v_email_gate := public._require_verified_email_for_transaction();

  if v_email_gate is not null then
    return v_email_gate;
  end if;

  v_user_id := auth.uid();

  if v_user_id is null then
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
      and poi.homeowner_user_id = v_user_id
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
    v_user_id,
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
    v_user_id,
    v_counterparty_role
  );

  return jsonb_build_object(
    'ok', true,
    'property_id', p_property_id,
    'counterparty_role', v_counterparty_role
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: create_chain_for_onboarding
-- ---------------------------------------------------------------------------

create or replace function public.create_chain_for_onboarding(
  p_name text,
  p_access_code text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_chain_id bigint;
  v_name text;
  v_access_code text;
  v_email_gate jsonb;
begin
  v_email_gate := public._require_verified_email_for_transaction();

  if v_email_gate is not null then
    return v_email_gate;
  end if;

  v_user_id := auth.uid();

  if v_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  v_name := nullif(trim(p_name), '');

  if v_name is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_name');
  end if;

  v_access_code := nullif(trim(p_access_code), '');

  if v_access_code is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_access_code');
  end if;

  begin
    insert into public.chains (name, access_code, created_by_user_id)
    values (v_name, v_access_code, v_user_id)
    returning id into v_chain_id;
  exception
    when unique_violation then
      return jsonb_build_object('ok', false, 'error', 'duplicate_access_code');
  end;

  return jsonb_build_object(
    'ok', true,
    'chain_id', v_chain_id,
    'access_code', v_access_code
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: create_ea_operational_chain
-- ---------------------------------------------------------------------------

create or replace function public.create_ea_operational_chain(
  p_name text,
  p_access_code text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_chain_id bigint;
  v_name text;
  v_access_code text;
  v_email_gate jsonb;
begin
  v_email_gate := public._require_verified_email_for_transaction();

  if v_email_gate is not null then
    return v_email_gate;
  end if;

  v_user_id := auth.uid();

  if v_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  if not exists (
    select 1
    from public.ea_branch_members bm
    where bm.user_id = v_user_id
  ) then
    return jsonb_build_object('ok', false, 'error', 'not_ea_branch_member');
  end if;

  v_name := nullif(trim(p_name), '');

  if v_name is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_name');
  end if;

  v_access_code := nullif(trim(p_access_code), '');

  if v_access_code is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_access_code');
  end if;

  begin
    insert into public.chains (name, access_code, created_by_user_id)
    values (v_name, v_access_code, v_user_id)
    returning id into v_chain_id;
  exception
    when unique_violation then
      return jsonb_build_object('ok', false, 'error', 'duplicate_access_code');
  end;

  return jsonb_build_object(
    'ok', true,
    'chain_id', v_chain_id,
    'access_code', v_access_code
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: create_ea_operational_property
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
  v_property_id bigint;
  v_chain_position integer;
  v_claim_status text;
  v_address text;
  v_postcode text;
  v_email_gate jsonb;
begin
  v_email_gate := public._require_verified_email_for_transaction();

  if v_email_gate is not null then
    return v_email_gate;
  end if;

  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  if not public.is_ea_branch_member(p_branch_id) then
    return jsonb_build_object('ok', false, 'error', 'not_ea_branch_member');
  end if;

  if p_relationship_type not in ('sale', 'purchase') then
    return jsonb_build_object('ok', false, 'error', 'invalid_relationship_type');
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
  ) then
    return jsonb_build_object('ok', false, 'error', 'chain_not_found');
  end if;

  if exists (
    select 1
    from public.properties p
    where p.chain_id = p_chain_id
      and p.address = v_address
      and p.postcode = v_postcode
  ) then
    return jsonb_build_object('ok', false, 'error', 'property_already_exists');
  end if;

  select coalesce(max(p.chain_position), 0) + 1
  into v_chain_position
  from public.properties p
  where p.chain_id = p_chain_id;

  v_claim_status := case
    when nullif(trim(p_invite_email), '') is not null then 'claim_invited'
    else 'unclaimed'
  end;

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
    v_chain_position,
    v_address,
    v_postcode,
    case
      when p_relationship_type = 'sale' then 'property_listed'
      else 'offer_accepted'
    end,
    'pending_connection',
    p_relationship_type,
    auth.uid(),
    case
      when p_relationship_type = 'sale' then coalesce(p_awaiting_buyer, false)
      else false
    end,
    false,
    case
      when p_relationship_type = 'sale' then true
      else false
    end,
    false,
    false,
    0
  )
  returning id into v_property_id;

  perform public._ea_assign_originated_property(
    v_property_id,
    p_branch_id,
    coalesce(p_homeowner_only_updates, false),
    p_invite_email,
    p_invite_display_name,
    v_claim_status
  );

  return jsonb_build_object(
    'ok', true,
    'property_id', v_property_id,
    'chain_id', p_chain_id,
    'claim_status', v_claim_status
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: accept_property_delegate
-- ---------------------------------------------------------------------------

create or replace function public.accept_property_delegate(
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

  update public.property_delegates pd
  set
    status = 'active',
    accepted_at = now(),
    updated_at = now()
  where pd.property_id = p_property_id
    and pd.delegate_user_id = auth.uid()
    and pd.status = 'pending';

  if not found then
    return jsonb_build_object('ok', false, 'error', 'no_pending_invite');
  end if;

  return jsonb_build_object('ok', true, 'property_id', p_property_id);
end;
$$;
