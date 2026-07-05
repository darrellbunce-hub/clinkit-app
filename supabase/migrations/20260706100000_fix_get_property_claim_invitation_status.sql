-- Fix get_property_claim_invitation_status: load metadata via explicit SELECT
-- instead of %rowtype, so invitation_deferred is read from the table column
-- directly rather than through a stale composite record type.

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
