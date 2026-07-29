-- SEC-104: Postgres-backed RPC rate limiting (Development)
-- Abuse-control primitive only — no auth/login changes, no access-code logging.

-- ---------------------------------------------------------------------------
-- Table: rpc_rate_limit_buckets
-- ---------------------------------------------------------------------------

create table if not exists public.rpc_rate_limit_buckets (
  scope text not null,
  subject_key text not null,
  window_started_at timestamptz not null,
  attempt_count integer not null default 0
    check (attempt_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (scope, subject_key, window_started_at)
);

create index if not exists rpc_rate_limit_buckets_updated_at_idx
  on public.rpc_rate_limit_buckets (updated_at);

comment on table public.rpc_rate_limit_buckets is
  'Short-lived RPC abuse counters. Keys are opaque scope+subject (typically user_id). No access codes, tokens, or raw IPs.';

alter table public.rpc_rate_limit_buckets enable row level security;

revoke all on table public.rpc_rate_limit_buckets from public;
revoke all on table public.rpc_rate_limit_buckets from anon;
revoke all on table public.rpc_rate_limit_buckets from authenticated;
-- No policies for anon/authenticated → no direct PostgREST access.
-- Table owner / service_role retain access for maintenance.

-- ---------------------------------------------------------------------------
-- Internal helpers (fixed search_path, no client EXECUTE)
-- ---------------------------------------------------------------------------

create or replace function public._rate_limit_window_start(
  p_window_seconds integer
)
returns timestamptz
language sql
immutable
set search_path = public
as $$
  select to_timestamp(
    floor(
      extract(epoch from now()) / greatest(p_window_seconds, 1)
    ) * greatest(p_window_seconds, 1)
  );
$$;

revoke all on function public._rate_limit_window_start(integer) from public;

create or replace function public._rate_limit_cleanup_subject(
  p_scope text,
  p_subject_key text,
  p_retain_seconds integer default 7200
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.rpc_rate_limit_buckets
  where scope = p_scope
    and subject_key = p_subject_key
    and window_started_at < now() - make_interval(secs => greatest(p_retain_seconds, 60));

  -- Opportunistic global trim (bounded) to prevent unbounded growth.
  delete from public.rpc_rate_limit_buckets
  where ctid in (
    select ctid
    from public.rpc_rate_limit_buckets
    where updated_at < now() - interval '24 hours'
    limit 200
  );
end;
$$;

revoke all on function public._rate_limit_cleanup_subject(text, text, integer) from public;

-- Returns true when the subject is already at/over the limit (does not increment).
create or replace function public._rate_limit_is_blocked(
  p_scope text,
  p_subject_key text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window timestamptz;
  v_count integer;
begin
  if p_subject_key is null or p_subject_key = '' then
    return true;
  end if;

  v_window := public._rate_limit_window_start(p_window_seconds);

  select b.attempt_count
  into v_count
  from public.rpc_rate_limit_buckets b
  where b.scope = p_scope
    and b.subject_key = p_subject_key
    and b.window_started_at = v_window;

  return coalesce(v_count, 0) >= p_limit;
end;
$$;

revoke all on function public._rate_limit_is_blocked(text, text, integer, integer) from public;

-- Atomically increments the current window counter and returns the new count.
create or replace function public._rate_limit_record_attempt(
  p_scope text,
  p_subject_key text,
  p_window_seconds integer
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window timestamptz;
  v_count integer;
begin
  if p_subject_key is null or p_subject_key = '' then
    return 2147483647;
  end if;

  v_window := public._rate_limit_window_start(p_window_seconds);

  insert into public.rpc_rate_limit_buckets as b (
    scope,
    subject_key,
    window_started_at,
    attempt_count,
    updated_at
  )
  values (
    p_scope,
    p_subject_key,
    v_window,
    1,
    now()
  )
  on conflict (scope, subject_key, window_started_at)
  do update
  set
    attempt_count = b.attempt_count + 1,
    updated_at = now()
  returning b.attempt_count into v_count;

  perform public._rate_limit_cleanup_subject(
    p_scope,
    p_subject_key,
    greatest(p_window_seconds * 2, 3600)
  );

  return v_count;
end;
$$;

revoke all on function public._rate_limit_record_attempt(text, text, integer) from public;

-- Consume-on-entry: increments first; returns true if still within limit after increment.
-- Used for successful-create / summary-refresh quotas where every call counts.
create or replace function public._rate_limit_try_consume(
  p_scope text,
  p_subject_key text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  v_count := public._rate_limit_record_attempt(
    p_scope,
    p_subject_key,
    p_window_seconds
  );

  return v_count <= p_limit;
end;
$$;

revoke all on function public._rate_limit_try_consume(text, text, integer, integer) from public;

comment on function public._rate_limit_record_attempt(text, text, integer) is
  'Atomic fixed-window increment via INSERT...ON CONFLICT DO UPDATE. Concurrent callers cannot both read a stale pre-increment count.';

-- ---------------------------------------------------------------------------
-- Constants (documented in SEC-104 remediation report)
-- join_chain_failed: 10 / 15 min / user_id (failed attempts only)
-- claim_property_failed: 15 / 15 min / user_id (failed attempts only)
-- create_chain_homeowner: 10 / 1 hour / user_id (successful creates)
-- create_chain_ea: 40 / 1 hour / user_id (successful creates; EA origination)
-- upsert_operational_summaries: 60 / 15 min / user_id:chain_id
-- validate_onboarding_address: DEFERRED P3 (not wired)
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- RPC: join_chain_property — failed-attempt throttle (oracle-safe)
-- ---------------------------------------------------------------------------

create or replace function public.join_chain_property(
  p_access_code text,
  p_address text,
  p_postcode text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_property public.properties%rowtype;
  v_counterparty_role text;
  v_grant jsonb;
  v_email_gate jsonb;
  v_candidates text[];
  v_subject text;
  c_scope constant text := 'join_chain_failed';
  c_limit constant integer := 10;
  c_window constant integer := 900;
begin
  v_email_gate := public._require_verified_email_for_transaction();

  if v_email_gate is not null then
    return v_email_gate;
  end if;

  v_user_id := auth.uid();

  if v_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  v_subject := v_user_id::text;

  -- Check BEFORE match so throttled valid/invalid codes are indistinguishable.
  if public._rate_limit_is_blocked(c_scope, v_subject, c_limit, c_window) then
    return jsonb_build_object('ok', false, 'error', 'join_details_not_matched');
  end if;

  v_candidates := public._access_code_lookup_candidates(p_access_code);

  if coalesce(array_length(v_candidates, 1), 0) = 0 then
    perform public._rate_limit_record_attempt(c_scope, v_subject, c_window);
    return jsonb_build_object('ok', false, 'error', 'join_details_not_matched');
  end if;

  select p.*
  into v_property
  from public.properties p
  inner join public.chains c
    on c.id = p.chain_id
  where c.access_code = any (v_candidates)
    and p.address = p_address
    and p.postcode = p_postcode
  limit 1;

  if v_property.id is null then
    perform public._rate_limit_record_attempt(c_scope, v_subject, c_window);
    return jsonb_build_object('ok', false, 'error', 'join_details_not_matched');
  end if;

  v_grant := public._grant_counterparty_participation_core(
    v_property.id,
    v_user_id
  );

  if not coalesce((v_grant ->> 'ok')::boolean, false) then
    perform public._rate_limit_record_attempt(c_scope, v_subject, c_window);
    return jsonb_build_object('ok', false, 'error', 'join_details_not_matched');
  end if;

  v_counterparty_role := v_grant ->> 'counterparty_role';

  update public.properties
  set
    status = 'healthy',
    buyer_connected = case
      when v_property.relationship_type in ('sale', 'purchase') then true
      else buyer_connected
    end,
    seller_connected = case
      when v_property.relationship_type = 'purchase' then true
      else seller_connected
    end
  where id = v_property.id;

  select *
  into v_property
  from public.properties
  where id = v_property.id;

  -- Successful joins do not consume failed-attempt allowance.
  return jsonb_build_object(
    'ok', true,
    'property_id', v_property.id,
    'chain_id', v_property.chain_id,
    'linked_property_id', v_property.linked_property_id,
    'relationship_type', v_property.relationship_type,
    'joining_role', v_counterparty_role
  );
end;
$$;

comment on function public.join_chain_property(text, text, text) is
  'Join via access code + address + postcode. Failed attempts rate-limited 10/15min/user; public failures remain join_details_not_matched.';

revoke all on function public.join_chain_property(text, text, text) from public;
grant execute on function public.join_chain_property(text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- RPC: claim_operational_property — failed-attempt throttle
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
  v_claimable boolean;
  v_hash text;
  v_invitation public.property_claim_invitations%rowtype;
  v_grant jsonb;
  v_subject text;
  c_scope constant text := 'claim_property_failed';
  c_limit constant integer := 15;
  c_window constant integer := 900;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  v_subject := auth.uid()::text;

  -- Throttle checked before token/claimability evaluation → no token oracle.
  if public._rate_limit_is_blocked(c_scope, v_subject, c_limit, c_window) then
    return jsonb_build_object('ok', false, 'error', 'too_many_attempts');
  end if;

  if not exists (
    select 1
    from public.profiles pr
    where pr.id = auth.uid()
      and pr.account_type = 'homeowner'
  ) then
    perform public._rate_limit_record_attempt(c_scope, v_subject, c_window);
    return jsonb_build_object('ok', false, 'error', 'homeowner_only');
  end if;

  v_email := public.get_auth_user_email();

  if v_email is null or v_email = '' then
    perform public._rate_limit_record_attempt(c_scope, v_subject, c_window);
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
      perform public._rate_limit_record_attempt(c_scope, v_subject, c_window);
      return jsonb_build_object('ok', false, 'error', 'invalid_token');
    end if;

    if v_invitation.invitation_used_at is not null then
      perform public._rate_limit_record_attempt(c_scope, v_subject, c_window);
      return jsonb_build_object('ok', false, 'error', 'already_used');
    end if;

    if v_invitation.invitation_rejected_at is not null then
      perform public._rate_limit_record_attempt(c_scope, v_subject, c_window);
      return jsonb_build_object('ok', false, 'error', 'invitation_declined');
    end if;

    if v_invitation.invitation_revoked_at is not null then
      perform public._rate_limit_record_attempt(c_scope, v_subject, c_window);
      return jsonb_build_object('ok', false, 'error', 'invalid_token');
    end if;

    if v_invitation.invitation_expires_at <= now() then
      perform public._rate_limit_record_attempt(c_scope, v_subject, c_window);
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
    perform public._rate_limit_record_attempt(c_scope, v_subject, c_window);
    return jsonb_build_object('ok', false, 'error', 'not_claimable');
  end if;

  if exists (
    select 1
    from public.property_operational_identities poi
    where poi.property_id = p_property_id
      and poi.status = 'active'
  ) then
    perform public._rate_limit_record_attempt(c_scope, v_subject, c_window);
    return jsonb_build_object('ok', false, 'error', 'already_claimed');
  end if;

  select *
  into v_property
  from public.properties
  where id = p_property_id;

  if v_property.id is null then
    perform public._rate_limit_record_attempt(c_scope, v_subject, c_window);
    return jsonb_build_object('ok', false, 'error', 'property_not_found');
  end if;

  v_grant := public.establish_operational_homeowner(
    p_property_id,
    'claim_operational_property'
  );

  if not coalesce((v_grant ->> 'ok')::boolean, false) then
    perform public._rate_limit_record_attempt(c_scope, v_subject, c_window);
    return v_grant;
  end if;

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

revoke all on function public.claim_operational_property(bigint, text) from public;
grant execute on function public.claim_operational_property(bigint, text) to authenticated;

-- ---------------------------------------------------------------------------
-- RPC: create_chain_for_onboarding — successful-create throttle (homeowner)
-- ---------------------------------------------------------------------------

create or replace function public.create_chain_for_onboarding(
  p_name text,
  p_access_code text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_chain_id bigint;
  v_name text;
  v_access_code text;
  v_email_gate jsonb;
  c_scope constant text := 'create_chain_homeowner';
  c_limit constant integer := 10;
  c_window constant integer := 3600;
begin
  v_email_gate := public._require_verified_email_for_transaction();

  if v_email_gate is not null then
    return v_email_gate;
  end if;

  v_user_id := auth.uid();

  if v_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  if public._rate_limit_is_blocked(
    c_scope,
    v_user_id::text,
    c_limit,
    c_window
  ) then
    return jsonb_build_object('ok', false, 'error', 'too_many_attempts');
  end if;

  v_name := nullif(trim(p_name), '');

  if v_name is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_name');
  end if;

  v_access_code := nullif(trim(p_access_code), '');

  if v_access_code is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_access_code');
  end if;

  begin
    insert into public.chains (name, access_code, created_by_user_id)
    values (v_name, v_access_code, v_user_id)
    returning id into v_chain_id;
  exception
    when unique_violation then
      return jsonb_build_object('ok', false, 'error', 'duplicate_access_code');
  end;

  perform public._rate_limit_record_attempt(
    c_scope,
    v_user_id::text,
    c_window
  );

  return jsonb_build_object(
    'ok', true,
    'chain_id', v_chain_id,
    'access_code', v_access_code
  );
end;
$$;

revoke all on function public.create_chain_for_onboarding(text, text) from public;
grant execute on function public.create_chain_for_onboarding(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- RPC: create_ea_operational_chain — higher EA create allowance
-- ---------------------------------------------------------------------------

create or replace function public.create_ea_operational_chain(
  p_name text,
  p_access_code text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_chain_id bigint;
  v_name text;
  v_access_code text;
  v_email_gate jsonb;
  c_scope constant text := 'create_chain_ea';
  c_limit constant integer := 40;
  c_window constant integer := 3600;
begin
  v_email_gate := public._require_verified_email_for_transaction();

  if v_email_gate is not null then
    return v_email_gate;
  end if;

  v_user_id := auth.uid();

  if v_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  if not exists (
    select 1
    from public.ea_branch_members bm
    where bm.user_id = v_user_id
  ) then
    return jsonb_build_object('ok', false, 'error', 'not_ea_branch_member');
  end if;

  if public._rate_limit_is_blocked(
    c_scope,
    v_user_id::text,
    c_limit,
    c_window
  ) then
    return jsonb_build_object('ok', false, 'error', 'too_many_attempts');
  end if;

  v_name := nullif(trim(p_name), '');

  if v_name is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_name');
  end if;

  v_access_code := nullif(trim(p_access_code), '');

  if v_access_code is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_access_code');
  end if;

  begin
    insert into public.chains (name, access_code, created_by_user_id)
    values (v_name, v_access_code, v_user_id)
    returning id into v_chain_id;
  exception
    when unique_violation then
      return jsonb_build_object('ok', false, 'error', 'duplicate_access_code');
  end;

  perform public._rate_limit_record_attempt(
    c_scope,
    v_user_id::text,
    c_window
  );

  return jsonb_build_object(
    'ok', true,
    'chain_id', v_chain_id,
    'access_code', v_access_code
  );
end;
$$;

revoke all on function public.create_ea_operational_chain(text, text) from public;
grant execute on function public.create_ea_operational_chain(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- RPC: upsert_operational_summaries — retain authenticated EXECUTE + throttle
-- Callers: ChainContext / claim / EA finalize via refreshOperationalSummary.
-- Worker path uses upsert_operational_summaries_service (service_role) — unchanged.
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

  if not public.is_chain_operational_viewer(v_chain_id) then
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

revoke all on function public.upsert_operational_summaries(jsonb, jsonb) from public;
grant execute on function public.upsert_operational_summaries(jsonb, jsonb) to authenticated;

-- validate_onboarding_property_address: DEFERRED P3 — soft throttle not wired.
