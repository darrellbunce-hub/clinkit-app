-- MoveLoop Stripe: payment_succeeded is recorded only from paid, non-zero
-- invoices and keyed by Stripe invoice id. Enforce at most one row per invoice.
-- Forward-safe: earlier payment_succeeded rows were status-derived and carry no
-- stripe_invoice_id, so they are outside the partial index.
-- Depends on nothing new; does not alter existing rows or other tables.

create unique index if not exists ea_subscription_events_payment_invoice_once_idx
  on public.ea_subscription_events ((metadata ->> 'stripe_invoice_id'))
  where event_type = 'payment_succeeded'
    and metadata ? 'stripe_invoice_id';

comment on index public.ea_subscription_events_payment_invoice_once_idx is
  'One payment_succeeded audit row per Stripe invoice; duplicate invoice.paid deliveries and retries hit this index instead of duplicating.';
