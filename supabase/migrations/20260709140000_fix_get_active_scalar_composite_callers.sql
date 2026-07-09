-- Fix callers of get_active_property_claim_invitation().
--
-- The helper RETURNS a scalar composite, not SETOF. EXISTS (SELECT 1 FROM fn(...))
-- evaluates TRUE when the function returns a NULL composite. Callers must use
-- (fn(...)).id IS NOT NULL or SELECT * INTO ... IF var.id IS NOT NULL.

comment on function public.get_active_property_claim_invitation(bigint) is
  'Active invitation as a scalar composite (NULL when none). Test .id IS NOT NULL; do not use EXISTS (SELECT 1 FROM this_function(...)).';

-- ---------------------------------------------------------------------------
-- Internal: create invitation row
-- ---------------------------------------------------------------------------

create or replace function public._create_property_claim_invitation(
  p_property_id bigint,
  p_created_by_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_raw_token text;
  v_hash text;
  v_version integer;
  v_expires_at timestamptz;
  v_invitation_id uuid;
begin
  update public.property_claim_invitations
  set
    invitation_revoked_at = now(),
    updated_at = now()
  where property_id = p_property_id
    and invitation_revoked_at is null
    and invitation_used_at is null
    and invitation_expires_at <= now();

  -- Scalar composite: .id IS NOT NULL (EXISTS FROM this function is wrong for NULL composite).
  if (public.get_active_property_claim_invitation(p_property_id)).id is not null then
    return jsonb_build_object('ok', false, 'error', 'invitation_already_active');
  end if;

  select coalesce(max(pci.invitation_version), 0) + 1
  into v_version
  from public.property_claim_invitations pci
  where pci.property_id = p_property_id;

  v_raw_token := replace(
    replace(
      encode(extensions.gen_random_bytes(32), 'base64'),
      '+',
      '-'
    ),
    '/',
    '_'
  );

  v_hash := public.hash_invitation_token(v_raw_token);
  v_expires_at := now() + interval '48 hours';

  insert into public.property_claim_invitations (
    property_id,
    invitation_token_hash,
    invitation_expires_at,
    invitation_version,
    created_by_user_id
  )
  values (
    p_property_id,
    v_hash,
    v_expires_at,
    v_version,
    p_created_by_user_id
  )
  returning id into v_invitation_id;

  update public.property_claim_metadata
  set
    claim_status = 'claim_invited',
    invitation_deferred = false,
    updated_at = now()
  where property_id = p_property_id
    and claim_status = 'unclaimed';

  update public.property_claim_metadata
  set
    invitation_deferred = false,
    updated_at = now()
  where property_id = p_property_id
    and invitation_deferred = true;

  return jsonb_build_object(
    'ok', true,
    'invitation_id', v_invitation_id,
    'token', v_raw_token,
    'expires_at', v_expires_at,
    'invitation_version', v_version
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: generate_property_claim_invitation (restore production implementation)
-- ---------------------------------------------------------------------------

create or replace function public.generate_property_claim_invitation(
  p_property_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_metadata public.property_claim_metadata%rowtype;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  if not public.is_ea_assigned_to_property(p_property_id) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  select *
  into v_metadata
  from public.property_claim_metadata pcm
  where pcm.property_id = p_property_id;

  if v_metadata.property_id is null then
    return jsonb_build_object('ok', false, 'error', 'property_not_found');
  end if;

  if v_metadata.claim_status = 'claimed' then
    return jsonb_build_object('ok', false, 'error', 'already_claimed');
  end if;

  if nullif(trim(v_metadata.invite_email), '') is null then
    return jsonb_build_object('ok', false, 'error', 'invite_email_required');
  end if;

  return public._create_property_claim_invitation(
    p_property_id,
    v_user_id
  );
end;
$$;

comment on function public.generate_property_claim_invitation(bigint) is
  'Issue a new homeowner claim invitation for an EA-assigned property.';

-- ---------------------------------------------------------------------------
-- RPC: resend_property_claim_invitation
-- ---------------------------------------------------------------------------

create or replace function public.resend_property_claim_invitation(
  p_property_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_metadata public.property_claim_metadata%rowtype;
  v_latest public.property_claim_invitations%rowtype;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  if not public.is_ea_assigned_to_property(p_property_id) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  select *
  into v_metadata
  from public.property_claim_metadata pcm
  where pcm.property_id = p_property_id;

  if v_metadata.property_id is null then
    return jsonb_build_object('ok', false, 'error', 'property_not_found');
  end if;

  if v_metadata.claim_status = 'claimed' then
    return jsonb_build_object('ok', false, 'error', 'already_claimed');
  end if;

  if nullif(trim(v_metadata.invite_email), '') is null then
    return jsonb_build_object('ok', false, 'error', 'invite_email_required');
  end if;

  -- Scalar composite: .id IS NOT NULL (EXISTS FROM this function is wrong for NULL composite).
  if (public.get_active_property_claim_invitation(p_property_id)).id is not null then
    return jsonb_build_object('ok', false, 'error', 'invitation_already_active');
  end if;

  select *
  into v_latest
  from public.get_latest_property_claim_invitation(p_property_id) latest_invitation;

  if v_latest.id is null then
    return jsonb_build_object('ok', false, 'error', 'no_invitation_to_resend');
  end if;

  if v_latest.invitation_used_at is not null then
    return jsonb_build_object('ok', false, 'error', 'invitation_already_used');
  end if;

  if v_latest.invitation_expires_at > now()
    and v_latest.invitation_revoked_at is null then
    return jsonb_build_object('ok', false, 'error', 'invitation_still_active');
  end if;

  perform public._revoke_open_property_claim_invitations(p_property_id);

  return public._create_property_claim_invitation(
    p_property_id,
    v_user_id
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: revoke_property_claim_invitation
-- ---------------------------------------------------------------------------

create or replace function public.revoke_property_claim_invitation(
  p_property_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  if not public.is_ea_assigned_to_property(p_property_id) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  -- Scalar composite: .id IS NOT NULL (EXISTS FROM this function is wrong for NULL composite).
  if (public.get_active_property_claim_invitation(p_property_id)).id is null then
    return jsonb_build_object('ok', false, 'error', 'no_active_invitation');
  end if;

  v_count := public._revoke_open_property_claim_invitations(p_property_id);

  return jsonb_build_object('ok', true, 'revoked_count', v_count);
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: defer_property_claim_invitation
-- ---------------------------------------------------------------------------

create or replace function public.defer_property_claim_invitation(
  p_property_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_metadata public.property_claim_metadata%rowtype;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  if not public.is_ea_assigned_to_property(p_property_id) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  select *
  into v_metadata
  from public.property_claim_metadata pcm
  where pcm.property_id = p_property_id;

  if v_metadata.property_id is null then
    return jsonb_build_object('ok', false, 'error', 'property_not_found');
  end if;

  if v_metadata.claim_status = 'claimed' then
    return jsonb_build_object('ok', false, 'error', 'already_claimed');
  end if;

  -- Scalar composite: .id IS NOT NULL (EXISTS FROM this function is wrong for NULL composite).
  if (public.get_active_property_claim_invitation(p_property_id)).id is not null then
    return jsonb_build_object('ok', false, 'error', 'invitation_already_active');
  end if;

  update public.property_claim_metadata
  set
    invitation_deferred = true,
    updated_at = now()
  where property_id = p_property_id;

  return jsonb_build_object('ok', true);
end;
$$;
