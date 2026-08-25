-- Fix: get_ea_branch_team_directory must not mutate data.
--
-- The directory RPC is STABLE and Supabase may execute it in a read-only
-- transaction. _revoke_expired_ea_branch_invitations() performs UPDATE and
-- must not be called from read paths. Expired invitation status is derived at
-- read time; revocation remains in create_ea_branch_invitation only.

create or replace function public.get_ea_branch_team_directory(
  p_branch_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_members jsonb;
  v_pending jsonb;
begin
  if not public.can_access_ea_branch_team(p_branch_id) then
    return jsonb_build_object('ok', false, 'error', 'not_branch_member');
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'member_id', bm.id,
        'user_id', bm.user_id,
        'contact_name', coalesce(
          nullif(trim(p.contact_name), ''),
          split_part(public.get_user_email_by_id(bm.user_id), '@', 1)
        ),
        'email', public.get_user_email_by_id(bm.user_id),
        'role', bm.role,
        'status', 'active',
        'joined_at', bm.joined_at
      )
      order by bm.joined_at asc
    ),
    '[]'::jsonb
  )
  into v_members
  from public.ea_branch_members bm
  left join public.profiles p
    on p.id = bm.user_id
  where bm.branch_id = p_branch_id;

  if public.is_ea_branch_team_manager(p_branch_id) then
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'invitation_id', inv.id,
          'invite_name', inv.invite_name,
          'invite_email', inv.invite_email,
          'invite_role', inv.invite_role,
          'status',
            case
              when inv.invitation_expires_at <= now() then 'expired'
              else 'pending'
            end,
          'expires_at', inv.invitation_expires_at,
          'sent_at', inv.invitation_sent_at,
          'created_at', inv.invitation_created_at
        )
        order by inv.invitation_created_at desc
      ),
      '[]'::jsonb
    )
    into v_pending
    from public.ea_branch_invitations inv
    where inv.branch_id = p_branch_id
      and inv.invitation_accepted_at is null
      and inv.invitation_revoked_at is null;
  else
    v_pending := '[]'::jsonb;
  end if;

  return jsonb_build_object(
    'ok', true,
    'members', v_members,
    'pending_invitations', v_pending,
    'can_manage_team', public.is_ea_branch_team_manager(p_branch_id)
  );
end;
$$;

revoke all on function public.get_ea_branch_team_directory(uuid) from public;
grant execute on function public.get_ea_branch_team_directory(uuid) to authenticated;

comment on function public.get_ea_branch_team_directory(uuid) is
  'Read-only branch team directory. Expired invitation status is computed; no writes.';
