# Development baseline freeze

**Status:** **READY TO FREEZE**  
**Recorded:** 2026-08-25  
**Branch:** `staging-test`  
**Freeze reference commit:** `62e81eb16704ea2a61aeb32c5c0a0713d2dbb92e`  
**Short:** `62e81eb` — *Refine delay lifecycle and confidence* (2026-08-20)  
**Development Supabase:** `bbbsxzxcjkmpqsfvmhbo`

This document is the authoritative freeze record for starting the **Production parity** programme. It supersedes July 2026 Development claims in [PRODUCTION_READINESS_CHECKLIST.md](./PRODUCTION_READINESS_CHECKLIST.md) (e.g. “14 migrations”, uncommitted route-auth, activity-text-only delays).

---

## Verified Development evidence

| Area | Verifier / evidence | Result |
|------|---------------------|--------|
| Operational delay lifecycle | `scripts/verify-operational-delay-lifecycle-development.ts --execute` | **38/38 passed** |
| EA billing customer communications | `scripts/verify-ea-billing-customer-communications-development.ts --execute` | **29/29 passed** |
| Email lookup RPC privacy | `scripts/verify-email-lookup-privacy-development.ts --execute` | **15/15 passed** |
| Chain Confidence Option 2 | Implemented; regressions + tsc + build passed | Active delay does **not** directly reduce Chain Confidence; no explicit delay penalty / delay Strong-band cap |
| Dash / punctuation audit | Read-only audit | Complete; **no freeze blocker**; optional polish deferred |
| Affiliate / partner architecture | Product decision | **Intentionally deferred** — not a freeze blocker |

Related migrations (Dev-evidenced via the execute suites above):

- `20260820200000_operational_delay_lifecycle.sql`
- `20260819210000_billing_customer_email_dispatches.sql`
- `20260819200000_sec_email_lookup_rpc_privacy.sql`

---

## Migration inventory discipline

At freeze commit, the repository contains **82** files under `supabase/migrations/`. That number is a **repository inventory snapshot only**.

| Layer | Meaning |
|-------|---------|
| Migration files in repository | Present on git at `62e81eb` |
| Migrations evidenced on Development | Proven by execute verifiers / prior Dev applies — **not** automatically “all 82” |
| Production parity | Requires an actual **Development-versus-Production** catalog/history delta — **not** “apply 82 files” |

---

## Classification of remaining work

### Development baseline complete

- Operational delay lifecycle (structured ACTIVE/RESOLVED; Dev 38/38)
- Chain Confidence Option 2
- EA billing Stage 1–2 Sandbox foundation + customer communications (Dev 29/29)
- Email lookup RPC privacy (Dev 15/15)
- Route authorization and current EA/homeowner app on `staging-test` @ freeze commit

### Production parity required

- Actual Dev↔Prod database/RPC/RLS delta and ordered apply plan
- Deploy freeze-equivalent application code to Production
- Production environment secrets and configuration (Supabase, Vercel, Resend, Stripe Sandbox→live as applicable)
- Production observability external config (Sentry DSN, uptime) where still open
- Ideal Postcodes Production key/DPA if the feature is enabled in Production

### Required before public launch

- Solicitor publication approval of legal drafts
- FD-004 invitation subject legal review
- privacy@ mailbox operational verification
- Provider/DPA verification as required for publication
- Production transactional email checks ([PRODUCTION_READINESS_CHECKLIST.md](./PRODUCTION_READINESS_CHECKLIST.md) §13)
- OPEN-VAT resolution for published pricing disclosure
- EA Terms publication update where draft still describes payment-failure emails as backlog (legal file unchanged here)

### Required before public charging

- Stripe Production keys, webhook, Customer Portal configuration
- Stripe Dashboard customer receipt / invoice emails
- Refund / cancellation / dispute operational procedures

### Required before entitlement enforcement

- Explicit go-live decision to set `EA_BILLING_ENTITLEMENT_ENFORCEMENT_ENABLED = true`
- Customer-facing enforcement copy (OPEN-ENFORCEMENT-COPY)

### Recommended before launch

- Concurrent-user / performance baseline
- Favicon / browser & social brand assets
- FD-042–045 UX follow-ups
- Full unit-economics model

### Intentional deferrals

- Affiliate / partner minimal architecture
- Optional em dash / copy polish from the punctuation audit
- Wiring Welcome / Property connected emails
- EA multi-branch / regional analytics beyond labelled “Coming soon”
- Entitlement enforcement remaining **OFF** during freeze

### Post-launch

- Evidence-based serverless vs containers review
- Google OAuth (unless brought forward by separate decision)
- Partner/affiliate foundation when authorised

---

## Next step

Proceed to the **Production parity audit** using freeze commit `62e81eb` as the Development source of truth. Do not treat the July checklist migration tables as the apply list.
