-- Invitation lifecycle finalisation:
-- - Rotate active invitations for delivery when the client has no stored token
-- - Record invitation_sent_at after email delivery
-- - Extend status RPC with explicit email_sent fields

-- ---------------------------------------------------------------------------
-- RPC: rotate_active_property_claim_invitation_for_delivery
-- Revokes any open invitation and issues a fresh token for email/link delivery.
-- ---------------------------------------------------------------------------

create or replace function public.rotate_active_property_claim_invitation_for_delivery(
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

  perform public._revoke_open_property_claim_invitations(p_property_id);

  return public._create_property_claim_invitation(
    p_property_id,
    v_user_id
  );
end;
$$;

revoke all on function public.rotate_active_property_claim_invitation_for_delivery(bigint) from public;
grant execute on function public.rotate_active_property_claim_invitation_for_delivery(bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- RPC: record_property_claim_invitation_sent
-- ---------------------------------------------------------------------------

create or replace function public.record_property_claim_invitation_sent(
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

  update public.property_claim_invitations
  set
    invitation_sent_at = coalesce(invitation_sent_at, now()),
    updated_at = now()
  where property_id = p_property_id
    and invitation_revoked_at is null
    and invitation_used_at is null
    and invitation_expires_at > now();

  get diagnostics v_count = row_count;

  if v_count = 0 then
    return jsonb_build_object('ok', false, 'error', 'no_active_invitation');
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.record_property_claim_invitation_sent(bigint) from public;
grant execute on function public.record_property_claim_invitation_sent(bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- RPC: get_property_claim_invitation_status (email_sent fields)
-- ---------------------------------------------------------------------------

create or replace function public.get_property_claim_invitation_status(
  p_property_id bigint
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_active public.property_claim_invitations%rowtype;
  v_latest public.property_claim_invitations%rowtype;
  v_hours_remaining integer;
  v_claim_status text;
  v_invite_email text;
  v_claimed_at timestamptz;
  v_invitation_deferred boolean := false;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  if not public.is_ea_assigned_to_property(p_property_id) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  select
    pcm.claim_status,
    nullif(trim(pcm.invite_email), ''),
    pcm.claimed_at,
    coalesce(pcm.invitation_deferred, false)
  into
    v_claim_status,
    v_invite_email,
    v_claimed_at,
    v_invitation_deferred
  from public.property_claim_metadata pcm
  where pcm.property_id = p_property_id;

  if found and v_claim_status = 'claimed' then
    return jsonb_build_object(
      'ok', true,
      'state', 'claimed',
      'invite_email', v_invite_email,
      'claimed_at', v_claimed_at,
      'has_invite_email', v_invite_email is not null
    );
  end if;

  select *
  into v_active
  from public.get_active_property_claim_invitation(p_property_id) active_invitation;

  if v_active.id is not null then
    v_hours_remaining := greatest(
      0,
      ceil(
        extract(
          epoch from (
            v_active.invitation_expires_at - now()
          )
        ) / 3600.0
      )::integer
    );

    return jsonb_build_object(
      'ok', true,
      'state', 'active',
      'invite_email', v_invite_email,
      'created_at', v_active.invitation_created_at,
      'email_sent_at', v_active.invitation_sent_at,
      'email_sent', v_active.invitation_sent_at is not null,
      'expires_at', v_active.invitation_expires_at,
      'hours_remaining', v_hours_remaining,
      'invitation_version', v_active.invitation_version,
      'has_invite_email', v_invite_email is not null
    );
  end if;

  select *
  into v_latest
  from public.get_latest_property_claim_invitation(p_property_id) latest_invitation;

  if v_latest.id is not null
    and v_latest.invitation_revoked_at is null
    and v_latest.invitation_used_at is null
    and v_latest.invitation_expires_at <= now() then
    return jsonb_build_object(
      'ok', true,
      'state', 'expired',
      'invite_email', v_invite_email,
      'created_at', v_latest.invitation_created_at,
      'email_sent_at', v_latest.invitation_sent_at,
      'email_sent', v_latest.invitation_sent_at is not null,
      'expired_at', v_latest.invitation_expires_at,
      'invitation_version', v_latest.invitation_version,
      'has_invite_email', v_invite_email is not null
    );
  end if;

  if found and v_invitation_deferred then
    return jsonb_build_object(
      'ok', true,
      'state', 'deferred',
      'invite_email', v_invite_email,
      'has_invite_email', v_invite_email is not null
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'state', 'none',
    'invite_email', v_invite_email,
    'has_invite_email', v_invite_email is not null
  );
end;
$$;

revoke all on function public.get_property_claim_invitation_status(bigint) from public;
grant execute on function public.get_property_claim_invitation_status(bigint) to authenticated;
