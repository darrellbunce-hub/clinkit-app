-- Homeowner invitation rejection: explicit declined lifecycle with audit fields.

-- ---------------------------------------------------------------------------
-- Audit columns on property_claim_invitations
-- ---------------------------------------------------------------------------

alter table public.property_claim_invitations
  add column if not exists invitation_rejected_at timestamptz null,
  add column if not exists invitation_rejected_by_user_id uuid null
    references auth.users (id),
  add column if not exists invitation_rejection_reason text null;

comment on column public.property_claim_invitations.invitation_rejected_at is
  'When the invited homeowner explicitly declined this invitation.';
comment on column public.property_claim_invitations.invitation_rejected_by_user_id is
  'Authenticated homeowner who declined the invitation.';
comment on column public.property_claim_invitations.invitation_rejection_reason is
  'Optional homeowner-provided decline reason slug (not_my_property, wrong_email, no_longer_moving, other).';

-- ---------------------------------------------------------------------------
-- RPC: reject_property_claim_invitation
-- ---------------------------------------------------------------------------

create or replace function public.reject_property_claim_invitation(
  p_invitation_token text,
  p_rejection_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_email text;
  v_hash text;
  v_invitation public.property_claim_invitations%rowtype;
  v_metadata public.property_claim_metadata%rowtype;
  v_reason text;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  if not exists (
    select 1
    from public.profiles pr
    where pr.id = v_user_id
      and pr.account_type = 'homeowner'
  ) then
    return jsonb_build_object('ok', false, 'error', 'homeowner_only');
  end if;

  v_email := public.get_auth_user_email();

  if v_email is null or v_email = '' then
    return jsonb_build_object('ok', false, 'error', 'email_required');
  end if;

  if nullif(trim(p_invitation_token), '') is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_token');
  end if;

  v_reason := nullif(trim(p_rejection_reason), '');

  if v_reason is not null
    and v_reason not in (
      'not_my_property',
      'wrong_email',
      'no_longer_moving',
      'other'
    ) then
    return jsonb_build_object('ok', false, 'error', 'invalid_rejection_reason');
  end if;

  v_hash := public.hash_invitation_token(p_invitation_token);

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

  if v_invitation.invitation_rejected_at is not null then
    return jsonb_build_object('ok', false, 'error', 'invitation_declined');
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

  if v_metadata.property_id is null then
    return jsonb_build_object('ok', false, 'error', 'property_not_found');
  end if;

  if v_metadata.claim_status = 'claimed' then
    return jsonb_build_object('ok', false, 'error', 'already_claimed');
  end if;

  if v_metadata.invite_email is null
    or lower(trim(v_metadata.invite_email)) <> v_email then
    return jsonb_build_object('ok', false, 'error', 'email_mismatch');
  end if;

  update public.property_claim_invitations
  set
    invitation_rejected_at = now(),
    invitation_rejected_by_user_id = v_user_id,
    invitation_rejection_reason = v_reason,
    invitation_revoked_at = now(),
    updated_at = now()
  where id = v_invitation.id
    and invitation_used_at is null
    and invitation_revoked_at is null
    and invitation_rejected_at is null;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'invalid_token');
  end if;

  update public.property_claim_metadata
  set
    claim_status = 'unclaimed',
    updated_at = now()
  where property_id = v_invitation.property_id
    and claim_status <> 'claimed';

  return jsonb_build_object(
    'ok', true,
    'property_id', v_invitation.property_id
  );
end;
$$;

revoke all on function public.reject_property_claim_invitation(text, text) from public;
grant execute on function public.reject_property_claim_invitation(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- RPC: get_property_claim_invitation_status (declined state)
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
      'created_at', v_active.invitation_created_at,
      'email_sent_at', v_active.invitation_sent_at,
      'email_sent', v_active.invitation_sent_at is not null,
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
    and v_latest.invitation_rejected_at is not null then
    return jsonb_build_object(
      'ok', true,
      'state', 'declined',
      'invite_email', v_invite_email,
      'rejected_at', v_latest.invitation_rejected_at,
      'rejection_reason', v_latest.invitation_rejection_reason,
      'invitation_version', v_latest.invitation_version,
      'has_invite_email', v_invite_email is not null
    );
  end if;

  if v_latest.id is not null
    and v_latest.invitation_revoked_at is null
    and v_latest.invitation_used_at is null
    and v_latest.invitation_expires_at <= now() then
    return jsonb_build_object(
      'ok', true,
      'state', 'expired',
      'invite_email', v_invite_email,
      'created_at', v_latest.invitation_created_at,
      'email_sent_at', v_latest.invitation_sent_at,
      'email_sent', v_latest.invitation_sent_at is not null,
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

-- ---------------------------------------------------------------------------
-- RPC: resolve_claim_invitation_token (invitation_declined)
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

  if v_invitation.invitation_rejected_at is not null then
    return jsonb_build_object('ok', false, 'error', 'invitation_declined');
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
-- RPC: claim_operational_property (block declined invitations)
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

    if v_invitation.invitation_rejected_at is not null then
      return jsonb_build_object('ok', false, 'error', 'invitation_declined');
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
-- RPC: discover_claimable_properties (hide homeowner-declined invitations)
-- ---------------------------------------------------------------------------

create or replace function public.discover_claimable_properties()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_email text;
  v_results jsonb;
begin
  if auth.uid() is null then
    return '[]'::jsonb;
  end if;

  if not exists (
    select 1
    from public.profiles pr
    where pr.id = auth.uid()
      and pr.account_type = 'homeowner'
  ) then
    return '[]'::jsonb;
  end if;

  v_email := public.get_auth_user_email();

  if v_email is null or v_email = '' then
    return '[]'::jsonb;
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'property_id', rows.property_id,
        'address', rows.address,
        'postcode', rows.postcode,
        'branch_name', rows.branch_name,
        'in_chain', rows.in_chain,
        'claim_status', rows.claim_status
      )
      order by rows.property_id
    ),
    '[]'::jsonb
  )
  into v_results
  from (
    select
      pcm.property_id,
      p.address,
      p.postcode,
      coalesce(b.name, 'Estate agent branch') as branch_name,
      exists (
        select 1
        from public.properties p2
        where p2.chain_id = p.chain_id
          and p2.id <> p.id
      ) as in_chain,
      pcm.claim_status
    from public.property_claim_metadata pcm
    inner join public.properties p
      on p.id = pcm.property_id
    left join lateral (
      select pea.branch_id
      from public.property_ea_assignments pea
      where pea.property_id = pcm.property_id
        and pea.status = 'active'
      order by pea.assigned_at desc nulls last
      limit 1
    ) active_assignment
      on true
    left join public.ea_branches b
      on b.id = active_assignment.branch_id
    where pcm.origin_type = 'estate_agent'
      and pcm.claim_status in ('unclaimed', 'claim_invited')
      and pcm.invite_email is not null
      and lower(trim(pcm.invite_email)) = v_email
      and not exists (
        select 1
        from public.property_members pm
        where pm.property_id = pcm.property_id
          and pm.user_id = auth.uid()
      )
      and not exists (
        select 1
        from public.property_claim_invitations pci
        where pci.property_id = pcm.property_id
          and pci.invitation_rejected_by_user_id = auth.uid()
          and pci.invitation_rejected_at is not null
          and (public.get_active_property_claim_invitation(pcm.property_id)).id is null
      )
  ) as rows;

  return coalesce(v_results, '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- View: agent_branch_property_summaries (invitation_declined)
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
    when latest_invitation.invitation_rejected_at is not null then 'invitation_declined'
    when latest_invitation.id is not null
      and latest_invitation.invitation_revoked_at is null
      and latest_invitation.invitation_used_at is null
      and latest_invitation.invitation_expires_at <= now() then 'invitation_expired'
    when coalesce(pcm.invitation_deferred, false) then 'invitation_deferred'
    else 'awaiting_claim'
  end as invitation_lifecycle_status,
  active_invitation.invitation_expires_at,
  active_invitation.invitation_version,
  latest_invitation.invitation_rejected_at,
  latest_invitation.invitation_rejection_reason
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
