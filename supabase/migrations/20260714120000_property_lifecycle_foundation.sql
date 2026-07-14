-- Phase 1: Property lifecycle foundation
--
-- Tracks operational lifecycle state, audit transitions, and anonymised analytics
-- snapshots. Does NOT execute operational cleanup (Phase 2 workers).

-- ---------------------------------------------------------------------------
-- property_lifecycle_states
-- ---------------------------------------------------------------------------

create table if not exists public.property_lifecycle_states (
  property_id bigint primary key
    references public.properties (id) on delete cascade,
  operational_state text not null default 'active',
  lifecycle_reason text null,
  entered_state_at timestamptz not null default now(),
  grace_ends_at timestamptz null,
  archive_eligible_at timestamptz null,
  last_evaluated_at timestamptz null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint property_lifecycle_states_operational_state_check
    check (
      operational_state in (
        'active',
        'completed_grace',
        'dormant',
        'archived',
        'released',
        'anonymised'
      )
    )
);

create index if not exists property_lifecycle_states_operational_state_idx
  on public.property_lifecycle_states (operational_state);

create index if not exists property_lifecycle_states_grace_ends_at_idx
  on public.property_lifecycle_states (grace_ends_at)
  where grace_ends_at is not null;

comment on table public.property_lifecycle_states is
  'Operational lifecycle state per property. Distinct from chain completion lifecycle.';

-- Backfill active state for properties that already have members.

insert into public.property_lifecycle_states (
  property_id,
  operational_state,
  lifecycle_reason,
  entered_state_at
)
select
  p.id,
  'active',
  'backfill_existing_operational_property',
  coalesce(
    (
      select min(pm.created_at)
      from public.property_members pm
      where pm.property_id = p.id
    ),
    now()
  )
from public.properties p
where exists (
  select 1
  from public.property_members pm
  where pm.property_id = p.id
)
on conflict (property_id) do nothing;

-- ---------------------------------------------------------------------------
-- property_lifecycle_events (append-only audit)
-- ---------------------------------------------------------------------------

create table if not exists public.property_lifecycle_events (
  id uuid primary key default gen_random_uuid(),
  property_id bigint not null
    references public.properties (id) on delete cascade,
  from_state text null,
  to_state text not null,
  trigger text not null,
  scenario text null,
  reason text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),

  constraint property_lifecycle_events_trigger_check
    check (
      trigger in (
        'evaluation',
        'chain_completion',
        'worker',
        'manual',
        'system'
      )
    )
);

create index if not exists property_lifecycle_events_property_id_idx
  on public.property_lifecycle_events (property_id, created_at desc);

comment on table public.property_lifecycle_events is
  'Append-only audit trail for property operational lifecycle transitions.';

-- ---------------------------------------------------------------------------
-- property_analytics_snapshots (permanent anonymised metrics)
-- ---------------------------------------------------------------------------

create table if not exists public.property_analytics_snapshots (
  id uuid primary key default gen_random_uuid(),
  property_ref uuid not null,
  chain_ref uuid null,
  source_property_id bigint null,
  snapshot_version integer not null default 1,
  payload jsonb not null,
  captured_at timestamptz not null default now()
);

create index if not exists property_analytics_snapshots_property_ref_idx
  on public.property_analytics_snapshots (property_ref);

create index if not exists property_analytics_snapshots_source_property_id_idx
  on public.property_analytics_snapshots (source_property_id)
  where source_property_id is not null;

comment on table public.property_analytics_snapshots is
  'Anonymised transaction metrics retained after operational cleanup. No PII.';

alter table public.property_lifecycle_states enable row level security;
alter table public.property_lifecycle_events enable row level security;
alter table public.property_analytics_snapshots enable row level security;

revoke all on public.property_lifecycle_states from public;
revoke all on public.property_lifecycle_events from public;
revoke all on public.property_analytics_snapshots from public;

-- ---------------------------------------------------------------------------
-- Helper: gather lifecycle signals for a property
-- ---------------------------------------------------------------------------

create or replace function public.get_property_lifecycle_signals(
  p_property_id bigint
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_property public.properties%rowtype;
  v_chain public.chains%rowtype;
  v_lifecycle public.property_lifecycle_states%rowtype;
  v_claim public.property_claim_metadata%rowtype;
  v_member_count integer := 0;
  v_last_activity_at timestamptz;
  v_has_pending_invitation boolean := false;
  v_has_connected_counterparty boolean := false;
  v_context jsonb;
begin
  select *
  into v_property
  from public.properties
  where id = p_property_id;

  if v_property.id is null then
    return jsonb_build_object('ok', false, 'error', 'property_not_found');
  end if;

  select *
  into v_lifecycle
  from public.property_lifecycle_states
  where property_id = p_property_id;

  select *
  into v_claim
  from public.property_claim_metadata
  where property_id = p_property_id;

  if v_property.chain_id is not null then
    select *
    into v_chain
    from public.chains
    where id = v_property.chain_id;
  end if;

  select count(*)::integer
  into v_member_count
  from public.property_members pm
  where pm.property_id = p_property_id;

  select max(a.timestamp)
  into v_last_activity_at
  from public.activities a
  where a.property_id = p_property_id;

  select exists (
    select 1
    from public.property_claim_invitations pci
    where pci.property_id = p_property_id
      and pci.invitation_revoked_at is null
      and pci.invitation_used_at is null
      and pci.invitation_rejected_at is null
      and pci.invitation_expires_at > now()
  )
  into v_has_pending_invitation;

  v_has_connected_counterparty :=
    coalesce(v_property.buyer_connected, false)
    or coalesce(v_property.seller_connected, false);

  v_context := jsonb_build_object(
    'propertyId', v_property.id,
    'chainId', v_property.chain_id,
    'operationalState', coalesce(v_lifecycle.operational_state, 'active'),
    'claimStatus', v_claim.claim_status,
    'originType', v_claim.origin_type,
    'relationshipType', v_property.relationship_type,
    'buyerConnected', coalesce(v_property.buyer_connected, false),
    'sellerConnected', coalesce(v_property.seller_connected, false),
    'hasConnectedCounterparty', v_has_connected_counterparty,
    'memberCount', v_member_count,
    'chainCompletedAt', v_chain.completed_at,
    'lastActivityAt', v_last_activity_at,
    'lastPropertyUpdateAt', v_last_activity_at,
    'hasAcceptedClaim', coalesce(v_claim.claim_status = 'claimed', false),
    'hasPendingInvitation', v_has_pending_invitation,
    'graceEndsAt', v_lifecycle.grace_ends_at,
    'enteredStateAt', coalesce(v_lifecycle.entered_state_at, now()),
    'daysSinceLastActivity', case
      when v_last_activity_at is null then null
      else floor(extract(epoch from (now() - v_last_activity_at)) / 86400)::integer
    end,
    'daysSinceChainCompleted', case
      when v_chain.completed_at is null then null
      else floor(extract(epoch from (now() - v_chain.completed_at)) / 86400)::integer
    end
  );

  return jsonb_build_object(
    'ok', true,
    'context', v_context
  );
end;
$$;

comment on function public.get_property_lifecycle_signals(bigint) is
  'Returns operational signals used by the property lifecycle evaluation engine.';

-- ---------------------------------------------------------------------------
-- RPC: record_property_lifecycle_transition
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
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
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
  'Records a lifecycle state transition and audit event. Does not execute cleanup.';

revoke all on function public.get_property_lifecycle_signals(bigint) from public;
revoke all on function public.record_property_lifecycle_transition(
  bigint, text, text, text, text, jsonb
) from public;

grant execute on function public.get_property_lifecycle_signals(bigint) to authenticated;
grant execute on function public.record_property_lifecycle_transition(
  bigint, text, text, text, text, jsonb
) to authenticated;

-- Service-role workers (Phase 2) will use elevated access; no anon grants.
