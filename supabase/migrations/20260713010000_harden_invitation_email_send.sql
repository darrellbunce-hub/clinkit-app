-- Server-side validation for invitation email sending.
-- Ensures only the latest active invitation token can be emailed.

create or replace function public.validate_property_claim_invitation_for_email_send(
  p_property_id bigint,
  p_token text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_active public.property_claim_invitations%rowtype;
  v_hash text;
  v_metadata public.property_claim_metadata%rowtype;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  if not public.is_ea_assigned_to_property(p_property_id) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  if nullif(trim(p_token), '') is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_token');
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

  v_active := public.get_active_property_claim_invitation(p_property_id);

  if v_active.id is null then
    return jsonb_build_object('ok', false, 'error', 'invitation_not_active');
  end if;

  if v_active.invitation_expires_at <= now() then
    return jsonb_build_object('ok', false, 'error', 'expired');
  end if;

  if v_active.invitation_rejected_at is not null then
    return jsonb_build_object('ok', false, 'error', 'invitation_declined');
  end if;

  v_hash := public.hash_invitation_token(p_token);

  if v_active.invitation_token_hash <> v_hash then
    return jsonb_build_object('ok', false, 'error', 'invalid_token');
  end if;

  return jsonb_build_object(
    'ok', true,
    'expires_at', v_active.invitation_expires_at,
    'invitation_version', v_active.invitation_version,
    'invitation_id', v_active.id
  );
end;
$$;

comment on function public.validate_property_claim_invitation_for_email_send(bigint, text) is
  'Validates the active homeowner invitation token before email delivery.';

create or replace function public.validate_ea_branch_invitation_for_email_send(
  p_invitation_id uuid,
  p_token text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_invitation public.ea_branch_invitations%rowtype;
  v_hash text;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  if nullif(trim(p_token), '') is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_token');
  end if;

  select inv.*
  into v_invitation
  from public.ea_branch_invitations inv
  where inv.id = p_invitation_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'invitation_not_found');
  end if;

  if not public.is_ea_branch_admin(v_invitation.branch_id) then
    return jsonb_build_object('ok', false, 'error', 'not_branch_admin');
  end if;

  if v_invitation.invitation_revoked_at is not null then
    return jsonb_build_object('ok', false, 'error', 'invitation_revoked');
  end if;

  if v_invitation.invitation_accepted_at is not null then
    return jsonb_build_object('ok', false, 'error', 'invitation_already_accepted');
  end if;

  if v_invitation.invitation_expires_at <= now() then
    return jsonb_build_object('ok', false, 'error', 'invitation_expired');
  end if;

  v_hash := public.hash_invitation_token(p_token);

  if v_invitation.invitation_token_hash <> v_hash then
    return jsonb_build_object('ok', false, 'error', 'invalid_token');
  end if;

  return jsonb_build_object(
    'ok', true,
    'invite_email', v_invitation.invite_email,
    'expires_at', v_invitation.invitation_expires_at
  );
end;
$$;

comment on function public.validate_ea_branch_invitation_for_email_send(uuid, text) is
  'Validates an estate agent branch invitation token before email delivery.';

revoke all on function public.validate_property_claim_invitation_for_email_send(bigint, text) from public;
revoke all on function public.validate_ea_branch_invitation_for_email_send(uuid, text) from public;

grant execute on function public.validate_property_claim_invitation_for_email_send(bigint, text) to authenticated;
grant execute on function public.validate_ea_branch_invitation_for_email_send(uuid, text) to authenticated;
