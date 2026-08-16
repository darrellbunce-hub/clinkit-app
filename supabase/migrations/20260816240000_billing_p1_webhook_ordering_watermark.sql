-- Billing P1: stripe_object_updated_at chronology authority (event.created).
-- Clears legacy values that stored current_period_end (often far in the future)
-- so older/out-of-order webhooks cannot be mis-ordered against period boundaries.
-- Idempotent / forward-safe. Does not enable entitlement enforcement.

comment on column public.ea_branch_subscriptions.stripe_object_updated_at is
  'Chronology watermark: Stripe event.created of the last webhook reconciliation applied to this row. Used to ignore stale/out-of-order webhook delivery. NOT current_period_end and NOT local receipt time.';

-- Legacy Stage 2 incorrectly stored current_period_end in this column.
update public.ea_branch_subscriptions
set
  stripe_object_updated_at = null,
  updated_at = now()
where stripe_object_updated_at is not null
  and stripe_object_updated_at > now() + interval '1 hour';
