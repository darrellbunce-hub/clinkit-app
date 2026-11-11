# EA billing customer communications

**Status:** **DEVELOPMENT BASELINE COMPLETE** — Development execute verifier **29/29 passed** (dispatch ledger migration treated as applied on Development). **Not** Production-approved. Live customer sends still depend on Resend / env configuration per environment.

**Freeze reference:** [DEVELOPMENT_BASELINE_FREEZE.md](./DEVELOPMENT_BASELINE_FREEZE.md) (`62e81eb`).

## Scope (this phase)

Keynetic transactional emails (Resend):

1. `ea-subscription-confirmation` — first transition to entitled/active
2. `ea-payment-failed` — enter 7-day grace (BL-01)
3. `ea-grace-reminder` — mid-grace (~day 3–4)
4. `ea-grace-final-warning` — ≤48h before grace end
5. `ea-subscription-cancelled` — once per cancellation request (Stripe `cancel_at_period_end` or a future `cancel_at`). Key: `subscription:<sub>:cancellation:<effective end>:requested:<Stripe canceled_at>`; a new request after a withdrawal (new `canceled_at`) gets a new email even for the same end date. Emails sent under the earlier key (`subscription:<sub>:cancellation:<effective end>`) at or after the request's `canceled_at` count as already sent.
6. `ea-subscription-cancellation-reversed` — once per withdrawn cancellation request, detected from the `customer.subscription.updated` event's `previous_attributes`. Key: `subscription:<sub>:cancellation_reversed:<withdrawn request's canceled_at>`.

**Not** sent by Keynetic: routine monthly successful-payment emails.  
**Stripe Dashboard (Production):** enable Customer receipt / invoice emails before live charging — **Required before public charging**.

## Architecture

- Templates: `emails/templates/Ea*.tsx`
- Send helpers: `lib/communications/email.ts`
- Dispatch: `lib/billing/eaBillingCustomerEmails.ts`
- Triggers: post-reconcile in `lib/billing/eaStripeWebhook.ts`; grace reminders via `/api/cron/billing-health`
- Idempotency: `billing_customer_email_dispatches` + `claim_billing_customer_email_dispatch` (insert-before-send)

## Privacy / subprocessors

- Billing emails include branch name, plan/price labels, dates, and billing management link.
- Delivered via **Resend** (existing transactional processor).
- Stripe may separately email receipts/invoices (Stripe-controlled).
- Update Privacy Policy / DPA review before Production publication — do not invent legal conclusions here.
- EA Terms draft still mentions payment-failure email backlog in places — **update before publication** (legal wording not changed by this documentation update).

## Migration

`supabase/migrations/20260819210000_billing_customer_email_dispatches.sql`

| Environment | Status |
|-------------|--------|
| Development | **Evidenced** — customer communications execute verifier **29/29** |
| Production | **Not applied / not approved** — Production parity required |

## Classification

| Item | Classification |
|------|----------------|
| Templates + dispatch ledger on Development | Development baseline complete |
| Production migration + Resend Production config | Production parity required / Required before public launch |
| Stripe receipt/invoice Dashboard emails | Required before public charging |
| EA Terms backlog wording vs implemented emails | Required before public launch (publication) |
| Entitlement enforcement | Required before entitlement enforcement (separate; still OFF) |
