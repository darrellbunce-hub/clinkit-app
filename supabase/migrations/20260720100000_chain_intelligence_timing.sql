-- Stage 3.5: Chain Intelligence timing clocks + summary metadata

alter table public.properties
  add column if not exists stage_entered_at timestamptz;

comment on column public.properties.stage_entered_at is
  'When the property entered its current stage. Set on genuine stage transitions only.';

alter table public.chain_nodes
  add column if not exists stage_entered_at timestamptz;

comment on column public.chain_nodes.stage_entered_at is
  'When the buyer-ready node entered its current stage. Set on genuine stage transitions only.';

alter table public.chain_operational_summary
  alter column confidence_score drop not null;

alter table public.chain_operational_summary
  add column if not exists confidence_band text,
  add column if not exists confidence_unavailable boolean not null default false,
  add column if not exists data_coverage_status text,
  add column if not exists coverage_label text,
  add column if not exists estimated_completion_window text,
  add column if not exists next_recalculation_at timestamptz,
  add column if not exists confidence_algorithm_version text,
  add column if not exists eta_algorithm_version text;

create index if not exists chain_operational_summary_next_recalc_idx
  on public.chain_operational_summary(next_recalculation_at)
  where next_recalculation_at is not null;

comment on column public.chain_operational_summary.confidence_band is
  'Customer-facing band: Strong, Good, Monitor, Needs attention, or Unavailable.';

-- ---------------------------------------------------------------------------
-- Service-role batch: chains due for time-only intelligence refresh
-- ---------------------------------------------------------------------------

create or replace function public.list_chain_intelligence_refresh_candidates(
  p_limit integer default 200
)
returns table(chain_id bigint)
language sql
security definer
set search_path = public
stable
as $$
  select cos.chain_id
  from public.chain_operational_summary cos
  inner join public.chains ch
    on ch.id = cos.chain_id
  where ch.completed_at is null
    and (
      cos.next_recalculation_at is null
      or cos.next_recalculation_at <= now()
    )
  order by cos.next_recalculation_at nulls first, cos.computed_at asc
  limit greatest(1, least(coalesce(p_limit, 200), 500));
$$;

revoke all on function public.list_chain_intelligence_refresh_candidates(integer) from public;
grant execute on function public.list_chain_intelligence_refresh_candidates(integer) to service_role;

-- ---------------------------------------------------------------------------
-- Service-role upsert (cron worker — no authenticated session)
-- ---------------------------------------------------------------------------

create or replace function public.upsert_operational_summaries_service(
  p_chain_summary jsonb,
  p_property_summaries jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_chain_id bigint;
  v_property jsonb;
begin
  v_chain_id := (p_chain_summary->>'chain_id')::bigint;

  if v_chain_id is null then
    raise exception 'chain_id is required';
  end if;

  insert into public.chain_operational_summary (
    chain_id,
    confidence_score,
    confidence_band,
    confidence_unavailable,
    data_coverage_status,
    coverage_label,
    estimated_completion_window,
    next_recalculation_at,
    confidence_algorithm_version,
    eta_algorithm_version,
    health_status,
    blocked_count,
    delay_count,
    stale_count,
    buyer_ready_stale,
    requires_replacement_buyer,
    computed_at,
    summary_version
  )
  values (
    v_chain_id,
    nullif(p_chain_summary->>'confidence_score', '')::integer,
    nullif(p_chain_summary->>'confidence_band', ''),
    coalesce((p_chain_summary->>'confidence_unavailable')::boolean, false),
    nullif(p_chain_summary->>'data_coverage_status', ''),
    nullif(p_chain_summary->>'coverage_label', ''),
    nullif(p_chain_summary->>'estimated_completion_window', ''),
    nullif(p_chain_summary->>'next_recalculation_at', '')::timestamptz,
    nullif(p_chain_summary->>'confidence_algorithm_version', ''),
    nullif(p_chain_summary->>'eta_algorithm_version', ''),
    p_chain_summary->>'health_status',
    coalesce((p_chain_summary->>'blocked_count')::integer, 0),
    coalesce((p_chain_summary->>'delay_count')::integer, 0),
    coalesce((p_chain_summary->>'stale_count')::integer, 0),
    coalesce((p_chain_summary->>'buyer_ready_stale')::boolean, false),
    coalesce((p_chain_summary->>'requires_replacement_buyer')::boolean, false),
    coalesce((p_chain_summary->>'computed_at')::timestamptz, now()),
    coalesce((p_chain_summary->>'summary_version')::integer, 2)
  )
  on conflict (chain_id) do update
  set
    confidence_score = excluded.confidence_score,
    confidence_band = excluded.confidence_band,
    confidence_unavailable = excluded.confidence_unavailable,
    data_coverage_status = excluded.data_coverage_status,
    coverage_label = excluded.coverage_label,
    estimated_completion_window = excluded.estimated_completion_window,
    next_recalculation_at = excluded.next_recalculation_at,
    confidence_algorithm_version = excluded.confidence_algorithm_version,
    eta_algorithm_version = excluded.eta_algorithm_version,
    health_status = excluded.health_status,
    blocked_count = excluded.blocked_count,
    delay_count = excluded.delay_count,
    stale_count = excluded.stale_count,
    buyer_ready_stale = excluded.buyer_ready_stale,
    requires_replacement_buyer = excluded.requires_replacement_buyer,
    computed_at = excluded.computed_at,
    summary_version = excluded.summary_version;

  for v_property in
    select value
    from jsonb_array_elements(p_property_summaries)
  loop
    if not exists (
      select 1
      from public.properties p
      where p.id = (v_property->>'property_id')::bigint
        and p.chain_id = v_chain_id
    ) then
      raise exception
        'property % does not belong to chain %',
        v_property->>'property_id',
        v_chain_id;
    end if;

    insert into public.property_operational_summary (
      property_id,
      chain_id,
      current_stage,
      property_status,
      last_update_at,
      days_since_last_update,
      stale_update,
      buyer_ready_stage,
      buyer_ready_status,
      buyer_ready_last_update,
      buyer_ready_delayed,
      buyer_ready_stale,
      completion_status,
      completion_scheduled,
      completion_confirmed,
      operational_alerts,
      needs_attention,
      next_recommended_action,
      computed_at,
      summary_version,
      derived_from_activity_at
    )
    values (
      (v_property->>'property_id')::bigint,
      v_chain_id,
      v_property->>'current_stage',
      v_property->>'property_status',
      nullif(v_property->>'last_update_at', '')::timestamptz,
      coalesce((v_property->>'days_since_last_update')::integer, 0),
      coalesce((v_property->>'stale_update')::boolean, false),
      nullif(v_property->>'buyer_ready_stage', ''),
      nullif(v_property->>'buyer_ready_status', ''),
      nullif(v_property->>'buyer_ready_last_update', '')::timestamptz,
      coalesce((v_property->>'buyer_ready_delayed')::boolean, false),
      coalesce((v_property->>'buyer_ready_stale')::boolean, false),
      nullif(v_property->>'completion_status', ''),
      coalesce((v_property->>'completion_scheduled')::boolean, false),
      coalesce((v_property->>'completion_confirmed')::boolean, false),
      coalesce(v_property->'operational_alerts', '[]'::jsonb),
      coalesce((v_property->>'needs_attention')::boolean, false),
      v_property->'next_recommended_action',
      coalesce((v_property->>'computed_at')::timestamptz, now()),
      coalesce((v_property->>'summary_version')::integer, 2),
      nullif(v_property->>'derived_from_activity_at', '')::timestamptz
    )
    on conflict (property_id) do update
    set
      chain_id = excluded.chain_id,
      current_stage = excluded.current_stage,
      property_status = excluded.property_status,
      last_update_at = excluded.last_update_at,
      days_since_last_update = excluded.days_since_last_update,
      stale_update = excluded.stale_update,
      buyer_ready_stage = excluded.buyer_ready_stage,
      buyer_ready_status = excluded.buyer_ready_status,
      buyer_ready_last_update = excluded.buyer_ready_last_update,
      buyer_ready_delayed = excluded.buyer_ready_delayed,
      buyer_ready_stale = excluded.buyer_ready_stale,
      completion_status = excluded.completion_status,
      completion_scheduled = excluded.completion_scheduled,
      completion_confirmed = excluded.completion_confirmed,
      operational_alerts = excluded.operational_alerts,
      needs_attention = excluded.needs_attention,
      next_recommended_action = excluded.next_recommended_action,
      computed_at = excluded.computed_at,
      summary_version = excluded.summary_version,
      derived_from_activity_at = excluded.derived_from_activity_at;
  end loop;
end;
$$;

revoke all on function public.upsert_operational_summaries_service(jsonb, jsonb) from public;
grant execute on function public.upsert_operational_summaries_service(jsonb, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- Extend authenticated upsert with new chain summary fields
-- ---------------------------------------------------------------------------

create or replace function public.upsert_operational_summaries(
  p_chain_summary jsonb,
  p_property_summaries jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_chain_id bigint;
  v_property jsonb;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  v_chain_id := (p_chain_summary->>'chain_id')::bigint;

  if v_chain_id is null then
    raise exception 'chain_id is required';
  end if;

  if not public.is_chain_operational_viewer(v_chain_id) then
    raise exception 'access denied';
  end if;

  insert into public.chain_operational_summary (
    chain_id,
    confidence_score,
    confidence_band,
    confidence_unavailable,
    data_coverage_status,
    coverage_label,
    estimated_completion_window,
    next_recalculation_at,
    confidence_algorithm_version,
    eta_algorithm_version,
    health_status,
    blocked_count,
    delay_count,
    stale_count,
    buyer_ready_stale,
    requires_replacement_buyer,
    computed_at,
    summary_version
  )
  values (
    v_chain_id,
    nullif(p_chain_summary->>'confidence_score', '')::integer,
    nullif(p_chain_summary->>'confidence_band', ''),
    coalesce((p_chain_summary->>'confidence_unavailable')::boolean, false),
    nullif(p_chain_summary->>'data_coverage_status', ''),
    nullif(p_chain_summary->>'coverage_label', ''),
    nullif(p_chain_summary->>'estimated_completion_window', ''),
    nullif(p_chain_summary->>'next_recalculation_at', '')::timestamptz,
    nullif(p_chain_summary->>'confidence_algorithm_version', ''),
    nullif(p_chain_summary->>'eta_algorithm_version', ''),
    p_chain_summary->>'health_status',
    coalesce((p_chain_summary->>'blocked_count')::integer, 0),
    coalesce((p_chain_summary->>'delay_count')::integer, 0),
    coalesce((p_chain_summary->>'stale_count')::integer, 0),
    coalesce((p_chain_summary->>'buyer_ready_stale')::boolean, false),
    coalesce((p_chain_summary->>'requires_replacement_buyer')::boolean, false),
    coalesce((p_chain_summary->>'computed_at')::timestamptz, now()),
    coalesce((p_chain_summary->>'summary_version')::integer, 2)
  )
  on conflict (chain_id) do update
  set
    confidence_score = excluded.confidence_score,
    confidence_band = excluded.confidence_band,
    confidence_unavailable = excluded.confidence_unavailable,
    data_coverage_status = excluded.data_coverage_status,
    coverage_label = excluded.coverage_label,
    estimated_completion_window = excluded.estimated_completion_window,
    next_recalculation_at = excluded.next_recalculation_at,
    confidence_algorithm_version = excluded.confidence_algorithm_version,
    eta_algorithm_version = excluded.eta_algorithm_version,
    health_status = excluded.health_status,
    blocked_count = excluded.blocked_count,
    delay_count = excluded.delay_count,
    stale_count = excluded.stale_count,
    buyer_ready_stale = excluded.buyer_ready_stale,
    requires_replacement_buyer = excluded.requires_replacement_buyer,
    computed_at = excluded.computed_at,
    summary_version = excluded.summary_version;

  for v_property in
    select value
    from jsonb_array_elements(p_property_summaries)
  loop
    if not exists (
      select 1
      from public.properties p
      where p.id = (v_property->>'property_id')::bigint
        and p.chain_id = v_chain_id
    ) then
      raise exception
        'property % does not belong to chain %',
        v_property->>'property_id',
        v_chain_id;
    end if;

    insert into public.property_operational_summary (
      property_id,
      chain_id,
      current_stage,
      property_status,
      last_update_at,
      days_since_last_update,
      stale_update,
      buyer_ready_stage,
      buyer_ready_status,
      buyer_ready_last_update,
      buyer_ready_delayed,
      buyer_ready_stale,
      completion_status,
      completion_scheduled,
      completion_confirmed,
      operational_alerts,
      needs_attention,
      next_recommended_action,
      computed_at,
      summary_version,
      derived_from_activity_at
    )
    values (
      (v_property->>'property_id')::bigint,
      v_chain_id,
      v_property->>'current_stage',
      v_property->>'property_status',
      nullif(v_property->>'last_update_at', '')::timestamptz,
      coalesce((v_property->>'days_since_last_update')::integer, 0),
      coalesce((v_property->>'stale_update')::boolean, false),
      nullif(v_property->>'buyer_ready_stage', ''),
      nullif(v_property->>'buyer_ready_status', ''),
      nullif(v_property->>'buyer_ready_last_update', '')::timestamptz,
      coalesce((v_property->>'buyer_ready_delayed')::boolean, false),
      coalesce((v_property->>'buyer_ready_stale')::boolean, false),
      nullif(v_property->>'completion_status', ''),
      coalesce((v_property->>'completion_scheduled')::boolean, false),
      coalesce((v_property->>'completion_confirmed')::boolean, false),
      coalesce(v_property->'operational_alerts', '[]'::jsonb),
      coalesce((v_property->>'needs_attention')::boolean, false),
      v_property->'next_recommended_action',
      coalesce((v_property->>'computed_at')::timestamptz, now()),
      coalesce((v_property->>'summary_version')::integer, 2),
      nullif(v_property->>'derived_from_activity_at', '')::timestamptz
    )
    on conflict (property_id) do update
    set
      chain_id = excluded.chain_id,
      current_stage = excluded.current_stage,
      property_status = excluded.property_status,
      last_update_at = excluded.last_update_at,
      days_since_last_update = excluded.days_since_last_update,
      stale_update = excluded.stale_update,
      buyer_ready_stage = excluded.buyer_ready_stage,
      buyer_ready_status = excluded.buyer_ready_status,
      buyer_ready_last_update = excluded.buyer_ready_last_update,
      buyer_ready_delayed = excluded.buyer_ready_delayed,
      buyer_ready_stale = excluded.buyer_ready_stale,
      completion_status = excluded.completion_status,
      completion_scheduled = excluded.completion_scheduled,
      completion_confirmed = excluded.completion_confirmed,
      operational_alerts = excluded.operational_alerts,
      needs_attention = excluded.needs_attention,
      next_recommended_action = excluded.next_recommended_action,
      computed_at = excluded.computed_at,
      summary_version = excluded.summary_version,
      derived_from_activity_at = excluded.derived_from_activity_at;
  end loop;
end;
$$;

-- Refresh dashboard view: append Chain Intelligence columns at end (preserve column order).
-- Must retain full definition from 20260712140000 — CREATE OR REPLACE cannot drop columns (42P16).

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
  latest_invitation.invitation_rejection_reason,
  nullif(trim(pcm.invite_email), '') as invite_email,
  latest_invitation.invitation_rejection_acknowledged_at,
  cos.confidence_band,
  cos.confidence_unavailable,
  cos.estimated_completion_window,
  cos.data_coverage_status,
  cos.coverage_label,
  cos.next_recalculation_at,
  cos.confidence_algorithm_version,
  cos.eta_algorithm_version
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

comment on view public.agent_branch_property_summaries is
  'Branch-scoped property assignment summaries with cached operational intelligence.';

revoke all on public.agent_branch_property_summaries from public;
revoke all on public.agent_branch_property_summaries from anon;
grant select on public.agent_branch_property_summaries to authenticated;
