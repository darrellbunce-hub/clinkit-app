-- EA dashboard "Last updated": the latest genuine operational activity,
-- derived from activity history when the dashboard is read.
--
-- 20261005150000 exposed property_operational_summary.last_update_at, a cache
-- computed by the refreshing client from every activity row (system notices
-- included) and paired with days_since_last_update = 0 for properties with no
-- activity at all. The view now derives both columns from public.activities
-- through is_genuine_property_activity, so summary recalculation, chain
-- intelligence, lifecycle processing, system notices and page loads cannot move
-- them. days_since_last_update is the Europe/London calendar-day difference and
-- is NULL when the property has no genuine activity.
--
-- Because the view now trusts activities."timestamp", end-user inserts can no
-- longer choose it.
--
-- No data is changed; no activity rows are created.

do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'agent_branch_property_summaries'
      and column_name = 'last_update_at'
  ) then
    raise exception 'dashboard_genuine_last_update aborted: 20261005150000 (last_update_at on agent_branch_property_summaries) is not applied';
  end if;

  if (
    select count(*)
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'activities'
      and column_name in ('property_id', 'timestamp', 'update', 'updated_by')
  ) <> 4 then
    raise exception 'dashboard_genuine_last_update aborted: activities columns differ from the expected shape';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'property_ea_assignments'
      and column_name = 'revoked_at'
  ) then
    raise exception 'dashboard_genuine_last_update aborted: property_ea_assignments.revoked_at is missing';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1) Genuine operational activity
-- ---------------------------------------------------------------------------

create or replace function public.is_genuine_property_activity(
  p_update text,
  p_updated_by text
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select
    coalesce(p_updated_by, '') <> 'system'
    and p_update is not null
    and (
      -- Homeowner / estate-agent operational property updates (structured stages).
      p_update = any (array[
        'Searching',
        'Next Home Search',
        'Property Listed',
        'Offer Accepted',
        'Solicitors Instructed',
        'Searches Ordered',
        'Survey Booked',
        'Searches Returned',
        'Survey Completed',
        'Mortgage Offer Received',
        'Enquiries Raised',
        'Enquiries Fully Answered',
        'Contracts Issued',
        'Ready To Exchange',
        'Contracts Exchanged',
        'Completion Date Agreed',
        'Completed',
        'Mortgage In Principle',
        'Mortgage Application',
        'Mortgage Application Submitted',
        'Solicitor Instructed',
        'Enquiries Reviewed',
        'Contracts Signed',
        'Exchange Contracts'
      ])
      -- Onward purchase added; user-initiated chain connection break.
      or p_update = any (array[
        'Onward purchase added',
        'Chain Connection Broken - Buyer Side',
        'Chain Connection Broken - Seller Side'
      ])
      -- Delay reported / resolved (current template and the legacy report text).
      or p_update like 'Delay reported %'
      or p_update like 'Delay resolved %'
      or p_update like 'Delay Reported: %'
      -- Completion date updated.
      or p_update like ('Completion date updated' || chr(10) || '%')
    );
$$;

comment on function public.is_genuine_property_activity(text, text) is
  'True for the agreed genuine operational activity types (operational stage updates, delay reported/resolved, onward purchase added, user-initiated chain connection break, completion date updated) when not written by the system. System notices (delink, release, lifecycle archive/release, EA reconnection) never count.';

revoke all on function public.is_genuine_property_activity(text, text) from public, anon;
grant execute on function public.is_genuine_property_activity(text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2) activities."timestamp" is set by the server for end-user writes
-- ---------------------------------------------------------------------------

create or replace function public._trg_activities_server_timestamp()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      new."timestamp" := now();
    else
      new."timestamp" := old."timestamp";
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public._trg_activities_server_timestamp() from public, anon, authenticated;

drop trigger if exists trg_activities_server_timestamp on public.activities;

create trigger trg_activities_server_timestamp
before insert or update of "timestamp" on public.activities
for each row
execute function public._trg_activities_server_timestamp();

-- ---------------------------------------------------------------------------
-- 3) Latest-activity lookup per property
-- ---------------------------------------------------------------------------

create index if not exists activities_property_id_timestamp_idx
  on public.activities (property_id, "timestamp" desc);

-- ---------------------------------------------------------------------------
-- 4) Dashboard view: 20261005150000 with last_update_at and
--    days_since_last_update derived from genuine activity
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
  case
    when genuine.last_update_at is null then null
    else greatest(
      0,
      (now() at time zone 'Europe/London')::date
        - (genuine.last_update_at at time zone 'Europe/London')::date
    )
  end as days_since_last_update,
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
  genuine.last_update_at
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
  -- A revoked branch sees activity only up to its revocation.
  select max(a."timestamp") as last_update_at
  from public.activities a
  where a.property_id = pea.property_id
    and public.is_genuine_property_activity(a.update, a.updated_by)
    and (
      pea.status = 'active'
      or pea.revoked_at is null
      or a."timestamp" <= pea.revoked_at
    )
) genuine on true
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
  'Branch-scoped property assignment summaries with cached operational intelligence. last_update_at is the latest genuine operational activity (is_genuine_property_activity), read from activity history; days_since_last_update is its Europe/London calendar-day age; both are NULL without genuine activity.';

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
    raise exception 'dashboard_genuine_last_update postflight: last_update_at not exposed';
  end if;

  if has_table_privilege('anon', 'public.agent_branch_property_summaries', 'select') then
    raise exception 'dashboard_genuine_last_update postflight: anon can read agent_branch_property_summaries';
  end if;

  if has_function_privilege('anon', 'public.is_genuine_property_activity(text, text)', 'execute') then
    raise exception 'dashboard_genuine_last_update postflight: anon can execute is_genuine_property_activity';
  end if;

  if public.is_genuine_property_activity('Estate agent branch reconnected to this property.', 'system')
    or public.is_genuine_property_activity('Solicitors Instructed', 'system')
    or not public.is_genuine_property_activity('Solicitors Instructed', 'homeowner') then
    raise exception 'dashboard_genuine_last_update postflight: is_genuine_property_activity classification check failed';
  end if;

  if not exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.activities'::regclass
      and tgname = 'trg_activities_server_timestamp'
      and not tgisinternal
  ) then
    raise exception 'dashboard_genuine_last_update postflight: trg_activities_server_timestamp missing';
  end if;
end;
$$;
