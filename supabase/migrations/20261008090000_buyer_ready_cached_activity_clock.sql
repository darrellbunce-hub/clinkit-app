-- Buyer Ready activity clock on the cached chain operational summary.
--
-- The worker already loads each Buyer Ready node's clock from
-- chain_node_operational_clock: latest genuine node activity, else the node's
-- stage_entered_at, else the node's created_at. The clock of the chain's
-- primary Buyer Ready node is now persisted on chain_operational_summary so the
-- Buyer Ready page reads it under the existing chain_operational_summary_select
-- policy (is_chain_operational_viewer) instead of ageing the newest loaded
-- activity.
--
-- Only upsert_operational_summaries_service (service_role only) changes: it
-- persists the three new columns and checks the node belongs to the chain.
-- No policy, grant or view changes. Existing summaries keep NULL until the
-- worker recalculates them.

do $$
begin
  if to_regprocedure('public.upsert_operational_summaries_service(jsonb, jsonb)') is null
    or to_regprocedure('public.persist_chain_operational_refresh(jsonb, jsonb, timestamptz)') is null
    or to_regclass('public.chain_node_operational_clock') is null then
    raise exception 'buyer_ready_cached_activity_clock aborted: 20261006120000 is not applied';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'chain_operational_summary'
      and column_name = 'stale_property_ids'
  ) then
    raise exception 'buyer_ready_cached_activity_clock aborted: chain_operational_summary.stale_property_ids is missing';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1) Summary columns
-- ---------------------------------------------------------------------------

alter table public.chain_operational_summary
  add column if not exists buyer_ready_node_id bigint,
  add column if not exists buyer_ready_activity_clock_at timestamptz,
  add column if not exists buyer_ready_activity_clock_source text;

comment on column public.chain_operational_summary.buyer_ready_node_id is
  'Buyer Ready node the buyer_ready_activity_clock_* columns were computed for. NULL when the chain has no Buyer Ready node.';
comment on column public.chain_operational_summary.buyer_ready_activity_clock_at is
  'Buyer Ready node staleness clock at computation (chain_node_operational_clock): latest genuine node activity, else node stage entry, else node creation. Not a Last updated time.';
comment on column public.chain_operational_summary.buyer_ready_activity_clock_source is
  'genuine_activity, stage_entered_at or node_created.';

-- ---------------------------------------------------------------------------
-- 2) Worker persistence (20261006120000 definition plus the Buyer Ready clock)
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
  v_buyer_ready_node_id bigint;
begin
  v_chain_id := (p_chain_summary->>'chain_id')::bigint;

  if v_chain_id is null then
    raise exception 'chain_id is required';
  end if;

  v_buyer_ready_node_id := nullif(p_chain_summary->>'buyer_ready_node_id', '')::bigint;

  if v_buyer_ready_node_id is not null and not exists (
    select 1
    from public.chain_nodes n
    where n.id = v_buyer_ready_node_id
      and n.chain_id = v_chain_id
      and n.node_type = 'buyer_ready'
  ) then
    raise exception
      'buyer ready node % does not belong to chain %',
      v_buyer_ready_node_id,
      v_chain_id;
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
    stale_property_ids,
    buyer_ready_node_id,
    buyer_ready_activity_clock_at,
    buyer_ready_activity_clock_source
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
    ),
    v_buyer_ready_node_id,
    nullif(p_chain_summary->>'buyer_ready_activity_clock_at', '')::timestamptz,
    nullif(p_chain_summary->>'buyer_ready_activity_clock_source', '')
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
    stale_property_ids = excluded.stale_property_ids,
    buyer_ready_node_id = excluded.buyer_ready_node_id,
    buyer_ready_activity_clock_at = excluded.buyer_ready_activity_clock_at,
    buyer_ready_activity_clock_source = excluded.buyer_ready_activity_clock_source;

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

-- ---------------------------------------------------------------------------
-- 3) Postflight
-- ---------------------------------------------------------------------------

do $$
begin
  if has_function_privilege('anon', 'public.upsert_operational_summaries_service(jsonb, jsonb)', 'execute')
    or has_function_privilege('authenticated', 'public.upsert_operational_summaries_service(jsonb, jsonb)', 'execute')
    or not has_function_privilege('service_role', 'public.upsert_operational_summaries_service(jsonb, jsonb)', 'execute') then
    raise exception 'buyer_ready_cached_activity_clock postflight: upsert_operational_summaries_service grants are wrong';
  end if;

  if position('buyer_ready_activity_clock_at' in pg_get_functiondef('public.upsert_operational_summaries_service(jsonb, jsonb)'::regprocedure)) = 0 then
    raise exception 'buyer_ready_cached_activity_clock postflight: Buyer Ready clock is not persisted';
  end if;

  if (
    select count(*)
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'chain_operational_summary'
      and column_name in ('buyer_ready_node_id', 'buyer_ready_activity_clock_at', 'buyer_ready_activity_clock_source')
  ) <> 3 then
    raise exception 'buyer_ready_cached_activity_clock postflight: Buyer Ready clock columns missing';
  end if;

  if not (select relrowsecurity from pg_class where oid = 'public.chain_operational_summary'::regclass)
    or not exists (
      select 1
      from pg_policies
      where schemaname = 'public'
        and tablename = 'chain_operational_summary'
        and policyname = 'chain_operational_summary_select'
        and cmd = 'SELECT'
        and qual like '%is_chain_operational_viewer%'
    ) then
    raise exception 'buyer_ready_cached_activity_clock postflight: chain_operational_summary RLS changed';
  end if;

  if has_table_privilege('anon', 'public.chain_operational_summary', 'select')
    or not has_table_privilege('authenticated', 'public.chain_operational_summary', 'select')
    or has_table_privilege('anon', 'public.chain_node_operational_clock', 'select')
    or has_table_privilege('authenticated', 'public.chain_node_operational_clock', 'select') then
    raise exception 'buyer_ready_cached_activity_clock postflight: summary grants changed';
  end if;
end;
$$;
