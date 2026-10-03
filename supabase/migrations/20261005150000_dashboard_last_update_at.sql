-- EA dashboard "Last updated": expose the genuine activity timestamp.
--
-- agent_branch_property_summaries exposed only property_operational_summary
-- .days_since_last_update, a whole-day count frozen at the moment the summary
-- was last recomputed. The dashboard now derives the day count from
-- last_update_at (latest property activity row, written by the summary
-- derivation), so a recalculation never moves "Last updated" and the count
-- stays correct between recalculations.
--
-- The view is 20260720100000 with pos.last_update_at appended (CREATE OR
-- REPLACE VIEW can only append columns). No data is changed; no activity rows
-- are created.

do $$
begin
  if to_regclass('public.agent_branch_property_summaries') is null then
    raise exception 'dashboard_last_update_at aborted: agent_branch_property_summaries is missing';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'property_operational_summary'
      and column_name = 'last_update_at'
  ) then
    raise exception 'dashboard_last_update_at aborted: property_operational_summary.last_update_at is missing';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'agent_branch_property_summaries'
      and column_name = 'eta_algorithm_version'
  ) then
    raise exception 'dashboard_last_update_at aborted: agent_branch_property_summaries differs from 20260720100000';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'agent_branch_property_summaries'
      and column_name = 'last_update_at'
  ) then
    raise exception 'dashboard_last_update_at aborted: last_update_at already exposed';
  end if;
end;
$$;

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
  cos.eta_algorithm_version,
  pos.last_update_at
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
  'Branch-scoped property assignment summaries with cached operational intelligence. last_update_at is the latest genuine property activity; days since it are derived at read time.';

revoke all on public.agent_branch_property_summaries from public;
revoke all on public.agent_branch_property_summaries from anon;
grant select on public.agent_branch_property_summaries to authenticated;

do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'agent_branch_property_summaries'
      and column_name = 'last_update_at'
  ) then
    raise exception 'dashboard_last_update_at postflight: last_update_at not exposed';
  end if;

  if has_table_privilege('anon', 'public.agent_branch_property_summaries', 'select') then
    raise exception 'dashboard_last_update_at postflight: anon can read agent_branch_property_summaries';
  end if;
end;
$$;
