-- Phase 9: Estate agent branch team invitations (MVP collaboration)

-- ---------------------------------------------------------------------------
-- ea_branch_invitations
-- ---------------------------------------------------------------------------

create table if not exists public.ea_branch_invitations (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null
    references public.ea_branches (id) on delete cascade,
  invite_email text not null,
  invite_name text not null,
  invite_role text not null,
  invitation_token_hash text not null,
  invitation_created_at timestamptz not null default now(),
  invitation_expires_at timestamptz not null,
  invitation_accepted_at timestamptz null,
  invitation_revoked_at timestamptz null,
  invitation_sent_at timestamptz null,
  created_by_user_id uuid not null
    references auth.users (id),
  accepted_by_user_id uuid null
    references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint ea_branch_invitations_role_check
    check (invite_role in ('branch_admin', 'agent')),

  constraint ea_branch_invitations_email_lower_check
    check (invite_email = lower(invite_email))
);

create index if not exists ea_branch_invitations_branch_id_idx
  on public.ea_branch_invitations (branch_id);

create index if not exists ea_branch_invitations_token_hash_idx
  on public.ea_branch_invitations (invitation_token_hash);

create unique index if not exists ea_branch_invitations_one_open_per_email_branch_idx
  on public.ea_branch_invitations (branch_id, invite_email)
  where
    invitation_revoked_at is null
    and invitation_accepted_at is null;

comment on table public.ea_branch_invitations is
  'Branch team invitations. Raw tokens are never stored; only SHA-256 hashes.';

alter table public.ea_branch_invitations enable row level security;

revoke all on public.ea_branch_invitations from public;
revoke all on public.ea_branch_invitations from anon;

-- ---------------------------------------------------------------------------
-- One branch per user (MVP — no multi-branch membership)
-- ---------------------------------------------------------------------------

create unique index if not exists ea_branch_members_one_branch_per_user_idx
  on public.ea_branch_members (user_id);

comment on index public.ea_branch_members_one_branch_per_user_idx is
  'MVP constraint: each estate agent user belongs to at most one branch.';

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.get_active_ea_branch_invitation(
  p_branch_id uuid,
  p_invite_email text
)
returns public.ea_branch_invitations
language sql
stable
security definer
set search_path = public
as $$
  select inv.*
  from public.ea_branch_invitations inv
  where inv.branch_id = p_branch_id
    and inv.invite_email = lower(trim(p_invite_email))
    and inv.invitation_revoked_at is null
    and inv.invitation_accepted_at is null
    and inv.invitation_expires_at > now()
  order by inv.invitation_created_at desc
  limit 1;
$$;

comment on function public.get_active_ea_branch_invitation(uuid, text) is
  'Active branch invitation as a scalar composite (NULL when none). Test .id IS NOT NULL; do not use EXISTS (SELECT 1 FROM this_function(...)).';

create or replace function public.user_has_ea_branch_membership(
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.ea_branch_members bm
    where bm.user_id = p_user_id
  );
$$;

create or replace function public.user_email_has_ea_branch_membership(
  p_email text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from auth.users u
    inner join public.ea_branch_members bm
      on bm.user_id = u.id
    where lower(u.email) = lower(trim(p_email))
  );
$$;

revoke all on function public.get_active_ea_branch_invitation(uuid, text) from public;
revoke all on function public.user_has_ea_branch_membership(uuid) from public;
revoke all on function public.user_email_has_ea_branch_membership(text) from public;

grant execute on function public.get_active_ea_branch_invitation(uuid, text) to authenticated;
grant execute on function public.user_has_ea_branch_membership(uuid) to authenticated;
grant execute on function public.user_email_has_ea_branch_membership(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Internal: revoke expired open invitations for branch + email
-- ---------------------------------------------------------------------------

create or replace function public._revoke_expired_ea_branch_invitations(
  p_branch_id uuid,
  p_invite_email text default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  update public.ea_branch_invitations
  set
    invitation_revoked_at = now(),
    updated_at = now()
  where branch_id = p_branch_id
    and invitation_revoked_at is null
    and invitation_accepted_at is null
    and invitation_expires_at <= now()
    and (
      p_invite_email is null
      or invite_email = lower(trim(p_invite_email))
    );

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public._revoke_expired_ea_branch_invitations(uuid, text) from public;

-- ---------------------------------------------------------------------------
-- Preview invitation (public — token only)
-- ---------------------------------------------------------------------------

create or replace function public.preview_ea_branch_invitation(
  p_token text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_hash text;
  v_invitation public.ea_branch_invitations;
  v_branch public.ea_branches;
  v_company public.ea_companies;
begin
  if p_token is null or length(trim(p_token)) = 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid_token');
  end if;

  v_hash := public.hash_invitation_token(p_token);

  select inv.*
  into v_invitation
  from public.ea_branch_invitations inv
  where inv.invitation_token_hash = v_hash
  order by inv.invitation_created_at desc
  limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'invitation_not_found');
  end if;

  if v_invitation.invitation_accepted_at is not null then
    return jsonb_build_object('ok', false, 'error', 'invitation_already_accepted');
  end if;

  if v_invitation.invitation_revoked_at is not null then
    return jsonb_build_object('ok', false, 'error', 'invitation_revoked');
  end if;

  if v_invitation.invitation_expires_at <= now() then
    return jsonb_build_object('ok', false, 'error', 'invitation_expired');
  end if;

  select b.*
  into v_branch
  from public.ea_branches b
  where b.id = v_invitation.branch_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'branch_not_found');
  end if;

  select c.*
  into v_company
  from public.ea_companies c
  where c.id = v_branch.company_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'company_not_found');
  end if;

  return jsonb_build_object(
    'ok', true,
    'invitation_id', v_invitation.id,
    'invite_name', v_invitation.invite_name,
    'invite_email', v_invitation.invite_email,
    'invite_role', v_invitation.invite_role,
    'branch_name', v_branch.name,
    'company_name', v_company.name,
    'expires_at', v_invitation.invitation_expires_at
  );
end;
$$;

revoke all on function public.preview_ea_branch_invitation(text) from public;
grant execute on function public.preview_ea_branch_invitation(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Create branch team invitation
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
  if not public.is_ea_branch_admin(p_branch_id) then
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

  select lower(u.email)
  into v_inviter_email
  from auth.users u
  where u.id = auth.uid();

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

revoke all on function public.create_ea_branch_invitation(uuid, text, text, text) from public;
grant execute on function public.create_ea_branch_invitation(uuid, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Record invitation email sent
-- ---------------------------------------------------------------------------

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

  if not public.is_ea_branch_admin(v_invitation.branch_id) then
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

revoke all on function public.record_ea_branch_invitation_sent(uuid) from public;
grant execute on function public.record_ea_branch_invitation_sent(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Accept branch team invitation
-- ---------------------------------------------------------------------------

create or replace function public.accept_ea_branch_invitation(
  p_token text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hash text;
  v_invitation public.ea_branch_invitations;
  v_user_email text;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'authentication_required');
  end if;

  if p_token is null or length(trim(p_token)) = 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid_token');
  end if;

  v_hash := public.hash_invitation_token(p_token);

  select inv.*
  into v_invitation
  from public.ea_branch_invitations inv
  where inv.invitation_token_hash = v_hash
  order by inv.invitation_created_at desc
  limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'invitation_not_found');
  end if;

  if v_invitation.invitation_accepted_at is not null then
    return jsonb_build_object('ok', false, 'error', 'invitation_already_accepted');
  end if;

  if v_invitation.invitation_revoked_at is not null then
    return jsonb_build_object('ok', false, 'error', 'invitation_revoked');
  end if;

  if v_invitation.invitation_expires_at <= now() then
    return jsonb_build_object('ok', false, 'error', 'invitation_expired');
  end if;

  select lower(u.email)
  into v_user_email
  from auth.users u
  where u.id = auth.uid();

  if v_user_email is distinct from v_invitation.invite_email then
    return jsonb_build_object('ok', false, 'error', 'email_mismatch');
  end if;

  if public.user_has_ea_branch_membership(auth.uid()) then
    return jsonb_build_object('ok', false, 'error', 'already_branch_member');
  end if;

  if not exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.account_type = 'estate_agent'
  ) then
    return jsonb_build_object('ok', false, 'error', 'estate_agent_account_required');
  end if;

  insert into public.ea_branch_members (
    branch_id,
    user_id,
    role
  )
  values (
    v_invitation.branch_id,
    auth.uid(),
    v_invitation.invite_role
  );

  update public.ea_branch_invitations
  set
    invitation_accepted_at = now(),
    accepted_by_user_id = auth.uid(),
    updated_at = now()
  where id = v_invitation.id;

  update public.profiles
  set
    onboarding_completed_at = coalesce(
      onboarding_completed_at,
      now()
    ),
    contact_name = coalesce(
      nullif(trim(contact_name), ''),
      v_invitation.invite_name
    )
  where id = auth.uid()
    and account_type = 'estate_agent';

  return jsonb_build_object(
    'ok', true,
    'branch_id', v_invitation.branch_id
  );
end;
$$;

revoke all on function public.accept_ea_branch_invitation(text) from public;
grant execute on function public.accept_ea_branch_invitation(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Revoke pending invitation
-- ---------------------------------------------------------------------------

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

  if not public.is_ea_branch_admin(v_invitation.branch_id) then
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

revoke all on function public.revoke_ea_branch_invitation(uuid) from public;
grant execute on function public.revoke_ea_branch_invitation(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Remove branch member (staff only — MVP)
-- ---------------------------------------------------------------------------

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

  if not public.is_ea_branch_admin(v_member.branch_id) then
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

revoke all on function public.remove_ea_branch_member(uuid) from public;
grant execute on function public.remove_ea_branch_member(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Branch team directory
-- ---------------------------------------------------------------------------

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
  if not public.is_ea_branch_member(p_branch_id) then
    return jsonb_build_object('ok', false, 'error', 'not_branch_member');
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'member_id', bm.id,
        'user_id', bm.user_id,
        'contact_name', coalesce(nullif(trim(p.contact_name), ''), split_part(u.email, '@', 1)),
        'email', u.email,
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
  inner join auth.users u
    on u.id = bm.user_id
  left join public.profiles p
    on p.id = bm.user_id
  where bm.branch_id = p_branch_id;

  if public.is_ea_branch_admin(p_branch_id) then
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
    'can_manage_team', public.is_ea_branch_admin(p_branch_id)
  );
end;
$$;

revoke all on function public.get_ea_branch_team_directory(uuid) from public;
grant execute on function public.get_ea_branch_team_directory(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS: ea_branch_members — all branch members see teammates
-- ---------------------------------------------------------------------------

drop policy if exists ea_branch_members_select_scope
  on public.ea_branch_members;

create policy ea_branch_members_select_scope
  on public.ea_branch_members
  for select
  to authenticated
  using (
    public.is_ea_branch_member(branch_id)
  );

-- ---------------------------------------------------------------------------
-- RLS: ea_branch_invitations — branch admins read invitations for their branch
-- ---------------------------------------------------------------------------

drop policy if exists ea_branch_invitations_select_admins
  on public.ea_branch_invitations;

create policy ea_branch_invitations_select_admins
  on public.ea_branch_invitations
  for select
  to authenticated
  using (
    public.is_ea_branch_admin(branch_id)
  );

grant select on public.ea_branch_invitations to authenticated;

-- ---------------------------------------------------------------------------
-- Backfill legacy company founders who predate branch membership rows
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

update public.ea_branch_members bm
set role = 'branch_admin'
from public.ea_branches b
inner join public.ea_companies c
  on c.id = b.company_id
where bm.branch_id = b.id
  and bm.user_id = c.created_by_user_id
  and bm.role <> 'branch_admin';
