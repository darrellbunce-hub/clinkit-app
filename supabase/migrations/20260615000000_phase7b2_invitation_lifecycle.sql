-- Phase 7B.2: Secure invitation lifecycle (pre-email)

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- property_claim_invitations
-- ---------------------------------------------------------------------------

create table if not exists public.property_claim_invitations (
  id uuid primary key default gen_random_uuid(),
  property_id bigint not null
    references public.properties (id) on delete cascade,
  invitation_token_hash text not null,
  invitation_created_at timestamptz not null default now(),
  invitation_expires_at timestamptz not null,
  invitation_used_at timestamptz null,
  invitation_revoked_at timestamptz null,
  invitation_sent_at timestamptz null,
  invitation_version integer not null default 1,
  created_by_user_id uuid not null
    references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint property_claim_invitations_version_positive_check
    check (invitation_version > 0)
);

create index if not exists property_claim_invitations_property_id_idx
  on public.property_claim_invitations (property_id);

create index if not exists property_claim_invitations_token_hash_idx
  on public.property_claim_invitations (invitation_token_hash);

-- One open (non-revoked, non-used) invitation per property. Expiry is enforced
-- in RPCs (get_active_property_claim_invitation, claim validation); partial
-- index predicates cannot use now() because it is STABLE, not IMMUTABLE.
create unique index if not exists property_claim_invitations_one_open_per_property_idx
  on public.property_claim_invitations (property_id)
  where
    invitation_revoked_at is null
    and invitation_used_at is null;

comment on table public.property_claim_invitations is
  'Secure homeowner claim invitations. Raw tokens are never stored; only SHA-256 hashes.';

alter table public.property_claim_invitations enable row level security;

revoke all on public.property_claim_invitations from public;
revoke all on public.property_claim_invitations from anon;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.hash_invitation_token(
  p_token text
)
returns text
language sql
immutable
as $$
  select encode(extensions.digest(trim(p_token), 'sha256'), 'hex');
$$;

comment on function public.hash_invitation_token(text) is
  'One-way hash for invitation token validation.';

create or replace function public.get_active_property_claim_invitation(
  p_property_id bigint
)
returns public.property_claim_invitations
language sql
stable
security definer
set search_path = public
as $$
  select pci.*
  from public.property_claim_invitations pci
  where pci.property_id = p_property_id
    and pci.invitation_revoked_at is null
    and pci.invitation_used_at is null
    and pci.invitation_expires_at > now()
  order by pci.invitation_created_at desc
  limit 1;
$$;

create or replace function public.get_latest_property_claim_invitation(
  p_property_id bigint
)
returns public.property_claim_invitations
language sql
stable
security definer
set search_path = public
as $$
  select pci.*
  from public.property_claim_invitations pci
  where pci.property_id = p_property_id
  order by pci.invitation_created_at desc
  limit 1;
$$;

revoke all on function public.hash_invitation_token(text) from public;
revoke all on function public.get_active_property_claim_invitation(bigint) from public;
revoke all on function public.get_latest_property_claim_invitation(bigint) from public;

grant execute on function public.hash_invitation_token(text) to authenticated;
grant execute on function public.get_active_property_claim_invitation(bigint) to authenticated;
grant execute on function public.get_latest_property_claim_invitation(bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- Internal: revoke open invitations for a property
-- ---------------------------------------------------------------------------

create or replace function public._revoke_open_property_claim_invitations(
  p_property_id bigint
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  update public.property_claim_invitations
  set
    invitation_revoked_at = now(),
    updated_at = now()
  where property_id = p_property_id
    and invitation_revoked_at is null
    and invitation_used_at is null;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Internal: create invitation row (caller validates access)
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
  -- Release the unique open-invitation slot for naturally expired rows.
  -- Expiry cannot live in the partial index predicate (now() is not IMMUTABLE).
  update public.property_claim_invitations
  set
    invitation_revoked_at = now(),
    updated_at = now()
  where property_id = p_property_id
    and invitation_revoked_at is null
    and invitation_used_at is null
    and invitation_expires_at <= now();

  if exists (
    select 1
    from public.get_active_property_claim_invitation(p_property_id) active_invitation
  ) then
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
    updated_at = now()
  where property_id = p_property_id
    and claim_status = 'unclaimed';

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
-- RPC: generate_property_claim_invitation
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

  if exists (
    select 1
    from public.get_active_property_claim_invitation(p_property_id) active_invitation
  ) then
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

  if not exists (
    select 1
    from public.get_active_property_claim_invitation(p_property_id) active_invitation
  ) then
    return jsonb_build_object('ok', false, 'error', 'no_active_invitation');
  end if;

  v_count := public._revoke_open_property_claim_invitations(p_property_id);

  return jsonb_build_object('ok', true, 'revoked_count', v_count);
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: get_property_claim_invitation_status (EA dashboard; no PII)
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
  v_state text;
  v_hours_remaining integer;
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

  if v_metadata.claim_status = 'claimed' then
    return jsonb_build_object(
      'ok', true,
      'state', 'claimed',
      'has_invite_email', nullif(trim(v_metadata.invite_email), '') is not null
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
      'expires_at', v_active.invitation_expires_at,
      'hours_remaining', v_hours_remaining,
      'invitation_version', v_active.invitation_version,
      'has_invite_email', nullif(trim(v_metadata.invite_email), '') is not null
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
      'expired_at', v_latest.invitation_expires_at,
      'invitation_version', v_latest.invitation_version,
      'has_invite_email', nullif(trim(v_metadata.invite_email), '') is not null
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'state', 'none',
    'has_invite_email', nullif(trim(v_metadata.invite_email), '') is not null
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: resolve_claim_invitation_token
-- ---------------------------------------------------------------------------

create or replace function public.resolve_claim_invitation_token(
  p_token text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_email text;
  v_hash text;
  v_invitation public.property_claim_invitations%rowtype;
  v_metadata public.property_claim_metadata%rowtype;
  v_property public.properties%rowtype;
  v_branch_name text;
  v_in_chain boolean;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  if not exists (
    select 1
    from public.profiles pr
    where pr.id = auth.uid()
      and pr.account_type = 'homeowner'
  ) then
    return jsonb_build_object('ok', false, 'error', 'homeowner_only');
  end if;

  v_email := public.get_auth_user_email();

  if v_email is null or v_email = '' then
    return jsonb_build_object('ok', false, 'error', 'email_required');
  end if;

  if nullif(trim(p_token), '') is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_token');
  end if;

  v_hash := public.hash_invitation_token(p_token);

  select *
  into v_invitation
  from public.property_claim_invitations pci
  where pci.invitation_token_hash = v_hash
  order by pci.invitation_created_at desc
  limit 1;

  if v_invitation.id is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_token');
  end if;

  if v_invitation.invitation_used_at is not null then
    return jsonb_build_object('ok', false, 'error', 'already_used');
  end if;

  if v_invitation.invitation_revoked_at is not null then
    return jsonb_build_object('ok', false, 'error', 'invalid_token');
  end if;

  if v_invitation.invitation_expires_at <= now() then
    return jsonb_build_object('ok', false, 'error', 'expired');
  end if;

  select *
  into v_metadata
  from public.property_claim_metadata pcm
  where pcm.property_id = v_invitation.property_id;

  if v_metadata.claim_status = 'claimed' then
    return jsonb_build_object('ok', false, 'error', 'already_claimed');
  end if;

  if v_metadata.invite_email is null
    or lower(trim(v_metadata.invite_email)) <> v_email then
    return jsonb_build_object('ok', false, 'error', 'email_mismatch');
  end if;

  if exists (
    select 1
    from public.property_members pm
    where pm.property_id = v_invitation.property_id
      and pm.user_id = auth.uid()
  ) then
    return jsonb_build_object('ok', false, 'error', 'already_member');
  end if;

  select *
  into v_property
  from public.properties
  where id = v_invitation.property_id;

  select coalesce(b.name, 'Estate agent branch')
  into v_branch_name
  from public.property_ea_assignments pea
  left join public.ea_branches b
    on b.id = pea.branch_id
  where pea.property_id = v_invitation.property_id
    and pea.status = 'active'
  order by pea.assigned_at desc nulls last
  limit 1;

  v_in_chain := exists (
    select 1
    from public.properties p2
    where p2.chain_id = v_property.chain_id
      and p2.id <> v_property.id
  );

  return jsonb_build_object(
    'ok', true,
    'property', jsonb_build_object(
      'property_id', v_property.id,
      'address', v_property.address,
      'postcode', v_property.postcode,
      'branch_name', v_branch_name,
      'in_chain', v_in_chain,
      'claim_status', v_metadata.claim_status
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Update claim_operational_property to accept optional invitation token
-- ---------------------------------------------------------------------------

create or replace function public.claim_operational_property(
  p_property_id bigint,
  p_invitation_token text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  v_property public.properties%rowtype;
  v_role text;
  v_claimable boolean;
  v_hash text;
  v_invitation public.property_claim_invitations%rowtype;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  if not exists (
    select 1
    from public.profiles pr
    where pr.id = auth.uid()
      and pr.account_type = 'homeowner'
  ) then
    return jsonb_build_object('ok', false, 'error', 'homeowner_only');
  end if;

  v_email := public.get_auth_user_email();

  if v_email is null or v_email = '' then
    return jsonb_build_object('ok', false, 'error', 'email_required');
  end if;

  if nullif(trim(p_invitation_token), '') is not null then
    v_hash := public.hash_invitation_token(p_invitation_token);

    select *
    into v_invitation
    from public.property_claim_invitations pci
    where pci.property_id = p_property_id
      and pci.invitation_token_hash = v_hash
    order by pci.invitation_created_at desc
    limit 1;

    if v_invitation.id is null then
      return jsonb_build_object('ok', false, 'error', 'invalid_token');
    end if;

    if v_invitation.invitation_used_at is not null then
      return jsonb_build_object('ok', false, 'error', 'already_used');
    end if;

    if v_invitation.invitation_revoked_at is not null then
      return jsonb_build_object('ok', false, 'error', 'invalid_token');
    end if;

    if v_invitation.invitation_expires_at <= now() then
      return jsonb_build_object('ok', false, 'error', 'expired');
    end if;
  end if;

  select exists (
    select 1
    from public.property_claim_metadata pcm
    where pcm.property_id = p_property_id
      and pcm.origin_type = 'estate_agent'
      and pcm.claim_status in ('unclaimed', 'claim_invited')
      and pcm.invite_email is not null
      and lower(trim(pcm.invite_email)) = v_email
  )
  into v_claimable;

  if not v_claimable then
    return jsonb_build_object('ok', false, 'error', 'not_claimable');
  end if;

  if exists (
    select 1
    from public.property_members pm
    where pm.property_id = p_property_id
      and pm.user_id = auth.uid()
  ) then
    return jsonb_build_object('ok', false, 'error', 'already_member');
  end if;

  select *
  into v_property
  from public.properties
  where id = p_property_id;

  if v_property.id is null then
    return jsonb_build_object('ok', false, 'error', 'property_not_found');
  end if;

  v_role := case
    when v_property.relationship_type = 'purchase' then 'buyer'
    else 'seller'
  end;

  perform public.ensure_property_membership(
    p_property_id,
    v_role
  );

  if v_invitation.id is not null then
    update public.property_claim_invitations
    set
      invitation_used_at = now(),
      updated_at = now()
    where id = v_invitation.id
      and invitation_used_at is null;
  else
    update public.property_claim_invitations
    set
      invitation_used_at = now(),
      updated_at = now()
    where property_id = p_property_id
      and invitation_revoked_at is null
      and invitation_used_at is null
      and invitation_expires_at > now();
  end if;

  return jsonb_build_object(
    'ok', true,
    'property_id', p_property_id,
    'chain_id', v_property.chain_id
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Extend agent_branch_property_summaries with invitation lifecycle (no PII)
-- ---------------------------------------------------------------------------

create or replace view public.agent_branch_property_summaries
with (security_invoker = false)
as
select
  pea.id as assignment_id,
  pea.property_id,
  pea.branch_id,
  pea.status as assignment_status,
  pea.homeowner_only_updates,
  pea.assigned_at,
  p.chain_id,
  p.address,
  p.postcode,
  p.stage,
  p.status as property_status,
  ch.completion_lifecycle_status,
  ch.completion_scheduled_date,
  ch.completed_at,
  pos.needs_attention,
  pos.stale_update,
  pos.days_since_last_update,
  pos.operational_alerts,
  pos.next_recommended_action,
  cos.confidence_score,
  cos.health_status,
  coalesce(pcm.claim_status, 'claimed') as claim_status,
  coalesce(pcm.origin_type, 'homeowner') as origin_type,
  case
    when coalesce(pcm.claim_status, 'claimed') = 'claimed' then 'claimed'
    when active_invitation.id is not null then 'invitation_active'
    when latest_invitation.id is not null
      and latest_invitation.invitation_revoked_at is null
      and latest_invitation.invitation_used_at is null
      and latest_invitation.invitation_expires_at <= now() then 'invitation_expired'
    else 'awaiting_claim'
  end as invitation_lifecycle_status,
  active_invitation.invitation_expires_at,
  active_invitation.invitation_version
from public.property_ea_assignments pea
inner join public.properties p
  on p.id = pea.property_id
inner join public.chains ch
  on ch.id = p.chain_id
left join public.property_operational_summary pos
  on pos.property_id = pea.property_id
left join public.chain_operational_summary cos
  on cos.chain_id = p.chain_id
left join public.property_claim_metadata pcm
  on pcm.property_id = pea.property_id
left join lateral (
  select pci.*
  from public.property_claim_invitations pci
  where pci.property_id = pea.property_id
    and pci.invitation_revoked_at is null
    and pci.invitation_used_at is null
    and pci.invitation_expires_at > now()
  order by pci.invitation_created_at desc
  limit 1
) active_invitation on true
left join lateral (
  select pci.*
  from public.property_claim_invitations pci
  where pci.property_id = pea.property_id
  order by pci.invitation_created_at desc
  limit 1
) latest_invitation on true
where
  auth.uid() is not null
  and exists (
    select 1
    from public.ea_branch_members bm
    where bm.branch_id = pea.branch_id
      and bm.user_id = auth.uid()
  )
  and pea.status in ('active', 'revoked');

revoke all on public.agent_branch_property_summaries from public;
revoke all on public.agent_branch_property_summaries from anon;
grant select on public.agent_branch_property_summaries to authenticated;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function public.generate_property_claim_invitation(bigint) from public;
revoke all on function public.resend_property_claim_invitation(bigint) from public;
revoke all on function public.revoke_property_claim_invitation(bigint) from public;
revoke all on function public.get_property_claim_invitation_status(bigint) from public;
revoke all on function public.resolve_claim_invitation_token(text) from public;

grant execute on function public.generate_property_claim_invitation(bigint) to authenticated;
grant execute on function public.resend_property_claim_invitation(bigint) to authenticated;
grant execute on function public.revoke_property_claim_invitation(bigint) to authenticated;
grant execute on function public.get_property_claim_invitation_status(bigint) to authenticated;
grant execute on function public.claim_operational_property(bigint, text) to authenticated;
