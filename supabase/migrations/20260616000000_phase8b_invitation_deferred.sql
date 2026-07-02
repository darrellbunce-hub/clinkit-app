-- Phase 8B: Invitation deferred structured state + dashboard lifecycle extension

alter table public.property_claim_metadata
  add column if not exists invitation_deferred boolean not null default false;

comment on column public.property_claim_metadata.invitation_deferred is
  'Structured EA decision to defer homeowner invitation. No free-text reason stored.';

-- ---------------------------------------------------------------------------
-- RPC: defer_property_claim_invitation
-- ---------------------------------------------------------------------------

create or replace function public.defer_property_claim_invitation(
  p_property_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_metadata public.property_claim_metadata%rowtype;
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

  if v_metadata.claim_status = 'claimed' then
    return jsonb_build_object('ok', false, 'error', 'already_claimed');
  end if;

  if exists (
    select 1
    from public.get_active_property_claim_invitation(p_property_id) active_invitation
  ) then
    return jsonb_build_object('ok', false, 'error', 'invitation_already_active');
  end if;

  update public.property_claim_metadata
  set
    invitation_deferred = true,
    updated_at = now()
  where property_id = p_property_id;

  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: resume_property_claim_invitation
-- ---------------------------------------------------------------------------

create or replace function public.resume_property_claim_invitation(
  p_property_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  if not public.is_ea_assigned_to_property(p_property_id) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  if not exists (
    select 1
    from public.property_claim_metadata pcm
    where pcm.property_id = p_property_id
      and pcm.invitation_deferred = true
  ) then
    return jsonb_build_object('ok', false, 'error', 'not_deferred');
  end if;

  update public.property_claim_metadata
  set
    invitation_deferred = false,
    updated_at = now()
  where property_id = p_property_id;

  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Clear deferred flag when creating a new invitation
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
    invitation_deferred = false,
    updated_at = now()
  where property_id = p_property_id
    and claim_status = 'unclaimed';

  update public.property_claim_metadata
  set
    invitation_deferred = false,
    updated_at = now()
  where property_id = p_property_id
    and invitation_deferred = true;

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
-- Update get_property_claim_invitation_status
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

  if v_metadata.invitation_deferred then
    return jsonb_build_object(
      'ok', true,
      'state', 'deferred',
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
-- Extend agent_branch_property_summaries
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
    when coalesce(pcm.invitation_deferred, false) then 'invitation_deferred'
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

revoke all on function public.defer_property_claim_invitation(bigint) from public;
revoke all on function public.resume_property_claim_invitation(bigint) from public;

grant execute on function public.defer_property_claim_invitation(bigint) to authenticated;
grant execute on function public.resume_property_claim_invitation(bigint) to authenticated;
