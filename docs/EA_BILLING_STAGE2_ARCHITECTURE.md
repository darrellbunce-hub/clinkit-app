# EA Billing Stage 2 — Stripe Sandbox Checkout, Webhooks & Portal

**Status:** Implemented in repo (Sandbox). Entitlement enforcement remains **OFF**.

**Customer billing communications:** Development baseline complete (**29/29** execute) — [EA_BILLING_CUSTOMER_COMMUNICATIONS.md](./EA_BILLING_CUSTOMER_COMMUNICATIONS.md).

**Production:** untouched.

**Paid billing Production-ready:** **NO** until Production parity + charging configuration.

**Freeze:** [DEVELOPMENT_BASELINE_FREEZE.md](./DEVELOPMENT_BASELINE_FREEZE.md).

## Commercial

| Item | Value |
|---|---|
| Unit | EA branch |
| Customer (Day 1) | EA **branch** (`ea_branches.stripe_customer_id`) |
| Customer (future org) | EA company field reserved — not Day 1 Portal/Checkout |
| Subscription | EA branch |
| New subscriptions | Standard £129/month only |
| Free trial | 30 days, card required at Checkout, no payment during the trial |
| Trial conversion | Automatically £129/month at trial end unless cancelled before |
| Trial end, no payment method | Stripe cancels the subscription (`missing_payment_method: cancel`) |
| Trial limit | One trial per branch (see Trial eligibility) |
| Founding | £99/month — **historical only**, closed to new subscriptions; existing founding subscriptions keep reconciling |
| Cancel | `cancel_at_period_end` (during a trial: ends at trial end, no charge) |
| Grace | 7 days after unrecovered payment failure (includes a failed first charge at trial end) |
| Enforcement | `EA_BILLING_ENTITLEMENT_ENFORCEMENT_ENABLED = false` |

**Legal commercial locks (Phase 2A):** [LAUNCH_LEGAL_FOUNDER_DECISIONS.md](./LAUNCH_LEGAL_FOUNDER_DECISIONS.md) — founding places are permanently consumed when secured (cancel does not reopen £99); non-transferable; cancel-at-period-end; no ordinary partial refund. The founding offer is now **closed** to new subscriptions. Terms of Service §12 and Privacy Policy wording about founding arrangements are pending legal review and have not been changed.

## Flow

```
Owner → POST /api/billing/ea/checkout-session   (body: branchId only)
  → already entitled / grace / trialing / active / past_due → 409 already_subscribed
  → pending Checkout session status "complete" → 409 checkout_processing (session id kept)
  → ensure Branch Stripe Customer (not company)
  → list ALL Stripe subscriptions on that Customer (fails closed → 503 subscription_check_unavailable)
      billable subscription from this row's own completed Checkout → 409 checkout_processing
      any other billable subscription → 409 stripe_subscription_exists (+ reconcile event)
  → trial eligibility: database evidence + Stripe evidence
  → Stripe Checkout (hosted), subscription mode, STRIPE_EA_STANDARD_PRICE_ID only:
      payment_method_collection: "always"
      subscription_data.trial_period_days: 30                 (eligible branches only)
      subscription_data.trial_settings.end_behavior.missing_payment_method: "cancel"
      metadata keynetic_checkout_offer: standard_trial_30d | standard_no_trial
  → return /account?billing=success (no entitlement grant)
  → Stripe webhooks: trialing → entitled; trial end → active (£129 invoice) or cancelled
Owner → POST /api/billing/ea/portal-session → Customer Portal for THAT branch Customer only
```

New Checkout never calls `reserve_ea_founding_slot`, never uses the founding price and never sets a founding `expires_at`. An open Checkout session is reused only when its `keynetic_checkout_offer` matches the current offer; sessions created under older pricing (including founding) are expired and replaced.

`get_ea_founding_availability` and its cache are no longer used by marketing pages; the helpers remain for the historical founding verifier only.

## Trial eligibility (one trial per branch)

A branch receives the 30-day trial only if **both** checks find no previous subscription:

| Evidence | Check | Covers |
|---|---|---|
| Database | any `ea_branch_subscriptions` row for the branch with `stripe_subscription_id` set (ended, cancelled, past-due, founding — all count; rows are never deleted, FK `on delete restrict`) | normal history |
| Stripe | `subscriptions.list({ customer: ea_branches.stripe_customer_id, status: "all" })`, all pages; any subscription in any status (active, trialing, past_due, canceled, unpaid, incomplete, incomplete_expired, paused) | delayed or failed webhooks |

- Abandoned or expired Checkout creates no subscription, so it never consumes the trial.
- Eligibility is per branch and per branch Stripe Customer; changing owner, user or billing contact does not reset it. A different branch has its own Customer and its own trial.
- The Stripe Customer id is server-managed (`prevent_client_ea_branch_stripe_customer_mutation`) and comes from the authorised branch; the lookup only returns a yes/no decision.
- If either check errors, Checkout returns **503 `subscription_check_unavailable`** (retryable) — no Checkout is created and a trial is never granted by default.
- Ineligible branches get `standard_no_trial`: £129 charged at Checkout.

## Duplicate subscription guard

The same Stripe listing gates **every** new or reused Checkout, not just the trial decision, so a database row that wrongly shows ended (or a missing row) cannot lead to a second subscription. Decision logic: `lib/billing/eaCheckoutSubscriptionGuard.ts`.

| Stripe status | Checkout | Trial | Why |
|---|---|---|---|
| `active`, `trialing`, `past_due` | Blocked | — | Billing or entitled now (including `cancel_at_period_end`) |
| `unpaid`, `paused` | Blocked | — | Mapped to `ended` locally, but Stripe can resume them; resolve via Portal or ops |
| `incomplete` | Blocked | — | First payment can still succeed; Stripe expires it after ~23 hours, which unblocks Checkout |
| `incomplete_expired` | Allowed | Used up | Terminal, never charged. Only arises from no-trial Checkouts (trial subscriptions start as `trialing`), so in practice the branch was already ineligible |
| `canceled` | Allowed | Used up | Terminal; a new paid subscription is legitimate |

- Blocked because of this open row's own subscription (Stripe metadata `keynetic_subscription_id` = row, row still `checkout_pending`) → **409 `checkout_processing`**: delayed webhook, not a discrepancy.
- Blocked otherwise → **409 `stripe_subscription_exists`**. When the blocking subscription is not the one linked to the open row, Checkout logs `[billing-reconcile]` (branch, Stripe subscription ids and statuses, open row id/status) and records `billing_reconcile_required` in `ea_subscription_events` (deduped per Stripe subscription per day). Billing health raises a **WARNING** incident for any such event in the last 72 hours.
- Before responding, every open Checkout session for the branch (the stored one plus any open session listed on the branch's own Customer) is expired, but only if its Customer and `keynetic_branch_id` metadata match the branch. An already-complete session → `checkout_processing`. If listing or expiry fails → **503 `checkout_session_expiry_failed`**, logged and recorded as `billing_reconcile_required`; no new session is created.
- Replacing a stale or other-offer session also requires its expiry to succeed first; otherwise 503 and no new session.
- Checkout never cancels or modifies existing Stripe subscriptions; ops reconcile manually (replay the webhook, or cancel in Stripe if genuinely unwanted).
- Concurrent Checkout requests can both pass the Stripe check before either subscription exists. After `checkout.session.completed` and `customer.subscription.created/updated`, once a live subscription is linked to an open branch row, the webhook expires every other open session on the same Customer and branch (`expireOtherCheckoutSessionsAfterLink`). The completed session and any session carrying the linked subscription are never touched; unlinked (conflicting), terminal or ended subscriptions are skipped. It runs from database state on every such event, so retries repeat it; expiry/listing failure, or another session found already complete, records `billing_reconcile_required` without failing the event. Residual race: if both sessions complete before either webhook runs, two subscriptions exist; the second is caught by association protection (conflict, alert, manual cancel/refund).

## Webhook subscription association

A webhook never silently re-points a subscription row (or the branch) at a different Stripe subscription (`lib/billing/eaSubscriptionAssociation.ts`):

| Situation | Result |
|---|---|
| Row unlinked, or linked to the same subscription | Link / update as normal |
| Row linked to another subscription that is `canceled`, `incomplete_expired` or missing in Stripe | Take over the row; `resubscribed` audit row with `replaced_stripe_subscription_id` |
| Row linked to another live subscription (any other status) | **Conflict** |
| Confirmed historical founding row linked to another subscription | **Conflict** (founding rows are never re-pointed) |
| Late `canceled`/`incomplete_expired` event for a subscription that no longer owns the row | Ignored |
| Live subscription for an ended row while the branch has another open row | **Conflict** |

- Conflict: no row write, no founding confirmation, no Stripe subscription touched; `[billing-reconcile]` log and `billing_reconcile_required` (branch, row, incoming and existing subscription ids/statuses; deduped per incoming subscription and reason per day). The webhook event completes; a failed reconcile insert fails it for retry. Billing health alerts.
- The row write is compare-and-swap on the association that was read; if another webhook linked a different subscription meanwhile, the event fails and the retry re-evaluates.
- Looking up the previously linked subscription's status is a Stripe GET; errors other than `resource_missing` fail the event for retry.
- The listing covers the branch's own Customer only. If a legacy Customer were ever shared between branches, another branch's subscription would block this branch (conservative); the reconcile metadata records whether each subscription's `keynetic_branch_id` matches.

## Completed Checkout recovery

- Both session-reuse paths retrieve the stored Checkout session. Status `complete` → **409 `checkout_processing`** with a "confirming your subscription" message; the session id is kept so the webhook can link the subscription.
- Status `expired` (or a session Stripe reports as `resource_missing`) → cleared and a new attempt is started, as before.
- Any other Stripe error retrieving the session → **503** without clearing anything (never treated as abandoned).
- Before creating a new session the open row is reset to `checkout_pending` only if its status is unchanged since it was read; if a webhook has just linked the subscription the request returns `checkout_processing`.
- The new session id is stored only if the row still holds this request's attempt marker (or the same session id from a concurrent duplicate) and is still `checkout_pending`. Otherwise the new session is expired immediately.
- If the stored session id was lost but Stripe already has the subscription created for this row, the duplicate guard returns `checkout_processing` as well.
- Abandoned or expired sessions create no subscription, so neither the guard nor the trial check blocks a retry.
- Account page: after `billing=success` it polls every 4s for 30s and hides "Continue checkout" while the row is still `checkout_pending`, showing "Confirming your subscription with Stripe…". If a webhook is delayed beyond that, pressing the button again returns `checkout_processing` until the webhook arrives.

**Concurrency:** simultaneous requests compute the same offer from the same evidence, claim the same `attempt:{uuid}` marker (conditional update) and send the same Stripe Idempotency-Key, so Stripe returns one session. The key includes the offer, so a request evaluated under a different offer cannot reuse a session created with different trial parameters; whichever attempt does not own the marker at write time expires its session.

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
| `STRIPE_EA_FOUNDING_PRICE_ID` | Optional — historical founding identification only; keep it set wherever founding subscriptions may exist so founding prices are recognised even without metadata |
| `STRIPE_EA_STANDARD_PRICE_ID` | Yes — must be the £129 GBP monthly price; used for every new Checkout |
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
- Cancellation mode: **cancel at end of billing period** (during a trial this is the trial end)
- Reactivation: enable if available
- Subscription update / plan switching: **off** (customers must not be able to move to the historical £99 price)

## Authoritative events

| Transition | Prefer |
|---|---|
| Trial starts (entitled, £0 invoice) | `checkout.session.completed` / `customer.subscription.created` (`trialing`) |
| Become entitled / confirm historical founding | `invoice.paid` (+ active subscription) |
| Trial converts to paid | `customer.subscription.updated` (`trialing` → `active`) + `invoice.paid` (£129) |
| Trial ends with no payment method | `customer.subscription.deleted` |
| Status/period/`cancel_at_period_end` | `customer.subscription.updated` |
| Payment problem → grace | `invoice.payment_failed` / `past_due` |
| Ended | `customer.subscription.deleted` or canceled after period end / grace exhausted |

### Scheduled cancellation

A cancellation is pending when a non-terminal subscription has `cancel_at_period_end = true` **or** a `cancel_at` later than the event (the Customer Portal sends `cancel_at` with `cancel_at_period_end = false`). It takes effect at `cancel_at`, else `current_period_end`; entitlement continues until `customer.subscription.deleted`. Terminal statuses keep the `cancel_at_period_end`-only mapping.

- Row: `cancel_at_period_end = true` while pending; `cancelled_at` = Stripe `canceled_at` (kept across repeated updates). Both clear on reversal.
- Email: one per subscription and effective date (dispatch key), attempted on every update while pending.
- Audit: one `cancellation_scheduled` per subscription and effective date; its primary key is derived from both, so retries and concurrent deliveries collapse to one row.

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
- Checkout attempt idempotency: in-flight marker `attempt:{uuid}` is stored on
  `ea_branch_subscriptions.stripe_checkout_session_id` until Stripe returns the
  real session id (markers written by the old founding flow,
  `attempt:{uuid}:{expiresAtUnix}`, still parse). Stripe Idempotency-Key is
  `ea-checkout-{branchId}-{subscriptionId}-{tier}-{offer}-{attemptId}`; the
  offer makes trial and non-trial creates distinct. Same logical create
  (double-click / lost response) reuses the attempt id; expired/abandoned
  Checkout clears the session and rotates the attempt so Stripe’s ≥24h
  idempotency cache cannot block a legitimate new attempt. A completed session
  is never cleared (see Completed Checkout recovery). Never client-supplied.
- Branch Stripe Customer create key remains: `ea-branch-customer-{branchId}`

- Portal session uses `branchStripeCustomerId` only
- Webhooks continue to resolve via `keynetic_branch_id` / `stripe_subscription_id`; may backfill branch customer when null

**Sandbox cleanup:** obsolete company-scoped Customers that hold multiple branch subscriptions should not be reused. Prefer fresh Checkout after this change; cancel/delete orphan Sandbox test Customers in Stripe Dashboard if needed.

Verifier: `scripts/verify-ea-billing-portal-isolation-development.ts`

## Day 1 operational alerting / billing health

Lightweight safety net (no Datadog/PagerDuty/Redis):

- Cron: `GET/POST /api/cron/billing-health` once daily at 04:00 UTC (`0 4 * * *` in `vercel.json`) for Vercel Hobby compatibility; auth via `CRON_SECRET`. Intended future cadence is every 30 minutes when infrastructure allows it.
- Signals: failed `stripe_webhook_events`, stale `processing` (>10m), `founding_reconcile_exception`
- Not alerted: normal `invoice.payment_failed`, cancellations, Checkout abandon, Portal use
- Dedupe: `billing_ops_alert_state` (incident_key + 6h cooldown)
- Delivery: Resend via `BILLING_OPS_ALERT_EMAIL` (suggested `admin@keynetic.co.uk`); unset → detect but skip email
- Response: counts + incident keys only (no Stripe/customer PII)

Verifier: `scripts/verify-ea-billing-operational-alerting-development.ts`

## Customer billing communications (transactional)

See [EA_BILLING_CUSTOMER_COMMUNICATIONS.md](./EA_BILLING_CUSTOMER_COMMUNICATIONS.md).

- Confirmation / payment-failed / cancel emails after successful reconcile transitions
- Grace mid + final reminders from `/api/cron/billing-health` (same daily cron)
- Atomic dispatch ledger: `billing_customer_email_dispatches`
- **No** monthly Keynetic successful-payment emails — configure Stripe Dashboard receipts/invoices for Production

Verifier: `scripts/verify-ea-billing-customer-communications-development.ts`

## Trial notes and known limitations

- **Billing period fallback:** newer Stripe API versions expose the billing
  period only on subscription items. The webhook reads
  `current_period_start/end` from the subscription (older payloads), otherwise
  from the first subscription item, and stores null if neither is present.
  EA subscriptions have a single item.
  During a trial the period end equals the trial end (= first charge date).
- **Subscription confirmation email** (trial start) states the trial end /
  first £129 payment date. **No Keynetic email is sent when a trial converts**
  to paid; Stripe Dashboard receipts/invoices and Stripe's trial-ending
  reminder (Dashboard setting) must be configured for Production.
- Customer email dates are formatted in `Europe/London` (BST/GMT-correct for
  trial end, first payment, renewal, grace and cancellation dates).
- **Audit events** (migration `20261108160000_ea_billing_trial_started_audit_event.sql`,
  must be applied **before** this webhook code is deployed):
  - `trial_started` is recorded once per Stripe subscription by whichever
    trialing webhook arrives first; the partial unique index
    `ea_subscription_events_trial_started_once_idx` absorbs retries and
    concurrent deliveries.
  - `payment_succeeded` is recorded only from `invoice.paid` with
    `amount_paid > 0` (never from a subscription status change, never for the
    £0 trial invoice), keyed by `stripe_invoice_id`, independent of
    subscription chronology. Migration
    `20261108170000_ea_billing_payment_succeeded_invoice_dedupe.sql` adds the
    per-invoice unique index; before it is applied, dedupe relies on the
    webhook event claim plus a lookup. Older status-derived rows have no
    invoice id and are unaffected.
  - A failed webhook audit insert logs `[billing-audit]` and fails the webhook
    event (`audit_event_insert_failed:<type>:<code>`), so billing health alerts
    and Stripe retries. Audit rows are written after customer emails, so a
    retry cannot skip an email.
- A completed Checkout whose webhooks never arrive keeps returning
  `checkout_processing` until Stripe retries succeed (failed webhooks are
  alerted by billing health) or an operator reconciles.

## Historical founding compatibility

- Founding rows (`pricing_tier = founding`, £99, confirmed `founding_slot_number`)
  remain valid and keep reconciling via webhooks.
- The webhook identifies founding by `STRIPE_EA_FOUNDING_PRICE_ID` (when set),
  `keynetic_pricing_tier = founding` metadata or an existing founding row, and
  confirms via the idempotent
  `confirm_ea_founding_slot` (`already_confirmed` for existing places).
- Founding RPCs, ledger and constraints are unchanged. Verifier:
  `scripts/verify-ea-billing-founding-slot-development.ts` (historical tests
  plus "new Checkout never reserves founding").

## Stage 3 (not started)

Flip entitlement enforcement and gate `/agent`, origination, EA operational surfaces via `getEaBranchEntitlement()`.
