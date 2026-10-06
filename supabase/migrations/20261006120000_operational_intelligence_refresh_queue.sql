-- Operational intelligence: calculate on change / when due, consume on read.
--
-- Meaningful operational changes queue the chain cheaply (no intelligence is
-- calculated inside a trigger). The service-role worker selects missing,
-- queued and time-due chains, loads their datasets in one set-based call,
-- derives the summaries in the application and persists them through
-- persist_chain_operational_refresh, which also clears the queue entry. The
-- EA Dashboard and the Chain view read the cached summaries.
--
-- Activity clock (one SQL definition, property_operational_clock):
--   1. latest genuine activity (is_genuine_property_activity)
--   2. otherwise properties.stage_entered_at
--   3. otherwise the earliest creation time of the property's own records
--      (membership, EA assignment, claim metadata, operational identity,
--      counterparty participation, lifecycle state)
--   4. otherwise chains.created_at
-- No activity is created or inferred; an untouched property ages from its
-- fallback time and can go stale. Buyer Ready nodes use the same rule with
-- chain_nodes.stage_entered_at and chain_nodes.created_at.
--
-- Freshness (operational_summary_state): missing (no summary), stale (queued,
-- summary_version below 3, or more than one daily worker cycle past
-- next_recalculation_at), otherwise fresh.
--
-- upsert_operational_summaries (authenticated) keeps its authorisation and
-- rate limit but no longer persists client-derived summaries: it queues the
-- chain for the worker. Revoking authenticated EXECUTE is a follow-up once no
-- deployed client calls it.
--
-- No summary rows are written by this migration.

do $$
begin
  if to_regprocedure('public.is_genuine_property_activity(text, text)') is null then
    raise exception 'operational_intelligence_refresh_queue aborted: is_genuine_property_activity is missing';
  end if;

  if to_regprocedure('public.is_chain_operational_viewer(bigint)') is null
    or to_regprocedure('public.can_operate_in_chain(bigint)') is null
    or to_regprocedure('public._rate_limit_try_consume(text, text, integer, integer)') is null then
    raise exception 'operational_intelligence_refresh_queue aborted: authorisation helpers are missing';
  end if;

  if to_regprocedure('public.upsert_operational_summaries_service(jsonb, jsonb)') is null
    or to_regprocedure('public.list_chain_intelligence_refresh_candidates(integer)') is null then
    raise exception 'operational_intelligence_refresh_queue aborted: worker functions are missing';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'agent_branch_property_summaries'
      and column_name = 'last_update_at'
  ) then
    raise exception 'operational_intelligence_refresh_queue aborted: 20261005170000 is not applied';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1) Summary columns
-- ---------------------------------------------------------------------------

alter table public.property_operational_summary
  add column if not exists activity_clock_at timestamptz,
  add column if not exists activity_clock_source text;

comment on column public.property_operational_summary.activity_clock_at is
  'Staleness clock at computation: latest genuine activity, else stage entry, else the property''s record creation, else chain creation.';
comment on column public.property_operational_summary.activity_clock_source is
  'genuine_activity, stage_entered_at, property_record_created or chain_created.';
comment on column public.property_operational_summary.last_update_at is
  'Latest genuine operational activity on this property (is_genuine_property_activity). NULL when there is none.';

alter table public.chain_operational_summary
  add column if not exists bottleneck_property_id bigint,
  add column if not exists stale_property_ids bigint[] not null default '{}'::bigint[];

comment on column public.chain_operational_summary.bottleneck_property_id is
  'Property holding the chain back at computation (blocked, then delayed, then longest without activity past 14 days).';
comment on column public.chain_operational_summary.stale_property_ids is
  'Properties past the 21-day activity clock at computation.';

-- ---------------------------------------------------------------------------
-- 2) Lookup indexes for chain-scoped work
-- ---------------------------------------------------------------------------

create index if not exists properties_chain_id_idx
  on public.properties (chain_id);

create index if not exists chain_nodes_chain_id_idx
  on public.chain_nodes (chain_id);

create index if not exists activities_chain_node_id_timestamp_idx
  on public.activities (chain_node_id, "timestamp" desc)
  where chain_node_id is not null;

-- ---------------------------------------------------------------------------
-- 3) Activity clocks
-- ---------------------------------------------------------------------------

create or replace view public.property_operational_clock_fallback
with (security_invoker = false)
as
select
  p.id as property_id,
  p.chain_id,
  coalesce(p.stage_entered_at, records.created_at, ch.created_at) as fallback_at,
  case
    when p.stage_entered_at is not null then 'stage_entered_at'
    when records.created_at is not null then 'property_record_created'
    when ch.created_at is not null then 'chain_created'
  end as fallback_source
from public.properties p
left join public.chains ch
  on ch.id = p.chain_id
left join lateral (
  select least(
    (select min(pm.created_at) from public.property_members pm where pm.property_id = p.id),
    (select min(pea.created_at) from public.property_ea_assignments pea where pea.property_id = p.id),
    (select pcm.created_at from public.property_claim_metadata pcm where pcm.property_id = p.id),
    (select poi.created_at from public.property_operational_identities poi where poi.property_id = p.id),
    (select min(pcp.created_at) from public.property_counterparty_participants pcp where pcp.property_id = p.id),
    (select pls.created_at from public.property_lifecycle_states pls where pls.property_id = p.id)
  ) as created_at
) records on true;

comment on view public.property_operational_clock_fallback is
  'Staleness clock start for a property without genuine activity: stage entry, else earliest record creation, else chain creation. Internal.';

create or replace view public.property_operational_clock
with (security_invoker = false)
as
select
  f.property_id,
  f.chain_id,
  genuine.last_activity_at as genuine_last_activity_at,
  coalesce(genuine.last_activity_at, f.fallback_at) as activity_clock_at,
  case
    when genuine.last_activity_at is not null then 'genuine_activity'
    else f.fallback_source
  end as activity_clock_source
from public.property_operational_clock_fallback f
left join lateral (
  select max(a."timestamp") as last_activity_at
  from public.activities a
  where a.property_id = f.property_id
    and public.is_genuine_property_activity(a.update, a.updated_by)
) genuine on true;

comment on view public.property_operational_clock is
  'Authoritative property activity clock: latest genuine activity, else the documented fallback. Internal.';

create or replace view public.chain_node_operational_clock
with (security_invoker = false)
as
select
  n.id as chain_node_id,
  n.chain_id,
  genuine.last_activity_at as genuine_last_activity_at,
  coalesce(genuine.last_activity_at, n.stage_entered_at, n.created_at) as activity_clock_at,
  case
    when genuine.last_activity_at is not null then 'genuine_activity'
    when n.stage_entered_at is not null then 'stage_entered_at'
    else 'node_created'
  end as activity_clock_source
from public.chain_nodes n
left join lateral (
  select max(a."timestamp") as last_activity_at
  from public.activities a
  where a.chain_node_id = n.id
    and public.is_genuine_property_activity(a.update, a.updated_by)
) genuine on true;

comment on view public.chain_node_operational_clock is
  'Buyer Ready node activity clock: latest genuine node activity, else stage entry, else node creation. Internal.';

revoke all on public.property_operational_clock_fallback from public, anon, authenticated;
revoke all on public.property_operational_clock from public, anon, authenticated;
revoke all on public.chain_node_operational_clock from public, anon, authenticated;
grant select on public.property_operational_clock_fallback to service_role;
grant select on public.property_operational_clock to service_role;
grant select on public.chain_node_operational_clock to service_role;

-- ---------------------------------------------------------------------------
-- 4) Refresh queue
-- ---------------------------------------------------------------------------

create table if not exists public.chain_operational_refresh_queue (
  chain_id bigint primary key,
  reason text not null,
  first_requested_at timestamptz not null default clock_timestamp(),
  last_requested_at timestamptz not null default clock_timestamp(),
  request_count integer not null default 1,
  attempt_count integer not null default 0,
  last_attempt_at timestamptz,
  last_error text
);

comment on table public.chain_operational_refresh_queue is
  'One row per chain awaiting an operational intelligence refresh. Written by cheap triggers; drained by the service-role worker. No intelligence is calculated here.';

alter table public.chain_operational_refresh_queue enable row level security;

revoke all on public.chain_operational_refresh_queue from public, anon, authenticated;
grant select, insert, update, delete on public.chain_operational_refresh_queue to service_role;

create index if not exists chain_operational_refresh_queue_first_requested_idx
  on public.chain_operational_refresh_queue (first_requested_at);

create or replace function public._enqueue_chain_operational_refresh(
  p_chain_ids bigint[],
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_chain_ids is null or cardinality(p_chain_ids) = 0 then
    return;
  end if;

  begin
    insert into public.chain_operational_refresh_queue as q (chain_id, reason)
    select ch.id, coalesce(p_reason, 'unspecified')
    from public.chains ch
    where ch.id = any (p_chain_ids)
      and ch.completed_at is null
    on conflict (chain_id) do update
    set
      last_requested_at = clock_timestamp(),
      reason = excluded.reason,
      request_count = q.request_count + 1;
  exception
    when others then
      -- Queueing must never block the operational write that triggered it.
      raise warning 'chain operational refresh enqueue failed: %', sqlerrm;
  end;
end;
$$;

alter function public._enqueue_chain_operational_refresh(bigint[], text) owner to postgres;
revoke all on function public._enqueue_chain_operational_refresh(bigint[], text) from public, anon, authenticated;
grant execute on function public._enqueue_chain_operational_refresh(bigint[], text) to service_role;

-- activities: genuine activity only (system notices never queue)

create or replace function public._trg_activities_enqueue_refresh_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_property_chains bigint[];
  v_node_chains bigint[];
begin
  select array_agg(distinct p.chain_id)
  into v_property_chains
  from new_rows r
  join public.properties p on p.id = r.property_id
  where r.property_id is not null
    and public.is_genuine_property_activity(r.update, r.updated_by);

  select array_agg(distinct n.chain_id)
  into v_node_chains
  from new_rows r
  join public.chain_nodes n on n.id = r.chain_node_id
  where r.chain_node_id is not null
    and public.is_genuine_property_activity(r.update, r.updated_by);

  perform public._enqueue_chain_operational_refresh(v_property_chains, 'genuine_activity');
  perform public._enqueue_chain_operational_refresh(v_node_chains, 'buyer_ready_activity');
  return null;
end;
$$;

create or replace function public._trg_activities_enqueue_refresh_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_chains bigint[];
begin
  select array_agg(distinct c.chain_id)
  into v_chains
  from (
    select p.chain_id
    from old_rows r
    join public.properties p on p.id = r.property_id
    where public.is_genuine_property_activity(r.update, r.updated_by)
    union
    select n.chain_id
    from old_rows r
    join public.chain_nodes n on n.id = r.chain_node_id
    where public.is_genuine_property_activity(r.update, r.updated_by)
  ) c;

  perform public._enqueue_chain_operational_refresh(v_chains, 'activity_removed');
  return null;
end;
$$;

-- properties

create or replace function public._trg_properties_enqueue_refresh_rows()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_chains bigint[];
begin
  if tg_op = 'INSERT' then
    select array_agg(distinct r.chain_id) into v_chains from new_rows r;
    perform public._enqueue_chain_operational_refresh(v_chains, 'property_added');
  else
    select array_agg(distinct r.chain_id) into v_chains from old_rows r;
    perform public._enqueue_chain_operational_refresh(v_chains, 'property_removed');
  end if;
  return null;
end;
$$;

create or replace function public._trg_properties_enqueue_refresh_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._enqueue_chain_operational_refresh(
    array_remove(array[new.chain_id, old.chain_id], null),
    'property_changed'
  );
  return null;
end;
$$;

-- chain_nodes (Buyer Ready)

create or replace function public._trg_chain_nodes_enqueue_refresh_rows()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_chains bigint[];
begin
  if tg_op = 'INSERT' then
    select array_agg(distinct r.chain_id) into v_chains from new_rows r;
  else
    select array_agg(distinct r.chain_id) into v_chains from old_rows r;
  end if;
  perform public._enqueue_chain_operational_refresh(v_chains, 'buyer_ready_changed');
  return null;
end;
$$;

create or replace function public._trg_chain_nodes_enqueue_refresh_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._enqueue_chain_operational_refresh(
    array_remove(array[new.chain_id, old.chain_id], null),
    'buyer_ready_changed'
  );
  return null;
end;
$$;

-- operational_delays

create or replace function public._trg_operational_delays_enqueue_refresh()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public._enqueue_chain_operational_refresh(array_remove(array[old.chain_id], null), 'operational_delay_changed');
  elsif tg_op = 'UPDATE' then
    perform public._enqueue_chain_operational_refresh(array_remove(array[new.chain_id, old.chain_id], null), 'operational_delay_changed');
  else
    perform public._enqueue_chain_operational_refresh(array_remove(array[new.chain_id], null), 'operational_delay_changed');
  end if;
  return null;
end;
$$;

-- chains: completion fields

create or replace function public._trg_chains_enqueue_refresh_completion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.completed_at is null then
    perform public._enqueue_chain_operational_refresh(array[new.id], 'completion_changed');
  end if;
  return null;
end;
$$;

-- property_ea_assignments

create or replace function public._trg_property_ea_assignments_enqueue_refresh()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_chains bigint[];
begin
  select array_agg(distinct p.chain_id)
  into v_chains
  from public.properties p
  where p.id = new.property_id;

  perform public._enqueue_chain_operational_refresh(v_chains, 'ea_assignment_changed');
  return null;
end;
$$;

-- property_members: membership changes

create or replace function public._trg_property_members_enqueue_refresh()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_chains bigint[];
begin
  if tg_op = 'INSERT' then
    select array_agg(distinct p.chain_id) into v_chains
    from new_rows r join public.properties p on p.id = r.property_id;
  else
    select array_agg(distinct p.chain_id) into v_chains
    from old_rows r join public.properties p on p.id = r.property_id;
  end if;
  perform public._enqueue_chain_operational_refresh(v_chains, 'membership_changed');
  return null;
end;
$$;

do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'public._trg_property_members_enqueue_refresh()',
    'public._trg_activities_enqueue_refresh_insert()',
    'public._trg_activities_enqueue_refresh_delete()',
    'public._trg_properties_enqueue_refresh_rows()',
    'public._trg_properties_enqueue_refresh_update()',
    'public._trg_chain_nodes_enqueue_refresh_rows()',
    'public._trg_chain_nodes_enqueue_refresh_update()',
    'public._trg_operational_delays_enqueue_refresh()',
    'public._trg_chains_enqueue_refresh_completion()',
    'public._trg_property_ea_assignments_enqueue_refresh()'
  ]
  loop
    execute format('alter function %s owner to postgres', v_fn);
    execute format('revoke all on function %s from public, anon, authenticated', v_fn);
  end loop;
end;
$$;

drop trigger if exists trg_activities_enqueue_refresh_insert on public.activities;
create trigger trg_activities_enqueue_refresh_insert
after insert on public.activities
referencing new table as new_rows
for each statement
execute function public._trg_activities_enqueue_refresh_insert();

drop trigger if exists trg_activities_enqueue_refresh_delete on public.activities;
create trigger trg_activities_enqueue_refresh_delete
after delete on public.activities
referencing old table as old_rows
for each statement
execute function public._trg_activities_enqueue_refresh_delete();

drop trigger if exists trg_properties_enqueue_refresh_insert on public.properties;
create trigger trg_properties_enqueue_refresh_insert
after insert on public.properties
referencing new table as new_rows
for each statement
execute function public._trg_properties_enqueue_refresh_rows();

drop trigger if exists trg_properties_enqueue_refresh_delete on public.properties;
create trigger trg_properties_enqueue_refresh_delete
after delete on public.properties
referencing old table as old_rows
for each statement
execute function public._trg_properties_enqueue_refresh_rows();

drop trigger if exists trg_properties_enqueue_refresh_update on public.properties;
create trigger trg_properties_enqueue_refresh_update
after update on public.properties
for each row
when (
  old.stage is distinct from new.stage
  or old.status is distinct from new.status
  or old.chain_id is distinct from new.chain_id
  or old.chain_position is distinct from new.chain_position
  or old.stage_entered_at is distinct from new.stage_entered_at
  or old.linked_property_id is distinct from new.linked_property_id
  or old.buyer_connected is distinct from new.buyer_connected
  or old.seller_connected is distinct from new.seller_connected
  or old.awaiting_buyer is distinct from new.awaiting_buyer
  or old.is_searching is distinct from new.is_searching
  or (old.address is null) is distinct from (new.address is null)
)
execute function public._trg_properties_enqueue_refresh_update();

drop trigger if exists trg_chain_nodes_enqueue_refresh_insert on public.chain_nodes;
create trigger trg_chain_nodes_enqueue_refresh_insert
after insert on public.chain_nodes
referencing new table as new_rows
for each statement
execute function public._trg_chain_nodes_enqueue_refresh_rows();

drop trigger if exists trg_chain_nodes_enqueue_refresh_delete on public.chain_nodes;
create trigger trg_chain_nodes_enqueue_refresh_delete
after delete on public.chain_nodes
referencing old table as old_rows
for each statement
execute function public._trg_chain_nodes_enqueue_refresh_rows();

drop trigger if exists trg_chain_nodes_enqueue_refresh_update on public.chain_nodes;
create trigger trg_chain_nodes_enqueue_refresh_update
after update on public.chain_nodes
for each row
when (
  old.stage is distinct from new.stage
  or old.status is distinct from new.status
  or old.progress is distinct from new.progress
  or old.stage_entered_at is distinct from new.stage_entered_at
  or old.linked_property_id is distinct from new.linked_property_id
  or old.chain_id is distinct from new.chain_id
)
execute function public._trg_chain_nodes_enqueue_refresh_update();

drop trigger if exists trg_operational_delays_enqueue_refresh on public.operational_delays;
create trigger trg_operational_delays_enqueue_refresh
after insert or delete or update of status, chain_id, property_id, chain_node_id
on public.operational_delays
for each row
execute function public._trg_operational_delays_enqueue_refresh();

drop trigger if exists trg_chains_enqueue_refresh_completion on public.chains;
create trigger trg_chains_enqueue_refresh_completion
after update of completion_lifecycle_status, completion_scheduled_date, completion_confirmed_at, completed_at
on public.chains
for each row
when (
  old.completion_lifecycle_status is distinct from new.completion_lifecycle_status
  or old.completion_scheduled_date is distinct from new.completion_scheduled_date
  or old.completion_confirmed_at is distinct from new.completion_confirmed_at
  or old.completed_at is distinct from new.completed_at
)
execute function public._trg_chains_enqueue_refresh_completion();

drop trigger if exists trg_property_members_enqueue_refresh_insert on public.property_members;
create trigger trg_property_members_enqueue_refresh_insert
after insert on public.property_members
referencing new table as new_rows
for each statement
execute function public._trg_property_members_enqueue_refresh();

drop trigger if exists trg_property_members_enqueue_refresh_delete on public.property_members;
create trigger trg_property_members_enqueue_refresh_delete
after delete on public.property_members
referencing old table as old_rows
for each statement
execute function public._trg_property_members_enqueue_refresh();

drop trigger if exists trg_property_ea_assignments_enqueue_refresh on public.property_ea_assignments;
create trigger trg_property_ea_assignments_enqueue_refresh
after insert or update of status
on public.property_ea_assignments
for each row
execute function public._trg_property_ea_assignments_enqueue_refresh();

-- ---------------------------------------------------------------------------
-- 5) Freshness
-- ---------------------------------------------------------------------------

create or replace function public.operational_summary_state(
  p_chain_summary_exists boolean,
  p_property_summary_exists boolean,
  p_refresh_queued boolean,
  p_next_recalculation_at timestamptz,
  p_summary_version integer
)
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when not coalesce(p_chain_summary_exists, false)
      or not coalesce(p_property_summary_exists, false) then 'missing'
    when coalesce(p_refresh_queued, false)
      or coalesce(p_summary_version, 0) < 3
      or p_next_recalculation_at is null
      or p_next_recalculation_at < now() - interval '26 hours' then 'stale'
    else 'fresh'
  end;
$$;

comment on function public.operational_summary_state(boolean, boolean, boolean, timestamptz, integer) is
  'missing: no cached summary. stale: refresh queued, summary_version below 3, or more than one daily worker cycle (26h) past next_recalculation_at. Otherwise fresh.';

revoke all on function public.operational_summary_state(boolean, boolean, boolean, timestamptz, integer) from public, anon;
grant execute on function public.operational_summary_state(boolean, boolean, boolean, timestamptz, integer) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6) Worker: work selection
-- ---------------------------------------------------------------------------

create or replace function public.list_chain_operational_refresh_work(
  p_limit integer default 200
)
returns table(chain_id bigint, reason text, priority integer)
language sql
stable
security definer
set search_path = public
as $$
  with relevant as (
    select ch.id
    from public.chains ch
    where ch.completed_at is null
      and coalesce(ch.completion_lifecycle_status, '') <> 'completed'
      and exists (select 1 from public.properties p where p.chain_id = ch.id)
      and not exists (
        select 1
        from public.chain_operational_refresh_queue q
        where q.chain_id = ch.id
          and q.last_attempt_at is not null
          and q.last_attempt_at > now() - interval '30 minutes'
      )
  ),
  ea_chains as (
    select distinct p.chain_id
    from public.property_ea_assignments pea
    join public.properties p on p.id = pea.property_id
    where pea.status = 'active'
  ),
  candidates as (
    select r.id as chain_id, 'missing_summary_ea'::text as reason, 1 as priority, null::timestamptz as sort_at
    from relevant r
    where exists (select 1 from ea_chains e where e.chain_id = r.id)
      and not exists (select 1 from public.chain_operational_summary cos where cos.chain_id = r.id)

    union all

    select q.chain_id, 'queued:' || q.reason, 2, q.first_requested_at
    from public.chain_operational_refresh_queue q
    join relevant r on r.id = q.chain_id

    union all

    select cos.chain_id,
      case when coalesce(cos.summary_version, 0) < 3 then 'summary_version' else 'time_due' end,
      3,
      cos.next_recalculation_at
    from public.chain_operational_summary cos
    join relevant r on r.id = cos.chain_id
    where cos.next_recalculation_at is null
      or cos.next_recalculation_at <= now()
      or coalesce(cos.summary_version, 0) < 3

    union all

    select r.id, 'missing_summary', 4, null::timestamptz
    from relevant r
    where not exists (select 1 from ea_chains e where e.chain_id = r.id)
      and not exists (select 1 from public.chain_operational_summary cos where cos.chain_id = r.id)
  ),
  ranked as (
    select distinct on (c.chain_id) c.chain_id, c.reason, c.priority, c.sort_at
    from candidates c
    order by c.chain_id, c.priority, c.sort_at nulls first
  )
  select ranked.chain_id, ranked.reason, ranked.priority
  from ranked
  order by ranked.priority, ranked.sort_at nulls first, ranked.chain_id
  limit greatest(1, least(coalesce(p_limit, 200), 500));
$$;

comment on function public.list_chain_operational_refresh_work(integer) is
  'Worker candidates in priority order: missing summaries for active EA chains, queued refreshes, time-due or outdated summaries, missing summaries for other active chains. Completed chains and chains without properties are excluded; chains that failed in the last 30 minutes are skipped.';

alter function public.list_chain_operational_refresh_work(integer) owner to postgres;
revoke all on function public.list_chain_operational_refresh_work(integer) from public, anon, authenticated;
grant execute on function public.list_chain_operational_refresh_work(integer) to service_role;

-- Kept for deployed callers; delegates to the work list.
create or replace function public.list_chain_intelligence_refresh_candidates(
  p_limit integer default 200
)
returns table(chain_id bigint)
language sql
stable
security definer
set search_path = public
as $$
  select w.chain_id
  from public.list_chain_operational_refresh_work(p_limit) w;
$$;

revoke all on function public.list_chain_intelligence_refresh_candidates(integer) from public, anon, authenticated;
grant execute on function public.list_chain_intelligence_refresh_candidates(integer) to service_role;

-- ---------------------------------------------------------------------------
-- 7) Worker: set-based dataset load
-- ---------------------------------------------------------------------------

create or replace function public.load_operational_refresh_datasets(
  p_chain_ids bigint[]
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'loaded_at', now(),
    'chains', coalesce(jsonb_agg(
      jsonb_build_object(
        'chain', jsonb_build_object(
          'id', ch.id,
          'completionLifecycleStatus', ch.completion_lifecycle_status,
          'completionScheduledDate', ch.completion_scheduled_date,
          'completionConfirmedAt', ch.completion_confirmed_at,
          'completedAt', ch.completed_at
        ),
        'properties', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'id', p.id,
              'chainId', p.chain_id,
              'chainPosition', p.chain_position,
              'stage', p.stage,
              'status', p.status,
              'address', p.address,
              'stageEnteredAt', p.stage_entered_at,
              'hasActiveOperationalDelay', exists (
                select 1 from public.operational_delays d
                where d.property_id = p.id and d.status = 'active'
              ),
              'genuineLastActivityAt', clk.genuine_last_activity_at,
              'activityClockAt', clk.activity_clock_at,
              'activityClockSource', clk.activity_clock_source,
              'activities', coalesce((
                select jsonb_agg(
                  jsonb_build_object(
                    'id', a.id,
                    'timestamp', a."timestamp",
                    'update', a.update,
                    'updated_by', a.updated_by
                  )
                  order by a."timestamp" desc, a.id desc
                )
                from public.activities a
                where a.property_id = p.id
              ), '[]'::jsonb)
            )
            order by p.chain_position, p.id
          )
          from public.properties p
          left join public.property_operational_clock clk on clk.property_id = p.id
          where p.chain_id = ch.id
        ), '[]'::jsonb),
        'chainNodes', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'id', n.id,
              'chain_id', n.chain_id,
              'node_type', n.node_type,
              'linked_property_id', n.linked_property_id,
              'stage', n.stage,
              'status', n.status,
              'progress', n.progress,
              'stageEnteredAt', n.stage_entered_at,
              'hasActiveOperationalDelay', exists (
                select 1 from public.operational_delays d
                where d.chain_node_id = n.id and d.status = 'active'
              ),
              'genuineLastActivityAt', nclk.genuine_last_activity_at,
              'activityClockAt', nclk.activity_clock_at,
              'activityClockSource', nclk.activity_clock_source,
              'activities', coalesce((
                select jsonb_agg(
                  jsonb_build_object(
                    'id', a.id,
                    'timestamp', a."timestamp",
                    'update', a.update,
                    'updated_by', a.updated_by
                  )
                  order by a."timestamp" desc, a.id desc
                )
                from public.activities a
                where a.chain_node_id = n.id
              ), '[]'::jsonb)
            )
            order by n.position nulls last, n.id
          )
          from public.chain_nodes n
          left join public.chain_node_operational_clock nclk on nclk.chain_node_id = n.id
          where n.chain_id = ch.id
        ), '[]'::jsonb)
      )
    ), '[]'::jsonb)
  )
  from public.chains ch
  where ch.id = any (coalesce(p_chain_ids, '{}'::bigint[]));
$$;

comment on function public.load_operational_refresh_datasets(bigint[]) is
  'Worker dataset for a batch of chains in one call: chain completion fields, properties and Buyer Ready nodes with activities, activity clocks and active delay flags.';

alter function public.load_operational_refresh_datasets(bigint[]) owner to postgres;
revoke all on function public.load_operational_refresh_datasets(bigint[]) from public, anon, authenticated;
grant execute on function public.load_operational_refresh_datasets(bigint[]) to service_role;

-- ---------------------------------------------------------------------------
-- 8) Worker: persistence
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
    summary_version,
    bottleneck_property_id,
    stale_property_ids
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
    coalesce((p_chain_summary->>'summary_version')::integer, 2),
    nullif(p_chain_summary->>'bottleneck_property_id', '')::bigint,
    coalesce(
      (
        select array_agg(value::bigint order by ordinality)
        from jsonb_array_elements_text(
          case
            when jsonb_typeof(p_chain_summary->'stale_property_ids') = 'array'
              then p_chain_summary->'stale_property_ids'
            else '[]'::jsonb
          end
        ) with ordinality
      ),
      '{}'::bigint[]
    )
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
    summary_version = excluded.summary_version,
    bottleneck_property_id = excluded.bottleneck_property_id,
    stale_property_ids = excluded.stale_property_ids;

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
      derived_from_activity_at,
      activity_clock_at,
      activity_clock_source
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
      nullif(v_property->>'derived_from_activity_at', '')::timestamptz,
      nullif(v_property->>'activity_clock_at', '')::timestamptz,
      nullif(v_property->>'activity_clock_source', '')
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
      derived_from_activity_at = excluded.derived_from_activity_at,
      activity_clock_at = excluded.activity_clock_at,
      activity_clock_source = excluded.activity_clock_source;
  end loop;
end;
$$;

revoke all on function public.upsert_operational_summaries_service(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.upsert_operational_summaries_service(jsonb, jsonb) to service_role;

create or replace function public.persist_chain_operational_refresh(
  p_chain_summary jsonb,
  p_property_summaries jsonb,
  p_snapshot_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_chain_id bigint := (p_chain_summary->>'chain_id')::bigint;
begin
  if p_snapshot_at is null then
    raise exception 'snapshot time is required';
  end if;

  perform public.upsert_operational_summaries_service(p_chain_summary, p_property_summaries);

  -- Requests made after the dataset snapshot stay queued.
  delete from public.chain_operational_refresh_queue q
  where q.chain_id = v_chain_id
    and q.last_requested_at <= p_snapshot_at;

  update public.chain_operational_refresh_queue q
  set attempt_count = 0, last_attempt_at = null, last_error = null
  where q.chain_id = v_chain_id;
end;
$$;

comment on function public.persist_chain_operational_refresh(jsonb, jsonb, timestamptz) is
  'Worker persistence: upserts the chain and property summaries and clears queue requests made before the dataset snapshot.';

alter function public.persist_chain_operational_refresh(jsonb, jsonb, timestamptz) owner to postgres;
revoke all on function public.persist_chain_operational_refresh(jsonb, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.persist_chain_operational_refresh(jsonb, jsonb, timestamptz) to service_role;

create or replace function public.record_chain_operational_refresh_failure(
  p_chain_id bigint,
  p_error text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_chain_id is null then
    return;
  end if;

  insert into public.chain_operational_refresh_queue as q (
    chain_id, reason, attempt_count, last_attempt_at, last_error
  )
  values (p_chain_id, 'retry', 1, now(), left(coalesce(p_error, 'unknown'), 500))
  on conflict (chain_id) do update
  set
    attempt_count = q.attempt_count + 1,
    last_attempt_at = now(),
    last_error = left(coalesce(p_error, 'unknown'), 500);
end;
$$;

alter function public.record_chain_operational_refresh_failure(bigint, text) owner to postgres;
revoke all on function public.record_chain_operational_refresh_failure(bigint, text) from public, anon, authenticated;
grant execute on function public.record_chain_operational_refresh_failure(bigint, text) to service_role;

create or replace function public.persist_chain_operational_refreshes(
  p_items jsonb,
  p_snapshot_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item jsonb;
  v_chain_id bigint;
  v_persisted integer := 0;
  v_failures jsonb := '[]'::jsonb;
begin
  for v_item in
    select value
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    v_chain_id := (v_item->'chain_summary'->>'chain_id')::bigint;

    begin
      perform public.persist_chain_operational_refresh(
        v_item->'chain_summary',
        coalesce(v_item->'property_summaries', '[]'::jsonb),
        p_snapshot_at
      );
      v_persisted := v_persisted + 1;
    exception
      when others then
        perform public.record_chain_operational_refresh_failure(v_chain_id, sqlerrm);
        v_failures := v_failures || jsonb_build_array(
          jsonb_build_object('chain_id', v_chain_id, 'error', left(sqlerrm, 500))
        );
    end;
  end loop;

  return jsonb_build_object('persisted', v_persisted, 'failures', v_failures);
end;
$$;

comment on function public.persist_chain_operational_refreshes(jsonb, timestamptz) is
  'Worker batch persistence: persist_chain_operational_refresh per item; a failing chain is recorded for retry without affecting the rest of the batch.';

alter function public.persist_chain_operational_refreshes(jsonb, timestamptz) owner to postgres;
revoke all on function public.persist_chain_operational_refreshes(jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.persist_chain_operational_refreshes(jsonb, timestamptz) to service_role;

create or replace function public.purge_chain_operational_refresh_queue()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  delete from public.chain_operational_refresh_queue q
  where not exists (
    select 1
    from public.chains ch
    where ch.id = q.chain_id
      and ch.completed_at is null
      and coalesce(ch.completion_lifecycle_status, '') <> 'completed'
      and exists (select 1 from public.properties p where p.chain_id = ch.id)
  );
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

alter function public.purge_chain_operational_refresh_queue() owner to postgres;
revoke all on function public.purge_chain_operational_refresh_queue() from public, anon, authenticated;
grant execute on function public.purge_chain_operational_refresh_queue() to service_role;

-- ---------------------------------------------------------------------------
-- 9) Authenticated summary writes queue instead of persisting
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
  v_subject text;
  c_scope constant text := 'upsert_operational_summaries';
  c_limit constant integer := 60;
  c_window constant integer := 900;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  v_chain_id := (p_chain_summary->>'chain_id')::bigint;

  if v_chain_id is null then
    raise exception 'chain_id is required';
  end if;

  if not public.can_operate_in_chain(v_chain_id) then
    raise exception 'access denied';
  end if;

  v_subject := auth.uid()::text || ':' || v_chain_id::text;

  if not public._rate_limit_try_consume(
    c_scope,
    v_subject,
    c_limit,
    c_window
  ) then
    raise exception 'rate_limited';
  end if;

  -- Client-derived summaries are not persisted; the worker recalculates.
  perform public._enqueue_chain_operational_refresh(array[v_chain_id], 'client_refresh_request');
end;
$$;

comment on function public.upsert_operational_summaries(jsonb, jsonb) is
  'Compatibility entry point for clients deployed before the refresh queue. Authorised by can_operate_in_chain and rate limited; queues the chain for the service-role worker and ignores the supplied summaries.';

revoke all on function public.upsert_operational_summaries(jsonb, jsonb) from public, anon;
grant execute on function public.upsert_operational_summaries(jsonb, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 10) Chain view read
-- ---------------------------------------------------------------------------

create or replace function public.get_chain_operational_intelligence(
  p_chain_id bigint
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  if auth.uid() is null
    or p_chain_id is null
    or not public.is_chain_operational_viewer(p_chain_id) then
    return null;
  end if;

  select jsonb_build_object(
    'chain_id', p_chain_id,
    'summary_state', public.operational_summary_state(
      cos.chain_id is not null,
      true,
      exists (select 1 from public.chain_operational_refresh_queue q where q.chain_id = p_chain_id),
      cos.next_recalculation_at,
      cos.summary_version
    ),
    'computed_at', cos.computed_at,
    'summary_version', cos.summary_version,
    'health_status', cos.health_status,
    'confidence_score', cos.confidence_score,
    'confidence_band', cos.confidence_band,
    'confidence_unavailable', coalesce(cos.confidence_unavailable, false),
    'data_coverage_status', cos.data_coverage_status,
    'coverage_label', cos.coverage_label,
    'estimated_completion_window', cos.estimated_completion_window,
    'next_recalculation_at', cos.next_recalculation_at,
    'blocked_count', coalesce(cos.blocked_count, 0),
    'delay_count', coalesce(cos.delay_count, 0),
    'stale_count', coalesce(cos.stale_count, 0),
    'buyer_ready_stale', coalesce(cos.buyer_ready_stale, false),
    'requires_replacement_buyer', coalesce(cos.requires_replacement_buyer, false),
    'bottleneck_property_id', cos.bottleneck_property_id,
    'stale_property_ids', to_jsonb(coalesce(cos.stale_property_ids, '{}'::bigint[])),
    'property_clocks', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'property_id', pos.property_id,
          'activity_clock_at', pos.activity_clock_at
        )
        order by pos.property_id
      )
      from public.property_operational_summary pos
      where pos.chain_id = p_chain_id
        and (
          pos.property_id = cos.bottleneck_property_id
          or pos.property_id = any (coalesce(cos.stale_property_ids, '{}'::bigint[]))
        )
    ), '[]'::jsonb)
  )
  into v_result
  from (select 1) anchor
  left join public.chain_operational_summary cos
    on cos.chain_id = p_chain_id;

  return v_result;
end;
$$;

comment on function public.get_chain_operational_intelligence(bigint) is
  'Cached chain intelligence for an operational viewer of the chain (is_chain_operational_viewer): health, confidence, ETA window, delay/stale counts, bottleneck and stale property clocks, and freshness. Returns NULL for non-viewers.';

alter function public.get_chain_operational_intelligence(bigint) owner to postgres;
revoke all on function public.get_chain_operational_intelligence(bigint) from public, anon;
grant execute on function public.get_chain_operational_intelligence(bigint) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 11) Dashboard view: 20261005170000 with freshness and activity clock
--     appended
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
  genuine.last_update_at,
  public.operational_summary_state(
    cos.chain_id is not null,
    pos.property_id is not null,
    refresh_queue.chain_id is not null,
    cos.next_recalculation_at,
    least(cos.summary_version, pos.summary_version)
  ) as summary_state,
  cos.computed_at as summary_computed_at,
  coalesce(genuine.last_update_at, clock_fallback.fallback_at) as activity_clock_at,
  case
    when genuine.last_update_at is not null then 'genuine_activity'
    else clock_fallback.fallback_source
  end as activity_clock_source
from public.property_ea_assignments pea
inner join public.properties p
  on p.id = pea.property_id
inner join public.chains ch
  on ch.id = p.chain_id
left join public.property_operational_summary pos
  on pos.property_id = pea.property_id
left join public.chain_operational_summary cos
  on cos.chain_id = p.chain_id
left join public.chain_operational_refresh_queue refresh_queue
  on refresh_queue.chain_id = p.chain_id
left join public.property_operational_clock_fallback clock_fallback
  on clock_fallback.property_id = pea.property_id
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
  'Branch-scoped property assignment summaries with cached operational intelligence. last_update_at is the latest genuine operational activity (is_genuine_property_activity); days_since_last_update is its Europe/London calendar-day age; both are NULL without genuine activity. summary_state is missing, stale or fresh (operational_summary_state). activity_clock_at is the live staleness clock: genuine activity, else the documented fallback.';

revoke all on public.agent_branch_property_summaries from public;
revoke all on public.agent_branch_property_summaries from anon;
grant select on public.agent_branch_property_summaries to authenticated;

-- ---------------------------------------------------------------------------
-- 12) Postflight
-- ---------------------------------------------------------------------------

do $$
declare
  v_fn text;
  v_tg text;
begin
  foreach v_fn in array array[
    'public._enqueue_chain_operational_refresh(bigint[], text)',
    'public.list_chain_operational_refresh_work(integer)',
    'public.list_chain_intelligence_refresh_candidates(integer)',
    'public.load_operational_refresh_datasets(bigint[])',
    'public.upsert_operational_summaries_service(jsonb, jsonb)',
    'public.persist_chain_operational_refresh(jsonb, jsonb, timestamptz)',
    'public.persist_chain_operational_refreshes(jsonb, timestamptz)',
    'public.record_chain_operational_refresh_failure(bigint, text)',
    'public.purge_chain_operational_refresh_queue()',
    'public._trg_activities_enqueue_refresh_insert()',
    'public._trg_activities_enqueue_refresh_delete()',
    'public._trg_properties_enqueue_refresh_rows()',
    'public._trg_properties_enqueue_refresh_update()',
    'public._trg_chain_nodes_enqueue_refresh_rows()',
    'public._trg_chain_nodes_enqueue_refresh_update()',
    'public._trg_operational_delays_enqueue_refresh()',
    'public._trg_chains_enqueue_refresh_completion()',
    'public._trg_property_ea_assignments_enqueue_refresh()',
    'public._trg_property_members_enqueue_refresh()'
  ]
  loop
    if has_function_privilege('anon', v_fn, 'execute')
      or has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception 'operational_intelligence_refresh_queue postflight: % is executable by anon/authenticated', v_fn;
    end if;
  end loop;

  if has_function_privilege('anon', 'public.get_chain_operational_intelligence(bigint)', 'execute')
    or not has_function_privilege('authenticated', 'public.get_chain_operational_intelligence(bigint)', 'execute') then
    raise exception 'operational_intelligence_refresh_queue postflight: get_chain_operational_intelligence grants are wrong';
  end if;

  if has_function_privilege('anon', 'public.upsert_operational_summaries(jsonb, jsonb)', 'execute')
    or not has_function_privilege('authenticated', 'public.upsert_operational_summaries(jsonb, jsonb)', 'execute') then
    raise exception 'operational_intelligence_refresh_queue postflight: upsert_operational_summaries grants changed';
  end if;

  if position('_rate_limit_try_consume' in pg_get_functiondef('public.upsert_operational_summaries(jsonb, jsonb)'::regprocedure)) = 0
    or position('can_operate_in_chain' in pg_get_functiondef('public.upsert_operational_summaries(jsonb, jsonb)'::regprocedure)) = 0
    or position('insert into public.chain_operational_summary' in pg_get_functiondef('public.upsert_operational_summaries(jsonb, jsonb)'::regprocedure)) > 0 then
    raise exception 'operational_intelligence_refresh_queue postflight: upsert_operational_summaries must authorise, rate limit and not persist';
  end if;

  if has_table_privilege('anon', 'public.chain_operational_refresh_queue', 'select')
    or has_table_privilege('authenticated', 'public.chain_operational_refresh_queue', 'select')
    or has_table_privilege('authenticated', 'public.chain_operational_refresh_queue', 'insert')
    or has_table_privilege('anon', 'public.property_operational_clock', 'select')
    or has_table_privilege('authenticated', 'public.property_operational_clock', 'select')
    or has_table_privilege('authenticated', 'public.property_operational_clock_fallback', 'select')
    or has_table_privilege('authenticated', 'public.chain_node_operational_clock', 'select') then
    raise exception 'operational_intelligence_refresh_queue postflight: internal relations are readable by end users';
  end if;

  if not (select relrowsecurity from pg_class where oid = 'public.chain_operational_refresh_queue'::regclass) then
    raise exception 'operational_intelligence_refresh_queue postflight: queue RLS is disabled';
  end if;

  if has_table_privilege('anon', 'public.agent_branch_property_summaries', 'select') then
    raise exception 'operational_intelligence_refresh_queue postflight: anon can read agent_branch_property_summaries';
  end if;

  if (
    select count(*)
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'agent_branch_property_summaries'
      and column_name in ('summary_state', 'summary_computed_at', 'activity_clock_at', 'activity_clock_source', 'last_update_at')
  ) <> 5 then
    raise exception 'operational_intelligence_refresh_queue postflight: dashboard columns missing';
  end if;

  foreach v_tg in array array[
    'activities:trg_activities_enqueue_refresh_insert',
    'activities:trg_activities_enqueue_refresh_delete',
    'properties:trg_properties_enqueue_refresh_insert',
    'properties:trg_properties_enqueue_refresh_delete',
    'properties:trg_properties_enqueue_refresh_update',
    'chain_nodes:trg_chain_nodes_enqueue_refresh_insert',
    'chain_nodes:trg_chain_nodes_enqueue_refresh_delete',
    'chain_nodes:trg_chain_nodes_enqueue_refresh_update',
    'operational_delays:trg_operational_delays_enqueue_refresh',
    'chains:trg_chains_enqueue_refresh_completion',
    'property_ea_assignments:trg_property_ea_assignments_enqueue_refresh',
    'property_members:trg_property_members_enqueue_refresh_insert',
    'property_members:trg_property_members_enqueue_refresh_delete'
  ]
  loop
    if not exists (
      select 1
      from pg_trigger t
      where t.tgrelid = ('public.' || split_part(v_tg, ':', 1))::regclass
        and t.tgname = split_part(v_tg, ':', 2)
        and not t.tgisinternal
    ) then
      raise exception 'operational_intelligence_refresh_queue postflight: trigger % missing', v_tg;
    end if;
  end loop;

  if public.operational_summary_state(false, true, false, now() + interval '1 day', 3) <> 'missing'
    or public.operational_summary_state(true, false, false, now() + interval '1 day', 3) <> 'missing'
    or public.operational_summary_state(true, true, true, now() + interval '1 day', 3) <> 'stale'
    or public.operational_summary_state(true, true, false, now() + interval '1 day', 2) <> 'stale'
    or public.operational_summary_state(true, true, false, now() - interval '27 hours', 3) <> 'stale'
    or public.operational_summary_state(true, true, false, now() - interval '1 hour', 3) <> 'fresh' then
    raise exception 'operational_intelligence_refresh_queue postflight: operational_summary_state classification failed';
  end if;
end;
$$;
