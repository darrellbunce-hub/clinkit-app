# Launch Legal Draft Review Register — Stage 3 / Phase 2A update

**Created:** Stage 3 — P0 Launch Legal, Privacy and Content Structure  
**Updated:** Legal / Policy Phase 2A — locked founder decisions recorded in [LAUNCH_LEGAL_FOUNDER_DECISIONS.md](./LAUNCH_LEGAL_FOUNDER_DECISIONS.md)  
**Authority:** [LAUNCH_LEGAL_FOUNDER_DECISIONS.md](./LAUNCH_LEGAL_FOUNDER_DECISIONS.md) · [LAUNCH_CONTENT_FOUNDER_DECISIONS.md](./LAUNCH_CONTENT_FOUNDER_DECISIONS.md) · [LAUNCH_STAGE2_TECHNICAL_VALIDATION.md](./LAUNCH_STAGE2_TECHNICAL_VALIDATION.md)

---

## Status legend

| Status | Meaning |
|--------|---------|
| **DRAFT_FOR_LEGAL_REVIEW** | Factual draft complete; requires professional legal review before treating as final |
| **BLOCKED_PENDING_FACTS** | Cannot finalise until factual/commercial gaps resolved |
| **READY_FOR_FOUNDER_REVIEW** | Ready for founder read-through (not legal sign-off) |
| **APPROVED_FOR_PUBLICATION** | Not used in Stage 3 — requires separate founder/legal authorisation |
| **PHASE_2B_REWRITE** | Locked decisions exist; full section rewrite still required before publication |

**Customer-facing pages:** Do not display internal status labels unless founder explicitly chooses to publish a draft-labelled document.

---

## Document register

### 1. Privacy Policy

| Field | Detail |
|-------|--------|
| **Route** | `/privacy` |
| **Module** | `lib/legal/content/privacyPolicy.ts` |
| **Draft status** | **DRAFT_FOR_LEGAL_REVIEW** |
| **Phase 2A** | Stripe processor wording updated for Sandbox/billing readiness (not a claim that Production charging is already live). Retention model notes identifiable vs anonymised (D-D1); periods still proposed. |
| **Founder decisions** | FD-001, FD-008, FD-003; legal D-D1 |
| **Legal questions** | Lawful bases; controller entity; transfers; erasure of shared data; fraud-hold retention |
| **Publication readiness** | Structure complete; **not APPROVED_FOR_PUBLICATION** |

---

### 2. Website & Platform Terms of Use

| Field | Detail |
|-------|--------|
| **Route** | `/terms` |
| **Module** | `lib/legal/content/termsOfUse.ts` |
| **Draft status** | **DRAFT_FOR_LEGAL_REVIEW** |
| **Phase 2A** | Governing law already England and Wales (D-G1 preference); solicitor confirmation still required. Liability cap unchanged (OPEN). |
| **Legal questions** | Liability caps; jurisdiction confirmation; acceptable use breadth |
| **Publication readiness** | Structure complete; liability section flagged |

---

### 3. Estate Agent Terms of Service

| Field | Detail |
|-------|--------|
| **Route** | `/estate-agents/terms` |
| **Module** | `lib/legal/content/estateAgentTerms.ts` |
| **Draft status** | **DRAFT_FOR_LEGAL_REVIEW** (Phase 2B full structure drafted) |
| **Version** | `2026-08-v2` (acceptance audit) · last updated August 2026 |
| **Phase 2B** | Full SaaS structure: definitions, authority, subscription/billing, founding (D-F1–F5, D-S1), payment failure/7-day grace, cancellation at period end, refunds, acceptable use, data/privacy flags, IP, service changes, liability (solicitor), governing law (D-G1). No VAT claims. No invented retention periods or liability caps. |
| **Founder decisions** | [LAUNCH_LEGAL_FOUNDER_DECISIONS.md](./LAUNCH_LEGAL_FOUNDER_DECISIONS.md) |
| **Legal questions** | Liability/indemnity; controller/processor/DPA; VAT; detailed refunds; price-change notices; D-B5 unpaid amounts; jurisdiction confirmation |
| **Publication readiness** | Not APPROVED_FOR_PUBLICATION until solicitor review |

---

### 4. Cookie Policy

| Field | Detail |
|-------|--------|
| **Route** | `/cookies` |
| **Module** | `lib/legal/content/cookiePolicy.ts` |
| **Draft status** | **DRAFT_FOR_LEGAL_REVIEW** |
| **Phase 2A** | Unchanged |
| **Legal questions** | PECR/ePrivacy / consent banner |

---

### 5. Data Retention Information

| Field | Detail |
|-------|--------|
| **Route** | `/data-retention` |
| **Module** | `lib/legal/content/dataRetention.ts` |
| **Draft status** | **DRAFT_FOR_LEGAL_REVIEW** |
| **Phase 2A** | Explicit identifiable vs anonymised distinction (D-D1). **No invented periods.** Internal retention policy remains a launch task. |
| **Publication readiness** | Periods remain proposed/not legally final |

---

## UI/content items (non-standalone documents)

| Item | Status | Notes |
|------|--------|-------|
| Account LegalPrivacySection | **READY_FOR_FOUNDER_REVIEW** | Links + erasure request entry |
| Footer legal navigation | **READY_FOR_FOUNDER_REVIEW** | privacy@ surfaced |
| Collection-point notices | **DRAFT_FOR_LEGAL_REVIEW** | Art. 13 transparency |
| EA landing billing/founding FAQ & CTA | **Phase 2B aligned** | Founding permanence; no “billing not yet live” |
| Account SubscriptionSection | **Phase 2B aligned** | Grace / cancel / founding footer copy |

---

## Outstanding legal questions (consolidated)

1. Confirm data controller legal entity and registered address  
2. Confirm lawful bases for each processing purpose  
3. Confirm international transfer mechanisms per processor  
4. Approve retention periods after internal policy (D-D1 / OPEN-RETENTION)  
5. Review liability limitation and jurisdiction clauses (OPEN-LIABILITY · D-G1)  
6. PECR/ePrivacy assessment for auth cookies and functional storage without banner  
7. EA controller/processor responsibilities and DPA need (OPEN-DPA)  
8. Invitation email address minimisation (FD-004)  
9. D-B5 amounts-due / no invented collections wording  
10. Detailed refund/dispute language (OPEN-REFUND-DETAIL)  
11. D-S2 / OPEN-PRICE-CHANGE notice mechanics for paid customers  

---

## Outstanding provider verification

1. privacy@keynetic.co.uk mailbox — create, secure, test delivery  
2. Supabase — DPA, residency, auth cookie documentation  
3. Vercel — DPA, log retention defaults  
4. Resend — DPA, email event retention  
5. Upstash — confirm production enablement and DPA  
6. Stripe — verify Production processor wording when Production charging is enabled  

---

## Outstanding commercial/billing questions (Phase 2A)

| Item | Status |
|------|--------|
| Locked founding / cancel decisions D-F1–F5, D-B2–B3 | **LOCKED** — see LAUNCH_LEGAL_FOUNDER_DECISIONS.md |
| VAT-inclusive vs exclusive (OPEN-VAT) | **OPEN** — do not invent |
| Final Production list-price confirmation (OPEN-PRICE) | **OPEN** — £99/£129 remain current product constants |
| Payment-failure / grace email (D-B4) | **DEVELOPMENT BASELINE COMPLETE** BL-01 — Dev **29/29**; Terms publication wording + Production config still required |
| Undo scheduled cancellation UX (D-B2) | **BACKLOG** BL-02 |
| Founding milestone ~1-month public sunset (D-C1) | **BACKLOG** BL-03 |
| Internal data-retention policy (D-D1) | **BACKLOG** BL-04 |
| Phase 2B full EA Terms billing rewrite | **DONE (draft)** — solicitor review still required |
| Stripe Production go-live / entitlement enforcement copy | Separate workstream; enforcement remains OFF |

---

## New P0 launch blockers from Stage 3 (unchanged theme)

| Blocker | Severity | Owner |
|---------|----------|-------|
| Legal review of all draft policies | P0 pre-launch | Founder/legal |
| privacy@ mailbox operational | P0 pre-launch | Founder/ops |
| Lawful basis / controller details | P0 pre-launch | Legal |
| APPROVED_FOR_PUBLICATION status | P0 pre-launch | Founder/legal |
| Solicitor review of Phase 2B EA Terms | P0 before Production charging | Founder/legal |

---

## Phase 2B rewrite checklist (EA Terms)

- [x] Failed payments + 7-day grace (honest about email backlog BL-01)
- [x] Automatic renewal / recurring authorisation
- [x] Portal cancel + note on undo (BL-02)
- [x] Amounts due after access ends (D-B5) — solicitor flag retained
- [x] Company vs Branch commercial clarity
- [x] Service/Terms/pricing change rights (D-S2) — fair notice; solicitor on detail
- [x] Governing law preference (D-G1) — solicitor confirmation
- [ ] Version bump on **publication** (draft version already `2026-08-v2` for acceptance records)
- [ ] Solicitor approval → APPROVED_FOR_PUBLICATION
