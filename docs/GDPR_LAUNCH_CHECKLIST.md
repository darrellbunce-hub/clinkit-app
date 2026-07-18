# GDPR Launch Checklist — Keynetic

**Version:** Phase 1 governance  
**Privacy contact (proposed):** privacy@keynetic.co.uk  
**Related:** [Data Inventory](./GDPR_DATA_INVENTORY.md) · [Erasure Architecture](./GDPR_RIGHT_TO_ERASURE_ARCHITECTURE.md) · [Operational Runbook](./GDPR_ERASURE_OPERATIONAL_RUNBOOK.md) · [Processor Checklist](./GDPR_PROCESSOR_DPA_CHECKLIST.md) · [Website Register](./GDPR_WEBSITE_CONTENT_REGISTER.md) · [Phase 2 Spec](./GDPR_PHASE2_IMPACT_REPORT_REQUIREMENTS.md)

---

## Phase 1 governance (complete)

- [x] Operational erasure runbook — [GDPR_ERASURE_OPERATIONAL_RUNBOOK.md](./GDPR_ERASURE_OPERATIONAL_RUNBOOK.md)
- [x] Retention schedule (proposed) — [GDPR_DATA_RETENTION_SCHEDULE.md](./GDPR_DATA_RETENTION_SCHEDULE.md)
- [x] Processor/DPA checklist — [GDPR_PROCESSOR_DPA_CHECKLIST.md](./GDPR_PROCESSOR_DPA_CHECKLIST.md)
- [x] Website content register — [GDPR_WEBSITE_CONTENT_REGISTER.md](./GDPR_WEBSITE_CONTENT_REGISTER.md)
- [x] Phase 2 impact report spec — [GDPR_PHASE2_IMPACT_REPORT_REQUIREMENTS.md](./GDPR_PHASE2_IMPACT_REPORT_REQUIREMENTS.md) · [Implementation](./GDPR_PHASE2_IMPACT_REPORT_IMPLEMENTATION.md)
- [x] Phase 3 controlled execution (Development) — [GDPR_PHASE3_ERASURE_EXECUTION.md](./GDPR_PHASE3_ERASURE_EXECUTION.md)
- [x] Phase 3B Privacy Admin UI (Development) — [GDPR_PHASE3B_PRIVACY_ADMIN.md](./GDPR_PHASE3B_PRIVACY_ADMIN.md)
- [x] Phase 3B Privacy Admin MFA / AAL2 (Development) — [GDPR_PHASE3B_PRIVACY_ADMIN_SECURITY.md](./GDPR_PHASE3B_PRIVACY_ADMIN_SECURITY.md)
- [ ] **Production: platform-admin TOTP enrolled for all operators**
- [ ] **Production: Supabase MFA TOTP enabled; SMS MFA disabled; AAL1 session limits enabled**
- [ ] **Production: Privacy Admin subject-lookup rate limiting (Upstash) verified**
- [x] Contextual property-address model — architecture doc updated
- [x] Analytics anonymity classification — architecture + inventory updated
- [x] PII client logging removed — `start-move`, `chain`, `join-chain`
- [ ] **privacy@keynetic.co.uk mailbox live and tested**
- [ ] Privacy Policy published (content phase)

---

| Standard | Timeframe | Notes |
|----------|-----------|-------|
| **UK GDPR statutory (Right to Erasure)** | **One calendar month** from receipt of valid request | Extendable by up to **two further months** if complex — must inform requester within first month ([ICO guidance](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/individual-rights/individual-rights/right-to-erasure/)) |
| **Keynetic internal target** | **72 hours** where possible | Operational SLA only — **do not document as legal deadline** |
| Identity verification | Clock may start after ID confirmed | ICO: time limit begins when sufficient information received |

---

## Part 11 — UK GDPR / ICO operational requirements

### A. Data subject rights

| Right | Launch requirement | Keynetic status | Owner |
|-------|-------------------|-----------------|-------|
| **Erasure (Art. 17)** | Documented process + ability to execute | **Not implemented** — architecture designed | Product / Legal |
| **Access / SAR (Art. 15)** | Process + export capability | **Not implemented** | Product |
| **Rectification (Art. 16)** | Profile/property correction paths | Partial — profile self-service; property via operational flows | Product |
| **Restriction (Art. 18)** | Process to flag restricted processing | **Not implemented** | Legal / Product |
| **Portability (Art. 20)** | Machine-readable export where processing automated + consent/contract | **Not implemented** — assess scope (likely limited for chain platform) | Legal |
| **Objection (Art. 21)** | Process for direct marketing / legitimate interest objections | **Not implemented** — no marketing analytics SDK found | Legal |
| **Automated decision-making (Art. 22)** | N/A assessment | Lifecycle worker is operational housekeeping — **document not solely automated legal effect** | Legal |

### B. Governance & accountability

| Item | Action | Status |
|------|--------|--------|
| **Records of processing (Art. 30)** | Maintain RoPA document from [Data Inventory](./GDPR_DATA_INVENTORY.md) | Draft in inventory |
| **Privacy notice (Art. 13/14)** | Publish before launch | **Placeholder only** (`LegalPrivacySection`) |
| **Lawful basis documentation** | Contract, legitimate interest assessments per processing activity | **Legal review required** |
| **DPIA for lifecycle automation** | Assess dormancy emails, worker, shared visibility | **Recommended** — dormancy E2E verified technically |
| **Processor contracts / DPAs** | Supabase, Resend, Vercel, Upstash (if used) | **Confirm signed** |
| **ICO registration / fee** | UK data controllers typically pay fee unless exempt | **Founder to confirm** ([ICO self-assessment](https://ico.org.uk/for-organisations/data-protection-fee/)) |
| **DPO appointment** | Required only in specific cases | **Likely not required** — formal assessment needed |
| **Internal privacy contact** | Published email + responsible person | **Not live** |
| **Staff/partner training** | EA data responsibilities | Before EA scale |

### C. Security & breach

| Item | Action | Status |
|------|--------|--------|
| **Data breach response plan** | Detect → assess → ICO 72h if risk → notify subjects | **Not documented** |
| **Supabase RLS** | Participant privacy verified (PR5) | **Implemented** — see `docs/PR5_PRIVACY_VERIFICATION_REPORT.md` |
| **Service role discipline** | Workers/admin only | Documented in architecture |
| **Auth security** | Email verification gate, password hardening | See `docs/ACCOUNT_SECURITY.md` |

### D. Retention

| Data class | Policy needed | Current behaviour |
|------------|---------------|-------------------|
| Operational transaction | Lifecycle automation (90/150/30 day defaults) | **Implemented** |
| `email_events` | Defined retention + erasure | **Indefinite — gap** |
| Analytics snapshots | Permanent anonymised | **By design** |
| Auth accounts | Until deletion request | Indefinite |
| Backups | 7-day Supabase Pro (verify) | See [Backup Runbook](./GDPR_BACKUP_ERASURE_RUNBOOK.md) |
| Supabase/Vercel logs | Plan defaults | **Verify Dashboard** |

### E. Cookies & marketing

| Item | Action | Status |
|------|--------|--------|
| **Cookie policy** | Publish if non-essential cookies used | **Placeholder** — Supabase auth cookies essential; confirm no analytics cookies |
| **PECR / consent** | Banner if non-essential tracking | **No third-party analytics SDK in repo** |
| **Email marketing** | Consent if promotional emails | Transactional only via Resend today |

### F. Erasure operational checklist (when request received)

- [ ] Log request date (statutory clock)
- [ ] Verify identity
- [ ] Warn if active shared transaction
- [ ] Run impact report (when implemented) or manual inventory
- [ ] Legal review if refusal grounds possible
- [ ] Execute erasure on live DB
- [ ] Request Resend deletion
- [ ] Delete Auth user (last)
- [ ] Append suppression ledger
- [ ] Confirm completion to requester (within statutory deadline; target 72h internal)
- [ ] File minimal audit record

---

## Part 12 — Website / content follow-up inventory

**Do not rewrite in this phase.** Use this list in dedicated content review after architecture approval.

### Legal pages (currently placeholder)

| Area | File / route | Issue |
|------|--------------|-------|
| Privacy Policy | `LegalPrivacySection.tsx` — "Coming soon" | Must cover processors, retention, rights, lawful basis |
| Terms of Service | Placeholder | EA vs homeowner responsibilities |
| Cookie Policy | Placeholder | Auth cookies + any future analytics |
| Data Retention Policy | Placeholder | Lifecycle periods + email_events |
| Account Deletion Request | Placeholder | Must distinguish **request** vs instant delete; link to erasure process |

### Wording requiring careful distinction

| Topic | Current copy location | Required clarity |
|-------|----------------------|------------------|
| **De-link** | `participationDelinkPresentation.ts` | Already states history retained — add "not GDPR erasure" cross-link |
| **Dormancy** | `dormancyConfirmationPresentation.ts`, `DormancyWarning.tsx` | Not erasure; address release ≠ account deletion |
| **Lifecycle anonymised** | `PROPERTY_LIFECYCLE.md`, worker comments | Not RTBF |
| **72-hour target** | Not yet published | Must not imply statutory deadline |

### Property & address privacy

| Screen | File | Review need |
|--------|------|-------------|
| Start Move | `app/start-move/page.tsx` | Explain address use; remove console.log before launch |
| Property page | `app/property/[propertyId]/page.tsx` | Participant visibility rules |
| Chain view | `app/chain/[chainId]/page.tsx` | Peer address hiding |
| Claim flow | Claim pages | Invite email handling |
| Buyer-ready | `app/buyer-ready/[chainId]/` | Counterparty visibility |

### Email & invitations

| Template | PII included | Review need |
|----------|--------------|-------------|
| `homeowner-invitation` | Full address, name | Necessity + retention |
| `property-claimed` | Address | Same |
| `lifecycle-dormancy-warning` | No address (good) | Confirm wording |
| `password-reset`, `welcome` | Name, links | Standard transactional |

### Estate agent surfaces

| Area | File | Review need |
|------|------|-------------|
| EA landing | `EaLandingPage.tsx` | "Anonymised regional benchmarks" — accurate vs analytics design |
| Team directory | Branch team UI | Email visibility to branch admins |
| Originate property | EA flows | Homeowner invite data responsibilities |
| Pricing / Stripe | Landing copy | Future billing privacy when Stripe live |

### Auth & signup

| Screen | Review need |
|--------|-------------|
| Signup / login | Link to privacy notice + lawful basis |
| Email verification | Why verification required |
| `verify-email` page | Data use explanation |

### Account settings

| Section | Review need |
|---------|-------------|
| `SecuritySection.tsx` | Password data processing |
| `LegalPrivacySection.tsx` | Replace placeholders |
| Profile name (EA) | Purpose limitation |

### Footer & global

| Item | Status |
|------|--------|
| Footer privacy/terms links | **Verify presence on marketing pages** |
| Contact / data protection email | **Missing** |
| ICO registration number | **If applicable — add when registered** |

### Factual inconsistencies discovered (copy vs behaviour)

| Finding | Location | Inconsistency |
|---------|----------|---------------|
| Account deletion | `LegalPrivacySection` | Implies process exists — **none implemented** |
| Data retention policy | Placeholder | Lifecycle retention exists in code but not published |
| "Coming soon" legal | Account page | Launch blocker if public |
| EA benchmarks | `EaLandingPage` | Analytics pipeline Phase 3 — benchmarks may be **aspirational** |
| De-link retains history | Delink UI | Accurate — must contrast with erasure in privacy policy |
| Production readiness doc | `PRODUCTION_READINESS_CHECKLIST.md` | Dated 2026-06-06 — many items now resolved on Development; **refresh before launch comms** |

---

## P0 launch blockers (privacy)

1. [ ] Published Privacy Policy (accurate to inventory)
2. [ ] Privacy contact channel
3. [ ] Erasure request process (manual minimum)
4. [ ] DPAs: Supabase + Resend (+ Vercel, Upstash if used)
5. [ ] `email_events` retention policy decided
6. [ ] De-link / lifecycle / erasure distinction in user-facing docs
7. [ ] Remove PII console logging (`start-move`)

## P1 before scale

1. [ ] Impact report + execution RPCs
2. [ ] SAR export tooling
3. [ ] Suppression ledger + restore drill
4. [ ] DPIA for lifecycle + communications
5. [ ] Cookie policy (even if "essential only")
6. [ ] Breach response runbook

---

## Documentation cross-links (existing docs — link only)

Add references in future edits to:

- [Property Lifecycle](./PROPERTY_LIFECYCLE.md) — anonymised ≠ RTBF
- [Property Lifecycle Automation](./PROPERTY_LIFECYCLE_AUTOMATION.md)
- [Participation De-link](./PARTICIPATION_DELINK.md)
- [Communications](./COMMUNICATIONS.md)
- [Account Security](./ACCOUNT_SECURITY.md) — P2 account deletion note
- [Production Readiness](./PRODUCTION_READINESS_CHECKLIST.md)

---

*Checklist for launch planning. Legal counsel should review before publication.*
