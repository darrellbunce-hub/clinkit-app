-- Fix duplicate detection in create_ea_branch_invitation().
--
-- get_active_ea_branch_invitation() RETURNS a scalar composite, not SETOF.
-- EXISTS (SELECT 1 FROM get_active_ea_branch_invitation(...)) is TRUE even when
-- the function returns NULL (no active invitation). Use a direct table EXISTS
-- or test (fn(...)).id IS NOT NULL instead.

comment on function public.get_active_ea_branch_invitation(uuid, text) is
  'Active branch invitation as a scalar composite (NULL when none). Test .id IS NOT NULL; do not use EXISTS (SELECT 1 FROM this_function(...)).';

create or replace function public.create_ea_branch_invitation(
  p_branch_id uuid,
  p_invite_email text,
  p_invite_name text,
  p_invite_role text default 'agent'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite_email text;
  v_invite_name text;
  v_invite_role text;
  v_inviter_email text;
  v_raw_token text;
  v_hash text;
  v_expires_at timestamptz;
  v_invitation_id uuid;
begin
  if not public.is_ea_branch_team_manager(p_branch_id) then
    return jsonb_build_object('ok', false, 'error', 'not_branch_admin');
  end if;

  v_invite_email := lower(trim(p_invite_email));
  v_invite_name := trim(p_invite_name);
  v_invite_role := coalesce(nullif(trim(p_invite_role), ''), 'agent');

  if v_invite_email !~ '^[^@]+@[^@]+\.[^@]+$' then
    return jsonb_build_object('ok', false, 'error', 'invalid_email');
  end if;

  if length(v_invite_name) < 2 then
    return jsonb_build_object('ok', false, 'error', 'invalid_name');
  end if;

  if v_invite_role not in ('branch_admin', 'agent') then
    return jsonb_build_object('ok', false, 'error', 'invalid_role');
  end if;

  v_inviter_email := public.get_auth_user_email();

  if v_inviter_email = v_invite_email then
    return jsonb_build_object('ok', false, 'error', 'cannot_invite_self');
  end if;

  if public.user_email_has_ea_branch_membership(v_invite_email) then
    return jsonb_build_object('ok', false, 'error', 'already_branch_member');
  end if;

  perform public._revoke_expired_ea_branch_invitations(
    p_branch_id,
    v_invite_email
  );

  -- Active = exact invite_email on this branch, not revoked/accepted, not expired.
  if exists (
    select 1
    from public.ea_branch_invitations inv
    where inv.branch_id = p_branch_id
      and inv.invite_email = v_invite_email
      and inv.invitation_revoked_at is null
      and inv.invitation_accepted_at is null
      and inv.invitation_expires_at > now()
  ) then
    return jsonb_build_object('ok', false, 'error', 'invitation_already_active');
  end if;

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
  v_expires_at := now() + interval '7 days';

  insert into public.ea_branch_invitations (
    branch_id,
    invite_email,
    invite_name,
    invite_role,
    invitation_token_hash,
    invitation_expires_at,
    created_by_user_id
  )
  values (
    p_branch_id,
    v_invite_email,
    v_invite_name,
    v_invite_role,
    v_hash,
    v_expires_at,
    auth.uid()
  )
  returning id into v_invitation_id;

  return jsonb_build_object(
    'ok', true,
    'invitation_id', v_invitation_id,
    'token', v_raw_token,
    'expires_at', v_expires_at
  );
end;
$$;

revoke all on function public.create_ea_branch_invitation(uuid, text, text, text) from public;
grant execute on function public.create_ea_branch_invitation(uuid, text, text, text) to authenticated;
