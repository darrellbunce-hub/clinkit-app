# EA billing customer communications

**Status:** **IMPLEMENTED IN REPO** — Development/Staging apply of migration + Resend required before live sends. **Not** Production-approved.

## Scope (this phase)

Keynetic transactional emails (Resend):

1. `ea-subscription-confirmation` — first transition to entitled/active
2. `ea-payment-failed` — enter 7-day grace (BL-01)
3. `ea-grace-reminder` — mid-grace (~day 3–4)
4. `ea-grace-final-warning` — ≤48h before grace end
5. `ea-subscription-cancelled` — first `cancel_at_period_end` transition

**Not** sent by Keynetic: routine monthly successful-payment emails.  
**Stripe Dashboard (Production):** enable Customer receipt / invoice emails before live charging.

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
- EA Terms still mention payment-failure email backlog in published draft — **update before publication**.

## Migration

`supabase/migrations/20260819210000_billing_customer_email_dispatches.sql`
