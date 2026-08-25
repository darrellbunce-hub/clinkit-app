-- Platform security Phase 1 — RPC authorisation hardening (Development target).
-- Addresses live-confirmed: SEC-001, SEC-002, SEC-004, SEC-101.
-- Idempotent grant/function changes; safe to re-run on Development.

-- ---------------------------------------------------------------------------
-- Internal helpers: lifecycle read vs write authorisation (separate predicates)
-- ---------------------------------------------------------------------------

create or replace function public.property_lifecycle_read_caller_authorized(
  p_property_id bigint
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(auth.jwt() ->> 'role', '') = 'service_role'
    or (
      auth.uid() is not null
      and (
        public.is_property_member(p_property_id)
        or public.is_ea_assigned_to_property(p_property_id)
      )
    );
$$;

comment on function public.property_lifecycle_read_caller_authorized(bigint) is
  'Lifecycle signal read: service_role or callers with property visibility (matches properties SELECT RLS).';

revoke all on function public.property_lifecycle_read_caller_authorized(bigint) from public;
revoke all on function public.property_lifecycle_read_caller_authorized(bigint) from anon;
revoke all on function public.property_lifecycle_read_caller_authorized(bigint) from authenticated;
revoke all on function public.property_lifecycle_read_caller_authorized(bigint) from service_role;

create or replace function public.property_lifecycle_write_internal_caller_authorized(
  p_property_id bigint
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(auth.jwt() ->> 'role', '') = 'service_role'
    or (
      auth.uid() is not null
      and (
        public.is_property_operational_homeowner(p_property_id)
        or public.is_ea_assigned_to_property(p_property_id)
      )
    );
$$;

comment on function public.property_lifecycle_write_internal_caller_authorized(bigint) is
  'Internal lifecycle transition writes: service_role, operational homeowner, or assigned EA (delink flows only). Not a general property edit grant.';

revoke all on function public.property_lifecycle_write_internal_caller_authorized(bigint) from public;
revoke all on function public.property_lifecycle_write_internal_caller_authorized(bigint) from anon;
revoke all on function public.property_lifecycle_write_internal_caller_authorized(bigint) from authenticated;
revoke all on function public.property_lifecycle_write_internal_caller_authorized(bigint) from service_role;

-- ---------------------------------------------------------------------------
-- SEC-002: gate get_property_lifecycle_signals (rename core + wrapper)
-- ---------------------------------------------------------------------------

do $$
begin
  if to_regprocedure('public.get_property_lifecycle_signals(bigint)') is not null
     and to_regprocedure('public.get_property_lifecycle_signals_core(bigint)') is null then
    alter function public.get_property_lifecycle_signals(bigint)
      rename to get_property_lifecycle_signals_core;
  end if;
end;
$$;

revoke all on function public.get_property_lifecycle_signals_core(bigint) from public;
revoke all on function public.get_property_lifecycle_signals_core(bigint) from anon;
revoke all on function public.get_property_lifecycle_signals_core(bigint) from authenticated;
revoke all on function public.get_property_lifecycle_signals_core(bigint) from service_role;

create or replace function public.get_property_lifecycle_signals(
  p_property_id bigint
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.property_lifecycle_read_caller_authorized(p_property_id) then
    if auth.uid() is null then
      return jsonb_build_object('ok', false, 'error', 'not_authenticated');
    end if;

    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  return public.get_property_lifecycle_signals_core(p_property_id);
end;
$$;

comment on function public.get_property_lifecycle_signals(bigint) is
  'Authorised lifecycle signal read. Requires property membership, EA assignment, or service_role.';

revoke all on function public.get_property_lifecycle_signals(bigint) from public;
revoke all on function public.get_property_lifecycle_signals(bigint) from anon;
grant execute on function public.get_property_lifecycle_signals(bigint) to authenticated;
grant execute on function public.get_property_lifecycle_signals(bigint) to service_role;

-- ---------------------------------------------------------------------------
-- SEC-001: gate record_property_lifecycle_transition
-- ---------------------------------------------------------------------------

create or replace function public.record_property_lifecycle_transition(
  p_property_id bigint,
  p_to_state text,
  p_trigger text,
  p_scenario text default null,
  p_reason text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.property_lifecycle_states%rowtype;
  v_from_state text;
  v_grace_days integer := coalesce(
    nullif(current_setting('app.lifecycle_completed_grace_days', true), '')::integer,
    30
  );
begin
  if auth.uid() is null
     and coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  if not public.property_lifecycle_write_internal_caller_authorized(p_property_id) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  if p_to_state not in (
    'active',
    'completed_grace',
    'dormant',
    'archived',
    'released',
    'anonymised'
  ) then
    return jsonb_build_object('ok', false, 'error', 'invalid_state');
  end if;

  select *
  into v_existing
  from public.property_lifecycle_states
  where property_id = p_property_id;

  v_from_state := coalesce(v_existing.operational_state, 'active');

  insert into public.property_lifecycle_events (
    property_id,
    from_state,
    to_state,
    trigger,
    scenario,
    reason,
    metadata
  )
  values (
    p_property_id,
    v_from_state,
    p_to_state,
    p_trigger,
    p_scenario,
    coalesce(nullif(trim(p_reason), ''), 'transition_recorded'),
    coalesce(p_metadata, '{}'::jsonb)
  );

  insert into public.property_lifecycle_states (
    property_id,
    operational_state,
    lifecycle_reason,
    entered_state_at,
    grace_ends_at,
    archive_eligible_at,
    last_evaluated_at,
    metadata,
    updated_at
  )
  values (
    p_property_id,
    p_to_state,
    coalesce(nullif(trim(p_reason), ''), 'transition_recorded'),
    now(),
    case
      when p_to_state = 'completed_grace' then now() + make_interval(days => v_grace_days)
      else null
    end,
    case
      when p_to_state in ('archived', 'released') then now()
      else null
    end,
    now(),
    coalesce(p_metadata, '{}'::jsonb),
    now()
  )
  on conflict (property_id) do update
  set
    operational_state = excluded.operational_state,
    lifecycle_reason = excluded.lifecycle_reason,
    entered_state_at = excluded.entered_state_at,
    grace_ends_at = excluded.grace_ends_at,
    archive_eligible_at = excluded.archive_eligible_at,
    last_evaluated_at = excluded.last_evaluated_at,
    metadata = public.property_lifecycle_states.metadata || excluded.metadata,
    updated_at = now();

  return jsonb_build_object(
    'ok', true,
    'property_id', p_property_id,
    'operational_state', p_to_state,
    'from_state', v_from_state
  );
end;
$$;

comment on function public.record_property_lifecycle_transition(
  bigint, text, text, text, text, jsonb
) is
  'Internal lifecycle transition recorder. Not directly executable by authenticated clients; invoked by approved delink flows and service_role workers.';

revoke all on function public.record_property_lifecycle_transition(
  bigint, text, text, text, text, jsonb
) from public;
revoke all on function public.record_property_lifecycle_transition(
  bigint, text, text, text, text, jsonb
) from anon;
revoke all on function public.record_property_lifecycle_transition(
  bigint, text, text, text, text, jsonb
) from authenticated;

-- ---------------------------------------------------------------------------
-- SEC-004: invitation helper RPCs — internal only (revoke client EXECUTE)
-- ---------------------------------------------------------------------------

revoke all on function public.get_active_property_claim_invitation(bigint) from public;
revoke all on function public.get_active_property_claim_invitation(bigint) from anon;
revoke all on function public.get_active_property_claim_invitation(bigint) from authenticated;

revoke all on function public.get_latest_property_claim_invitation(bigint) from public;
revoke all on function public.get_latest_property_claim_invitation(bigint) from anon;
revoke all on function public.get_latest_property_claim_invitation(bigint) from authenticated;

comment on function public.get_active_property_claim_invitation(bigint) is
  'Internal helper: active invitation row. Not directly executable by clients.';

comment on function public.get_latest_property_claim_invitation(bigint) is
  'Internal helper: latest invitation row. Not directly executable by clients.';

-- ---------------------------------------------------------------------------
-- SEC-101: operational homeowner enumeration — service_role only
-- ---------------------------------------------------------------------------

revoke all on function public.report_multiple_operational_homeowners() from public;
revoke all on function public.report_multiple_operational_homeowners() from anon;
revoke all on function public.report_multiple_operational_homeowners() from authenticated;
grant execute on function public.report_multiple_operational_homeowners() to service_role;

comment on function public.report_multiple_operational_homeowners() is
  'Operational anomaly report for multiple operational homeowners. service_role only.';
