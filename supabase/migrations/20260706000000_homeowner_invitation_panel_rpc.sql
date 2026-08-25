-- Homeowner invitation panel: extend status RPC + operational invite email update

-- ---------------------------------------------------------------------------
-- RPC: update_property_claim_invite_email
-- Updates delivery address only; does not touch invitation lifecycle.
-- ---------------------------------------------------------------------------

create or replace function public.update_property_claim_invite_email(
  p_property_id bigint,
  p_invite_email text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_metadata public.property_claim_metadata%rowtype;
  v_email text;
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

  if v_metadata.origin_type <> 'estate_agent' then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  v_email := nullif(trim(p_invite_email), '');

  update public.property_claim_metadata
  set
    invite_email = v_email,
    updated_at = now()
  where property_id = p_property_id;

  return jsonb_build_object(
    'ok', true,
    'invite_email', v_email
  );
end;
$$;

revoke all on function public.update_property_claim_invite_email(bigint, text) from public;
grant execute on function public.update_property_claim_invite_email(bigint, text) to authenticated;

-- ---------------------------------------------------------------------------
-- RPC: get_property_claim_invitation_status (extended for invitation panel)
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
  v_metadata public.property_claim_metadata%rowtype;
  v_active public.property_claim_invitations%rowtype;
  v_latest public.property_claim_invitations%rowtype;
  v_hours_remaining integer;
  v_invite_email text;
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

  v_invite_email := nullif(trim(v_metadata.invite_email), '');

  if v_metadata.claim_status = 'claimed' then
    return jsonb_build_object(
      'ok', true,
      'state', 'claimed',
      'invite_email', v_invite_email,
      'claimed_at', v_metadata.claimed_at,
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
      'sent_at', coalesce(
        v_active.invitation_sent_at,
        v_active.invitation_created_at
      ),
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
      'sent_at', coalesce(
        v_latest.invitation_sent_at,
        v_latest.invitation_created_at
      ),
      'expired_at', v_latest.invitation_expires_at,
      'invitation_version', v_latest.invitation_version,
      'has_invite_email', v_invite_email is not null
    );
  end if;

  if v_metadata.invitation_deferred then
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
