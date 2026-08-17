# EA Billing Stage 2 — Stripe Sandbox Checkout, Webhooks & Portal

**Status:** Implemented in repo (Sandbox). Entitlement enforcement remains **OFF**.  
**Production:** untouched.  
**Paid billing Production-ready:** **NO** until Sandbox E2E + webhook secret configured.

## Commercial

| Item | Value |
|---|---|
| Unit | EA branch |
| Customer (Day 1) | EA **branch** (`ea_branches.stripe_customer_id`) |
| Customer (future org) | EA company field reserved — not Day 1 Portal/Checkout |
| Subscription | EA branch |
| Founding | £99/month (first 20) |
| Standard | £129/month |
| Cancel | `cancel_at_period_end` |
| Grace | 7 days after unrecovered payment failure |
| Enforcement | `EA_BILLING_ENTITLEMENT_ENFORCEMENT_ENABLED = false` |

**Legal commercial locks (Phase 2A):** [LAUNCH_LEGAL_FOUNDER_DECISIONS.md](./LAUNCH_LEGAL_FOUNDER_DECISIONS.md) — founding places are permanently consumed when secured (cancel does not reopen £99); non-transferable; multi-branch of same company may each take a place while available; cancel-at-period-end; no ordinary partial refund. Public “20 founding places secured” milestone then ~1-month site sunset is **BACKLOG** (D-C1), not implemented as automatic removal.

## Flow

```
Owner → POST /api/billing/ea/checkout-session
  → ensure Branch Stripe Customer (not company)
  → live reserve_ea_founding_slot (30 minutes) OR conscious acceptStandardPricing
  → founding Checkout expires_at aligned to reservation (not 24h default)
  → stale founding Checkout is not reused after reservation expiry
  → Stripe Checkout (hosted) — customer always sees the price before paying
  → return /account?billing=success (no entitlement grant)
  → Stripe webhooks → confirm_ea_founding_slot is founding authority (not Price ID alone)
  → exceptional residual £99 race: cancel Stripe sub + audit; no silent £129 rebill
Owner → POST /api/billing/ea/portal-session → Customer Portal for THAT branch Customer only
```

Public founding availability (`get_ea_founding_availability`) may be cached ~10 minutes for marketing only. Checkout never uses that cache.

## Webhook chronology (P1)

- Authority: Stripe **`event.created`** (stored on `ea_branch_subscriptions.stripe_object_updated_at`)
- Not used as chronology: `current_period_end`, local receipt time, event id sort order
- Stale/out-of-order events are ignored; concurrent writes use a conditional update on the watermark
- `subscription.updated` / `deleted` use event payload snapshots
- `invoice.*` / `checkout.session.completed` may retrieve the live Subscription for state, but still advance the watermark from **`event.created`** only when not stale

## Environment variables

| Name | Required |
|---|---|
| `STRIPE_SECRET_KEY` | Yes (Sandbox `sk_test_…`) |
| `STRIPE_API_MODE` | Yes (`test`) |
| `STRIPE_EA_FOUNDING_PRICE_ID` | Yes |
| `STRIPE_EA_STANDARD_PRICE_ID` | Yes |
| `STRIPE_WEBHOOK_SECRET` | Required for live webhook processing |
| `NEXT_PUBLIC_APP_URL` | Recommended for success/cancel/return URLs |

Never use `NEXT_PUBLIC_` for Stripe secrets. Publishable key not required.

## Webhook setup (founder)

1. Stripe Dashboard → **Developers → Webhooks** (Test mode)
2. Add endpoint URL (local via Stripe CLI or deployed Dev URL):

```
https://<your-dev-host>/api/billing/stripe/webhook
```

Local CLI example:

```
stripe listen --forward-to localhost:3000/api/billing/stripe/webhook
```

3. Subscribe to events:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.paid`
   - `invoice.payment_failed`
4. Copy signing secret into `.env.local` as `STRIPE_WEBHOOK_SECRET` (do not paste into chat)
5. Restart the app

Without `STRIPE_WEBHOOK_SECRET`, the webhook route returns **503** and does **not** weaken signature verification.

## Customer Portal (founder Dashboard)

Test mode → Settings → Billing → Customer portal:

- Payment method update: **on**
- Invoice history: **on**
- Cancel subscription: **on**
- Cancellation mode: **cancel at end of billing period**
- Reactivation: enable if available

## Authoritative events

| Transition | Prefer |
|---|---|
| Become entitled / confirm founding | `invoice.paid` (+ active subscription) |
| Status/period/`cancel_at_period_end` | `customer.subscription.updated` |
| Payment problem → grace | `invoice.payment_failed` / `past_due` |
| Ended | `customer.subscription.deleted` or canceled after period end / grace exhausted |

## Additive migration

`20260729210000_billing_stage2_checkout_grace_foundation.sql`

- `stripe_checkout_session_id`
- `grace_ends_at`
- `stripe_object_updated_at`
- `confirm_ea_founding_slot`
- summary includes grace fields

## Webhook claim / retry integrity (P0)

**App behaviour (deployable without waiting on migration):** `lib/billing/eaStripeWebhook.ts` claims via RPC when present, otherwise a TypeScript fallback that inspects `processing_status` on unique conflict and reclaims `failed` / stale `processing`. Failed events return HTTP **500**; only `processed`/`ignored` return idempotent **200**.

**Preferred DB hardening:** apply `20260816200000_billing_p0_webhook_claim_retry.sql` for advisory-locked `claim_stripe_webhook_event` / `finish_stripe_webhook_event` and `processing_started_at`.

| Claim outcome | Meaning | HTTP to Stripe |
|---|---|---|
| `process` | New claim or reclaim of `failed` / stale `processing` | Continue handler |
| `already_succeeded` | Prior `processed` / `ignored` | **200** idempotent (no re-apply) |
| `in_progress` | Fresh processing lease held by another worker | **500** so Stripe retries |
| handler exception | Row marked `failed` (retryable); `processed_at` cleared | **500** |

**Boundary:** Stripe object retrieval happens outside Postgres. Local reconciliation statements run after retrieve; the event is marked `processed` only after reconciliation returns without throwing. A mid-reconcile crash may leave subscription rows updated and the event `failed`/`processing` — retry reclaims and re-applies an idempotent subscription patch (audit `ea_subscription_events` may gain an extra row on that rare path).

**Regression closed:** failed claim → unique conflict → 200 without reprocess.

Verifier: `scripts/verify-ea-billing-webhook-p0-development.ts`

## Authoritative grace expiry (P1)

Migration: `20260816210000_billing_p1_authoritative_grace_expiry.sql`

**Invariant:** `entitlement_status = grace` AND `grace_ends_at <= now()` ⇒ **effective entitlement is ended**, even with no further Stripe webhook.

**Architecture:** Hybrid lazy read-time authority (no new cron):

| Layer | Behaviour |
|---|---|
| `ea_effective_entitlement_status(...)` | Pure SQL mapping (expired grace → ended) |
| `is_ea_branch_commercially_entitled` | Uses effective status |
| `get_ea_branch_subscription_summary` | Best-effort conditional persist, returns effective `entitlement_status` |
| `apply_ea_branch_grace_expiry_if_due` | Conditional `grace`→`ended` UPDATE; cannot overwrite `entitled` recovery |
| TS `resolveEffectiveEntitlementStatus` | Same mapping for app paths (Checkout / entitlement helper) |

**Recovery race:** expiry UPDATE requires `entitlement_status = 'grace'`; a newer webhook that set `entitled` wins.

**No cron required** for security/entitlement correctness. Physical persist is best-effort on trusted reads.

Verifier: `scripts/verify-ea-billing-grace-expiry-development.ts`

## Branch-level Stripe Customer isolation (P1)

Migration: `20260816220000_billing_p1_branch_stripe_customer.sql`

**Day 1 model:**

```
Company
 ├── Branch A → Stripe Customer A → Subscription A
 └── Branch B → Stripe Customer B → Subscription B
```

- Authoritative Customer: `ea_branches.stripe_customer_id`
- `ea_companies.stripe_customer_id`: reserved for **future organisation billing** only (not written by Day 1 Checkout/Portal)
- Trigger blocks authenticated/anon mutation of branch `stripe_customer_id`
- Checkout attempt idempotency: in-flight marker `attempt:{uuid}` (founding:
  `attempt:{uuid}:{expiresAtUnix}`) is stored on
  `ea_branch_subscriptions.stripe_checkout_session_id` until Stripe returns the
  real session id. Stripe Idempotency-Key is
  `ea-checkout-{branchId}-{subscriptionId}-{tier}-{attemptId}`.
  Founding `expires_at` is frozen in the marker so Stripe idempotent retries
  send identical params. Same logical create (double-click / lost response)
  reuses the attempt id; expired/abandoned Checkout clears the session and
  rotates the attempt so Stripe’s ≥24h idempotency cache cannot block a
  legitimate new attempt. Never client-supplied.
- Branch Stripe Customer create key remains: `ea-branch-customer-{branchId}`

- Portal session uses `branchStripeCustomerId` only
- Webhooks continue to resolve via `keynetic_branch_id` / `stripe_subscription_id`; may backfill branch customer when null

**Sandbox cleanup:** obsolete company-scoped Customers that hold multiple branch subscriptions should not be reused. Prefer fresh Checkout after this change; cancel/delete orphan Sandbox test Customers in Stripe Dashboard if needed.

Verifier: `scripts/verify-ea-billing-portal-isolation-development.ts`

## Day 1 operational alerting / billing health

Lightweight safety net (no Datadog/PagerDuty/Redis):

- Cron: `GET/POST /api/cron/billing-health` once daily at 04:00 UTC (`0 4 * * *` in `vercel.json`) for Vercel Hobby compatibility; auth via `CRON_SECRET`. Intended future cadence is every 30 minutes when infrastructure allows it.
- Signals: failed `stripe_webhook_events`, stale `processing` (>10m), `founding_reconcile_exception`
- Not alerted: normal `invoice.payment_failed`, cancellations, Checkout abandon, Portal use, founding exhaustion
- Dedupe: `billing_ops_alert_state` (incident_key + 6h cooldown)
- Delivery: Resend via `BILLING_OPS_ALERT_EMAIL` (suggested `admin@keynetic.co.uk`); unset → detect but skip email
- Response: counts + incident keys only (no Stripe/customer PII)

Verifier: `scripts/verify-ea-billing-operational-alerting-development.ts`

## Stage 3 (not started)

Flip entitlement enforcement and gate `/agent`, origination, EA operational surfaces via `getEaBranchEntitlement()`.
