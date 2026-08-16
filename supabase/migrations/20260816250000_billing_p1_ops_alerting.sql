-- P1: Day 1 Stripe billing operational alert state (dedupe / incident tracking).
-- Authoritative billing health remains stripe_webhook_events + ea_subscription_events.
-- This table only tracks whether ops has already been notified for an open incident.

create table if not exists public.billing_ops_alert_state (
  incident_key text primary key,
  severity text not null,
  status text not null,
  title text not null,
  detail jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_alerted_at timestamptz null,
  resolved_at timestamptz null,
  alert_send_count integer not null default 0,
  last_delivery_status text null,
  updated_at timestamptz not null default now(),
  constraint billing_ops_alert_state_severity_check
    check (severity in ('critical', 'warning')),
  constraint billing_ops_alert_state_status_check
    check (status in ('open', 'resolved')),
  constraint billing_ops_alert_state_delivery_check
    check (
      last_delivery_status is null
      or last_delivery_status in ('sent', 'skipped', 'failed', 'deduped')
    ),
  constraint billing_ops_alert_state_send_count_check
    check (alert_send_count >= 0)
);

comment on table public.billing_ops_alert_state is
  'Day 1 Stripe billing ops alert dedupe state. Not a billing ledger; webhook/subscription tables remain authoritative.';

create index if not exists billing_ops_alert_state_status_idx
  on public.billing_ops_alert_state (status, severity);

create index if not exists billing_ops_alert_state_last_seen_idx
  on public.billing_ops_alert_state (last_seen_at desc);

alter table public.billing_ops_alert_state enable row level security;

revoke all on table public.billing_ops_alert_state from public;
revoke all on table public.billing_ops_alert_state from anon;
revoke all on table public.billing_ops_alert_state from authenticated;

grant select, insert, update, delete on table public.billing_ops_alert_state
  to service_role;
