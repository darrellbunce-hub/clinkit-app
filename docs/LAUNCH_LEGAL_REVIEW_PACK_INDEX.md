# Keynetic Legal Review Pack — Index

**Version:** Stage 3 — P0 launch legal structure  
**Internal status:** Documents are **DRAFT_FOR_LEGAL_REVIEW** unless separately marked  
**Purpose:** Orient professional legal counsel, founders, and reviewers to Keynetic's privacy/legal evidence without duplicating every detail.

---

## What Keynetic does

Keynetic is an **information, visibility and coordination platform** for residential property chains. It is **not** a conveyancing service, legal service, mortgage provider, estate agency, or substitute for professional confirmation.

| Source | Path |
|--------|------|
| Architecture overview | [KEYNETIC_ARCHITECTURE.md](./KEYNETIC_ARCHITECTURE.md) |
| Terminology register | [KEYNETIC_TERMINOLOGY_REGISTER.md](./KEYNETIC_TERMINOLOGY_REGISTER.md) |
| Launch content audit | [LAUNCH_CONTENT_AUDIT.md](./LAUNCH_CONTENT_AUDIT.md) |
| Founder decisions | [LAUNCH_CONTENT_FOUNDER_DECISIONS.md](./LAUNCH_CONTENT_FOUNDER_DECISIONS.md) |
| Stage 2 technical validation | [LAUNCH_STAGE2_TECHNICAL_VALIDATION.md](./LAUNCH_STAGE2_TECHNICAL_VALIDATION.md) |

---

## User types

| User type | Primary flows | Legal documents |
|-----------|---------------|-----------------|
| Website visitors | Homepage, EA marketing | Privacy Policy, Terms, Cookies |
| Homeowners / buyers / sellers | Login, start-move, join-chain, property workspace | Privacy Policy, Terms, Data Retention |
| Estate agent branches | Signup, onboarding, agent workspace | Privacy Policy, EA Terms, Data Retention |

---

## Published draft pages (customer-facing routes)

| Document | Route | Content module |
|----------|-------|----------------|
| Privacy Policy | `/privacy` | `lib/legal/content/privacyPolicy.ts` |
| Website & Platform Terms | `/terms` | `lib/legal/content/termsOfUse.ts` |
| Estate Agent Terms | `/estate-agents/terms` | `lib/legal/content/estateAgentTerms.ts` |
| Cookie Policy | `/cookies` | `lib/legal/content/cookiePolicy.ts` |
| Data Retention | `/data-retention` | `lib/legal/content/dataRetention.ts` |

**Publication approach:** Routes are live for founder/legal review. Customer pages do **not** display internal engineering labels such as `DRAFT_FOR_LEGAL_REVIEW`. Internal register tracks review status separately.

**Public privacy contact:** privacy@keynetic.co.uk — never admin@keynetic.co.uk

---

## Data flows and privacy model

| Topic | Source |
|-------|--------|
| Data inventory | [GDPR_DATA_INVENTORY.md](./GDPR_DATA_INVENTORY.md) |
| Website/content register | [GDPR_WEBSITE_CONTENT_REGISTER.md](./GDPR_WEBSITE_CONTENT_REGISTER.md) |
| Participant visibility / RLS | [KEYNETIC_ARCHITECTURE.md](./KEYNETIC_ARCHITECTURE.md), Stage 2 validation |
| Three separate mechanisms | De-link ≠ lifecycle anonymisation ≠ GDPR erasure — [GDPR_RIGHT_TO_ERASURE_ARCHITECTURE.md](./GDPR_RIGHT_TO_ERASURE_ARCHITECTURE.md), FD-009 |

---

## GDPR rights process

| Topic | Source |
|-------|--------|
| Right to erasure architecture | [GDPR_RIGHT_TO_ERASURE_ARCHITECTURE.md](./GDPR_RIGHT_TO_ERASURE_ARCHITECTURE.md) |
| Operational runbook | [GDPR_ERASURE_OPERATIONAL_RUNBOOK.md](./GDPR_ERASURE_OPERATIONAL_RUNBOOK.md) |
| Privacy Admin (internal) | [GDPR_PHASE3B_PRIVACY_ADMIN.md](./GDPR_PHASE3B_PRIVACY_ADMIN.md) |
| Phase 4 backup/processor erasure | [GDPR_PHASE4_BACKUP_PROCESSOR_ERASURE.md](./GDPR_PHASE4_BACKUP_PROCESSOR_ERASURE.md) |
| Account UI entry point | `components/account/LegalPrivacySection.tsx` — request via privacy@ |

**Not exposed to users:** Privacy Admin routes, workflow statuses, suppression ledger internals.

---

## Retention model

| Source | Path |
|--------|------|
| Internal retention schedule | [GDPR_DATA_RETENTION_SCHEDULE.md](./GDPR_DATA_RETENTION_SCHEDULE.md) |
| Public summary | `/data-retention` — `lib/legal/content/dataRetention.ts` |

---

## Processors and providers

| Source | Path |
|--------|------|
| Processor/DPA checklist | [GDPR_PROCESSOR_DPA_CHECKLIST.md](./GDPR_PROCESSOR_DPA_CHECKLIST.md) |
| Stage 2 processor summary | [LAUNCH_STAGE2_TECHNICAL_VALIDATION.md](./LAUNCH_STAGE2_TECHNICAL_VALIDATION.md) |

Active/substantive: Supabase, Vercel, Resend, Upstash (if enabled). Stripe: future/not active.

---

## Cookies and storage

| Source | Path |
|--------|------|
| Stage 2 storage audit | [LAUNCH_STAGE2_TECHNICAL_VALIDATION.md](./LAUNCH_STAGE2_TECHNICAL_VALIDATION.md) — cookies section |
| Public Cookie Policy | `/cookies` |
| Founder decision | No consent banner for current implementation (legal review caveat) — FD-003 area |

---

## Security and admin controls (appropriate level)

| Topic | Source |
|-------|--------|
| Privacy Admin security | [GDPR_PHASE3B_PRIVACY_ADMIN_SECURITY.md](./GDPR_PHASE3B_PRIVACY_ADMIN_SECURITY.md) |
| Platform admin MFA | Internal admin routes under `/admin` — not customer-facing |

Do **not** distribute: service-role keys, HMAC secrets, MFA enrolment details, invitation tokens, access codes.

---

## Commercial model (EA)

| Item | Status |
|------|--------|
| Subscription unit | Individual estate agent **branch** |
| Founding direction | £79/month — first 20 founding branches |
| Standard direction | £99/month per branch |
| Billing/Stripe | **Not implemented** — registration is free signup |
| EA Terms draft | `/estate-agents/terms` |

---

## Stage 3 UI/content changes

| Change | Location |
|--------|----------|
| Footer legal links + privacy@ | `app/page.tsx`, `EaLandingPage.tsx` |
| Account legal section | `LegalPrivacySection.tsx` |
| Collection notices | login, start-move, EA signup/onboarding |
| De-link vs erasure note | `ParticipationDelinkPanel.tsx` |
| Internal ID removal | my-chains, chain page, dashboard fallback |
| Topology copy | `healthy` → Connected; Break → Disconnect from chain |
| Pricing CTA clarity | EA landing — signup not checkout |
| Homepage FAQ | Present tense for EA |

---

## Review registers

| Register | Path |
|----------|------|
| Legal draft review register | [LAUNCH_LEGAL_DRAFT_REVIEW_REGISTER.md](./LAUNCH_LEGAL_DRAFT_REVIEW_REGISTER.md) |
| Website content register | [GDPR_WEBSITE_CONTENT_REGISTER.md](./GDPR_WEBSITE_CONTENT_REGISTER.md) |
| Launch checklist | [GDPR_LAUNCH_CHECKLIST.md](./GDPR_LAUNCH_CHECKLIST.md) |

---

## Outstanding decisions (summary)

See [LAUNCH_LEGAL_DRAFT_REVIEW_REGISTER.md](./LAUNCH_LEGAL_DRAFT_REVIEW_REGISTER.md) for full lists:

- Lawful bases confirmation per processing activity
- Company registration details for data controller identification
- International transfer safeguards per processor
- Retention period legal approval
- Liability/jurisdiction clause legal sign-off
- privacy@ mailbox operational setup and testing
- Stripe/billing commercial implementation (FD-036)
- Chain Confidence product behaviour (Stage 3.5 — not Stage 3)

---

*Index only — points to authoritative sources. Do not treat draft customer-facing pages as solicitor-approved advice.*
