# EA Billing Stage 1 — Branch Subscription Architecture

**Status:** Stage 1 foundation implemented (schema + domain types).  
**Stripe Checkout / Portal / webhooks / entitlement enforcement:** not started (Stage 2).  
**Production:** not modified by Stage 1 apply process (Development-first).

## Commercial model (founder-approved)

| Item | Value |
|---|---|
| Billing unit | **Estate agent branch** (`ea_branches`) |
| Founding price | **£99/month** (9900 pence) |
| Standard price | **£129/month** (12900 pence) |
| Founding cohort | First **20** eligible paying branches |
| Homeowners | Free |

Historical FD-007 recorded £79/£99; that record is retained as history. Active marketing/legal/constants now use £99/£129.

## Domain model

```
ea_companies (organisation; optional future Stripe Customer owner)
  └── ea_branches (commercial billing unit)
        ├── ea_branch_members (Owner=branch_admin, Staff=agent)
        ├── property_ea_assignments (operational access to properties)
        └── ea_branch_subscriptions (append-only subscription history)
              └── ea_founding_slot_ledger (slots 1–20)
```

## Stripe ownership (Day 1 — branch Customer isolation)

| Object | Owner |
|---|---|
| Stripe Customer (Day 1) | **`ea_branches.stripe_customer_id`** — one Customer per branch |
| Stripe Subscription | **`ea_branch_subscriptions`** — one open subscription per branch |
| Stripe Customer (future org) | **`ea_companies.stripe_customer_id`** — reserved; not used by Day 1 Checkout/Portal |
| Price selection | Server-only constants → Stripe Price IDs (not client-supplied) |

Portal isolation: Branch A Portal uses Customer A only, so sibling Branch B subscriptions are not visible.

See Stage 2 doc for Portal/Checkout/webhook details.

## Entitlement model

- `stripe_status` — mirror of Stripe lifecycle  
- `entitlement_status` — Keynetic access decision (`none` \| `entitled` \| `grace` \| `ended`)  
- Enforcement flag: `EA_BILLING_ENTITLEMENT_ENFORCEMENT_ENABLED = false` (Stage 1)  
- Helper: `getEaBranchEntitlement()` — central abstraction; **not wired into route guards yet**

## Founding allocation

- Table: `ea_founding_slot_ledger`  
- RPC: `reserve_ea_founding_slot(branch_id, reservation_seconds)`  
- Uses transaction advisory lock + unique partial indexes  
- Short-lived **reserved** hold for checkout price selection; **confirmed** on successful payment (Stage 2)  
- Expired reservations auto-released  

## Cancellation / failure / resubscription (policy — not implemented)

- Cancel at period end; remain entitled until `current_period_end`  
- Payment failure → grace → recover or end  
- Resubscribe by ending open row and inserting a new open subscription  
- Do **not** delete shared chain/property/homeowner data on expiry  

## Tables

- `ea_branch_subscriptions`  
- `ea_founding_slot_ledger`  
- `stripe_webhook_events` (idempotency; no payloads)  
- `ea_subscription_events` (lightweight audit)  

## RLS

- Clients cannot INSERT/UPDATE/DELETE billing tables  
- Branch members may SELECT own-branch subscription + audit rows  
- Founding ledger and webhook events are not client-readable  
- Mutations intended for service_role / security definer paths in Stage 2  

## Verifiers

- `scripts/verify-ea-billing-architecture-readonly.ts` — static architecture (Stage 2-aware)
- `scripts/verify-ea-billing-stage1-development.ts` — Stage 1 RLS/constraint probes
- `scripts/verify-ea-billing-stage2-development.ts` — Stage 2 routes/config/adversarial probes

See also: [EA_BILLING_STAGE2_ARCHITECTURE.md](./EA_BILLING_STAGE2_ARCHITECTURE.md)
