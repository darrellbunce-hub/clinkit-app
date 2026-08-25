# Keynetic Launch Legal Founder Decisions

**Phase:** Legal / Policy Phase 2A  
**Status:** Source of truth for locked legal/commercial decisions before Phase 2B Terms drafting  
**Related:** [LAUNCH_LEGAL_DRAFT_REVIEW_REGISTER.md](./LAUNCH_LEGAL_DRAFT_REVIEW_REGISTER.md) · [LAUNCH_CONTENT_FOUNDER_DECISIONS.md](./LAUNCH_CONTENT_FOUNDER_DECISIONS.md) · [EA_BILLING_STAGE2_ARCHITECTURE.md](./EA_BILLING_STAGE2_ARCHITECTURE.md) · [KEYNETIC_TERMINOLOGY_REGISTER.md](./KEYNETIC_TERMINOLOGY_REGISTER.md)

Decisions in this register supersede conflicting provisional notes in older launch legal drafts where IDs collide.  
Do **not** invent VAT treatment, liability caps, retention periods, or DPA conclusions here.

---

## Status key

| Status | Meaning |
|--------|---------|
| **LOCKED** | Founder-approved; safe to reflect in Terms/docs |
| **OPEN** | Must not be invented in customer-facing legal copy |
| **BACKLOG** | Product/comms implementation task |
| **SOLICITOR** | Professional legal review required |

---

## Locked decisions

### D-F1 — Founding place permanently consumed on cancel

| Field | Detail |
|-------|--------|
| **Decision** | If a founding branch cancels, it permanently loses founding status. The founding place does **not** return to the pool. Once one of the first 20 founding places has been used, that place is permanently consumed even if the subscriber later cancels. |
| **Status** | **LOCKED** |
| **Date/phase** | Phase 2A (2026-08) |
| **Rationale** | Preserve scarcity and fairness of the first-20 offer; prevent churn to free slots for later £99 customers. |
| **Implementation consequence** | Terms/marketing must not say places become available again after cancel. Product: confirmed ledger slots must remain consumed (do not auto-release on cancel). Verify continuously in founding verifiers. |

### D-F2 — Founding status non-transferable

| Field | Detail |
|-------|--------|
| **Decision** | Founding status cannot be transferred between branches, companies, accounts, or customers. |
| **Status** | **LOCKED** |
| **Date/phase** | Phase 2A (2026-08) |
| **Rationale** | Prevent gaming / resale of founding pricing. |
| **Implementation consequence** | Phase 2B Terms must state non-transferability. No transfer UI/API. |

### D-F3 — Multiple branches of same company may each take founding places

| Field | Detail |
|-------|--------|
| **Decision** | While founding places remain available, multiple branches of the same company may independently secure founding places. No one-founding-place-per-company restriction. |
| **Status** | **LOCKED** |
| **Date/phase** | Phase 2A (2026-08) |
| **Rationale** | Matches Day 1 branch-level billing unit. |
| **Implementation consequence** | Continue branch-level reservation/confirm; do not add company-level founding cap. |

### D-F4 — Founding offer closes permanently at 20 secured

| Field | Detail |
|-------|--------|
| **Decision** | The founding offer permanently closes once all 20 founding places are secured. Cancellation does **not** reopen a £99 place. Customers who join after 20 are secured pay then-current standard price. |
| **Status** | **LOCKED** |
| **Date/phase** | Phase 2A (2026-08) |
| **Rationale** | Same as D-F1 scarcity; clear end state for marketing. |
| **Implementation consequence** | Public UI already uses “20 founding places secured” milestone (not “0 remaining”). No mechanism to re-open £99 from cancellations. |

### D-F5 — Exceptional refunds only; no automatic founding refund/rebill

| Field | Detail |
|-------|--------|
| **Decision** | Refunds for billing/reconciliation/technical errors are exceptional and case-by-case. No automatic refund/rebill for the founding offer. Technical exceptions are not a normal customer journey. |
| **Status** | **LOCKED** |
| **Date/phase** | Phase 2A (2026-08) |
| **Rationale** | Matches webhook founding-reconcile exception path (cancel Stripe sub; no auto £129 rebill; manual ops may refund). |
| **Implementation consequence** | Terms must not promise automatic refunds. Ops alerting remains the visibility path. Detailed refund wording → OPEN + SOLICITOR. |

### D-B2 — Cancellation at period end

| Field | Detail |
|-------|--------|
| **Decision** | Customer cancellation takes effect at the end of the current paid subscription period. No partial-month cancellation. Customer retains access per entitlement until period end. Customer should be able to reverse scheduled cancellation before period end where Stripe/product supports it. |
| **Status** | **LOCKED** (policy) · undo cancellation **BACKLOG** if not in UI |
| **Date/phase** | Phase 2A (2026-08) |
| **Rationale** | Matches product semantics `cancel_at_period_end` and Portal guidance. |
| **Implementation consequence** | Phase 2B Terms: period-end cancel. **Do not** invent mid-period cancel. Undo cancel: Stripe Customer Portal may support it depending on Dashboard config; Keynetic has no dedicated in-app “undo cancellation” control — see backlog. |

### D-B3 — No partial-period refund on ordinary cancel

| Field | Detail |
|-------|--------|
| **Decision** | Ordinary voluntary cancellation does not generate a partial-period refund. Customer has paid for the current period and remains subscribed until period end. |
| **Status** | **LOCKED** |
| **Date/phase** | Phase 2A (2026-08) |
| **Rationale** | Standard B2B monthly SaaS commercial position. |
| **Implementation consequence** | Phase 2B Terms. Exceptional errors remain D-F5 / OPEN detailed refund wording. |

### D-B4 — Payment-failure / grace customer notification

| Field | Detail |
|-------|--------|
| **Decision** | Keynetic should clearly notify the customer when a recurring payment fails: payment failed; grace applies; action required; consequence if not recovered. |
| **Status** | **LOCKED** (policy) · email **BACKLOG** |
| **Date/phase** | Phase 2A (2026-08) |
| **Rationale** | Fairness and complaint reduction before entitlement enforcement. |
| **Implementation consequence** | Account UI surfaces grace. **Keynetic payment-failure / grace emails are Development-baseline complete** (immediate + mid + final; Dev execute **29/29**). Do not claim Production-enabled until Resend + dispatch objects are live in that environment. Stripe-hosted receipts remain separate (Dashboard config). EA Terms draft may still mention backlog until publication update. |

### D-B5 — Amounts due remain payable

| Field | Detail |
|-------|--------|
| **Decision** | Amounts legitimately due under the subscription remain payable even if access later ends. |
| **Status** | **LOCKED** (commercial intent) · **SOLICITOR** for debt-collection wording |
| **Date/phase** | Phase 2A (2026-08) |
| **Rationale** | Avoid implying that ending access extinguishes legitimate fees. |
| **Implementation consequence** | Phase 2B: short statement only; do not invent collections process. Solicitor review. |

### D-S1 — Founding price lock while continuously subscribed

| Field | Detail |
|-------|--------|
| **Decision** | Intended commercial statement: founding members lock in the £99 monthly price for the duration of their **continuous** subscription. |
| **Status** | **LOCKED** (commercial intent) · **VAT / final price display OPEN** |
| **Date/phase** | Phase 2A (2026-08) |
| **Rationale** | Aligns with “while subscription remains active” and D-F1 (cancel ends founding). |
| **Implementation consequence** | Do **not** add including/excluding VAT wording yet. Do **not** change displayed £99/£129 until pricing review closes. Phase 2B Terms may use the continuous-subscription lock language without VAT claims. |

### D-S2 — Rights to change service / Terms / future pricing

| Field | Detail |
|-------|--------|
| **Decision** | Keynetic requires appropriate rights to change functionality, features, service structure, Terms, and future pricing — **not** an unrestricted “change anything anytime” clause. |
| **Status** | **LOCKED** (direction) · detailed wording **OPEN** / **SOLICITOR** |
| **Date/phase** | Phase 2A (2026-08) |
| **Rationale** | Operational flexibility with customer fairness. |
| **Implementation consequence** | Phase 2B formal Terms drafting; current Changes sections are inadequate for paid billing. |

### D-D1 — Identifiable vs anonymised retention model

| Field | Detail |
|-------|--------|
| **Decision** | Distinguish (1) identifiable/un-anonymised operational data from (2) genuinely anonymised data. Founder will create a separate **internal** data-retention policy with actual periods. |
| **Status** | **LOCKED** (model) · exact periods **OPEN** |
| **Date/phase** | Phase 2A (2026-08) |
| **Rationale** | Avoid false precision in public legal copy. |
| **Implementation consequence** | Do not invent retention numbers. Public Privacy/Retention pages should stay “proposed” until internal policy exists; then reference it. Launch task: write internal retention policy. |

### D-A1 — Authority representation at EA signup

| Field | Detail |
|-------|--------|
| **Decision** | Person accepting EA Terms represents authority to bind the organisation/branch. Keynetic does not independently verify every signatory. Organisation remains responsible for users, access, information, use, and payment. |
| **Status** | **LOCKED** |
| **Date/phase** | Phase 2A (2026-08) |
| **Rationale** | Standard B2B SaaS approach without manual KYC of signatories. |
| **Implementation consequence** | Reflect in EA Terms Agreement section (Phase 2A factual alignment / Phase 2B polish). No verification workflow. |

### D-G1 — Governing law England and Wales

| Field | Detail |
|-------|--------|
| **Decision** | Preferred governing law/jurisdiction: England and Wales, subject to solicitor review. |
| **Status** | **LOCKED** (preference) · **SOLICITOR** |
| **Date/phase** | Phase 2A (2026-08) |
| **Rationale** | UK product; Platform Terms already state England and Wales pending confirmation. |
| **Implementation consequence** | Keep preference; solicitor confirms exclusive jurisdiction language. EA Terms should cross-refer in Phase 2B. |

### D-C1 — Founding milestone then ~1 month public sunset

| Field | Detail |
|-------|--------|
| **Decision** | When all 20 founding places are secured: immediately show positive “20 founding places secured” milestone (not “0 remaining”). After approximately **one month**, remove founding availability/milestone messaging from the public website; normal public pricing becomes the focus. |
| **Status** | **LOCKED** (intent) · automatic sunset **BACKLOG** |
| **Date/phase** | Phase 2A (2026-08) |
| **Rationale** | Celebrate milestone; avoid permanent “sold out founding” clutter. |
| **Implementation consequence** | Milestone UI already exists. **Do not** implement automatic one-month removal yet unless a suitable mechanism exists — track as product/content backlog (manual or scheduled content flag). |

---

## OPEN decisions (do not invent in legal copy)

| ID | Topic | Notes |
|----|--------|-------|
| OPEN-VAT | VAT-inclusive vs VAT-exclusive pricing | No “inc/ex VAT” in UI or Terms until decided |
| OPEN-PRICE | Final Production go-live confirmation of list prices | **Phase 2B:** founder confirmed **keep £99 / £129** as current launch baseline in Terms/UI. Still subject to VAT decision and solicitor publication approval. |
| OPEN-LIABILITY | Liability cap amount / structure | Platform Terms draft exists; solicitor |
| OPEN-DPA | Controller / processor / DPA need | EA Terms currently provisional; solicitor |
| OPEN-RETENTION | Exact retention periods | Internal policy to be written (D-D1) |
| OPEN-REFUND-DETAIL | Detailed refund / dispute wording beyond D-F5 / D-B3 | Solicitor + ops process |
| OPEN-PRICE-CHANGE | Detailed pricing-change / notice wording for existing subscribers | Direction D-S2 only |
| OPEN-ENFORCEMENT-COPY | Exact customer wording when entitlement enforcement turns on | Depends on Stage 3 timing |

---

## Implementation backlog (product / communications)

| ID | Item | Notes |
|----|------|-------|
| BL-01 | Payment-failure / grace customer email (D-B4) | **DEVELOPMENT BASELINE COMPLETE** (2026-08) — Dev execute **29/29**; Resend templates + atomic dispatch ledger. Production parity + Stripe receipt Dashboard config + EA Terms publication wording update still required before publication / charging |
| BL-02 | In-app or documented “undo scheduled cancellation” (D-B2) | Portal may already allow depending on Stripe Dashboard; no dedicated Keynetic control |
| BL-03 | Founding public milestone ~1-month sunset (D-C1) | Manual ops or scheduled content flag; not implemented |
| BL-04 | Internal data-retention policy document (D-D1) | Prerequisite before finalising public retention periods |
| BL-05 | Verify confirmed founding slots never re-open on cancel (D-F1/D-F4) | Align Terms with ledger behaviour; add regression coverage if gaps found |
| BL-06 | Phase 2B full EA Terms billing rewrite | **DONE (draft 2026-08-v2)** — solicitor review still required before publication |

---

## Solicitor review items (focused)

1. Liability limitation / UCTA reasonableness (OPEN-LIABILITY)  
2. Controller/processor split and whether a DPA is required (OPEN-DPA)  
3. VAT disclosure once OPEN-VAT decided  
4. Governing law / jurisdiction confirmation (D-G1)  
5. Debt/amounts-due wording (D-B5) — no collections process invention  
6. Detailed refund/dispute language (OPEN-REFUND-DETAIL)  
7. PECR/cookie banner (existing register)  
8. Pricing-change / Terms-change notice fairness (D-S2 / OPEN-PRICE-CHANGE)

---

## Phase 2B drafting targets (not done in 2A)

- Full EA Terms sections: Billing & Payment, Automatic Renewal, Cancellation, Failed Payments, Grace Period, Founding Offer (complete), Company/Branch, Suspension vs enforcement  
- Privacy: Production Stripe activation wording when charging goes live  
- Align landing FAQ permanently with Production go-live messaging  
- Version bump `LEGAL_DOCUMENT_VERSIONS` on material publication
