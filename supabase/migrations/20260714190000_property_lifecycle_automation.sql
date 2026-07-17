-- Phase 2: Property lifecycle automation (dormancy architecture revision)
--
-- Two dormancy paths:
--   B1 isolated / unconnected — shorter inactivity threshold (default 90 days)
--   B2 connected but abandoned — longer threshold + warning + confirmation (150 + 30 days)
--
-- Fixes identity-age flaw: operational identity age alone is NOT meaningful activity.
-- Calculates last_operational_activity_at on write (not nightly history scans).
--
-- Note: this migration is idempotent (IF NOT EXISTS / CREATE OR REPLACE / DROP IF EXISTS)
-- and safe to rerun after a partial SQL Editor failure.

-- ---------------------------------------------------------------------------
-- Schema: operational activity + dormancy warning columns
-- ---------------------------------------------------------------------------

alter table public.properties
  add column if not exists last_operational_activity_at timestamptz null;

comment on column public.properties.last_operational_activity_at is
  'Durable summary of meaningful transaction activity. Updated on write by touch_property_operational_activity().';

alter table public.chains
  add column if not exists last_operational_activity_at timestamptz null;

comment on column public.chains.last_operational_activity_at is
  'Max meaningful operational activity across chain members. Used for connected dormancy evaluation.';

alter table public.property_lifecycle_states
  add column if not exists processing_lease_until timestamptz null,
  add column if not exists address_released_at timestamptz null,
  add column if not exists dormancy_warning_at timestamptz null,
  add column if not exists dormancy_confirmation_deadline_at timestamptz null,
  add column if not exists dormancy_warning_notified_at timestamptz null,
  add column if not exists last_still_active_confirmed_at timestamptz null;

create index if not exists property_lifecycle_states_processing_lease_idx
  on public.property_lifecycle_states (processing_lease_until)
  where processing_lease_until is not null;

create index if not exists property_lifecycle_states_dormancy_deadline_idx
  on public.property_lifecycle_states (dormancy_confirmation_deadline_at)
  where dormancy_confirmation_deadline_at is not null;

alter table public.property_analytics_snapshots
  add column if not exists snapshot_kind text not null default 'operational_release';

create unique index if not exists property_analytics_snapshots_source_kind_uidx
  on public.property_analytics_snapshots (source_property_id, snapshot_kind)
  where source_property_id is not null;

-- Extend operational_state enum
alter table public.property_lifecycle_states
  drop constraint if exists property_lifecycle_states_operational_state_check;

alter table public.property_lifecycle_states
  add constraint property_lifecycle_states_operational_state_check
  check (
    operational_state in (
      'active',
      'completed_grace',
      'dormancy_warning',
      'dormant',
      'archived',
      'released',
      'anonymised'
    )
  );

comment on column public.property_lifecycle_states.dormancy_warning_at is
  'When connected dormancy warning was issued. Cleared on still-active confirmation.';

comment on column public.property_lifecycle_states.dormancy_confirmation_deadline_at is
  'Deadline for structured still-active confirmation before connected dormancy release.';

comment on column public.property_lifecycle_states.dormancy_warning_notified_at is
  'When dormancy warning notification was queued/sent. Prevents duplicate worker notifications.';

comment on column public.property_lifecycle_states.last_still_active_confirmed_at is
  'Last structured "My transaction is still active" confirmation timestamp.';

-- ---------------------------------------------------------------------------
-- Lifecycle event triggers (de-link + still-active confirmation)
-- ---------------------------------------------------------------------------

alter table public.property_lifecycle_events
  drop constraint if exists property_lifecycle_events_trigger_check;

alter table public.property_lifecycle_events
  add constraint property_lifecycle_events_trigger_check
  check (
    trigger in (
      'evaluation',
      'chain_completion',
      'worker',
      'manual',
      'system',
      'homeowner_delink',
      'ea_delink_no_homeowner',
      'participation_delink',
      'still_active_confirmation'
    )
  );

-- Structured still-active confirmation audit (no free text)
create table if not exists public.property_lifecycle_still_active_confirmations (
  id uuid primary key default gen_random_uuid(),
  property_id bigint not null
    references public.properties (id) on delete cascade,
  chain_id bigint null
    references public.chains (id) on delete set null,
  user_id uuid not null
    references auth.users (id) on delete cascade,
  confirmation_code text not null default 'still_active',
  confirmed_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,

  constraint property_lifecycle_still_active_confirmations_code_check
    check (confirmation_code = 'still_active')
);

create index if not exists property_lifecycle_still_active_confirmations_property_idx
  on public.property_lifecycle_still_active_confirmations (property_id, confirmed_at desc);

comment on table public.property_lifecycle_still_active_confirmations is
  'Auditable structured confirmations for connected dormancy warning. No free text.';

-- ---------------------------------------------------------------------------
-- Fix identity-age flaw in meaningful participation
-- ---------------------------------------------------------------------------

create or replace function public.homeowner_has_meaningful_participation(
  p_property_id bigint
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_property public.properties%rowtype;
  v_homeowner_activity_count integer := 0;
begin
  if not exists (
    select 1
    from public.property_operational_identities poi
    where poi.property_id = p_property_id
      and poi.status = 'active'
  ) then
    return false;
  end if;

  select *
  into v_property
  from public.properties
  where id = p_property_id;

  select count(*)
  into v_homeowner_activity_count
  from public.activities a
  where a.property_id = p_property_id
    and a.updated_by = 'homeowner';

  if v_homeowner_activity_count > 0 then
    return true;
  end if;

  if v_property.stage is not null
    and v_property.stage not in ('property_listed', 'searching') then
    return true;
  end if;

  if exists (
    select 1
    from public.property_counterparty_participants pcp
    where pcp.property_id = p_property_id
      and pcp.status = 'active'
  ) then
    return true;
  end if;

  if v_property.buyer_connected
    and v_property.seller_connected then
    return true;
  end if;

  -- Identity age alone is NOT meaningful participation (removed identity-age block).

  return false;
end;
$$;

comment on function public.homeowner_has_meaningful_participation(bigint) is
  'True when active operational homeowner has durable transaction progress. Identity age alone does not qualify.';

-- ---------------------------------------------------------------------------
-- Calculate-on-write operational activity touch
-- ---------------------------------------------------------------------------

create or replace function public.touch_property_operational_activity(
  p_property_id bigint,
  p_touch_chain boolean default true
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_chain_id bigint;
  v_now timestamptz := now();
begin
  if p_property_id is null then
    return;
  end if;

  update public.properties
  set last_operational_activity_at = v_now
  where id = p_property_id;

  if not p_touch_chain then
    return;
  end if;

  select chain_id
  into v_chain_id
  from public.properties
  where id = p_property_id;

  if v_chain_id is null then
    return;
  end if;

  update public.chains
  set last_operational_activity_at = v_now
  where id = v_chain_id;

  update public.properties
  set last_operational_activity_at = v_now
  where chain_id = v_chain_id;
end;
$$;

comment on function public.touch_property_operational_activity(bigint, boolean) is
  'Updates last_operational_activity_at on property (and chain peers when p_touch_chain). Not called for page reads.';

-- Backfill from durable operational signals only — never NOW().
-- Properties with no historical signals keep NULL; dormancy evaluation falls back
-- to enteredStateAt derived from membership / claim / lifecycle rows in signals RPC.
with operational_signals as (
  select a.property_id, a.timestamp as signal_at
  from public.activities a

  union all

  select poi.property_id, poi.granted_at
  from public.property_operational_identities poi

  union all

  select pcp.property_id, pcp.granted_at
  from public.property_counterparty_participants pcp

  union all

  select pcm.property_id, pcm.claimed_at
  from public.property_claim_metadata pcm
  where pcm.claimed_at is not null

  union all

  select pm.property_id, min(pm.created_at) as signal_at
  from public.property_members pm
  group by pm.property_id
),
aggregated_property_activity as (
  select
    signal.property_id,
    max(signal.signal_at) as derived_at
  from operational_signals signal
  where signal.signal_at is not null
  group by signal.property_id
)
update public.properties p
set last_operational_activity_at = agg.derived_at
from aggregated_property_activity agg
where p.id = agg.property_id
  and p.last_operational_activity_at is null;

with chain_signals as (
  select p.chain_id, p.last_operational_activity_at as signal_at
  from public.properties p
  where p.chain_id is not null
    and p.last_operational_activity_at is not null

  union all

  select p.chain_id, max(a.timestamp) as signal_at
  from public.properties p
  inner join public.activities a on a.property_id = p.id
  where p.chain_id is not null
  group by p.chain_id
),
aggregated_chain_activity as (
  select
    signal.chain_id,
    max(signal.signal_at) as derived_at
  from chain_signals signal
  where signal.chain_id is not null
    and signal.signal_at is not null
  group by signal.chain_id
)
update public.chains c
set last_operational_activity_at = agg.derived_at
from aggregated_chain_activity agg
where c.id = agg.chain_id
  and c.last_operational_activity_at is null;

-- Triggers: meaningful writes only (not page reads)
create or replace function public._trg_touch_operational_activity_from_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.touch_property_operational_activity(new.property_id, true);
  return new;
end;
$$;

drop trigger if exists trg_touch_operational_activity_from_activity
  on public.activities;

create trigger trg_touch_operational_activity_from_activity
  after insert on public.activities
  for each row
  execute function public._trg_touch_operational_activity_from_activity();

create or replace function public._trg_touch_operational_activity_from_property()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    if (
      new.stage is distinct from old.stage
      or new.status is distinct from old.status
      or new.buyer_connected is distinct from old.buyer_connected
      or new.seller_connected is distinct from old.seller_connected
      or new.chain_id is distinct from old.chain_id
      or new.chain_position is distinct from old.chain_position
    ) then
      perform public.touch_property_operational_activity(new.id, true);
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_touch_operational_activity_from_property
  on public.properties;

create trigger trg_touch_operational_activity_from_property
  after update on public.properties
  for each row
  execute function public._trg_touch_operational_activity_from_property();

create or replace function public._trg_touch_operational_activity_from_claim()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE'
    and new.claim_status is distinct from old.claim_status
    and new.claim_status = 'claimed' then
    perform public.touch_property_operational_activity(new.property_id, true);
  end if;

  return new;
end;
$$;

drop trigger if exists trg_touch_operational_activity_from_claim
  on public.property_claim_metadata;

create trigger trg_touch_operational_activity_from_claim
  after update on public.property_claim_metadata
  for each row
  execute function public._trg_touch_operational_activity_from_claim();

create or replace function public._trg_touch_operational_activity_from_counterparty()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'active' then
    perform public.touch_property_operational_activity(new.property_id, true);
  end if;

  return new;
end;
$$;

drop trigger if exists trg_touch_operational_activity_from_counterparty
  on public.property_counterparty_participants;

create trigger trg_touch_operational_activity_from_counterparty
  after insert or update on public.property_counterparty_participants
  for each row
  execute function public._trg_touch_operational_activity_from_counterparty();

-- ---------------------------------------------------------------------------
-- Chain connectivity + release safety helpers
-- ---------------------------------------------------------------------------

create or replace function public.property_chain_is_connected(
  p_property_id bigint
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.properties p
    where p.id = p_property_id
      and (
        coalesce(p.buyer_connected, false)
        or coalesce(p.seller_connected, false)
        or exists (
          select 1
          from public.property_counterparty_participants pcp
          where pcp.property_id = p.id
            and pcp.status = 'active'
        )
        or (
          p.chain_id is not null
          and (
            select count(*) > 1
            from public.properties cp
            where cp.chain_id = p.chain_id
          )
        )
        or (
          p.chain_id is not null
          and exists (
            select 1
            from public.properties cp
            join public.property_operational_identities poi
              on poi.property_id = cp.id
              and poi.status = 'active'
            where cp.chain_id = p.chain_id
              and cp.id <> p.id
          )
        )
      )
  );
$$;

create or replace function public.chain_last_operational_activity_at(
  p_chain_id bigint
)
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select c.last_operational_activity_at
      from public.chains c
      where c.id = p_chain_id
    ),
    (
      select max(p.last_operational_activity_at)
      from public.properties p
      where p.chain_id = p_chain_id
    )
  );
$$;

create or replace function public.property_lifecycle_chain_release_safe(
  p_property_id bigint
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_property public.properties%rowtype;
  v_state text;
  v_connected boolean;
begin
  select *
  into v_property
  from public.properties
  where id = p_property_id;

  if v_property.id is null then
    return false;
  end if;

  select operational_state
  into v_state
  from public.property_lifecycle_states
  where property_id = p_property_id;

  v_state := coalesce(v_state, 'active');
  v_connected := public.property_chain_is_connected(p_property_id);

  if not v_connected or v_property.chain_id is null then
    return true;
  end if;

  -- Fail closed when another chain member is still actively progressing.
  if exists (
    select 1
    from public.properties cp
    join public.property_lifecycle_states pls
      on pls.property_id = cp.id
    where cp.chain_id = v_property.chain_id
      and cp.id <> p_property_id
      and coalesce(pls.operational_state, 'active') in (
        'active',
        'completed_grace'
      )
      and public.homeowner_has_meaningful_participation(cp.id)
  ) then
    return false;
  end if;

  -- Fail closed when another member is in dormancy warning with time remaining.
  if exists (
    select 1
    from public.properties cp
    join public.property_lifecycle_states pls
      on pls.property_id = cp.id
    where cp.chain_id = v_property.chain_id
      and cp.id <> p_property_id
      and pls.operational_state = 'dormancy_warning'
      and (
        pls.dormancy_confirmation_deadline_at is null
        or pls.dormancy_confirmation_deadline_at > now()
      )
  ) then
    return false;
  end if;

  return true;
end;
$$;

comment on function public.property_lifecycle_chain_release_safe(bigint) is
  'Fail-closed check before lifecycle release. Prevents corrupting an otherwise active connected chain.';

-- ---------------------------------------------------------------------------
-- Address reservation semantics
-- ---------------------------------------------------------------------------

create or replace function public.property_address_is_reserved(
  p_property_id bigint
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when exists (
      select 1
      from public.property_lifecycle_states pls
      where pls.property_id = p_property_id
        and pls.operational_state in ('released', 'anonymised')
    ) then false
    when exists (
      select 1
      from public.property_lifecycle_states pls
      where pls.property_id = p_property_id
        and pls.operational_state in (
          'active',
          'completed_grace',
          'dormancy_warning',
          'dormant',
          'archived'
        )
    ) then true
    when exists (
      select 1
      from public.property_operational_identities poi
      where poi.property_id = p_property_id
        and poi.status = 'active'
    ) then true
    when exists (
      select 1
      from public.property_members pm
      where pm.property_id = p_property_id
    ) then true
    else false
  end;
$$;

comment on function public.property_address_is_reserved(bigint) is
  'True when a property row still reserves its address. Released/anonymised historic rows do not block reuse.';

revoke all on function public.property_address_is_reserved(bigint) from public;
grant execute on function public.property_address_is_reserved(bigint) to authenticated;

create or replace function public.property_exists_for_onboarding(
  p_address text,
  p_postcode text,
  p_exclude_property_id bigint default null
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.properties p
    where p.address = p_address
      and p.postcode = p_postcode
      and (
        p_exclude_property_id is null
        or p.id <> p_exclude_property_id
      )
      and public.property_address_is_reserved(p.id)
  );
$$;

-- ---------------------------------------------------------------------------
-- Worker lifecycle config helpers (Postgres settings mirror TS env)
-- ---------------------------------------------------------------------------

create or replace function public.lifecycle_completed_grace_days()
returns integer
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('app.lifecycle_completed_grace_days', true), '')::integer,
    30
  );
$$;

create or replace function public.lifecycle_dormant_inactivity_days()
returns integer
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('app.lifecycle_dormant_inactivity_days', true), '')::integer,
    90
  );
$$;

create or replace function public.lifecycle_connected_dormant_days()
returns integer
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('app.lifecycle_connected_dormant_days', true), '')::integer,
    150
  );
$$;

create or replace function public.lifecycle_dormancy_confirmation_days()
returns integer
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('app.lifecycle_dormancy_confirmation_days', true), '')::integer,
    30
  );
$$;

-- ---------------------------------------------------------------------------
-- Enhanced lifecycle signals
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
  v_has_valid_active_invitation boolean := false;
  v_has_expired_invitation_only boolean := false;
  v_has_connected_counterparty boolean := false;
  v_is_chain_connected boolean := false;
  v_has_active_operational_identity boolean := false;
  v_has_meaningful_participation boolean := false;
  v_has_analytics_snapshot boolean := false;
  v_manually_released boolean := false;
  v_chain_last_operational timestamptz;
  v_chain_release_safe boolean := true;
  v_member_since timestamptz;
  v_identity_granted_at timestamptz;
  v_operational_anchor timestamptz;
  v_entered_anchor timestamptz;
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
  into v_has_valid_active_invitation;

  select exists (
    select 1
    from public.property_claim_invitations pci
    where pci.property_id = p_property_id
      and pci.invitation_revoked_at is null
      and pci.invitation_used_at is null
      and pci.invitation_rejected_at is null
      and pci.invitation_expires_at <= now()
  )
  and not v_has_valid_active_invitation
  into v_has_expired_invitation_only;

  v_has_connected_counterparty :=
    coalesce(v_property.buyer_connected, false)
    or coalesce(v_property.seller_connected, false);

  v_is_chain_connected := public.property_chain_is_connected(p_property_id);

  select exists (
    select 1
    from public.property_operational_identities poi
    where poi.property_id = p_property_id
      and poi.status = 'active'
  )
  into v_has_active_operational_identity;

  v_has_meaningful_participation :=
    public.homeowner_has_meaningful_participation(p_property_id);

  select exists (
    select 1
    from public.property_analytics_snapshots pas
    where pas.source_property_id = p_property_id
      and pas.snapshot_kind = 'operational_release'
  )
  into v_has_analytics_snapshot;

  select exists (
    select 1
    from public.property_lifecycle_events ple
    where ple.property_id = p_property_id
      and ple.to_state = 'released'
      and ple.trigger in (
        'homeowner_delink',
        'participation_delink',
        'manual'
      )
  )
  into v_manually_released;

  v_chain_last_operational := case
    when v_property.chain_id is null then null
    else public.chain_last_operational_activity_at(v_property.chain_id)
  end;

  v_chain_release_safe := public.property_lifecycle_chain_release_safe(p_property_id);

  select min(pm.created_at)
  into v_member_since
  from public.property_members pm
  where pm.property_id = p_property_id;

  select poi.granted_at
  into v_identity_granted_at
  from public.property_operational_identities poi
  where poi.property_id = p_property_id
    and poi.status = 'active'
  limit 1;

  v_operational_anchor := coalesce(
    v_property.last_operational_activity_at,
    v_last_activity_at,
    v_identity_granted_at,
    v_claim.claimed_at,
    v_member_since,
    v_claim.created_at
  );

  v_entered_anchor := coalesce(
    v_lifecycle.entered_state_at,
    v_member_since,
    v_identity_granted_at,
    v_claim.created_at
  );

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
    'isChainConnected', v_is_chain_connected,
    'memberCount', v_member_count,
    'chainCompletedAt', v_chain.completed_at,
    'lastActivityAt', v_last_activity_at,
    'lastPropertyUpdateAt', v_last_activity_at,
    'lastOperationalActivityAt', v_operational_anchor,
    'chainLastOperationalActivityAt', v_chain_last_operational,
    'hasAcceptedClaim', coalesce(v_claim.claim_status = 'claimed', false),
    'hasValidActiveInvitation', v_has_valid_active_invitation,
    'hasExpiredInvitationOnly', v_has_expired_invitation_only,
    'graceEndsAt', v_lifecycle.grace_ends_at,
    'enteredStateAt', v_entered_anchor,
    'dormancyWarningAt', v_lifecycle.dormancy_warning_at,
    'dormancyConfirmationDeadlineAt', v_lifecycle.dormancy_confirmation_deadline_at,
    'daysSinceLastOperationalActivity', case
      when v_operational_anchor is null then null
      else floor(extract(epoch from (now() - v_operational_anchor)) / 86400)::integer
    end,
    'daysSinceChainOperationalActivity', case
      when v_chain_last_operational is null then null
      else floor(extract(epoch from (now() - v_chain_last_operational)) / 86400)::integer
    end,
    'daysSinceChainCompleted', case
      when v_chain.completed_at is null then null
      else floor(extract(epoch from (now() - v_chain.completed_at)) / 86400)::integer
    end,
    'hasActiveOperationalIdentity', v_has_active_operational_identity,
    'hasMeaningfulParticipation', v_has_meaningful_participation,
    'hasAnalyticsSnapshot', v_has_analytics_snapshot,
    'manuallyReleased', v_manually_released,
    'addressReserved', public.property_address_is_reserved(p_property_id),
    'chainReleaseSafe', v_chain_release_safe
  );

  return jsonb_build_object(
    'ok', true,
    'context', v_context
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Structured still-active confirmation (authenticated)
-- ---------------------------------------------------------------------------

create or replace function public.confirm_transaction_still_active(
  p_property_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_property public.properties%rowtype;
  v_state text;
  v_chain_id bigint;
begin
  if v_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  select *
  into v_property
  from public.properties
  where id = p_property_id;

  if v_property.id is null then
    return jsonb_build_object('ok', false, 'error', 'property_not_found');
  end if;

  if not exists (
    select 1
    from public.property_members pm
    where pm.property_id = p_property_id
      and pm.user_id = v_user_id
  )
  and not exists (
    select 1
    from public.property_operational_identities poi
    where poi.property_id = p_property_id
      and poi.homeowner_user_id = v_user_id
      and poi.status = 'active'
  )
  and not public.is_ea_assigned_to_property(p_property_id) then
    return jsonb_build_object('ok', false, 'error', 'not_a_participant');
  end if;

  select operational_state
  into v_state
  from public.property_lifecycle_states
  where property_id = p_property_id;

  v_state := coalesce(v_state, 'active');
  v_chain_id := v_property.chain_id;

  if v_state not in ('dormancy_warning', 'active') then
    return jsonb_build_object('ok', false, 'error', 'invalid_state_for_confirmation');
  end if;

  insert into public.property_lifecycle_still_active_confirmations (
    property_id,
    chain_id,
    user_id,
    confirmation_code
  )
  values (
    p_property_id,
    v_chain_id,
    v_user_id,
    'still_active'
  );

  perform public.touch_property_operational_activity(p_property_id, true);

  insert into public.property_lifecycle_events (
    property_id,
    from_state,
    to_state,
    trigger,
    scenario,
    reason,
    metadata
  )
  select
    pls.property_id,
    pls.operational_state,
    'active',
    'still_active_confirmation',
    'connected_dormant',
    'Structured still-active confirmation reset dormancy clock.',
    jsonb_build_object('confirmation_code', 'still_active', 'confirmed_by', v_user_id)
  from public.property_lifecycle_states pls
  where pls.property_id = p_property_id
    and pls.operational_state = 'dormancy_warning';

  insert into public.property_lifecycle_events (
    property_id,
    from_state,
    to_state,
    trigger,
    scenario,
    reason,
    metadata
  )
  select
    pls.property_id,
    pls.operational_state,
    'active',
    'still_active_confirmation',
    'connected_dormant',
    'Structured still-active confirmation reset dormancy clock.',
    jsonb_build_object('confirmation_code', 'still_active', 'confirmed_by', v_user_id)
  from public.property_lifecycle_states pls
  join public.properties cp on cp.id = pls.property_id
  where v_chain_id is not null
    and cp.chain_id = v_chain_id
    and cp.id <> p_property_id
    and pls.operational_state = 'dormancy_warning';

  -- Reset dormancy warning across connected chain peers in warning state.
  update public.property_lifecycle_states pls
  set
    operational_state = 'active',
    lifecycle_reason = 'still_active_confirmation',
    entered_state_at = now(),
    dormancy_warning_at = null,
    dormancy_confirmation_deadline_at = null,
    last_still_active_confirmed_at = now(),
    last_evaluated_at = now(),
    updated_at = now()
  from public.properties cp
  where cp.id = pls.property_id
    and (
      cp.id = p_property_id
      or (
        v_chain_id is not null
        and cp.chain_id = v_chain_id
        and pls.operational_state = 'dormancy_warning'
      )
    );

  return jsonb_build_object(
    'ok', true,
    'property_id', p_property_id,
    'operational_state', 'active'
  );
end;
$$;

revoke all on function public.confirm_transaction_still_active(bigint) from public;
grant execute on function public.confirm_transaction_still_active(bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- Worker-only transition recording (service role)
-- ---------------------------------------------------------------------------

create or replace function public.record_property_lifecycle_transition_worker(
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
  v_grace_days integer := public.lifecycle_completed_grace_days();
  v_confirmation_days integer := public.lifecycle_dormancy_confirmation_days();
begin
  if p_to_state not in (
    'active',
    'completed_grace',
    'dormancy_warning',
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

  if v_from_state = p_to_state then
    update public.property_lifecycle_states
    set
      last_evaluated_at = now(),
      updated_at = now()
    where property_id = p_property_id;

    return jsonb_build_object(
      'ok', true,
      'property_id', p_property_id,
      'operational_state', p_to_state,
      'from_state', v_from_state,
      'idempotent', true
    );
  end if;

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
    dormancy_warning_at,
    dormancy_confirmation_deadline_at,
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
      when p_to_state in ('archived', 'released', 'anonymised') then now()
      else null
    end,
    now(),
    case when p_to_state = 'dormancy_warning' then now() else null end,
    case
      when p_to_state = 'dormancy_warning'
        then now() + make_interval(days => v_confirmation_days)
      else null
    end,
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
    dormancy_warning_at = case
      when excluded.operational_state = 'dormancy_warning'
        then coalesce(
          public.property_lifecycle_states.dormancy_warning_at,
          excluded.dormancy_warning_at
        )
      when excluded.operational_state = 'active'
        then null
      else public.property_lifecycle_states.dormancy_warning_at
    end,
    dormancy_confirmation_deadline_at = case
      when excluded.operational_state = 'dormancy_warning'
        then coalesce(
          public.property_lifecycle_states.dormancy_confirmation_deadline_at,
          excluded.dormancy_confirmation_deadline_at
        )
      when excluded.operational_state = 'active'
        then null
      else public.property_lifecycle_states.dormancy_confirmation_deadline_at
    end,
    metadata = public.property_lifecycle_states.metadata || excluded.metadata,
    address_released_at = case
      when excluded.operational_state in ('released', 'anonymised')
        then coalesce(public.property_lifecycle_states.address_released_at, now())
      else public.property_lifecycle_states.address_released_at
    end,
    updated_at = now();

  return jsonb_build_object(
    'ok', true,
    'property_id', p_property_id,
    'operational_state', p_to_state,
    'from_state', v_from_state
  );
end;
$$;

revoke all on function public.record_property_lifecycle_transition_worker(
  bigint, text, text, text, text, jsonb
) from public;

-- ---------------------------------------------------------------------------
-- Connected dormancy warning (chain-wide)
-- ---------------------------------------------------------------------------

create or replace function public.execute_enter_dormancy_warning(
  p_property_id bigint,
  p_reason text,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_property public.properties%rowtype;
  v_state text;
  v_peer_id bigint;
  v_result jsonb;
  v_peers_updated integer := 0;
begin
  select *
  into v_property
  from public.properties
  where id = p_property_id;

  if v_property.id is null then
    return jsonb_build_object('ok', false, 'error', 'property_not_found');
  end if;

  select operational_state
  into v_state
  from public.property_lifecycle_states
  where property_id = p_property_id;

  v_state := coalesce(v_state, 'active');

  if v_state = 'dormancy_warning' then
    update public.property_lifecycle_states
    set
      dormancy_warning_notified_at = coalesce(dormancy_warning_notified_at, now()),
      last_evaluated_at = now(),
      updated_at = now()
    where property_id = p_property_id;

    return jsonb_build_object(
      'ok', true,
      'property_id', p_property_id,
      'idempotent', true,
      'operational_state', 'dormancy_warning'
    );
  end if;

  if v_state <> 'active' then
    return jsonb_build_object('ok', true, 'skipped', true, 'operational_state', v_state);
  end if;

  v_result := public.record_property_lifecycle_transition_worker(
    p_property_id,
    'dormancy_warning',
    'worker',
    'connected_dormant',
    p_reason,
    coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object('action', 'enter_dormancy_warning')
  );

  update public.property_lifecycle_states
  set dormancy_warning_notified_at = coalesce(dormancy_warning_notified_at, now())
  where property_id = p_property_id;

  if v_property.chain_id is not null then
    for v_peer_id in
      select cp.id
      from public.properties cp
      join public.property_lifecycle_states pls
        on pls.property_id = cp.id
      where cp.chain_id = v_property.chain_id
        and cp.id <> p_property_id
        and coalesce(pls.operational_state, 'active') = 'active'
    loop
      perform public.record_property_lifecycle_transition_worker(
        v_peer_id,
        'dormancy_warning',
        'worker',
        'connected_dormant',
        p_reason,
        coalesce(p_metadata, '{}'::jsonb)
          || jsonb_build_object('action', 'enter_dormancy_warning', 'source_property_id', p_property_id)
      );

      update public.property_lifecycle_states
      set dormancy_warning_notified_at = coalesce(dormancy_warning_notified_at, now())
      where property_id = v_peer_id;

      v_peers_updated := v_peers_updated + 1;
    end loop;
  end if;

  return v_result || jsonb_build_object(
    'peers_updated', v_peers_updated,
    'notification_pending', true
  );
end;
$$;

revoke all on function public.execute_enter_dormancy_warning(
  bigint, text, jsonb
) from public;

-- ---------------------------------------------------------------------------
-- Worker lease + candidate selection
-- ---------------------------------------------------------------------------

create or replace function public.try_acquire_property_lifecycle_lease(
  p_property_id bigint,
  p_lease_seconds integer default 300
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_acquired boolean := false;
begin
  update public.property_lifecycle_states
  set
    processing_lease_until = now() + make_interval(secs => p_lease_seconds),
    updated_at = now()
  where property_id = p_property_id
    and (
      processing_lease_until is null
      or processing_lease_until < now()
    )
  returning true into v_acquired;

  if v_acquired then
    return true;
  end if;

  insert into public.property_lifecycle_states (
    property_id,
    operational_state,
    lifecycle_reason,
    processing_lease_until
  )
  values (
    p_property_id,
    'active',
    'worker_lease_bootstrap',
    now() + make_interval(secs => p_lease_seconds)
  )
  on conflict (property_id) do update
  set
    processing_lease_until = excluded.processing_lease_until,
    updated_at = now()
  where public.property_lifecycle_states.processing_lease_until is null
     or public.property_lifecycle_states.processing_lease_until < now()
  returning true into v_acquired;

  return coalesce(v_acquired, false);
end;
$$;

create or replace function public.release_property_lifecycle_lease(
  p_property_id bigint
)
returns void
language sql
security definer
set search_path = public
as $$
  update public.property_lifecycle_states
  set
    processing_lease_until = null,
    last_evaluated_at = now(),
    updated_at = now()
  where property_id = p_property_id;
$$;

create or replace function public.list_property_lifecycle_worker_candidates(
  p_limit integer default 100
)
returns table (property_id bigint)
language sql
stable
security definer
set search_path = public
as $$
  select p.id
  from public.properties p
  left join public.property_lifecycle_states pls
    on pls.property_id = p.id
  left join public.chains c
    on c.id = p.chain_id
  where coalesce(pls.operational_state, 'active') not in ('anonymised')
    and (
      pls.processing_lease_until is null
      or pls.processing_lease_until < now()
    )
    and (
      coalesce(pls.operational_state, 'active') in (
        'completed_grace',
        'dormancy_warning',
        'dormant',
        'archived'
      )
      or (
        coalesce(pls.operational_state, 'active') = 'active'
        and c.completed_at is not null
      )
      or (
        coalesce(pls.operational_state, 'active') = 'dormancy_warning'
        and pls.dormancy_confirmation_deadline_at is not null
        and pls.dormancy_confirmation_deadline_at <= now()
      )
      or (
        coalesce(pls.operational_state, 'active') = 'active'
        and (
          pls.last_evaluated_at is null
          or pls.last_evaluated_at < now() - interval '6 hours'
        )
      )
      or (
        coalesce(pls.operational_state, 'active') = 'released'
        and not exists (
          select 1
          from public.property_analytics_snapshots pas
          where pas.source_property_id = p.id
            and pas.snapshot_kind = 'operational_release'
        )
      )
    )
  order by pls.last_evaluated_at nulls first, p.id
  limit greatest(p_limit, 1);
$$;

revoke all on function public.list_property_lifecycle_worker_candidates(integer) from public;
revoke all on function public.try_acquire_property_lifecycle_lease(bigint, integer) from public;
revoke all on function public.release_property_lifecycle_lease(bigint) from public;

-- ---------------------------------------------------------------------------
-- Analytics snapshot persistence (idempotent)
-- ---------------------------------------------------------------------------

create or replace function public.persist_property_analytics_snapshot(
  p_property_id bigint,
  p_payload jsonb,
  p_snapshot_kind text default 'operational_release'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_property_ref uuid;
  v_chain_ref uuid;
  v_row_count integer := 0;
begin
  if p_payload is null or p_payload = '{}'::jsonb then
    return jsonb_build_object('ok', false, 'error', 'empty_payload');
  end if;

  v_property_ref := coalesce(
    nullif(p_payload ->> 'propertyRef', '')::uuid,
    gen_random_uuid()
  );

  v_chain_ref := nullif(p_payload ->> 'chainRef', '')::uuid;

  insert into public.property_analytics_snapshots (
    property_ref,
    chain_ref,
    source_property_id,
    snapshot_version,
    snapshot_kind,
    payload,
    captured_at
  )
  values (
    v_property_ref,
    v_chain_ref,
    p_property_id,
    coalesce((p_payload ->> 'snapshotVersion')::integer, 1),
    coalesce(nullif(trim(p_snapshot_kind), ''), 'operational_release'),
    p_payload,
    now()
  )
  on conflict (source_property_id, snapshot_kind)
  where source_property_id is not null
  do nothing;

  get diagnostics v_row_count = row_count;

  return jsonb_build_object(
    'ok', true,
    'property_id', p_property_id,
    'inserted', v_row_count > 0,
    'idempotent', v_row_count = 0
  );
end;
$$;

revoke all on function public.persist_property_analytics_snapshot(
  bigint, jsonb, text
) from public;

-- ---------------------------------------------------------------------------
-- Operational archival (memberships + permissions, not chain history)
-- ---------------------------------------------------------------------------

create or replace function public.execute_property_lifecycle_archive(
  p_property_id bigint,
  p_reason text,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state text;
begin
  select operational_state
  into v_state
  from public.property_lifecycle_states
  where property_id = p_property_id;

  v_state := coalesce(v_state, 'active');

  if v_state in ('archived', 'released', 'anonymised') then
    return jsonb_build_object(
      'ok', true,
      'property_id', p_property_id,
      'idempotent', true,
      'operational_state', v_state
    );
  end if;

  if not public.property_lifecycle_chain_release_safe(p_property_id) then
    return jsonb_build_object(
      'ok', false,
      'error', 'chain_release_unsafe',
      'property_id', p_property_id
    );
  end if;

  update public.property_delegates
  set
    status = 'revoked',
    revoked_at = now(),
    updated_at = now()
  where property_id = p_property_id
    and status in ('pending', 'active');

  update public.property_counterparty_participants
  set
    status = 'delinked',
    delinked_at = now()
  where property_id = p_property_id
    and status = 'active';

  update public.property_operational_identities
  set
    status = 'delinked',
    delinked_at = coalesce(delinked_at, now()),
    updated_at = now()
  where property_id = p_property_id
    and status = 'active';

  delete from public.property_members
  where property_id = p_property_id;

  update public.property_ea_assignments
  set
    status = 'revoked',
    revoked_at = now(),
    updated_at = now()
  where property_id = p_property_id
    and status = 'active';

  update public.properties
  set
    buyer_connected = false,
    seller_connected = false
  where id = p_property_id;

  perform public._insert_participation_delink_activity(
    p_property_id,
    'Property operational participation archived by lifecycle automation.',
    'system'
  );

  return public.record_property_lifecycle_transition_worker(
    p_property_id,
    'archived',
    'worker',
    null,
    p_reason,
    coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object('action', 'archive_operational')
  );
end;
$$;

revoke all on function public.execute_property_lifecycle_archive(
  bigint, text, jsonb
) from public;

-- ---------------------------------------------------------------------------
-- Address release (reuse without deleting historic property row)
-- ---------------------------------------------------------------------------

create or replace function public.execute_property_lifecycle_release(
  p_property_id bigint,
  p_reason text,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state text;
begin
  select operational_state
  into v_state
  from public.property_lifecycle_states
  where property_id = p_property_id;

  v_state := coalesce(v_state, 'active');

  if v_state in ('released', 'anonymised') then
    return jsonb_build_object(
      'ok', true,
      'property_id', p_property_id,
      'idempotent', true,
      'operational_state', v_state,
      'address_reserved', public.property_address_is_reserved(p_property_id)
    );
  end if;

  if not public.property_lifecycle_chain_release_safe(p_property_id) then
    return jsonb_build_object(
      'ok', false,
      'error', 'chain_release_unsafe',
      'property_id', p_property_id
    );
  end if;

  update public.property_operational_identities
  set
    status = 'released',
    delinked_at = coalesce(delinked_at, now()),
    updated_at = now()
  where property_id = p_property_id
    and status in ('active', 'delinked');

  update public.property_claim_metadata pcm
  set
    claim_status = case
      when pcm.origin_type = 'estate_agent' then 'unclaimed'
      else pcm.claim_status
    end,
    claimed_by_user_id = case
      when pcm.origin_type = 'estate_agent' then null
      else pcm.claimed_by_user_id
    end,
    claimed_at = case
      when pcm.origin_type = 'estate_agent' then null
      else pcm.claimed_at
    end,
    invite_email = case
      when pcm.origin_type = 'estate_agent' then pcm.invite_email
      else pcm.invite_email
    end,
    updated_at = now()
  where pcm.property_id = p_property_id;

  update public.properties
  set
    status = 'pending_connection',
    buyer_connected = false,
    seller_connected = false
  where id = p_property_id;

  perform public._insert_participation_delink_activity(
    p_property_id,
    'Property released for future transactions. Historic chain data retained.',
    'system'
  );

  return public.record_property_lifecycle_transition_worker(
    p_property_id,
    'released',
    'worker',
    'future_claim',
    p_reason,
    coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object('action', 'release_property')
  );
end;
$$;

revoke all on function public.execute_property_lifecycle_release(
  bigint, text, jsonb
) from public;

-- ---------------------------------------------------------------------------
-- Historical anonymisation (property-level only — NOT full GDPR RTBF)
-- ---------------------------------------------------------------------------

create or replace function public.execute_property_lifecycle_anonymise(
  p_property_id bigint,
  p_reason text,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state text;
begin
  select operational_state
  into v_state
  from public.property_lifecycle_states
  where property_id = p_property_id;

  v_state := coalesce(v_state, 'active');

  if v_state = 'anonymised' then
    return jsonb_build_object(
      'ok', true,
      'property_id', p_property_id,
      'idempotent', true
    );
  end if;

  update public.property_claim_metadata pcm
  set
    invite_email = null,
    invite_display_name = null,
    updated_at = now()
  where pcm.property_id = p_property_id;

  update public.properties
  set
    address = '[Released property]',
    postcode = 'REDACTED'
  where id = p_property_id;

  return public.record_property_lifecycle_transition_worker(
    p_property_id,
    'anonymised',
    'worker',
    'analytics',
    p_reason,
    coalesce(p_metadata, '{}'::jsonb)
      || jsonb_build_object(
        'action', 'anonymise_historical',
        'gdpr_scope', 'property_lifecycle_only'
      )
  );
end;
$$;

comment on function public.execute_property_lifecycle_anonymise(bigint, text, jsonb) is
  'Property-level lifecycle anonymisation. Does NOT fulfil UK GDPR Right to Erasure.';

revoke all on function public.execute_property_lifecycle_anonymise(
  bigint, text, jsonb
) from public;

-- ---------------------------------------------------------------------------
-- Single action executor (called from TypeScript worker after evaluation)
-- ---------------------------------------------------------------------------

create or replace function public.execute_property_lifecycle_action(
  p_property_id bigint,
  p_action text,
  p_scenario text,
  p_reason text,
  p_worker_run_id uuid,
  p_snapshot_payload jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state text;
  v_metadata jsonb := jsonb_build_object('worker_run_id', p_worker_run_id);
  v_snapshot_result jsonb;
begin
  select operational_state
  into v_state
  from public.property_lifecycle_states
  where property_id = p_property_id;

  v_state := coalesce(v_state, 'active');

  if v_state in ('released', 'anonymised')
    and p_action in (
      'enter_completed_grace',
      'enter_dormancy_warning',
      'mark_dormant',
      'archive_operational',
      'release_property'
    ) then
    return jsonb_build_object(
      'ok', true,
      'property_id', p_property_id,
      'action', p_action,
      'skipped', true,
      'reason', 'already_released_or_anonymised'
    );
  end if;

  case p_action
    when 'enter_completed_grace' then
      if v_state <> 'active' then
        return jsonb_build_object('ok', true, 'skipped', true, 'action', p_action);
      end if;

      return public.record_property_lifecycle_transition_worker(
        p_property_id,
        'completed_grace',
        'worker',
        p_scenario,
        p_reason,
        v_metadata
      );

    when 'enter_dormancy_warning' then
      return public.execute_enter_dormancy_warning(
        p_property_id,
        p_reason,
        v_metadata
      ) || jsonb_build_object('action', p_action);

    when 'mark_dormant' then
      if v_state not in ('active', 'completed_grace', 'dormancy_warning') then
        return jsonb_build_object('ok', true, 'skipped', true, 'action', p_action);
      end if;

      return public.record_property_lifecycle_transition_worker(
        p_property_id,
        'dormant',
        'worker',
        p_scenario,
        p_reason,
        v_metadata
      );

    when 'create_analytics_snapshot' then
      if p_snapshot_payload is null then
        return jsonb_build_object('ok', false, 'error', 'snapshot_payload_required');
      end if;

      v_snapshot_result := public.persist_property_analytics_snapshot(
        p_property_id,
        p_snapshot_payload,
        'operational_release'
      );

      return v_snapshot_result || jsonb_build_object('action', p_action);

    when 'archive_operational' then
      return public.execute_property_lifecycle_archive(
        p_property_id,
        p_reason,
        v_metadata
      ) || jsonb_build_object('action', p_action);

    when 'release_property' then
      if not coalesce(
        (public.get_property_lifecycle_signals(p_property_id) -> 'context' ->> 'chainReleaseSafe')::boolean,
        true
      ) then
        return jsonb_build_object(
          'ok', false,
          'error', 'chain_release_unsafe',
          'action', p_action
        );
      end if;

      return public.execute_property_lifecycle_release(
        p_property_id,
        p_reason,
        v_metadata
      ) || jsonb_build_object('action', p_action);

    when 'anonymise_historical' then
      if v_state <> 'released' then
        return jsonb_build_object('ok', true, 'skipped', true, 'action', p_action);
      end if;

      return public.execute_property_lifecycle_anonymise(
        p_property_id,
        p_reason,
        v_metadata
      ) || jsonb_build_object('action', p_action);

    else
      return jsonb_build_object('ok', false, 'error', 'unknown_action');
  end case;
end;
$$;

revoke all on function public.execute_property_lifecycle_action(
  bigint, text, text, text, uuid, jsonb
) from public;

-- Service role grants (worker only)
grant execute on function public.get_property_lifecycle_signals(bigint) to service_role;
grant execute on function public.record_property_lifecycle_transition_worker(
  bigint, text, text, text, text, jsonb
) to service_role;
grant execute on function public.list_property_lifecycle_worker_candidates(integer) to service_role;
grant execute on function public.try_acquire_property_lifecycle_lease(bigint, integer) to service_role;
grant execute on function public.release_property_lifecycle_lease(bigint) to service_role;
grant execute on function public.persist_property_analytics_snapshot(
  bigint, jsonb, text
) to service_role;
grant execute on function public.execute_enter_dormancy_warning(
  bigint, text, jsonb
) to service_role;
grant execute on function public.execute_property_lifecycle_archive(
  bigint, text, jsonb
) to service_role;
grant execute on function public.execute_property_lifecycle_release(
  bigint, text, jsonb
) to service_role;
grant execute on function public.execute_property_lifecycle_anonymise(
  bigint, text, jsonb
) to service_role;
grant execute on function public.execute_property_lifecycle_action(
  bigint, text, text, text, uuid, jsonb
) to service_role;
grant execute on function public.property_address_is_reserved(bigint) to service_role;
grant execute on function public.property_exists_for_onboarding(text, text, bigint) to service_role;
grant execute on function public.property_chain_is_connected(bigint) to service_role;
grant execute on function public.property_lifecycle_chain_release_safe(bigint) to service_role;
grant execute on function public.touch_property_operational_activity(bigint, boolean) to service_role;
