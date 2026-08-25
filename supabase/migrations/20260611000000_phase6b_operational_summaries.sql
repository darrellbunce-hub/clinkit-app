-- Phase 6B: Operational Summary Engine — cached derived summaries
--
-- TypeScript derives summaries; this migration persists them via RPC.
-- No workflow intelligence is duplicated in SQL.

-- ---------------------------------------------------------------------------
-- property_operational_summary
-- ---------------------------------------------------------------------------

create table if not exists public.property_operational_summary (
  property_id bigint primary key
    references public.properties(id) on delete cascade,
  chain_id bigint not null
    references public.chains(id) on delete cascade,
  current_stage text not null,
  property_status text not null,
  last_update_at timestamptz,
  days_since_last_update integer not null default 0,
  stale_update boolean not null default false,
  buyer_ready_stage text,
  buyer_ready_status text,
  buyer_ready_last_update timestamptz,
  buyer_ready_delayed boolean not null default false,
  buyer_ready_stale boolean not null default false,
  completion_status text,
  completion_scheduled boolean not null default false,
  completion_confirmed boolean not null default false,
  operational_alerts jsonb not null default '[]'::jsonb,
  needs_attention boolean not null default false,
  next_recommended_action jsonb,
  computed_at timestamptz not null default now(),
  summary_version integer not null default 1,
  derived_from_activity_at timestamptz
);

create index if not exists property_operational_summary_chain_id_idx
  on public.property_operational_summary(chain_id);

create index if not exists property_operational_summary_needs_attention_idx
  on public.property_operational_summary(needs_attention)
  where needs_attention;

comment on table public.property_operational_summary is
  'Cached derived operational summary for one property. Populated by upsert_operational_summaries RPC.';

-- ---------------------------------------------------------------------------
-- chain_operational_summary
-- ---------------------------------------------------------------------------

create table if not exists public.chain_operational_summary (
  chain_id bigint primary key
    references public.chains(id) on delete cascade,
  confidence_score integer not null,
  health_status text not null,
  blocked_count integer not null default 0,
  delay_count integer not null default 0,
  stale_count integer not null default 0,
  buyer_ready_stale boolean not null default false,
  requires_replacement_buyer boolean not null default false,
  computed_at timestamptz not null default now(),
  summary_version integer not null default 1
);

comment on table public.chain_operational_summary is
  'Cached derived operational summary for one chain. Populated by upsert_operational_summaries RPC.';

-- ---------------------------------------------------------------------------
-- RLS: read via operational viewer; writes only through RPC
-- ---------------------------------------------------------------------------

alter table public.property_operational_summary enable row level security;
alter table public.chain_operational_summary enable row level security;

drop policy if exists property_operational_summary_select
  on public.property_operational_summary;

create policy property_operational_summary_select
  on public.property_operational_summary
  for select
  to authenticated
  using (
    public.is_chain_operational_viewer(chain_id)
  );

drop policy if exists chain_operational_summary_select
  on public.chain_operational_summary;

create policy chain_operational_summary_select
  on public.chain_operational_summary
  for select
  to authenticated
  using (
    public.is_chain_operational_viewer(chain_id)
  );

revoke all on public.property_operational_summary from public;
revoke all on public.property_operational_summary from anon;
revoke all on public.chain_operational_summary from public;
revoke all on public.chain_operational_summary from anon;

grant select on public.property_operational_summary to authenticated;
grant select on public.chain_operational_summary to authenticated;

-- ---------------------------------------------------------------------------
-- RPC: upsert_operational_summaries
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
    (p_chain_summary->>'confidence_score')::integer,
    p_chain_summary->>'health_status',
    coalesce((p_chain_summary->>'blocked_count')::integer, 0),
    coalesce((p_chain_summary->>'delay_count')::integer, 0),
    coalesce((p_chain_summary->>'stale_count')::integer, 0),
    coalesce((p_chain_summary->>'buyer_ready_stale')::boolean, false),
    coalesce((p_chain_summary->>'requires_replacement_buyer')::boolean, false),
    coalesce((p_chain_summary->>'computed_at')::timestamptz, now()),
    coalesce((p_chain_summary->>'summary_version')::integer, 1)
  )
  on conflict (chain_id) do update
  set
    confidence_score = excluded.confidence_score,
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
      coalesce((v_property->>'summary_version')::integer, 1),
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

comment on function public.upsert_operational_summaries(jsonb, jsonb) is
  'Persists TypeScript-derived operational summaries for a chain and its properties.';

revoke all on function public.upsert_operational_summaries(jsonb, jsonb) from public;
grant execute on function public.upsert_operational_summaries(jsonb, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- agent_branch_property_summaries: join cached summaries for dashboard layer
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
  cos.health_status
from public.property_ea_assignments pea
inner join public.properties p
  on p.id = pea.property_id
inner join public.chains ch
  on ch.id = p.chain_id
left join public.property_operational_summary pos
  on pos.property_id = pea.property_id
left join public.chain_operational_summary cos
  on cos.chain_id = p.chain_id
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
