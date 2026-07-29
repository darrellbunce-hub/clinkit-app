-- Billing Stage 1: EA branch subscription architecture + database foundation.
-- Development-first. Does NOT enable paid entitlement enforcement.
-- Does NOT call Stripe or create Checkout/Portal/webhook handlers.
--
-- Commercial (founder-approved Stage 1):
--   Founding: £99/month per branch (first 20 eligible paying branches)
--   Standard: £129/month per branch thereafter
--   Billing unit: ea_branches
--
-- Existing free EA access behaviour is intentionally unchanged.

-- ---------------------------------------------------------------------------
-- 1) ea_branch_subscriptions — append-only lifecycle; one open row per branch
-- ---------------------------------------------------------------------------

create table if not exists public.ea_branch_subscriptions (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null
    references public.ea_branches (id) on delete restrict,

  -- Stripe identifiers (nullable until Billing Stage 2)
  stripe_customer_id text null,
  stripe_subscription_id text null,
  stripe_price_id text null,

  -- Commercial snapshot at subscription creation (server-authoritative)
  pricing_tier text not null
    check (pricing_tier in ('founding', 'standard')),
  amount_gbp_minor integer not null
    check (amount_gbp_minor > 0),
  currency text not null default 'gbp'
    check (currency = 'gbp'),
  founding_slot_number integer null
    check (
      founding_slot_number is null
      or founding_slot_number between 1 and 20
    ),

  -- Stripe mirror (not the entitlement decision alone)
  stripe_status text not null default 'not_started'
    check (
      stripe_status in (
        'not_started',
        'checkout_pending',
        'incomplete',
        'incomplete_expired',
        'trialing',
        'active',
        'past_due',
        'unpaid',
        'canceled',
        'paused'
      )
    ),

  -- Keynetic commercial entitlement (may diverge during grace / cancel_at_period_end)
  entitlement_status text not null default 'none'
    check (
      entitlement_status in (
        'none',
        'entitled',
        'grace',
        'ended'
      )
    ),

  current_period_start timestamptz null,
  current_period_end timestamptz null,
  cancel_at_period_end boolean not null default false,
  cancelled_at timestamptz null,
  ended_at timestamptz null,

  stripe_status_updated_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint ea_branch_subscriptions_founding_consistency_check
    check (
      (
        pricing_tier = 'founding'
        and founding_slot_number is not null
        and amount_gbp_minor = 9900
      )
      or (
        pricing_tier = 'standard'
        and founding_slot_number is null
        and amount_gbp_minor = 12900
      )
    ),
  constraint ea_branch_subscriptions_ended_entitlement_check
    check (
      ended_at is null
      or entitlement_status = 'ended'
    )
);

comment on table public.ea_branch_subscriptions is
  'Per-branch subscription lifecycle. Billing unit is ea_branches. Append-only history via ended_at; at most one open subscription per branch. Stage 1 foundation — Stripe sync in Stage 2; entitlement enforcement not enabled yet.';

comment on column public.ea_branch_subscriptions.stripe_status is
  'Mirror of Stripe subscription/checkout lifecycle. Do not treat alone as access control.';

comment on column public.ea_branch_subscriptions.entitlement_status is
  'Keynetic commercial entitlement: none | entitled | grace | ended. May remain entitled while cancel_at_period_end until current_period_end; grace during payment recovery.';

comment on column public.ea_branch_subscriptions.amount_gbp_minor is
  'Integer minor units (pence). Founding=9900 (£99), standard=12900 (£129). Never float.';

create unique index if not exists ea_branch_subscriptions_one_open_per_branch_idx
  on public.ea_branch_subscriptions (branch_id)
  where ended_at is null;

create unique index if not exists ea_branch_subscriptions_stripe_subscription_id_uidx
  on public.ea_branch_subscriptions (stripe_subscription_id)
  where stripe_subscription_id is not null;

create index if not exists ea_branch_subscriptions_branch_id_idx
  on public.ea_branch_subscriptions (branch_id);

create index if not exists ea_branch_subscriptions_entitlement_status_idx
  on public.ea_branch_subscriptions (entitlement_status)
  where ended_at is null;

-- ---------------------------------------------------------------------------
-- 2) ea_founding_slot_ledger — concurrency-safe founding cohort (slots 1–20)
-- ---------------------------------------------------------------------------

create table if not exists public.ea_founding_slot_ledger (
  id uuid primary key default gen_random_uuid(),
  slot_number integer not null
    check (slot_number between 1 and 20),
  branch_id uuid not null
    references public.ea_branches (id) on delete restrict,
  subscription_id uuid null
    references public.ea_branch_subscriptions (id) on delete set null,
  state text not null
    check (state in ('reserved', 'confirmed', 'released')),
  reserved_at timestamptz not null default now(),
  reservation_expires_at timestamptz not null,
  confirmed_at timestamptz null,
  released_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint ea_founding_slot_ledger_confirmed_requires_subscription_check
    check (
      state <> 'confirmed'
      or (subscription_id is not null and confirmed_at is not null)
    ),
  constraint ea_founding_slot_ledger_released_timestamp_check
    check (
      state <> 'released'
      or released_at is not null
    )
);

comment on table public.ea_founding_slot_ledger is
  'Founding cohort slots 1–20. reserved = short-lived checkout hold; confirmed = paid founding subscription; released = expired/abandoned reservation. Allocation must be concurrency-safe via reserve_ea_founding_slot(). Released rows remain for audit; slot_number may be reused by a later active row.';

-- At most one active hold per slot number (released rows do not block reuse).
create unique index if not exists ea_founding_slot_ledger_one_active_per_slot_idx
  on public.ea_founding_slot_ledger (slot_number)
  where state in ('reserved', 'confirmed');

-- A branch may only hold one non-released slot at a time.
create unique index if not exists ea_founding_slot_ledger_one_active_per_branch_idx
  on public.ea_founding_slot_ledger (branch_id)
  where state in ('reserved', 'confirmed');

create index if not exists ea_founding_slot_ledger_state_idx
  on public.ea_founding_slot_ledger (state);

-- ---------------------------------------------------------------------------
-- 3) stripe_webhook_events — idempotency foundation (no payload storage)
-- ---------------------------------------------------------------------------

create table if not exists public.stripe_webhook_events (
  id uuid primary key default gen_random_uuid(),
  stripe_event_id text not null,
  event_type text not null,
  processing_status text not null default 'received'
    check (
      processing_status in ('received', 'processed', 'ignored', 'failed')
    ),
  error_message text null,
  received_at timestamptz not null default now(),
  processed_at timestamptz null,

  constraint stripe_webhook_events_stripe_event_id_unique
    unique (stripe_event_id)
);

comment on table public.stripe_webhook_events is
  'Stripe webhook idempotency ledger. Stores event id/type/status only — not full payloads or payment credentials. Stage 2 will process events.';

create index if not exists stripe_webhook_events_received_at_idx
  on public.stripe_webhook_events (received_at desc);

create index if not exists stripe_webhook_events_processing_status_idx
  on public.stripe_webhook_events (processing_status);

-- ---------------------------------------------------------------------------
-- 4) ea_subscription_events — lightweight commercial audit trail
-- ---------------------------------------------------------------------------

create table if not exists public.ea_subscription_events (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null
    references public.ea_branches (id) on delete restrict,
  subscription_id uuid null
    references public.ea_branch_subscriptions (id) on delete set null,
  event_type text not null
    check (
      event_type in (
        'subscription_started',
        'payment_succeeded',
        'payment_failed',
        'cancellation_scheduled',
        'cancellation_reversed',
        'subscription_expired',
        'resubscribed',
        'entitlement_changed',
        'founding_slot_reserved',
        'founding_slot_confirmed',
        'founding_slot_released'
      )
    ),
  actor_source text not null default 'system'
    check (actor_source in ('system', 'webhook', 'admin', 'user')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.ea_subscription_events is
  'Minimal Keynetic subscription lifecycle audit. Separate from stripe_webhook_events idempotency. Do not store card data.';

create index if not exists ea_subscription_events_branch_id_created_at_idx
  on public.ea_subscription_events (branch_id, created_at desc);

create index if not exists ea_subscription_events_subscription_id_idx
  on public.ea_subscription_events (subscription_id)
  where subscription_id is not null;

-- ---------------------------------------------------------------------------
-- 5) Deprecate company-level Stripe stub (keep column; document Stage 2 plan)
-- ---------------------------------------------------------------------------

comment on column public.ea_companies.stripe_customer_id is
  'DEPRECATED stub from foundation schema. Billing Stage 1 attaches subscriptions to ea_branches via ea_branch_subscriptions. Stage 2 recommendation: Stripe Customer owned at ea_companies (shared across branch subscriptions); this column may be reused or dual-written. Do not treat as authoritative entitlement.';

comment on table public.ea_companies is
  'Estate agency company (organisation layer). Commercial billing unit is the branch (ea_branches), not the company. Stripe Customer may still be company-scoped in Stage 2 while each branch has its own Subscription.';

-- ---------------------------------------------------------------------------
-- 6) RLS — billing tables are not client-mutable
-- ---------------------------------------------------------------------------

alter table public.ea_branch_subscriptions enable row level security;
alter table public.ea_founding_slot_ledger enable row level security;
alter table public.stripe_webhook_events enable row level security;
alter table public.ea_subscription_events enable row level security;

revoke all on public.ea_branch_subscriptions from public;
revoke all on public.ea_branch_subscriptions from anon;
revoke all on public.ea_branch_subscriptions from authenticated;

revoke all on public.ea_founding_slot_ledger from public;
revoke all on public.ea_founding_slot_ledger from anon;
revoke all on public.ea_founding_slot_ledger from authenticated;

revoke all on public.stripe_webhook_events from public;
revoke all on public.stripe_webhook_events from anon;
revoke all on public.stripe_webhook_events from authenticated;

revoke all on public.ea_subscription_events from public;
revoke all on public.ea_subscription_events from anon;
revoke all on public.ea_subscription_events from authenticated;

-- service_role retains full access by default in Supabase (bypasses RLS).

-- Branch members may READ open/ended subscription summary for their own branch only.
grant select on public.ea_branch_subscriptions to authenticated;

drop policy if exists ea_branch_subscriptions_select_member
  on public.ea_branch_subscriptions;

create policy ea_branch_subscriptions_select_member
  on public.ea_branch_subscriptions
  for select
  to authenticated
  using (public.is_ea_branch_member(branch_id));

-- Founding ledger: no authenticated table SELECT (prevents cohort enumeration).
-- stripe_webhook_events: no authenticated access.
-- Audit events: branch members may read their branch audit rows only.
grant select on public.ea_subscription_events to authenticated;

drop policy if exists ea_subscription_events_select_member
  on public.ea_subscription_events;

create policy ea_subscription_events_select_member
  on public.ea_subscription_events
  for select
  to authenticated
  using (public.is_ea_branch_member(branch_id));

-- ---------------------------------------------------------------------------
-- 7) Internal helpers (Stage 1 foundation; not wired to Checkout yet)
-- ---------------------------------------------------------------------------

create or replace function public._release_expired_ea_founding_reservations()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  with released as (
    update public.ea_founding_slot_ledger
    set
      state = 'released',
      released_at = now(),
      updated_at = now()
    where state = 'reserved'
      and reservation_expires_at <= now()
    returning slot_number
  )
  select count(*)::integer into v_count from released;

  return coalesce(v_count, 0);
end;
$$;

comment on function public._release_expired_ea_founding_reservations() is
  'Internal: release expired founding checkout reservations so slots can be reused.';

revoke all on function public._release_expired_ea_founding_reservations() from public;
revoke all on function public._release_expired_ea_founding_reservations() from anon;
revoke all on function public._release_expired_ea_founding_reservations() from authenticated;

-- Concurrency-safe founding slot reservation.
-- Returns jsonb: { ok, slot_number?, error? }
-- Does NOT allocate on signup — only when Stage 2 checkout requests a hold.
create or replace function public.reserve_ea_founding_slot(
  p_branch_id uuid,
  p_reservation_seconds integer default 1800
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seconds integer;
  v_existing public.ea_founding_slot_ledger%rowtype;
  v_slot integer;
  v_expires timestamptz;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  if p_branch_id is null then
    return jsonb_build_object('ok', false, 'error', 'branch_required');
  end if;

  if not public.is_ea_branch_admin(p_branch_id) then
    return jsonb_build_object('ok', false, 'error', 'not_branch_admin');
  end if;

  v_seconds := greatest(coalesce(p_reservation_seconds, 1800), 60);
  v_seconds := least(v_seconds, 7200);

  -- Serialise founding allocation across concurrent checkouts.
  perform pg_advisory_xact_lock(hashtext('ea_founding_slot_ledger'));

  perform public._release_expired_ea_founding_reservations();

  select *
  into v_existing
  from public.ea_founding_slot_ledger
  where branch_id = p_branch_id
    and state in ('reserved', 'confirmed')
  limit 1;

  if v_existing.slot_number is not null then
    if v_existing.state = 'confirmed' then
      return jsonb_build_object(
        'ok', true,
        'slot_number', v_existing.slot_number,
        'state', 'confirmed'
      );
    end if;

    -- Extend existing reservation
    v_expires := now() + make_interval(secs => v_seconds);
    update public.ea_founding_slot_ledger
    set
      reservation_expires_at = v_expires,
      updated_at = now()
    where id = v_existing.id
      and state = 'reserved';

    return jsonb_build_object(
      'ok', true,
      'slot_number', v_existing.slot_number,
      'state', 'reserved',
      'reservation_expires_at', v_expires
    );
  end if;

  select s.slot_number
  into v_slot
  from generate_series(1, 20) as s(slot_number)
  where not exists (
    select 1
    from public.ea_founding_slot_ledger l
    where l.slot_number = s.slot_number
      and l.state in ('reserved', 'confirmed')
  )
  order by s.slot_number
  limit 1;

  if v_slot is null then
    return jsonb_build_object('ok', false, 'error', 'founding_cohort_full');
  end if;

  v_expires := now() + make_interval(secs => v_seconds);

  insert into public.ea_founding_slot_ledger (
    slot_number,
    branch_id,
    state,
    reserved_at,
    reservation_expires_at
  )
  values (
    v_slot,
    p_branch_id,
    'reserved',
    now(),
    v_expires
  );

  insert into public.ea_subscription_events (
    branch_id,
    event_type,
    actor_source,
    metadata
  )
  values (
    p_branch_id,
    'founding_slot_reserved',
    'system',
    jsonb_build_object(
      'slot_number', v_slot,
      'reservation_expires_at', v_expires
    )
  );

  return jsonb_build_object(
    'ok', true,
    'slot_number', v_slot,
    'state', 'reserved',
    'reservation_expires_at', v_expires
  );
exception
  when unique_violation then
    return jsonb_build_object('ok', false, 'error', 'founding_allocation_conflict');
end;
$$;

comment on function public.reserve_ea_founding_slot(uuid, integer) is
  'Concurrency-safe founding slot reservation for branch Owner. Short-lived hold for checkout price selection; confirm on successful payment in Stage 2. Does not grant entitlement.';

revoke all on function public.reserve_ea_founding_slot(uuid, integer) from public;
revoke all on function public.reserve_ea_founding_slot(uuid, integer) from anon;
grant execute on function public.reserve_ea_founding_slot(uuid, integer) to authenticated;

-- Read-only commercial summary for Account Settings (Stage 2 UI).
create or replace function public.get_ea_branch_subscription_summary(
  p_branch_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_sub public.ea_branch_subscriptions%rowtype;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  if p_branch_id is null then
    return jsonb_build_object('ok', false, 'error', 'branch_required');
  end if;

  if not public.is_ea_branch_member(p_branch_id) then
    return jsonb_build_object('ok', false, 'error', 'not_branch_member');
  end if;

  select *
  into v_sub
  from public.ea_branch_subscriptions
  where branch_id = p_branch_id
    and ended_at is null
  order by created_at desc
  limit 1;

  if v_sub.id is null then
    return jsonb_build_object(
      'ok', true,
      'branch_id', p_branch_id,
      'has_subscription', false,
      'entitlement_status', 'none',
      'stripe_status', 'not_started',
      'enforcement_enabled', false
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'branch_id', p_branch_id,
    'has_subscription', true,
    'subscription_id', v_sub.id,
    'pricing_tier', v_sub.pricing_tier,
    'amount_gbp_minor', v_sub.amount_gbp_minor,
    'currency', v_sub.currency,
    'founding_slot_number', v_sub.founding_slot_number,
    'stripe_status', v_sub.stripe_status,
    'entitlement_status', v_sub.entitlement_status,
    'current_period_end', v_sub.current_period_end,
    'cancel_at_period_end', v_sub.cancel_at_period_end,
    'cancelled_at', v_sub.cancelled_at,
    'enforcement_enabled', false
  );
end;
$$;

comment on function public.get_ea_branch_subscription_summary(uuid) is
  'Branch-member-readable subscription summary. Does not expose Stripe customer secrets. enforcement_enabled=false until Billing Stage 2+ entitlement wiring.';

revoke all on function public.get_ea_branch_subscription_summary(uuid) from public;
revoke all on function public.get_ea_branch_subscription_summary(uuid) from anon;
grant execute on function public.get_ea_branch_subscription_summary(uuid) to authenticated;

-- Pure helper: map entitlement_status → commercial access flag (for Stage 2 gates).
-- Stage 1: application MUST NOT use this to deny EA access yet.
create or replace function public.is_ea_branch_commercially_entitled(
  p_branch_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.ea_branch_subscriptions s
    where s.branch_id = p_branch_id
      and s.ended_at is null
      and s.entitlement_status in ('entitled', 'grace')
  );
$$;

comment on function public.is_ea_branch_commercially_entitled(uuid) is
  'True when open subscription entitlement_status is entitled or grace. Stage 1: NOT wired into route guards — free EA access remains.';

revoke all on function public.is_ea_branch_commercially_entitled(uuid) from public;
revoke all on function public.is_ea_branch_commercially_entitled(uuid) from anon;
grant execute on function public.is_ea_branch_commercially_entitled(uuid) to authenticated;
