# Launch Legal Draft Review Register — Stage 3

**Created:** Stage 3 — P0 Launch Legal, Privacy and Content Structure  
**Authority:** [LAUNCH_CONTENT_FOUNDER_DECISIONS.md](./LAUNCH_CONTENT_FOUNDER_DECISIONS.md) · [LAUNCH_STAGE2_TECHNICAL_VALIDATION.md](./LAUNCH_STAGE2_TECHNICAL_VALIDATION.md)

---

## Status legend

| Status | Meaning |
|--------|---------|
| **DRAFT_FOR_LEGAL_REVIEW** | Factual draft complete; requires professional legal review before treating as final |
| **BLOCKED_PENDING_FACTS** | Cannot finalise until factual/commercial gaps resolved |
| **READY_FOR_FOUNDER_REVIEW** | Ready for founder read-through (not legal sign-off) |
| **APPROVED_FOR_PUBLICATION** | Not used in Stage 3 — requires separate founder/legal authorisation |

**Customer-facing pages:** Do not display internal status labels unless founder explicitly chooses to publish a draft-labelled document.

---

## Document register

### 1. Privacy Policy

| Field | Detail |
|-------|--------|
| **Route** | `/privacy` |
| **Module** | `lib/legal/content/privacyPolicy.ts` |
| **Draft status** | **DRAFT_FOR_LEGAL_REVIEW** |
| **Factual sources** | GDPR_DATA_INVENTORY.md, GDPR_DATA_RETENTION_SCHEDULE.md, GDPR_RIGHT_TO_ERASURE_ARCHITECTURE.md, Stage 2 cookie/storage audit, KEYNETIC_ARCHITECTURE.md |
| **Founder decisions** | FD-001 (erasure request), FD-008 (privacy@), FD-003 (no analytics tracking), platform positioning |
| **Legal questions** | Lawful bases per activity; data controller legal entity details; international transfers; shared-data erasure wording; fraud-hold retention |
| **Commercial questions** | None directly |
| **Provider verification** | Supabase, Vercel, Resend, Upstash DPA/residency; Stripe future wording |
| **Publication readiness** | Structure complete; **not APPROVED_FOR_PUBLICATION** |

---

### 2. Website & Platform Terms of Use

| Field | Detail |
|-------|--------|
| **Route** | `/terms` |
| **Module** | `lib/legal/content/termsOfUse.ts` |
| **Draft status** | **DRAFT_FOR_LEGAL_REVIEW** |
| **Factual sources** | Platform behaviour, access codes, de-link/disconnect flows, Stage 2 findings |
| **Founder decisions** | Platform positioning (not conveyancing/legal/EA); FD-009 de-link distinction; no verification guarantees |
| **Legal questions** | Liability caps; governing law/jurisdiction; acceptable use breadth |
| **Commercial questions** | None directly |
| **Provider verification** | None |
| **Publication readiness** | Structure complete; liability section flagged |

---

### 3. Estate Agent Terms of Service

| Field | Detail |
|-------|--------|
| **Route** | `/estate-agents/terms` |
| **Module** | `lib/legal/content/estateAgentTerms.ts` |
| **Draft status** | **DRAFT_FOR_LEGAL_REVIEW** |
| **Factual sources** | EA onboarding, branch model, CRM-complement positioning, Stage 2 billing audit |
| **Founder decisions** | FD-032/033 per-branch pricing (£79 founding / £99 standard); FD-036 billing not live; no Enterprise tier as available |
| **Legal questions** | Controller/processor split for client data; termination on billing live |
| **Commercial questions** | Cancellation/refund mechanics; billing start dates; founding branch cap enforcement — **BLOCKED_PENDING_FACTS** until Stripe |
| **Provider verification** | Stripe (future) |
| **Publication readiness** | Framework draft; billing sections explicitly provisional |

---

### 4. Cookie Policy

| Field | Detail |
|-------|--------|
| **Route** | `/cookies` |
| **Module** | `lib/legal/content/cookiePolicy.ts` |
| **Draft status** | **DRAFT_FOR_LEGAL_REVIEW** |
| **Factual sources** | Stage 2 storage audit (Supabase auth cookies, localStorage invitation tokens, no analytics SDKs) |
| **Founder decisions** | No consent banner for current implementation (legal review caveat) |
| **Legal questions** | PECR/ePrivacy classification of Supabase auth cookies and functional localStorage |
| **Commercial questions** | None |
| **Provider verification** | Supabase cookie names/behaviour in production |
| **Publication readiness** | Accurate to current implementation; legal classification pending |

---

### 5. Data Retention Information

| Field | Detail |
|-------|--------|
| **Route** | `/data-retention` |
| **Module** | `lib/legal/content/dataRetention.ts` |
| **Draft status** | **DRAFT_FOR_LEGAL_REVIEW** |
| **Factual sources** | GDPR_DATA_RETENTION_SCHEDULE.md, erasure architecture, backup runbooks (high level only) |
| **Founder decisions** | FD-001 erasure vs de-link; no internal runbook verbatim exposure |
| **Legal questions** | Statutory retention vs proposed periods; shared transaction record treatment |
| **Commercial questions** | None |
| **Provider verification** | Backup retention windows (Vercel/Supabase plan defaults) |
| **Publication readiness** | Periods marked as proposed/not legally final |

---

## UI/content items (non-standalone documents)

| Item | Status | Notes |
|------|--------|-------|
| Account LegalPrivacySection | **READY_FOR_FOUNDER_REVIEW** | Links + erasure request entry |
| Footer legal navigation | **READY_FOR_FOUNDER_REVIEW** | privacy@ surfaced |
| Collection-point notices | **DRAFT_FOR_LEGAL_REVIEW** | Art. 13 transparency; no blanket consent checkbox |
| De-link erasure cross-link | **READY_FOR_FOUNDER_REVIEW** | FD-009 |
| Homepage FAQ EA correction | **READY_FOR_FOUNDER_REVIEW** | Present tense |
| Internal ID removal | **READY_FOR_FOUNDER_REVIEW** | Chain # / Property id in stale warning |
| Pricing CTA | **READY_FOR_FOUNDER_REVIEW** | Signup not checkout; /estate-agents/pricing redirect |
| Connected / Disconnect copy | **READY_FOR_FOUNDER_REVIEW** | Copy only; behaviour unchanged |

---

## Outstanding legal questions (consolidated)

1. Confirm data controller legal entity and registered address
2. Confirm lawful bases for each processing purpose
3. Confirm international transfer mechanisms per processor
4. Approve proposed retention periods for publication
5. Review liability limitation and jurisdiction clauses
6. PECR/ePrivacy assessment for auth cookies and functional storage without banner
7. EA controller/processor responsibilities for client data
8. Invitation email address minimisation (FD-004 — separate from Stage 3)

---

## Outstanding provider verification

1. privacy@keynetic.co.uk mailbox — create, secure, test delivery
2. Supabase — DPA, residency, auth cookie documentation
3. Vercel — DPA, log retention defaults
4. Resend — DPA, email event retention
5. Upstash — confirm production enablement and DPA
6. Stripe — not active; verify before payment terms go live

---

## Outstanding commercial/billing questions

1. Stripe integration architecture (FD-036)
2. Per-branch vs company-level billing schema alignment
3. Founding branch cap (20) enforcement mechanism
4. Cancellation, refunds, and pro-rata policy
5. When automated billing begins — no invented start dates in UI

---

## New P0 launch blockers from Stage 3

| Blocker | Severity | Owner |
|---------|----------|-------|
| Legal review of all draft policies | P0 pre-launch | Founder/legal |
| privacy@ mailbox operational | P0 pre-launch | Founder/ops |
| Lawful basis / controller details | P0 pre-launch | Legal |
| APPROVED_FOR_PUBLICATION status | P0 pre-launch | Founder/legal |

**Not new blockers (unchanged):** Chain Confidence redesign (Stage 3.5), Stripe billing (deferred), email subject line review (FD-004).

---

## Verification

Run: `npx tsx scripts/verify-launch-stage3-legal.ts`  
Build: `npm run build`

---

*Register maintained as part of Stage 3 deliverables. Update status only with founder/legal authorisation.*
