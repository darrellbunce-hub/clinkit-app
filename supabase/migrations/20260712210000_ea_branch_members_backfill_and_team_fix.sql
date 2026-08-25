-- Backfill legacy estate agent founders into ea_branch_members and fix team directory access.

-- ---------------------------------------------------------------------------
-- Helpers for team access without RLS recursion
-- ---------------------------------------------------------------------------

create or replace function public.get_auth_user_ea_branch_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select bm.branch_id
  from public.ea_branch_members bm
  where bm.user_id = auth.uid();
$$;

comment on function public.get_auth_user_ea_branch_ids() is
  'Branch ids for the authenticated user; security definer to avoid RLS recursion.';

create or replace function public.is_ea_branch_founder(
  p_branch_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.ea_branches b
    inner join public.ea_companies c
      on c.id = b.company_id
    where b.id = p_branch_id
      and c.created_by_user_id = auth.uid()
  );
$$;

comment on function public.is_ea_branch_founder(uuid) is
  'True when the authenticated user created the company that owns the branch.';

create or replace function public.can_access_ea_branch_team(
  p_branch_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.is_ea_branch_member(p_branch_id)
    or public.is_ea_branch_founder(p_branch_id);
$$;

comment on function public.can_access_ea_branch_team(uuid) is
  'Branch members and legacy founders may view the team directory.';

create or replace function public.is_ea_branch_team_manager(
  p_branch_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.is_ea_branch_admin(p_branch_id)
    or public.is_ea_branch_founder(p_branch_id);
$$;

comment on function public.is_ea_branch_team_manager(uuid) is
  'Branch admins and company founders may manage team invitations.';

create or replace function public.get_user_email_by_id(
  p_user_id uuid
)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select u.email
  from auth.users u
  where u.id = p_user_id;
$$;

comment on function public.get_user_email_by_id(uuid) is
  'Lookup auth email for team directory display.';

revoke all on function public.get_auth_user_ea_branch_ids() from public;
revoke all on function public.is_ea_branch_founder(uuid) from public;
revoke all on function public.can_access_ea_branch_team(uuid) from public;
revoke all on function public.is_ea_branch_team_manager(uuid) from public;
revoke all on function public.get_user_email_by_id(uuid) from public;

grant execute on function public.get_auth_user_ea_branch_ids() to authenticated;
grant execute on function public.is_ea_branch_founder(uuid) to authenticated;
grant execute on function public.can_access_ea_branch_team(uuid) to authenticated;
grant execute on function public.is_ea_branch_team_manager(uuid) to authenticated;
grant execute on function public.get_user_email_by_id(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Idempotent backfill: company founders -> branch_admin on primary branch
-- ---------------------------------------------------------------------------

insert into public.ea_branch_members (
  branch_id,
  user_id,
  role
)
select
  branch_pick.branch_id,
  branch_pick.created_by_user_id,
  'branch_admin'
from (
  select distinct on (c.id)
    b.id as branch_id,
    c.created_by_user_id
  from public.ea_companies c
  inner join public.ea_branches b
    on b.company_id = c.id
  where c.created_by_user_id is not null
  order by
    c.id,
    b.is_head_office desc,
    b.created_at asc
) as branch_pick
where not exists (
  select 1
  from public.ea_branch_members bm
  where bm.user_id = branch_pick.created_by_user_id
)
on conflict (branch_id, user_id) do nothing;

-- Ensure existing founder memberships are branch_admin.
update public.ea_branch_members bm
set role = 'branch_admin'
from public.ea_branches b
inner join public.ea_companies c
  on c.id = b.company_id
where bm.branch_id = b.id
  and bm.user_id = c.created_by_user_id
  and bm.role <> 'branch_admin';

-- ---------------------------------------------------------------------------
-- Team management RPCs — founders may manage until membership is present
-- ---------------------------------------------------------------------------

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

create or replace function public.record_ea_branch_invitation_sent(
  p_invitation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invitation public.ea_branch_invitations;
begin
  select inv.*
  into v_invitation
  from public.ea_branch_invitations inv
  where inv.id = p_invitation_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'invitation_not_found');
  end if;

  if not public.is_ea_branch_team_manager(v_invitation.branch_id) then
    return jsonb_build_object('ok', false, 'error', 'not_branch_admin');
  end if;

  update public.ea_branch_invitations
  set
    invitation_sent_at = now(),
    updated_at = now()
  where id = p_invitation_id;

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.revoke_ea_branch_invitation(
  p_invitation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invitation public.ea_branch_invitations;
begin
  select inv.*
  into v_invitation
  from public.ea_branch_invitations inv
  where inv.id = p_invitation_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'invitation_not_found');
  end if;

  if not public.is_ea_branch_team_manager(v_invitation.branch_id) then
    return jsonb_build_object('ok', false, 'error', 'not_branch_admin');
  end if;

  if v_invitation.invitation_accepted_at is not null then
    return jsonb_build_object('ok', false, 'error', 'invitation_already_accepted');
  end if;

  update public.ea_branch_invitations
  set
    invitation_revoked_at = now(),
    updated_at = now()
  where id = p_invitation_id
    and invitation_revoked_at is null;

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.remove_ea_branch_member(
  p_member_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member public.ea_branch_members;
begin
  select bm.*
  into v_member
  from public.ea_branch_members bm
  where bm.id = p_member_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'member_not_found');
  end if;

  if not public.is_ea_branch_team_manager(v_member.branch_id) then
    return jsonb_build_object('ok', false, 'error', 'not_branch_admin');
  end if;

  if v_member.user_id = auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'cannot_remove_self');
  end if;

  if v_member.role = 'branch_admin' then
    return jsonb_build_object('ok', false, 'error', 'cannot_remove_owner');
  end if;

  delete from public.ea_branch_members
  where id = p_member_id;

  return jsonb_build_object('ok', true);
end;
$$;

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

-- ---------------------------------------------------------------------------
-- RLS: branch members — teammates visible without policy recursion
-- ---------------------------------------------------------------------------

drop policy if exists ea_branch_members_select_scope
  on public.ea_branch_members;

create policy ea_branch_members_select_scope
  on public.ea_branch_members
  for select
  to authenticated
  using (
    branch_id in (
      select public.get_auth_user_ea_branch_ids()
    )
  );

drop policy if exists ea_branch_invitations_select_admins
  on public.ea_branch_invitations;

create policy ea_branch_invitations_select_admins
  on public.ea_branch_invitations
  for select
  to authenticated
  using (
    public.is_ea_branch_team_manager(branch_id)
  );
