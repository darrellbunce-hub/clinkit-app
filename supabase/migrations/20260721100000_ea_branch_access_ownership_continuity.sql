-- Pre-Launch Workstream 1: EA branch access, revocation & ownership continuity
--
-- - Exactly one Owner (branch_admin) per branch (deferred invariant)
-- - Close direct authenticated UPDATE on ea_branch_members (OC-01)
-- - Atomic transfer_ea_branch_ownership RPC
-- - Retire company-founder team-management bypass
-- - Staff-only invitations; append-only membership audit events

-- ---------------------------------------------------------------------------
-- ea_branch_membership_events (append-only audit)
-- ---------------------------------------------------------------------------

create table if not exists public.ea_branch_membership_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  branch_id uuid not null references public.ea_branches (id) on delete cascade,
  actor_user_id uuid null references auth.users (id) on delete set null,
  subject_user_id uuid null references auth.users (id) on delete set null,
  previous_role text null,
  new_role text null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),

  constraint ea_branch_membership_events_event_type_check check (
    event_type in (
      'invitation_created',
      'invitation_revoked',
      'invitation_accepted',
      'member_removed',
      'ownership_transferred',
      'owner_left_branch',
      'role_changed',
      'member_reinvited'
    )
  )
);

create index if not exists ea_branch_membership_events_branch_created_idx
  on public.ea_branch_membership_events (branch_id, created_at desc);

create index if not exists ea_branch_membership_events_subject_created_idx
  on public.ea_branch_membership_events (subject_user_id, created_at desc)
  where subject_user_id is not null;

comment on table public.ea_branch_membership_events is
  'Append-only audit trail for EA branch membership and team administration.';

alter table public.ea_branch_membership_events enable row level security;

revoke all on public.ea_branch_membership_events from public, anon, authenticated;
grant select, insert on public.ea_branch_membership_events to service_role;

-- ---------------------------------------------------------------------------
-- Audit helper (security definer — RPCs only)
-- ---------------------------------------------------------------------------

create or replace function public._log_ea_branch_membership_event(
  p_event_type text,
  p_branch_id uuid,
  p_actor_user_id uuid default null,
  p_subject_user_id uuid default null,
  p_previous_role text default null,
  p_new_role text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.ea_branch_membership_events (
    event_type,
    branch_id,
    actor_user_id,
    subject_user_id,
    previous_role,
    new_role,
    metadata
  )
  values (
    p_event_type,
    p_branch_id,
    p_actor_user_id,
    p_subject_user_id,
    p_previous_role,
    p_new_role,
    coalesce(p_metadata, '{}'::jsonb)
  );
end;
$$;

comment on function public._log_ea_branch_membership_event(text, uuid, uuid, uuid, text, text, jsonb) is
  'Internal audit writer for EA branch membership mutations.';

revoke all on function public._log_ea_branch_membership_event(text, uuid, uuid, uuid, text, text, jsonb) from public;
revoke all on function public._log_ea_branch_membership_event(text, uuid, uuid, uuid, text, text, jsonb) from anon;
revoke all on function public._log_ea_branch_membership_event(text, uuid, uuid, uuid, text, text, jsonb) from authenticated;

-- ---------------------------------------------------------------------------
-- Data repair: exactly one Owner per branch; revoke pending Owner invitations
-- ---------------------------------------------------------------------------

with ranked_owners as (
  select
    bm.id,
    row_number() over (
      partition by bm.branch_id
      order by bm.joined_at asc, bm.id asc
    ) as owner_rank
  from public.ea_branch_members bm
  where bm.role = 'branch_admin'
)
update public.ea_branch_members bm
set role = 'agent'
from ranked_owners ro
where bm.id = ro.id
  and ro.owner_rank > 1;

with branches_without_owner as (
  select b.id as branch_id
  from public.ea_branches b
  where exists (
    select 1
    from public.ea_branch_members bm
    where bm.branch_id = b.id
  )
  and not exists (
    select 1
    from public.ea_branch_members bm
    where bm.branch_id = b.id
      and bm.role = 'branch_admin'
  )
),
first_member as (
  select distinct on (bm.branch_id)
    bm.id
  from public.ea_branch_members bm
  inner join branches_without_owner bwo
    on bwo.branch_id = bm.branch_id
  order by bm.branch_id, bm.joined_at asc, bm.id asc
)
update public.ea_branch_members bm
set role = 'branch_admin'
from first_member fm
where bm.id = fm.id;

update public.ea_branch_invitations inv
set
  invitation_revoked_at = now(),
  updated_at = now()
where inv.invite_role = 'branch_admin'
  and inv.invitation_accepted_at is null
  and inv.invitation_revoked_at is null;

-- ---------------------------------------------------------------------------
-- One-Owner invariant (checked at transaction commit — allows atomic transfer)
-- ---------------------------------------------------------------------------

create or replace function public._enforce_ea_branch_owner_invariant()
returns trigger
language plpgsql
as $$
declare
  v_branch_id uuid;
  v_owner_count integer;
begin
  v_branch_id := coalesce(new.branch_id, old.branch_id);

  select count(*)
  into v_owner_count
  from public.ea_branch_members bm
  where bm.branch_id = v_branch_id
    and bm.role = 'branch_admin';

  if v_owner_count <> 1 then
    raise exception 'ea_branch_owner_invariant_violation: branch % has % owners', v_branch_id, v_owner_count
      using errcode = '23514';
  end if;

  return null;
end;
$$;

drop trigger if exists ea_branch_owner_invariant_trigger
  on public.ea_branch_members;

create constraint trigger ea_branch_owner_invariant_trigger
  after insert or update of role or delete
  on public.ea_branch_members
  deferrable initially deferred
  for each row
  execute function public._enforce_ea_branch_owner_invariant();

comment on function public._enforce_ea_branch_owner_invariant() is
  'Deferred constraint: each branch must have exactly one branch_admin at commit.';

-- ---------------------------------------------------------------------------
-- OC-01: remove direct role mutation path for authenticated users
-- ---------------------------------------------------------------------------

drop policy if exists ea_branch_members_update_admins
  on public.ea_branch_members;

revoke update on public.ea_branch_members from authenticated;

-- ---------------------------------------------------------------------------
-- Retire founder bypass for team directory / management
-- ---------------------------------------------------------------------------

create or replace function public.can_access_ea_branch_team(
  p_branch_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_ea_branch_member(p_branch_id);
$$;

comment on function public.can_access_ea_branch_team(uuid) is
  'Active branch members may view the team directory.';

create or replace function public.is_ea_branch_team_manager(
  p_branch_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_ea_branch_admin(p_branch_id);
$$;

comment on function public.is_ea_branch_team_manager(uuid) is
  'Branch Owner (branch_admin) may manage team invitations and membership.';

-- is_ea_branch_founder retained for non-team uses (e.g. company founding RLS) but not team admin.

-- ---------------------------------------------------------------------------
-- create_ea_branch_invitation — Staff only; Owner-only authority
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

  if v_invite_role <> 'agent' then
    return jsonb_build_object('ok', false, 'error', 'owner_invitation_not_allowed');
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
    'agent',
    v_hash,
    v_expires_at,
    auth.uid()
  )
  returning id into v_invitation_id;

  perform public._log_ea_branch_membership_event(
    'invitation_created',
    p_branch_id,
    auth.uid(),
    null,
    null,
    'agent',
    jsonb_build_object('invitation_id', v_invitation_id)
  );

  return jsonb_build_object(
    'ok', true,
    'invitation_id', v_invitation_id,
    'token', v_raw_token,
    'expires_at', v_expires_at
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- record_ea_branch_invitation_sent
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

-- ---------------------------------------------------------------------------
-- revoke_ea_branch_invitation
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

  perform public._log_ea_branch_membership_event(
    'invitation_revoked',
    v_invitation.branch_id,
    auth.uid(),
    null,
    null,
    null,
    jsonb_build_object('invitation_id', p_invitation_id)
  );

  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- accept_ea_branch_invitation — always Staff; audit
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
  v_event_type text;
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

  if v_invitation.invite_role = 'branch_admin' then
    return jsonb_build_object('ok', false, 'error', 'owner_invitation_not_allowed');
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
    'agent'
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

  select case
    when exists (
      select 1
      from public.ea_branch_membership_events e
      where e.branch_id = v_invitation.branch_id
        and e.subject_user_id = auth.uid()
        and e.event_type in ('member_removed', 'owner_left_branch')
    ) then 'member_reinvited'
    else 'invitation_accepted'
  end
  into v_event_type;

  perform public._log_ea_branch_membership_event(
    v_event_type,
    v_invitation.branch_id,
    auth.uid(),
    auth.uid(),
    null,
    'agent',
    jsonb_build_object('invitation_id', v_invitation.id)
  );

  return jsonb_build_object(
    'ok', true,
    'branch_id', v_invitation.branch_id
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- remove_ea_branch_member — Owner removes Staff; audit
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

  if v_member.role <> 'agent' then
    return jsonb_build_object('ok', false, 'error', 'invalid_member_role');
  end if;

  perform public._log_ea_branch_membership_event(
    'member_removed',
    v_member.branch_id,
    auth.uid(),
    v_member.user_id,
    v_member.role,
    null,
    jsonb_build_object('member_id', p_member_id)
  );

  delete from public.ea_branch_members
  where id = p_member_id;

  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- transfer_ea_branch_ownership — atomic; remain Staff or leave branch
-- ---------------------------------------------------------------------------

create or replace function public.transfer_ea_branch_ownership(
  p_branch_id uuid,
  p_new_owner_member_id uuid,
  p_outgoing_action text default 'remain_staff'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_member public.ea_branch_members;
  v_target_member public.ea_branch_members;
  v_owner_count integer;
begin
  if p_outgoing_action not in ('remain_staff', 'leave_branch') then
    return jsonb_build_object('ok', false, 'error', 'invalid_outgoing_action');
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_branch_id::text, 0)
  );

  if not public.is_ea_branch_admin(p_branch_id) then
    return jsonb_build_object('ok', false, 'error', 'not_branch_admin');
  end if;

  select bm.*
  into v_caller_member
  from public.ea_branch_members bm
  where bm.branch_id = p_branch_id
    and bm.user_id = auth.uid();

  if not found or v_caller_member.role <> 'branch_admin' then
    return jsonb_build_object('ok', false, 'error', 'not_branch_admin');
  end if;

  select count(*)
  into v_owner_count
  from public.ea_branch_members bm
  where bm.branch_id = p_branch_id
    and bm.role = 'branch_admin';

  if v_owner_count <> 1 then
    return jsonb_build_object('ok', false, 'error', 'owner_invariant_violation');
  end if;

  select bm.*
  into v_target_member
  from public.ea_branch_members bm
  where bm.id = p_new_owner_member_id
    and bm.branch_id = p_branch_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'target_not_found');
  end if;

  if v_target_member.user_id = auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'cannot_transfer_to_self');
  end if;

  if v_target_member.role <> 'agent' then
    return jsonb_build_object('ok', false, 'error', 'target_must_be_staff');
  end if;

  -- Promote successor before outgoing Owner loses status (same transaction;
  -- deferred invariant checked at commit when exactly one Owner remains).
  update public.ea_branch_members
  set role = 'branch_admin'
  where id = v_target_member.id;

  if p_outgoing_action = 'remain_staff' then
    update public.ea_branch_members
    set role = 'agent'
    where id = v_caller_member.id;

    perform public._log_ea_branch_membership_event(
      'role_changed',
      p_branch_id,
      auth.uid(),
      v_caller_member.user_id,
      'branch_admin',
      'agent',
      jsonb_build_object('reason', 'ownership_transfer')
    );
  else
    perform public._log_ea_branch_membership_event(
      'owner_left_branch',
      p_branch_id,
      auth.uid(),
      v_caller_member.user_id,
      'branch_admin',
      null,
      jsonb_build_object('member_id', v_caller_member.id)
    );

    delete from public.ea_branch_members
    where id = v_caller_member.id;
  end if;

  perform public._log_ea_branch_membership_event(
    'ownership_transferred',
    p_branch_id,
    auth.uid(),
    v_target_member.user_id,
    'agent',
    'branch_admin',
    jsonb_build_object(
      'outgoing_action', p_outgoing_action,
      'previous_owner_user_id', v_caller_member.user_id
    )
  );

  return jsonb_build_object(
    'ok', true,
    'new_owner_user_id', v_target_member.user_id,
    'outgoing_action', p_outgoing_action
  );
end;
$$;

revoke all on function public.transfer_ea_branch_ownership(uuid, uuid, text) from public;
grant execute on function public.transfer_ea_branch_ownership(uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Team directory — Owner-only management flag
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
  v_is_owner boolean;
begin
  if not public.can_access_ea_branch_team(p_branch_id) then
    return jsonb_build_object('ok', false, 'error', 'not_branch_member');
  end if;

  v_is_owner := public.is_ea_branch_admin(p_branch_id);

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

  if v_is_owner then
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
    'can_manage_team', v_is_owner,
    'can_transfer_ownership', v_is_owner
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS: invitations visible to Owner only
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
