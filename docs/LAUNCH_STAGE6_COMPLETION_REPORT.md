# Stage 6 Completion Report — Terminology, UX & Brand Polish

**Date:** 21 July 2026  
**Status:** **FOUNDER_APPROVED_COMPLETE**  
**Founder sign-off:** 21 July 2026

**Authority:** [Founder Decisions](./LAUNCH_CONTENT_FOUNDER_DECISIONS.md) · [Terminology Register](./KEYNETIC_TERMINOLOGY_REGISTER.md) · [Stage 5 Report](./LAUNCH_STAGE5_COMPLETION_REPORT.md) · [Production Readiness Checklist](./PRODUCTION_READINESS_CHECKLIST.md)

---

## Founder sign-off record

The founder approved Stage 6 on **21 July 2026**. The following are **locked** for launch content:

| # | Decision | Status |
|---|----------|--------|
| 1 | **FD-041 — Chain status** | Homeowner-facing **Operational status** replaced with **Chain status**. Internal operational terminology and architecture unchanged. EA professional use of **operational** remains permitted where appropriate. |
| 2 | **FD-039 — Moving Made Clear** | Official Keynetic tagline. `KEYNETIC_TAGLINE` is the canonical reusable value. Tagline in **public marketing headers** (homepage + EA landing when logged out), homepage footer, EA landing footer, and transactional email footer. Authenticated app navigation remains logo/wordmark-only. Tagline does **not** need to appear beneath every logo. |
| 3 | **EA hero** | Approved: *“One shared chain view — whether a homeowner or your branch joins first.”* |
| 4 | **Partial-chain positioning** | Preserved — do not imply every real-world chain participant uses Keynetic; visibility improves as more connect; one shared chain model (not separate versions). |
| 5 | **Invite → Connect** | Preserved for customer-facing terminology. Internal claim architecture unchanged. |
| 6 | **“Keynetic meets everyone where the move starts”** | **Not a launch blocker.** May be revisited during final visual/marketing review if unclear. **Not changed** at this sign-off. |

**Launch content programme:** Stages **3 · 3.5 · 4 · 5 · 6** are all **FOUNDER_APPROVED_COMPLETE**.

**Next programme:** **Pre-Launch Operational Readiness** — **not started** (implementation).

---

## Summary

Stage 6 completed a customer-facing terminology, UX-copy, and brand-consistency pass across homeowner and estate-agent surfaces. Key outcomes:

- **FD-041:** Homeowner chain page label **Chain status** (supersedes FD-038 **Operational status** for homeowners only)
- **FD-039:** **Moving Made Clear** tagline restored with a documented brand usage rule
- Homeowner surfaces cleared of **operational** product terminology (internal architecture unchanged)
- EA **shared chain view** messaging replaces inaccurate **“Whoever starts the move, everyone finishes…”** wording
- Invite → **Connect** consistency extended to claim UI paths
- Internal term leaks removed from join-chain searching messages (searching placeholder, topology, property ID)

**Founder-approved complete.** Pre-Launch Operational Readiness **implementation** has not started.

**Not started:** Pre-Launch Operational Readiness implementation · Stripe/billing · Production deployment · schema/migrations · Auth/GDPR/Privacy Admin behaviour changes · Chain Intelligence calculation changes

---

## 1. Full terminology audit summary

| Area | Findings | Action |
|------|----------|--------|
| Homeowner chain page | FD-038 **Operational status** conflicted with Stage 6 no-operational rule | Relabelled **Chain status** (FD-041) |
| Property / Buyer Ready workspaces | **Operational owner**, **Operational Alert**, operational milestone/update copy | Role-aware labels via `lib/customerFacingLabels.ts` |
| Homepage | **Operational platform/view** in mixed-audience sections | Plain homeowner-oriented language in shared sections; EA section retains operational where appropriate |
| Claim / connect flow | **Claim** exposed in headings, CTAs, errors | **Connect** terminology (FD-021 extended) |
| Join chain | **Searching placeholder**, **topology**, property `#` in alerts | Plain English next-home search step messaging |
| EA landing | **Whoever starts… everyone** overstatement vs partial chains | **One shared chain view** messaging |
| Command Centre | **Operational confidence** bar label | **Chain confidence** (EA-only surface) |
| Chain Intelligence tooltips | **Operational information** in confidence tooltip | **Chain information** |
| Brand | Tagline absent from UI/emails | FD-039 implementation |
| Stale terms search | No active **Forecast Engine**, **real-time**, CRM replacement, or old confidence penalty copy found in runtime UI | No change required beyond items above |

---

## 2. Homeowner-facing uses of “operational” found

| Location | Text (before) |
|----------|----------------|
| `app/chain/[chainId]/page.tsx` | Operational status · operational conditions explainer · operational sale property |
| `app/page.tsx` | Shared operational platform/view (homeowner-facing sections) |
| `app/property/[propertyId]/page.tsx` | Operational Alert · operational milestone · Share operational updates |
| `app/buyer-ready/[chainId]/page.tsx` | Operational Alert · operational milestone/updates/events |
| `components/operational/OperationalContextStrip.tsx` | Operational owner · Operational manager |
| `components/operational/OperationalManagerBanner.tsx` | operational owner |
| `components/claim/ClaimPropertyExperience.tsx` | operational ownership |
| `lib/chainIntelligence/presentation.ts` | operational information (tooltip) |

EA-only surfaces intentionally retain operational terminology where it supports professional positioning (Command Centre, EA landing, originate page editing mode).

---

## 3. Exact replacements made and reasoning

| Before | After | Reason |
|--------|-------|--------|
| Operational status | **Chain status** | Plain English; works with Stable/Active/At Risk/Replacement Buyer Required; distinct from Progress/Confidence/ETA (FD-041) |
| Highlights operational conditions… | Reflects stale updates, reported delays, or connection issues… | Remove operational jargon for homeowners |
| Operational owner (homeowner strip) | **Managed by** | FD-018 plain language |
| Operational manager (homeowner) | **Your estate agent** | Natural homeowner wording |
| Operational Alert (homeowner) | **Attention needed** | Action badge without internal term |
| Operational milestone/updates (homeowner) | **milestone** / **Share updates with the chain** | Plain English |
| operational ownership / Claim property | **connect your property** / **Connect this property** | FD-021 invite→connect |
| Searching placeholder / topology (join) | **next-home search step** | FD-023 internal term leak |
| operational information (tooltip) | **chain information** | Homeowner-facing intelligence copy |
| Shared operational platform (homepage) | **shared platform** / **shared view** | Stage 6 homeowner positioning rule |

---

## 4. Confirmation internal operational architecture/code was not renamed

- No changes to `computeChainHealth()`, RPC names, schema, migrations, or internal modules (`operationalPosition`, `operationalSubject`, `operationalSummary`, etc.)
- `OPERATIONAL_OWNER_FALLBACK_LABEL` and related internal constants remain for EA paths
- Component/file names such as `OperationalContextStrip` unchanged (presentation only)

---

## 5. Final homeowner label replacing “Operational status”

**Chain status**

Explainer (customer-facing):

> Reflects stale updates, reported delays, or connection issues that may need attention. Separate from Chain Confidence, which reflects timing health for steps where reliable timing data is available.

Status values unchanged: **Stable · Active · At Risk · Replacement Buyer Required**

---

## 6. “Whoever starts the chain” current wording and location

**Previous locations (all updated):**

| Location | Previous wording |
|----------|------------------|
| EA hero headline | Whoever starts the move, everyone finishes on the same platform |
| EA outcomes card | Whoever starts the move, everyone finishes on the same platform — … |
| EA final CTA | Whoever starts the move, everyone finishes on the same platform |
| EA footer | Whoever starts the move, everyone finishes together |
| EA benefit strip outcome | everyone ends on the same platform |

---

## 7. Analysis of why it was retained or changed

**Changed** — not retained.

The phrase implied (a) that starting a move on Keynetic creates the real-world chain, and (b) that **everyone** in the chain participates on Keynetic. Both conflict with Stage 4 partial-chain honesty and the product’s actual model: **one shared chain model on Keynetic**, with visibility growing as participants connect.

---

## 8. Final EA wording implemented

**Hero headline:**

> One shared chain view —  
> whether a homeowner or your branch joins first.

**Supporting patterns used across EA landing:**

- Connected participants share one chain view on Keynetic
- Connected participants work from the same shared chain model
- Connected participants share the same shared operational workspace (EA professional positioning retained where appropriate)

No founder decision pending on EA headline — implemented after context review.

---

## 9. Partial-chain honesty review

Updated EA copy removes universal **“everyone”** claims. Retained approved partial-chain language from Stage 4/5:

- Connected participants / connected parts of the chain
- Visibility improves as more of the chain connects
- Keynetic only shows information for connected properties and participants

---

## 10. Platform-positioning changes

| Audience | Direction applied |
|----------|-------------------|
| Homeowner | Property chain coordination, shared progress, connected participants, live shared updates — **not** an “operational platform” |
| Estate agent | Retained **operational Command Centre**, **shared operational platform/view** where professionally appropriate |
| Homepage | Homeowner sections de-operationalised; EA section and FAQ answers still reference operational visibility for agents |

---

## 11. Invite → Connect consistency findings

| Surface | Before | After |
|---------|--------|-------|
| Claim page heading | Claim Your Property | **Connect Your Property** |
| Primary CTA | Claim this property | **Connect this property** |
| Empty/error states | claim link / claimed | **invitation link** / **connected** |
| EA originate hint | claim invitation | **invitation** |
| Transactional emails | Already Connect (Stage 5) | Unchanged |

Internal `claimOperationalProperty`, routes `/claim`, and schema claim status values unchanged.

---

## 12. Chain Intelligence copy/tooltips changes

| Item | Change |
|------|--------|
| Chain Confidence tooltip | “operational information” → **“chain information”** |
| Chain status panel | Label + explainer only (FD-041) |
| Progress / Confidence / ETA tooltips | Unchanged substance; timing_v1 / critical_path_v1 / 95% cap / limited-coverage preserved |
| Calculations | **No changes** |

---

## 13. “Moving Made Clear” audit findings

| Surface | Before | After |
|---------|--------|-------|
| Homepage footer logo | Tagline absent | Logo + tagline |
| EA landing footer | Tagline absent | Logo + tagline |
| Navbar / authenticated app | Logo only | Unchanged (compact context — correct) |
| Transactional email footer | Generic descriptor only | Tagline added |
| `app/layout.tsx` metadata | “Moving made clear” (description only) | Unchanged |
| Logo artwork | — | Not modified |

---

## 14. Final tagline usage rule (FD-039)

| Context | Treatment |
|---------|-----------|
| **Public marketing homepage header** | Navbar on `/` — Keynetic wordmark + tagline beneath wordmark (**route only**; visible for logged-in visitors too) |
| **Public EA marketing header** | `EaMarketingShell` — same treatment via `LightShellHeader showBrandTagline` |
| **Supporting brand contexts** | Homepage footer · EA landing footer · Transactional email footer |
| **Authenticated application navigation** | `Navbar` on non-`/` routes · `AgentShell` · dashboard/chain/property chrome — **logo/wordmark only** |
| **Rule** | **Public marketing context determines tagline visibility; authentication state does not.** |
| **Visual hierarchy** | Wordmark primary; tagline secondary (`text-[11px] sm:text-xs`) — must not compete with nav links |
| **Mobile** | Responsive tagline sizing; truncate on narrow widths where needed |
| **Do not** | Place tagline under every logo · modify logo PNG assets · hardcode duplicate tagline strings |

Constant: `KEYNETIC_TAGLINE` in `lib/theme/logoAssets.ts`

**Post–Stage 6 refinement (21 Jul 2026):** Public marketing **headers** added per founder visual review.

---

## 15. Locations where tagline is displayed

1. `components/ui/Logo.tsx` — optional `showTagline` prop (wordmark + tagline column layout)
2. `components/Navbar.tsx` — homepage public header (`/` · route-based; auth-independent)
3. `components/estate-agents/EaMarketingShell.tsx` → `LightShellHeader` — EA public marketing header
4. `app/page.tsx` — homepage footer
5. `components/estate-agents/EaLandingPage.tsx` — EA landing footer
6. `emails/components/Footer.tsx` — transactional email footer

---

## 16. CTA consistency changes

| CTA | Change |
|-----|--------|
| Claim this property | **Connect this property** |
| Claiming… | **Connecting…** |
| Claim Your Property | **Connect Your Property** |
| Start Your Move / Join Existing Chain / Accept invitation (emails) | Unchanged — already accurate |

Destructive/disconnect CTAs unchanged. EA signup CTAs unchanged (billing-not-live note preserved).

---

## 17. Mobile copy/layout fixes

- **Attention needed** badge (shorter than Operational Alert) on property/buyer-ready action panels
- **Chain status** label (shorter than Operational status)
- EA hero headline split across two lines (existing responsive pattern)
- No broad responsive redesign undertaken

---

## 18. Accessibility copy fixes

| Item | Fix |
|------|-----|
| Command Centre confidence bar `aria-label` | Operational confidence → **Chain confidence** |
| Logo link `aria-label` | Includes tagline when `showTagline` is true |
| Role-aware action alert badges | Clearer non-jargon labels for homeowners |

No unrelated component refactors for ESLint baseline.

---

## 19. Retired/stale terminology findings (active runtime)

| Term searched | Active runtime finding |
|---------------|------------------------|
| Forecast Engine | Not in active UI |
| Ready to proceed (authoritative Buyer Ready) | Not found |
| real-time (absolute) | Not in active customer copy |
| eventually estate agents | Removed in Stage 3 |
| Claim Property (customer) | **Fixed** in Stage 6 claim UI |
| operational (homeowner) | **Fixed** |
| CRM replacement | Not used |
| anonymised benchmarks as live | Not used |
| first 20 branches (inappropriate context) | EA pricing retains founding context with billing-not-live note |
| penalty-from-85 / CONFIDENCE_BASE | Not in customer copy |
| internal IDs in alerts | **Fixed** (property # removed from join-chain conflict message) |
| Coming soon legal placeholders | Not in active legal pages |
| Moving Made Clear absence | **Fixed** (FD-039) |

Historical docs, tests, and internal modules retain audit evidence intentionally.

---

## 20. Files changed

**New**

- `lib/customerFacingLabels.ts`
- `scripts/verify-stage6-terminology.ts`
- `docs/LAUNCH_STAGE6_COMPLETION_REPORT.md`

**Modified**

- `lib/theme/logoAssets.ts`
- `components/ui/Logo.tsx`
- `lib/operationalPresentation.ts` *(via hook only)*
- `hooks/useOperationalWorkspaceLabels.ts`
- `components/operational/OperationalContextStrip.tsx`
- `components/operational/OperationalManagerBanner.tsx`
- `app/chain/[chainId]/page.tsx`
- `app/property/[propertyId]/page.tsx`
- `app/buyer-ready/[chainId]/page.tsx`
- `app/page.tsx`
- `app/join-chain/page.tsx`
- `app/agent/originate/page.tsx`
- `components/estate-agents/EaLandingPage.tsx`
- `components/claim/ClaimPropertyExperience.tsx`
- `components/claim/ClaimablePropertyCard.tsx`
- `components/claim/ClaimInvitationError.tsx`
- `lib/joinChainSearching.ts`
- `lib/chainIntelligence/presentation.ts`
- `components/agent/commandCentre/ConfidenceBar.tsx`
- `emails/components/Footer.tsx`
- `scripts/verify-transactional-email-content.ts`
- `docs/LAUNCH_CONTENT_FOUNDER_DECISIONS.md`
- `docs/KEYNETIC_TERMINOLOGY_REGISTER.md`

---

## 21. Issues deferred to Pre-Launch Operational Readiness

These items remain **open** — Stage 6 sign-off does **not** resolve them. See [Production Readiness Checklist §14](./PRODUCTION_READINESS_CHECKLIST.md).

| Item | Notes |
|------|-------|
| **Professional legal review and publication approval** | Policy drafts remain **DRAFT_FOR_LEGAL_REVIEW** |
| **FD-004** | Invitation email address/subject legal review — **PENDING_LEGAL_REVIEW** |
| **privacy@ mailbox operational verification** | Pre-Launch |
| **Provider/DPA verification** | Pre-Launch |
| **Production environment/secrets review** | Pre-Launch |
| **FD-040 / `NEXT_PUBLIC_APP_URL`** | Production verification |
| **Resend Production configuration** | Pre-Launch |
| **Supabase Auth Production email templates** | Pre-Launch |
| **EA branch user access revocation** | Pre-Launch |
| **EA owner transfer/continuity** | Pre-Launch |
| **Production observability and incident alerting** | Pre-Launch |
| **Product/business operational metrics** | Pre-Launch |
| **Privacy-conscious website analytics decision** | Pre-Launch |
| **Run-cost monitoring and cost governance** | Pre-Launch |
| **Stripe/billing architecture (FD-036)** | Separate gated workstream |
| **Refund/cancellation/dispute procedures** | Pre-Launch |
| **Final security review** | Pre-Launch |
| **Final Production launch checklist** | Pre-Launch |
| **Unwired email templates** | Welcome · Property connected — documented inactive |

---

## 22. Verification/test results

| Suite | Result |
|-------|--------|
| `npm run build` | **PASS** |
| `npx tsc --noEmit` | **PASS** (via build) |
| `npx tsx scripts/verify-stage6-terminology.ts` | **PASS** (20/20) |
| `npx tsx scripts/verify-launch-stage3-legal.ts` | **PASS** |
| `npx tsx scripts/verify-chain-intelligence-stage35-refinements.ts` | **PASS** |
| `npx tsx scripts/verify-chain-intelligence-critical-scenarios.ts` | **PASS** (14/14) |
| `npx tsx scripts/verify-command-centre-presentation.ts` | **PASS** (6/6) |
| `npx tsx scripts/verify-transactional-email-content.ts` | **PASS** (includes rendered tagline check) |

---

## 23. ESLint final baseline (founder sign-off)

| | Pre-Stage-6 baseline | Final (post–final verification fix) |
|--|----------------------|-------------------------------------|
| Total | 55 | **55** |
| Errors | 22 | **22** |
| Warnings | 33 | **33** |

Matches known pre-Stage-6 baseline. The interim +1 warning (`PAGE_TITLE_CLASS` unused import in `ClaimablePropertyCard.tsx`) was identified and fixed before founder sign-off.

---

## 24. Build result

**PASS** — Next.js 16.2.6 production build completed successfully.

---

## 25. Confirmation no business logic/schema/Auth/GDPR/billing/Production changes

Confirmed:

- No Chain Intelligence calculation changes
- No database schema or migration changes
- No Supabase remote changes
- No Auth/GDPR/Privacy Admin workflow changes
- No email delivery architecture changes (footer copy only)
- No Stripe/billing implementation
- No Production deployment

---

## 26. Sign-off status

**Stage 6 — Terminology, UX & Brand Polish is FOUNDER_APPROVED_COMPLETE** (21 July 2026).

The **Launch Content programme** (Stages 3–6) is complete. The next programme is **Pre-Launch Operational Readiness** — implementation **not started**.

No application code or behaviour was changed during this documentation sign-off step.
