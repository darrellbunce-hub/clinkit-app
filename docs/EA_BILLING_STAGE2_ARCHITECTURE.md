# EA Billing Stage 2 — Stripe Sandbox Checkout, Webhooks & Portal

**Status:** Implemented in repo (Sandbox). Entitlement enforcement remains **OFF**.  
**Production:** untouched.  
**Paid billing Production-ready:** **NO** until Sandbox E2E + webhook secret configured.

## Commercial

| Item | Value |
|---|---|
| Unit | EA branch |
| Customer | EA company |
| Subscription | EA branch |
| Founding | £99/month (first 20) |
| Standard | £129/month |
| Cancel | `cancel_at_period_end` |
| Grace | 7 days after unrecovered payment failure |
| Enforcement | `EA_BILLING_ENTITLEMENT_ENFORCEMENT_ENABLED = false` |

## Flow

```
Owner → POST /api/billing/ea/checkout-session
  → server selects founding/standard Price ID
  → Stripe Checkout (hosted)
  → return /account?billing=success (no entitlement grant)
  → Stripe webhooks → reconcile ea_branch_subscriptions
Owner → POST /api/billing/ea/portal-session → Customer Portal
```

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

## Stage 3 (not started)

Flip entitlement enforcement and gate `/agent`, origination, EA operational surfaces via `getEaBranchEntitlement()`.
