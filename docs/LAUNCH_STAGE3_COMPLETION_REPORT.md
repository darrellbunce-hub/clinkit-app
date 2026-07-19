# Stage 3 Completion Report — P0 Launch Legal, Privacy and Content Structure

**Date:** June 2026  
**Status:** Stage 3 complete — stopped before Stage 3.5/4/5/6/Stripe

---

## 1. Pre-implementation findings

- **Legal placeholders:** `LegalPrivacySection.tsx` had five "Coming soon" items including misleading "Account Deletion Request / permanent account removal".
- **No public legal routes** existed; footer lacked Privacy/Terms/Cookies/privacy@.
- **Collection points** (login, start-move, EA signup/onboarding) had no privacy transparency links.
- **Homepage FAQ** stated estate agents participate "eventually" — factually outdated (EA product live).
- **Internal IDs** displayed as `Chain #123` and `Property {id}` in stale warnings.
- **Pricing defect:** `/estate-agents/pricing` route constant existed with no page; CTA implied payment without billing live.
- **Topology copy:** `healthy` displayed as "Healthy"; break UI said "Break Chain Connection".
- **De-link flow** lacked erasure distinction (FD-009).
- **No conflicts** with Stage 3 constraints — Chain Intelligence, billing, GDPR architecture, emails, access codes untouched.

---

## 2. Customer-facing files changed

| File | Change |
|------|--------|
| `components/account/LegalPrivacySection.tsx` | Policy links + erasure request entry |
| `components/legal/LegalDocumentPage.tsx` | New — legal page shell + footer links |
| `components/legal/CollectionPointNotice.tsx` | New — collection-point notice |
| `components/participation/ParticipationDelinkPanel.tsx` | Erasure distinction note |
| `components/estate-agents/EaLandingPage.tsx` | Footer legal links, pricing CTA clarity |
| `app/page.tsx` | FAQ fix, footer legal links |
| `app/login/page.tsx` | Collection notice |
| `app/start-move/page.tsx` | Collection notice |
| `app/estate-agents/signup/page.tsx` | Collection notice |
| `app/estate-agents/onboarding/page.tsx` | Collection notice |
| `app/my-chains/page.tsx` | Removed Chain # title |
| `app/chain/[chainId]/page.tsx` | Removed Chain # title; stale warning uses position |
| `app/dashboard/page.tsx` | Connected status label |
| `app/property/[propertyId]/page.tsx` | Disconnect from chain copy |
| `lib/operationalPosition.ts` | Fallback title → "Property chain" |
| `lib/auth/routes.ts` | Public legal paths registered |
| `lib/legal/*` | New legal constants, content, connection labels |

---

## 3. Legal routes/pages created

| Route | Page |
|-------|------|
| `/privacy` | Privacy Policy |
| `/terms` | Website & Platform Terms of Use |
| `/cookies` | Cookie Policy |
| `/data-retention` | Data Retention Information |
| `/estate-agents/terms` | Estate Agent Terms of Service |
| `/estate-agents/pricing` | Redirect → `/estate-agents#pricing` |

**Publication approach:** Customer pages use normal titles (no `DRAFT_FOR_LEGAL_REVIEW` label). Internal register marks all documents **DRAFT_FOR_LEGAL_REVIEW**.

---

## 4–8. Draft summaries

See `lib/legal/content/*.ts` and `docs/LAUNCH_LEGAL_DRAFT_REVIEW_REGISTER.md` for full detail.

| Document | Summary |
|----------|---------|
| **Privacy Policy** | Controller placeholder, privacy@, data categories, purposes, lawful-basis placeholders, chain sharing, processors (Supabase/Vercel/Resend/Upstash/Stripe future), retention, rights, erasure vs de-link, backups high-level, no analytics tracking |
| **Platform Terms** | Platform positioning, eligibility, appropriate use, access codes, disconnect vs erasure, IP, liability placeholders, England & Wales placeholder |
| **EA Terms** | Per-branch £79/£99 model, billing not live, CRM complement, data protection, no Enterprise as available |
| **Cookie Policy** | Supabase auth cookies, functional localStorage, no analytics SDKs, no banner (legal review caveat) |
| **Data Retention** | Purpose-based retention, proposed periods flagged, erasure vs de-link, backups, anonymised data |

---

## 9. Legal review status

All five documents: **DRAFT_FOR_LEGAL_REVIEW** — not APPROVED_FOR_PUBLICATION.

---

## 10. Footer/global legal navigation

- Homepage footer: Privacy, Terms, Cookies, Data Retention, privacy@
- EA marketing footer: same + Estate Agent Terms
- Legal pages: cross-nav between documents

---

## 11. Account privacy/erasure changes

- Removed "Coming soon" placeholders
- **Request deletion of your personal data** via privacy@ — not instant self-service
- Links to all policy documents

---

## 12. De-link vs erasure changes

- Concise note on `ParticipationDelinkPanel`: leaving ≠ requesting deletion
- Links to Privacy Policy and privacy@

---

## 13. Collection-point privacy notices

Added `CollectionPointNotice` at: login, start-move, EA signup, EA onboarding (step 1). Links to Privacy Policy only — no blanket consent checkbox.

---

## 14. Homepage factual corrections

FAQ "Who can use Keynetic?" — present tense for estate agents; link to EA pages implied in copy.

---

## 15. Internal ID removals

| Location | Before | After |
|----------|--------|-------|
| `my-chains` | `Chain #{id}` | `getDashboardChainTitle()` |
| `chain/[chainId]` | `Chain #{chainId}` | Address or "Property chain" |
| `operationalPosition` fallback | `Chain #${chainId}` | "Property chain" |
| Stale warning | `Property {id}` | Position number |

URLs/database IDs unchanged.

---

## 16. Pricing CTA/anchor correction

- `/estate-agents/pricing` redirects to marketing `#pricing`
- CTA: "Register your branch — free signup"
- Copy states billing not yet live

---

## 17. Connected / Disconnect terminology

| Internal | Customer-facing |
|----------|-----------------|
| `healthy` | Connected (dashboard) |
| Break chain connection | Disconnect from chain (property page) |

Underlying behaviour unchanged.

---

## 18. Legal review pack/index

Created: `docs/LAUNCH_LEGAL_REVIEW_PACK_INDEX.md`

---

## 19. Legal draft review register

Created: `docs/LAUNCH_LEGAL_DRAFT_REVIEW_REGISTER.md`

---

## 20–22. Outstanding questions

See register for full lists: lawful bases, controller details, transfers, retention approval, liability, PECR/banner, privacy@ mailbox, Stripe/billing (FD-036), EA controller/processor split.

---

## 23. New P0 launch blockers

1. Professional legal review of all drafts
2. privacy@ mailbox operational setup
3. Founder/legal APPROVED_FOR_PUBLICATION authorisation

(Unchanged: Chain Confidence Stage 3.5, Stripe implementation)

---

## 24. Verification/test results

`npx tsx scripts/verify-launch-stage3-legal.ts` — **PASSED** (all checks)

---

## 25. Build result

`npm run build` — **PASSED** (Next.js 16.2.6, 40 routes including all legal pages)

---

## 26–29. Confirmations

| Constraint | Status |
|------------|--------|
| Chain Intelligence algorithm/code unchanged | ✓ Confirmed |
| No billing/Stripe implementation | ✓ Confirmed |
| No database/migrations/Auth/GDPR/Privacy Admin behaviour changed | ✓ Confirmed |
| No Production changes | ✓ Confirmed |

---

**Stage 3 stopped.** Stage 3.5, 4, 5, 6 and Stripe require explicit founder approval.
