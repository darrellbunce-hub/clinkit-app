-- MoveLoop Stripe trial: audit event types for trial start and Stripe/database
-- reconciliation. Does not enable entitlement enforcement.
-- Forward-safe: every existing row satisfies the widened constraint, and no
-- trial_started rows exist before this migration.

-- ---------------------------------------------------------------------------
-- 1) Allow trial_started and billing_reconcile_required
-- ---------------------------------------------------------------------------

alter table public.ea_subscription_events
  drop constraint if exists ea_subscription_events_event_type_check;

alter table public.ea_subscription_events
  add constraint ea_subscription_events_event_type_check
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
      'founding_slot_released',
      'founding_reconcile_exception',
      'trial_started',
      'billing_reconcile_required'
    )
  );

-- ---------------------------------------------------------------------------
-- 2) trial_started is recorded at most once per Stripe subscription
-- ---------------------------------------------------------------------------

alter table public.ea_subscription_events
  drop constraint if exists ea_subscription_events_trial_started_subscription_check;

alter table public.ea_subscription_events
  add constraint ea_subscription_events_trial_started_subscription_check
  check (
    event_type <> 'trial_started'
    or nullif(metadata ->> 'stripe_subscription_id', '') is not null
  );

create unique index if not exists ea_subscription_events_trial_started_once_idx
  on public.ea_subscription_events ((metadata ->> 'stripe_subscription_id'))
  where event_type = 'trial_started';

comment on index public.ea_subscription_events_trial_started_once_idx is
  'One trial_started audit row per Stripe subscription; webhook retries and concurrent deliveries hit this index instead of duplicating.';
