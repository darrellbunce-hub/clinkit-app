# Keynetic Launch Content Audit

**Phase:** Audit complete · Founder review complete · Stage 2 complete · Stage 3 complete · Stage 3.5 complete · Stage 4 founder-approved complete · Stage 5 founder-approved complete · **Stage 6 founder-approved complete**  
**Date:** Original audit 19 July 2026 · Consolidation 19 July 2026 · Stage 6 sign-off 21 July 2026  
**Authority:** [Founder Decisions](./LAUNCH_CONTENT_FOUNDER_DECISIONS.md) · [Stage 2 Validation](./LAUNCH_STAGE2_TECHNICAL_VALIDATION.md)

**Launch Content programme:** Stages **3–6** are **FOUNDER_APPROVED_COMPLETE**. **Next programme:** Pre-Launch Operational Readiness (implementation not started).

---

## Executive summary

This audit inventories user-facing copy across the public website, homeowner and estate-agent product surfaces, transactional emails, and Privacy Admin operator wording. It compares messaging against implemented product behaviour and GDPR engineering (Phases 2–4, Privacy Admin + MFA).

**Founder review status:** FD-001–FD-041 in [LAUNCH_CONTENT_FOUNDER_DECISIONS.md](./LAUNCH_CONTENT_FOUNDER_DECISIONS.md). Stage 2 complete — [LAUNCH_STAGE2_TECHNICAL_VALIDATION.md](./LAUNCH_STAGE2_TECHNICAL_VALIDATION.md). **Stage 4 complete** — [LAUNCH_STAGE4_COMPLETION_REPORT.md](./LAUNCH_STAGE4_COMPLETION_REPORT.md). **Stage 5 complete** — [LAUNCH_STAGE5_COMPLETION_REPORT.md](./LAUNCH_STAGE5_COMPLETION_REPORT.md). **Stage 6 complete** — [LAUNCH_STAGE6_COMPLETION_REPORT.md](./LAUNCH_STAGE6_COMPLETION_REPORT.md).

**Chain Intelligence:** Stage 3.5 timing_v1 model **founder-approved** — customer-facing terminology incorporated in Stage 4. See [Stage 3.5 report](./LAUNCH_STAGE3_5_COMPLETION_REPORT.md).

**Transactional email (Stage 5):** Active sends — homeowner invitation · EA invitation · dormancy warning. **Unwired (inactive):** Welcome · Property connected. **FD-004** subject-line exposure **PENDING_LEGAL_REVIEW** before Production. Pre-Launch email environment checks — [Production Readiness Checklist §13](./PRODUCTION_READINESS_CHECKLIST.md).

**Stage 6 (terminology / brand):** FD-041 **Chain status** · FD-039 **Moving Made Clear** · homeowner no-operational rule · EA shared-chain hero approved. See [Stage 6 report](./LAUNCH_STAGE6_COMPLETION_REPORT.md). Pre-Launch programme — [§14](./PRODUCTION_READINESS_CHECKLIST.md).

**Key launch risks (content):** Legal placeholders; no published policies; footer lacks privacy@; marketing real-time/chain-wide claims; current confidence tooltips misstate algorithm.

---

## Methodology

| Source type | Scope |
|-------------|-------|
| App routes | 29 `app/**/page.tsx` files |
| Components | Account, auth, claim, participation, lifecycle, agent, estate-agents, navbar, privacy admin (operator) |
| Emails | 6 production templates + layout/components |
| Presentation libs | De-link, dormancy, confidence, completion, communications |
| Constants / server messages | `ChainContext`, join-chain, start-move errors |
| Existing register | Cross-reference to `GDPR_WEBSITE_CONTENT_REGISTER.md` |

Searches run for placeholders (`Coming soon`, `TODO`, `TBD`, `placeholder`, `delete account`, etc.), privacy terms, marketing claims, and address disclosure patterns.

**User-facing content locations reviewed:** **118**  
(distinct pages, major UI sections, email templates, and reusable copy modules)

---

## Part 1 — Content inventory (summary)

| Area | Routes / files | Audience | Notes |
|------|----------------|----------|-------|
| Public homepage | `/` · `app/page.tsx` | Public | Hero, features, metrics, FAQ, footer |
| Public nav | `Navbar.tsx` | Public / auth | Login, Start Move, EA link |
| EA marketing | `/estate-agents` · `EaLandingPage.tsx` | Estate agent | Strong CRM-complement positioning |
| EA auth/onboarding | `/estate-agents/login`, `signup`, `join`, `onboarding` | Estate agent | Branch setup |
| Homeowner auth | `/login`, `/verify-email`, `/forgot-password`, `/reset-password` | Homeowner | Minimal privacy context |
| Start Move | `/start-move` | Homeowner | Address collection, searching placeholder |
| Join Chain | `/join-chain` | Homeowner | Access code, `alert()` errors |
| Claim | `/claim` | Homeowner | Invitation acceptance |
| Dashboard | `/dashboard`, `/my-chains` | Homeowner | Property titles, chain list |
| Property workspace | `/property/[propertyId]` | Homeowner / EA | Operational editing, lifecycle |
| Chain view | `/chain/[chainId]` | Homeowner / EA | Viz, confidence, dormancy, de-link |
| Buyer Ready | `/buyer-ready/[chainId]` | Homeowner | Completion readiness |
| Account | `/account` · `LegalPrivacySection`, `SecuritySection` | All | **Legal placeholders P0** |
| Agent Command Centre | `/agent`, `/agent/originate` | Estate agent | Branch ops |
| Privacy Admin | `/admin/privacy`, `/admin/mfa/*` | Platform admin | Operator-only; AAL2 |
| Emails | `emails/templates/*` | Transactional | 3 wired send paths + 3 preview-only |
| Dev-only | `/dev/emails`, `/branding-review` | Internal | Excluded from launch blockers |

---

## Part 2 — Content register (findings)

Severity: **P0** launch blocker · **P1** before launch · **P2** polish · **P3** optional

| ID | Area | Route | File | Audience | Summary | Classification | Sev | Problem | Why it matters | Recommended direction | Founder? | Legal? | Priority |
|----|------|-------|------|----------|---------|----------------|-----|---------|----------------|----------------------|----------|--------|----------|
| LCA-001 | Account legal | `/account` | `LegalPrivacySection.tsx` | Homeowner/EA | All 5 policies show "Coming soon" | PLACEHOLDER | P0 | No published legal docs at collection/account touchpoint | Art. 13/14; launch trust | Publish policies or interim links to hosted docs | No | Yes | A |
| LCA-002 | Account deletion | `/account` | `LegalPrivacySection.tsx` | Homeowner/EA | "Account Deletion Request" + "permanent account removal" | LEGAL_PRIVACY_RISK | P0 | Implies self-serve delete; actual path is Privacy Admin RTBF + privacy@ | Users may believe instant delete; ICO risk | **FD-001 APPROVED:** CTA "Request deletion of your personal data"; Right to erasure via privacy@; no "Remove login account" | Yes (FD-001) | Yes | Stage 3 |
| LCA-003 | Privacy Policy | — | Missing route | Public | No `/privacy` page | LEGAL_PRIVACY_RISK | P0 | No published privacy notice | Launch blocker | **FD-011:** Draft Privacy Policy — DRAFT_FOR_LEGAL_REVIEW only | No | Yes | Stage 3 |
| LCA-004 | Terms | — | Missing | Public | No Terms of Service page | LEGAL_PRIVACY_RISK | P0 | No contract terms | Launch blocker | **FD-011 expanded:** Platform Terms of Use + EA Business Terms — legal review | No | Yes | Stage 3 |
| LCA-005 | Cookies | — | Missing | Public | No cookie policy or banner | LEGAL_PRIVACY_RISK | P0 | PECR transparency | Compliance gap | **FD-014:** Technical cookie/storage audit first; no generic banner by assumption | No | Yes | Stage 2 → 3 |
| LCA-006 | Footer | `/`, global | `app/page.tsx`, EA footer | Public | Footer: Home/Dashboard/Start/Join only; no Privacy/Terms/privacy@ | LEGAL_PRIVACY_RISK | P0 | No legal links or privacy contact | Art. 13 contact | Add Privacy, Terms, Cookies, privacy@ | No | Yes | A |
| LCA-007 | Sign-up notice | `/login`, EA signup | Login/signup pages | All | No privacy snippet at data collection | LEGAL_PRIVACY_RISK | P0 | Collection without linked notice | GDPR transparency | Short notice + link at signup | No | Yes | A |
| LCA-008 | Homepage FAQ | `/` | `app/page.tsx` | Public | "eventually estate agents and conveyancers" | FACTUALLY_OUTDATED | P0 | EA product exists | Misleading capability | Present tense; link to `/estate-agents` | Yes (FD-010) | No | A |
| LCA-009 | EA pricing nav | `/estate-agents` | `EaLandingPage.tsx` | EA | Nav may link `/estate-agents/pricing`; page is anchor `#pricing` only | BROKEN_JOURNEY | P1 | Potential 404 on pricing link | Broken CTA | Fix href to `#pricing` or add page | No | No | A |
| LCA-010 | Hero H1 | `/` | `app/page.tsx` | Public | "Track Your Property Chain In Real Time" | UNSUPPORTED_CLAIM | P1 | Not guaranteed sub-second streaming | Overpromise | **FD-002 APPROVED:** Prefer "live" wording; final copy in Stage 4 | Yes | No | Stage 4 |
| LCA-011 | Homepage steps | `/` | `app/page.tsx` | Public | "real time" in step 3 | UNSUPPORTED_CLAIM | P1 | Same as LCA-010 | Consistency | **FD-002** — align with live terminology | Yes | No | Stage 4 |
| LCA-012 | Metrics band | `/` | `app/page.tsx` | Public | "Real-Time" / "24/7" / "Chain-Wide" | UNSUPPORTED_CLAIM | P1 | Absolute availability + full chain | Marketing accuracy | **FD-002 + FD-006:** Live + partial-chain honesty | Yes | No | Stage 4 |
| LCA-013 | Feature: bottlenecks | `/` | `app/page.tsx` | Public | "Identify delays… before they impact completion" | UNSUPPORTED_CLAIM | P1 | Structured delay reasons exist; not predictive prevention | Implies prevention | "Surface delays early" not "prevent" | No | No | B |
| LCA-014 | Feature: chain progress | `/` | `app/page.tsx` | Public | "every property sits within the chain" | PRODUCT_BEHAVIOUR_MISMATCH | P1 | Partial/unconnected chains common | User disappointment | Explain partial visibility (FD-006) | Yes | No | B |
| LCA-015 | Homepage positioning | `/` | `app/page.tsx` | Public | "property chain tracking platform" — CRM distinction weak | WEAK_VALUE_PROPOSITION | P1 | New visitors may confuse with CRM/portal | Positioning | Add explicit "not a CRM" line in hero/FAQ | Yes | No | B |
| LCA-016 | EA benchmarks | `/estate-agents` | `EaLandingPage.tsx` | EA | "anonymised regional benchmarks" in feature list | UNSUPPORTED_CLAIM | P1 | Contradicts Coming soon elsewhere | Mixed signals | **FD-003 APPROVED:** Remove/qualify stray claims; use "Operational insights"; Coming soon OK on EA page | Yes | Yes | Stage 4 |
| LCA-017 | EA analytics section | `/estate-agents` | `EaLandingPage.tsx` | EA | Branch analytics "Coming soon" badge | PLACEHOLDER | P2 | Visible placeholder on marketing page | Polish | Acceptable if clearly labelled; ensure no contradictory claims | No | No | F |
| LCA-018 | EA CRM positioning | `/estate-agents` | `EaLandingPage.tsx` | EA | "Works alongside your CRM" | NO_CHANGE_RECOMMENDED | — | Accurate, strong | Keep | Keep and reuse on homepage | No | No | — |
| LCA-019 | EA founding price | `/estate-agents` | `EaLandingPage.tsx` | EA | £79/mo founding offer | PRODUCT_BEHAVIOUR_MISMATCH | P1 | Billing/checkout may not be live | EA expectation | **FD-007 PENDING_COMMERCIAL:** Confirm billing unit; no "first 20 branches" until confirmed; no false checkout | Yes | Yes | Stage 2 → 4 |
| LCA-020 | De-link copy | Property/chain | `participationDelinkPresentation.ts` | Homeowner/EA | History/analytics retained on leave | NO_CHANGE_RECOMMENDED | — | Accurate for de-link | Good | Add erasure cross-link (LCA-021) | No | Yes | C |
| LCA-021 | De-link vs erasure | Property | `ParticipationDelinkPanel` | Homeowner | No distinction from GDPR erasure | LEGAL_PRIVACY_RISK | P1 | Users may think leave = delete all data | Legal misunderstanding | **FD-009 APPROVED:** Short unobtrusive note + privacy@ route | Yes | Yes | Stage 3 |
| LCA-022 | Dormancy warning | Property/chain | `DormancyWarningPanel`, email | Homeowner | Release after inactivity | NO_CHANGE_RECOMMENDED | P2 | Accurate; not erasure | Good | Optional cross-link to retention policy | No | Yes | E |
| LCA-023 | Lifecycle anonymised | Internal/docs surfaced | `lib/lifecycle/types.ts` comments | — | Code documents distinction | — | — | Not user-facing | N/A | Ensure user copy never equates anonymised = RTBF | No | Yes | A |
| LCA-024 | privacy@ contact | Product-wide | — | All | privacy@ not in UI | LEGAL_PRIVACY_RISK | P0 | Required public contact missing | Erasure requests misrouted | Surface in footer + account (FD-008) | Yes | Yes | A |
| LCA-025 | admin@ exposure | — | Grep: not in user UI | — | admin@ not marketed as privacy contact | NO_CHANGE_RECOMMENDED | — | Correct | Good | Do not use admin@ publicly | No | No | — |
| LCA-026 | 72h guarantee | — | Not in user UI | — | Internal target not shown as legal deadline | NO_CHANGE_RECOMMENDED | — | Correct omission | Good | Keep internal; policy must cite 1-month statutory | No | Yes | A |
| LCA-027 | Join chain errors | `/join-chain` | `join-chain/page.tsx` | Homeowner | Errors via `alert()` | UX_MICROCOPY | P2 | Poor a11y/mobile UX | Unprofessional | Inline error components | No | No | G |
| LCA-028 | Chain context errors | Chain/property | `ChainContext.tsx` | Homeowner | Many `alert()` for permission/stage gates | ACCESSIBILITY_COPY | P2 | Screen reader / mobile | a11y | Toast or inline banners | No | No | G |
| LCA-029 | Start Move errors | `/start-move` | `start-move/page.tsx` | Homeowner | Some failures console-only | UX_MICROCOPY | P2 | User sees silent failure | Support burden | User-visible error states | No | No | C |
| LCA-030 | Verify email | `/verify-email` | `verify-email/page.tsx` | Homeowner | "Track progression in real time" | UNSUPPORTED_CLAIM | P2 | Same real-time concern | Consistency | Align with FD-002 | Yes | No | F |
| LCA-031 | Invitation email address | Email | `HomeownerInvitation.tsx` | Transactional | Full address in subject + body | LEGAL_PRIVACY_RISK | P1 → **PENDING_VALIDATION** | Email minimisation vs trust | GDPR + trust | **FD-004 OVERRIDE:** Do not auto-reduce addresses; Stage 2 validation + legal review | Yes | Yes | Stage 2 → 5 |
| LCA-032 | Invitation email CTA | Email | `HomeownerInvitation.tsx` | Transactional | "Accept invitation" → claim flow | NO_CHANGE_RECOMMENDED | — | Matches `/claim` | Good | Verify link expiry copy | No | No | E |
| LCA-033 | EA invitation email | Email | `EstateAgentInvitation.tsx` | Transactional | Branch invite copy | EMAIL_CONTENT | P2 | Review for CRM-complement tone | Consistency | Align with EA landing | No | No | E |
| LCA-034 | Dormancy email | Email | `DormancyWarning.tsx` | Transactional | No full address (good) | NO_CHANGE_RECOMMENDED | — | Minimisation | Good | Keep | No | No | E |
| LCA-035 | Welcome email | Email | `WelcomeEmail.tsx` | — | Template only, not wired | PLACEHOLDER | P2 | No production send | Incomplete journey | Wire or remove from dev preview at launch | No | No | E |
| LCA-036 | Password reset email | Email | `PasswordReset.tsx` | — | Template + Supabase auth | EMAIL_CONTENT | P2 | Confirm branding/subject parity | Consistency | Audit when enabled | No | No | E |
| LCA-037 | Property claimed email | Email | `PropertyClaimed.tsx` | — | Preview only | EMAIL_CONTENT | P2 | Address in template | Minimisation | Review before wiring | No | Yes | E |
| LCA-038 | Email sender | All | `lib/communications/email.ts` | Transactional | `notifications@keynetic.co.uk` | NO_CHANGE_RECOMMENDED | — | Appropriate | Good | No reply-for-privacy confusion | No | No | E |
| LCA-039 | Chain viz addresses | `/chain/[chainId]` | Chain components | Homeowner | Peer addresses hidden in viz | NO_CHANGE_RECOMMENDED | — | Matches privacy principle | Good | Document in privacy notice | No | Yes | C |
| LCA-040 | Dashboard address | `/dashboard` | Dashboard | Homeowner | Own property address shown | necessary operational | P3 | Justified for own property | OK | Explain in privacy notice | No | Yes | C |
| LCA-041 | Chain/property IDs | `/my-chains`, chain page | Various | Homeowner | Numeric IDs visible | UX_MICROCOPY | P1 | Unfriendly; minor leakage | UX/privacy-adjacent | **FD-005 APPROVED:** Remove from routine UI; discreet support ref on errors | Yes | No | Stage 3 |
| LCA-042 | Access code display | Dashboard/chain | Various | Homeowner | Plain-text access code | INCONSISTENT_TERMINOLOGY | P2 → **NO CHANGE** | — | — | **FD-022 OVERRIDE:** No masking/security change in content phase | No | No | — |
| LCA-043 | Searching placeholder UI | Chain | `chain/[chainId]/page.tsx` | Homeowner | "Searching" state for buying side | NO_CHANGE_RECOMMENDED | — | Good customer term | Good | Never expose internal "placeholder" | No | No | C |
| LCA-044 | Confidence wording | Chain | Confidence components | Homeowner | Healthy / slowing / needs attention | PRODUCT_BEHAVIOUR_MISMATCH | P1 → **GATED** | May mislead if algorithm stale/high floor | Trust | **FD-028/029:** Technical validation before copy; tooltips after validation | Yes | Yes | Stage 2 → 4 |
| LCA-045 | Buyer Ready | `/buyer-ready/[chainId]` | Page | Homeowner | Completion readiness flow | PRODUCT_BEHAVIOUR_MISMATCH | P2 | Verify all statuses match engine | Accuracy | Content pass in Phase C | No | No | C |
| LCA-046 | Completion lifecycle | Property | Completion components | Homeowner | Complete move wording | AMBIGUOUS | P2 | vs lifecycle anonymisation | Clarity | Distinguish complete vs archive | No | Yes | C |
| LCA-047 | Withdraw/de-link CTAs | Property | `ParticipationDelinkPanel` | Homeowner/EA | Multiple operation-specific labels | NO_CHANGE_RECOMMENDED | P2 | Clear with confirmation | Good | Terminology register alignment | No | No | F |
| LCA-048 | Privacy Admin UI | `/admin/privacy` | Privacy Admin components | Privacy Admin | Subject UUID, checklist, processors | NO_CHANGE_RECOMMENDED | — | Operator-only; accurate post-Phase 4 | Good | Do not expose to homeowners | No | No | — |
| LCA-049 | MFA enrol copy | `/admin/mfa/enroll` | MFA panels | Privacy Admin | TOTP enrol/challenge | NO_CHANGE_RECOMMENDED | — | Accurate | Good | — | No | No | — |
| LCA-050 | Agent "Command Centre" | `/agent` | Agent dashboard | EA | Operational visibility language | NO_CHANGE_RECOMMENDED | — | Differentiates from CRM | Good | — | No | No | D |
| LCA-051 | Agent vs CRM | `/agent` | Agent copy | EA | No "replace CRM" language found | NO_CHANGE_RECOMMENDED | — | Correct | Good | — | No | No | D |
| LCA-052 | Conveyancing implication | Marketing grep | — | Public | No conveyancing platform claims | NO_CHANGE_RECOMMENDED | — | Correct | Good | FAQ mentions conveyancers as participants only | No | No | — |
| LCA-053 | Fall-through prevention | `/`, EA | Marketing | Public/EA | "Reduce uncertainty/delays" not "prevent collapse" | PARTIALLY_SUPPORTED | P2 | Soft benefit claims | Acceptable if not absolute | Avoid "prevent fall-through" without evidence | No | No | B |
| LCA-054 | AI / automation | Grep | — | — | No user-facing AI claims found | NO_CHANGE_RECOMMENDED | — | — | Good | — | No | No | — |
| LCA-055 | Analytics anonymous | EA + docs | EA landing | EA | "Anonymised" benchmarks | LEGAL_REVIEW_REQUIRED | P1 | Snapshots may be pseudonymous | Misleading | **FD-003/030:** Use "Operational insights"; not "anonymised benchmarks" | Yes | Yes | Stage 4 |
| LCA-056 | Shared platform concept | EA landing | `EaLandingPage.tsx` | EA | "same platform" / shared view | NO_CHANGE_RECOMMENDED | — | Strong | Reuse for homeowners | No | No | B |
| LCA-057 | Homeowner join benefit | `/join-chain`, invite | Join + claim | Homeowner | Benefit of joining less clear than EA side | WEAK_VALUE_PROPOSITION | P1 | Conversion/trust | Explain shared visibility + privacy | Short explainer on join/claim | Yes | No | C |
| LCA-058 | Chain terminology | Product-wide | Various | Homeowner | "Chain" used without glossary | CONFUSING | P2 | Non-industry users | Comprehension | One-line explainer first use | No | No | C |
| LCA-059 | Invitation trust | Email + claim | Invite flows | Homeowner | EA name + address; ignore-if-unexpected | NO_CHANGE_RECOMMENDED | P2 | Reasonable trust signals | Good | Optional Keynetic explainer line | No | No | C |
| LCA-060 | Who can see what | Property/chain | — | Homeowner | Not explained in UI | AMBIGUOUS | P1 | Privacy anxiety | Transparency | "Who can see this" help panel | Yes | Yes | C |
| LCA-061 | Operational owner | Property edits | `canEditProperty` messaging | Homeowner | Permission denied alerts | PRODUCT_BEHAVIOUR_MISMATCH | P2 | Copy should match ownership model | Accuracy | Align with "who manages this property" | No | No | C |
| LCA-062 | EA edit everything | Agent UI | — | EA | No blanket "edit everything" claim | NO_CHANGE_RECOMMENDED | — | Matches permission model | Good | — | No | No | D |
| LCA-063 | Duplicate privacy explainer | Account + future footer | Multiple | All | Legal text will duplicate | CONTENT_DUPLICATION | P2 | Drift risk | Maintenance | Central `legalCopy` constants later | No | Yes | F |
| LCA-064 | Duplicate chain explainer | `/`, dashboard, join | Multiple | All | Chain descriptions repeated | CONTENT_DUPLICATION | P3 | Drift | Maintenance | Shared marketing constants | No | No | F |
| LCA-065 | Navbar CTA | Global | `Navbar.tsx` | Public | Start Move / Login | CTA_IMPROVEMENT | P3 | Clear | Good | — | No | No | — |
| LCA-066 | Start Your Move CTA | `/`, `/start-move` | Multiple | Homeowner | Accurate entry to start-move | NO_CHANGE_RECOMMENDED | — | Good | — | No | No | — |
| LCA-067 | Leave transaction CTA | De-link modal | Delink panel | Homeowner | Destructive with confirm | NO_CHANGE_RECOMMENDED | — | Good | Not labelled "delete account" | No | Yes | C |
| LCA-068 | Mobile long CTAs | Homepage hero | `app/page.tsx` | Public | "Start Your Move" / "Join Existing Chain" | MOBILE_COPY_RISK | P3 | Fit sm breakpoints | Previously fixed dormancy | Spot-check 320px | No | No | G |
| LCA-069 | Email long subjects | Invitation | `HomeownerInvitation` | Email | Full address lengthens subject | MOBILE_COPY_RISK | P2 → **PENDING_VALIDATION** | Mobile mail clients truncate | Open rates | **FD-004:** Subject reviewed in Stage 2; no automatic shortening | Yes | No | Stage 2 → 5 |
| LCA-070 | Icon-only actions | Chain/property | Various | All | Some icon buttons | ACCESSIBILITY_COPY | P2 | Needs aria-label audit | a11y | Add labels in Phase G | No | No | G |
| LCA-071 | Form placeholders | Start move | Input placeholders | Homeowner | "Selling property address" etc. | NO_CHANGE_RECOMMENDED | — | Clear labels | Good | — | No | No | — |
| LCA-072 | Tone: homepage | `/` | Marketing | Public | Calm, modern | TONE_CONSISTENCY | P3 | Slightly more hype than product UI | Brand | Align product + marketing tone in Phase B | No | No | F |
| LCA-073 | Tone: legal placeholders | `/account` | Dashed "Coming soon" boxes | All | Feels unfinished | TONE_CONSISTENCY | P0 | Undermines trust | Launch perception | Replace before public launch | No | Yes | A |
| LCA-074 | Retention indefinite | — | No user claim of indefinite retention | — | Not claimed in UI | NO_CHANGE_RECOMMENDED | — | Good | Publish retention policy | No | Yes | A |
| LCA-075 | Backups instant erase | — | Not claimed in UI | — | Correct omission | NO_CHANGE_RECOMMENDED | — | Phase 4 processor workflow internal | Policy must describe accurately | No | Yes | A |
| LCA-076 | Public Rightmove justification | — | Not found in UI | — | No "public portal = no GDPR" claim | NO_CHANGE_RECOMMENDED | — | Good | — | No | Yes | — |
| LCA-077 | Moving Hub | Grep | — | — | No "Moving Hub" user-facing brand found | NO_CHANGE_RECOMMENDED | — | N/A or future | Note for later | No | No | — |
| LCA-078 | Data retention policy placeholder | `/account` | `LegalPrivacySection` | All | Coming soon | PLACEHOLDER | P0 | Lifecycle retention exists in code but unpublished | Transparency | Publish schedule aligned to `GDPR_DATA_RETENTION_SCHEDULE.md` | No | Yes | A |
| LCA-079 | EA onboarding privacy | `/estate-agents/onboarding` | Onboarding | EA | Branch/company PII collection | LEGAL_PRIVACY_RISK | P1 | No EA-specific notice | GDPR | EA privacy snippet at collection | No | Yes | A |
| LCA-080 | Start Move address purpose | `/start-move` | Page | Homeowner | Address collected without inline purpose | LEGAL_PRIVACY_RISK | P1 | Purpose limitation transparency | Trust | Short "why we need this" copy | No | Yes | C |
| LCA-081 | Claim flow transparency | `/claim` | Claim | Homeowner | Third-party invite context | LEGAL_PRIVACY_RISK | P2 | Invite recipient rights | GDPR | Brief rights summary | No | Yes | C |
| LCA-082 | Security section | `/account` | `SecuritySection` | All | Password/MFA account security | NO_CHANGE_RECOMMENDED | P2 | No privacy policy link | Link when published | No | No | A |
| LCA-083 | Branding review route | `/branding-review` | Dev | Internal | Not for production | NO_CHANGE_RECOMMENDED | — | Dev only | Ensure not linked publicly | No | No | — |
| LCA-084 | Homepage demo metrics | `/` | Decorative chain graphic | Public | Illustrative 82% progress | AMBIGUOUS | P3 | Could read as real data | Clarify decorative | "Example view" if kept | No | No | B |
| LCA-085 | Formal docs reconciliation | Marketing | Various | Public | Claims vs `docs/GDPR_*` | — | P2 | Future investor/legal pack | Due diligence | Flag in Phase 23 list below | No | Yes | Post-launch |

---

## Part 3 — P0 placeholder audit

| Search term | User-facing hits | Verdict |
|-------------|------------------|---------|
| **Coming soon** | `LegalPrivacySection.tsx` (×5); EA landing analytics badge | **P0** legal; **P2** EA analytics (labelled) |
| **Account Deletion Request** | Legal section title | **P0** — implies unimplemented self-serve |
| **placeholder** | Input `placeholder=` attrs; internal `searchingPlaceholder` code | Input attrs OK; internal term must not leak to errors |
| **TODO / TBD / Lorem** | Not found in user-facing TSX | None |
| **delete account** | Legal section only | **P0** — misaligned with Privacy Admin workflow |
| **not implemented** | `docs/` and scripts only | Not user-facing |
| **contact us** | Sparse; no generic support@ in footer | Add privacy@ not generic contact |
| **test / dummy** | Dev routes only | Exclude `/dev/*` from launch |

**LegalPrivacySection:** All five policies including "Account Deletion Request" are dashed-border placeholders — **launch blocker** (LCA-001, LCA-002, LCA-073, LCA-078).

---

## Part 4 — GDPR / privacy content review

| Topic | User-facing state | Implementation | Finding |
|-------|-------------------|----------------|---------|
| Right to Erasure | Placeholder "Account Deletion Request" | Privacy Admin + privacy@; Phase 3/4 execution | **P0** LCA-002 |
| Account deletion | Same placeholder | Auth delete last after erasure checklist | Must not imply instant delete |
| Leave chain / de-link | Accurate retention message | `participationDelink` | Add erasure distinction LCA-021 |
| Lifecycle release | Dormancy copy accurate | Property release ≠ erasure | OK LCA-022 |
| Lifecycle anonymisation | Not prominently user-facing | Distinct from RTBF in code | Policy must clarify LCA-023 |
| Dormancy | Warning + email | Not erasure | OK |
| Retention | Unpublished | `GDPR_DATA_RETENTION_SCHEDULE.md` | **P0** LCA-078 |
| Property addresses | Contextual display | Hidden peer addresses on chain viz | Document in policy LCA-039–040 |
| Analytics | EA "anonymised" marketing | Pseudonymous snapshots possible | LCA-055 legal review |
| Backups | Not misrepresented in UI | Phase 4 processor workflow | Policy only LCA-075 |
| privacy@ | Missing in UI | Intended contact | **P0** LCA-024 |
| 72h target | Not in user UI | Internal operational target | Do not present as statutory deadline LCA-026 |
| Shared transaction records | Not explained | De-link retains history | Policy + UI LCA-021 |

**Requires formal legal review before publish:** Privacy Policy, Terms, Cookie Policy, Data Retention Policy, erasure request process wording, EA client-data responsibilities, invitation email minimisation, analytics adjectives, de-link vs erasure cross-links.

---

## Part 5 — Property address wording

| Location | Display | Classification | Finding |
|----------|---------|----------------|---------|
| Start Move | User enters own sale/purchase address | Necessary operational | LCA-080 purpose text |
| Dashboard | Own property title/address | Necessary operational | OK |
| Chain viz (homeowner) | Peer addresses hidden | Privacy-sensitive justified | LCA-039 |
| Chain viz (EA) | Broader operational view | Necessary for EA role | Document in EA terms |
| Invitations email | Full address subject/body | Potentially unnecessary disclosure — **founder: may be proportionate** | **FD-004 PENDING_VALIDATION** — do not auto-reduce |
| Dormancy email | No address | Good minimisation | LCA-034 |
| Claim page | Property context for invitee | Privacy-sensitive justified | Review minimisation LCA-081 |
| Analytics snapshots | Anonymised ref not raw address | Internal lifecycle | OK in code |
| Privacy/legal | Unpublished | Requires legal review | LCA-003 |

---

## Part 6 — Participant privacy

| Exposure | Location | Classification |
|----------|----------|----------------|
| Another homeowner's name | Chain viz / participants | Review RLS-backed display — **no cross-user leak identified in copy audit** |
| Email addresses | Not shown to other homeowners in reviewed UI | OK |
| Full peer address | Hidden on homeowner chain viz | OK LCA-039 |
| Internal user/property/chain IDs | Dashboard, errors | UX issue LCA-041 — **not classified as SECURITY_PRIVACY_DEFECT** |
| EA internal metadata | Agent views | Expected for EA role |
| Invitation details | Email to invitee only | OK |
| Privacy Admin subject UUID | Operator-only | OK LCA-048 |

**SECURITY_PRIVACY_DEFECT:** None identified during content-only audit. If RLS defects exist, they require engineering review separate from this register.

---

## Part 7 — Marketing claims matrix

| Claim | Location | Support level | Notes |
|-------|----------|---------------|-------|
| Real-time / 24/7 visibility | Homepage | PARTIALLY_SUPPORTED | Shared updates; not literal real-time (FD-002) |
| Chain-wide visibility | Homepage metrics | PARTIALLY_SUPPORTED | Depends on connections (FD-006) |
| Bottleneck detection | Homepage | PARTIALLY_SUPPORTED | Delay surfacing, not prediction |
| Reduce uncertainty/delays | Homepage, EA | PARTIALLY_SUPPORTED | Soft outcome; SOURCE_REQUIRED for stats |
| Prevent chain collapse | Not found | — | Avoid adding without evidence |
| Save money/time | EA "reduce chasing" | ASPIRATIONAL | Qualitative; OK if not quantified |
| Anonymised regional benchmarks | EA landing | ASPIRATIONAL / Coming soon | LCA-016 |
| CRM complement | EA landing | SUPPORTED | Strong |
| Permission controlled | Homepage | SUPPORTED | Matches model |
| Predictive AI | Not found | — | — |
| Better customer experience | EA | ASPIRATIONAL | Acceptable marketing |
| Founding pricing £79 | EA | PARTIALLY_SUPPORTED | Billing readiness FD-007 |

---

## Part 8 — Product capability accuracy (selected)

| Wording | Accurate? | Finding |
|---------|-----------|---------|
| Real-time | Partial | LCA-010–012 |
| Automatic chain connection | No — requires codes/invites | FAQ OK LCA-014 |
| Everyone in chain | Partial — invitation dependent | LCA-014 |
| Track whole chain | Partial | FD-006 |
| Anonymous analytics | Not fully at marketing level | LCA-055 |
| EA edits everything | No misleading claim | LCA-062 |
| Homeowner controls property | Matches operational owner model | LCA-061 |
| Delete account in app | **No** — request-based erasure | LCA-002 |

---

## Part 9 — Core value proposition assessment

| Question | Assessment |
|----------|------------|
| Within 5 seconds, what is Keynetic? | **Partial** — "property chain tracking" clear; differentiation from CRM weaker on homepage |
| Who is it for? | Homeowners clear; EA clearer on EA landing |
| What problem? | Uncertainty, delays, chasing — **reasonable** |
| Different from CRM? | **Strong on EA landing; weak on homepage** |
| Why homeowner participate? | **Needs strengthening** on join/claim (LCA-057) |
| Why EA pay? | Operational visibility + founding offer — ** plausible** pending billing |
| Partial chain joins? | **Under-explained** (FD-006) |
| Shared platform clear? | **EA yes; homeowner moderate** |
| Privacy without overwhelm? | Product UI reasonable; legal section alarming placeholders |

**Strongest messaging:** EA landing outcomes + "Works alongside your CRM" (LCA-018, LCA-056).

**Recommended messaging hierarchy (founder-approved direction — final copy in Stage 4):**
1. Property chain tracking/coordination (public) · shared operational platform (EA) — not a CRM
2. Homeowners free; EAs pay for operational visibility
3. One shared view of the chain — value before full connection; stronger as more connects (**FD-006, FD-017**)
4. Privacy by design (plain language; details in policy)
5. Operational benefits (visibility, delays, coordination) — live updates, not absolute real-time (**FD-002**)

---

## Part 10 — Estate-agent content summary

| Theme | Status |
|-------|--------|
| CRM complement | **Strong** — keep |
| Sounds like CRM replacement | **Not found** |
| Conveyancing/legal case mgmt | **Not found** |
| Property portal | **Not found** |
| Pricing justification | **Needs billing clarity** LCA-019 |
| Command Centre | **Good differentiation** LCA-050 |
| Benchmarks | **Coming soon vs stray claims** LCA-016–017 |

**EA findings count:** 12 (LCA-009, 016–019, 033, 050–051, 055–056, 062, 079)

---

## Part 11 — Homeowner content summary

| Theme | Status |
|-------|--------|
| Join benefit obvious | **Weak** LCA-057 |
| What they share / who sees | **Under-explained** LCA-060 |
| Invitations trustworthy | **Adequate** LCA-059 |
| Chain explained | **Needs glossary** LCA-058 |
| Status/confidence | **Mostly OK** LCA-044 |
| Dormancy / still active | **Accurate tone** LCA-022 |
| Withdraw/de-link | **Clear; erasure cross-link missing** LCA-021 |
| Completion | **Review** LCA-045–046 |
| Anxiety-inducing legal | **Placeholders worse than product copy** LCA-073 |

**Homeowner findings count:** 18 (LCA-027–031, 039–046, 057–061, 067, 080–081)

---

## Part 12 — Email content audit

| Template | Trigger | Recipient | Subject | CTA | Address in email | Wired? | Issues |
|----------|---------|-----------|---------|-----|------------------|--------|--------|
| HomeownerInvitation | EA invites homeowner | Homeowner | `Connect {address} on Keynetic` | Accept invitation | **Full** | Yes | LCA-031 (**FD-004 pending**), LCA-069 |
| EstateAgentInvitation | Homeowner invites branch | EA user | Branch invite | Accept/join | Varies | Yes | LCA-033 |
| DormancyWarning | Lifecycle worker | Homeowner | Inactivity warning | Confirm still active | None | Yes | OK LCA-034 |
| WelcomeEmail | Signup (intended) | New user | Welcome | Dashboard | None | **No** | LCA-035 |
| PasswordReset | Auth reset | User | Reset password | Reset link | None | Supabase | LCA-036 |
| PropertyClaimed | Claim success (intended) | Inviter | Property claimed | View property | Likely address | **No** | LCA-037 |

**Email findings count:** 8

---

## Part 13 — Terminology

See **[KEYNETIC_TERMINOLOGY_REGISTER.md](./KEYNETIC_TERMINOLOGY_REGISTER.md)**.

**Inconsistency count documented:** 24 concept rows with mixed usage; priority fixes: delete vs erasure, real-time, anonymised, chain vs move.

---

## Part 14 — Tone and brand voice

| Area | Tone | Issue |
|------|------|-------|
| Homepage marketing | Energetic, metric-heavy | Slightly more hype than in-app |
| Product flows | Calm, operational | Good |
| Legal section | Unfinished dashed boxes | **Breaks trust** LCA-073 |
| EA landing | Professional, confident | Best aligned to brand |
| Error alerts | Abrupt system dialogs | Less human LCA-028 |

---

## Part 15 — CTA audit (major)

| CTA | Accurate? | Destructive clarity | Mobile | Finding |
|-----|-----------|---------------------|--------|---------|
| Start Your Move | Yes | N/A | OK | — |
| Join Existing Chain | Yes | N/A | OK | — |
| Accept invitation | Yes | N/A | OK | — |
| Leave transaction | Yes | Confirmed | OK | LCA-067 |
| Confirm still active | Yes | N/A | Fixed previously | — |
| Complete move | Review states | N/A | Check | LCA-046 |
| Remove estate agent | Yes | Confirmed | OK | — |
| Founding branch signup | Billing caveat | N/A | OK | LCA-019 |
| Privacy / delete account | **Misleading** | N/A | N/A | LCA-002 |

**CTA findings:** 3 material (LCA-002, LCA-019, LCA-046)

---

## Part 16 — Mobile content risks

| Risk | Location | Severity |
|------|----------|----------|
| Long email subjects with full address | HomeownerInvitation | P2 LCA-069 |
| Hero dual CTAs on narrow screens | Homepage | P3 LCA-068 |
| Legal dashed cards stack | Account | P2 readability |
| `alert()` dialogs | Join chain, ChainContext | P2 LCA-027–028 |
| Long badge text | Chain status labels | P2 spot-check |

**Mobile findings:** 5

---

## Part 17 — Accessibility copy

| Issue | Count | Examples |
|-------|-------|----------|
| `alert()` instead of accessible announcements | High | join-chain, ChainContext LCA-028 |
| Icon-only actions | Medium | Chain/property toolbars LCA-070 |
| Form labels | Low | Start move generally labelled LCA-071 |
| Vague links | Low | None significant ("Click here" rare) |

**Accessibility-copy findings:** 3 primary themes

---

## Part 18 — Content duplication

| Topic | Locations | Recommendation |
|-------|-----------|----------------|
| Privacy / erasure | Account, future footer, emails | Central legal constants LCA-063 |
| Chain explanation | Homepage, join, FAQ | Shared `chainExplainer` LCA-064 |
| CRM complement | EA landing only | Reuse on homepage |
| De-link explanations | Presentation lib only | Good single source |
| Dormancy | Panel + email | Align cross-links LCA-022 |

---

## Part 19 — GDPR website content register cross-reference

| Register row | Status |
|--------------|--------|
| Homepage footer | **STILL_OPEN** LCA-006 |
| Homeowner sign-up notice | **STILL_OPEN** LCA-007 |
| EA sign-up notice | **STILL_OPEN** LCA-079 |
| Login privacy link | **STILL_OPEN** |
| Start Move address | **WORDING_UPDATE_REQUIRED** LCA-080; logging fixed per register |
| Join Chain | **WORDING_UPDATE_REQUIRED** LCA-057 |
| Claim flows | **WORDING_UPDATE_REQUIRED** LCA-081 |
| Property workspace | **LEGAL_REVIEW_REQUIRED** visibility description |
| Chain view peer hiding | **NOW_IMPLEMENTED**; policy text **STILL_OPEN** |
| Dashboard | **STILL_OPEN** privacy links |
| Account / Security | **STILL_OPEN** LCA-082 |
| Legal & Privacy placeholders | **STILL_OPEN** **P0** LCA-001 |
| Participation de-link | **WORDING_UPDATE_REQUIRED** LCA-021 |
| Dormancy | **NO_CHANGE_RECOMMENDED** |
| Email verification | **NO_CHANGE_RECOMMENDED** |
| Invitation emails | **LEGAL_REVIEW_REQUIRED** LCA-031 |
| EA Command Centre | **WORDING_UPDATE_REQUIRED** EA data responsibility |
| EA onboarding | **STILL_OPEN** LCA-079 |
| Footer global | **STILL_OPEN** LCA-006 |
| Privacy Policy | **STILL_OPEN** LCA-003 |
| Terms | **STILL_OPEN** LCA-004 |
| Cookie Policy | **STILL_OPEN** LCA-005 |
| Account deletion placeholder | **STILL_OPEN** LCA-002 |
| Contact / privacy routes | **STILL_OPEN** LCA-024 |
| Email templates (claimed, dormancy) | Dormancy OK; claimed **STILL_OPEN** |
| EA landing benchmarks | **WORDING_UPDATE_REQUIRED** LCA-016 |
| Production readiness doc | **NO_LONGER_RELEVANT** for user copy (internal doc refresh separate) |

---

## Part 20 — Content launch blockers (revised post-founder review)

### P0 — Must resolve before launch (Stage 3)

| Category | IDs / requirements |
|----------|-------------------|
| **LEGAL/PRIVACY** | LCA-001–007, LCA-024, LCA-078; **FD-011** expanded legal structure (drafts only until legal approval) |
| **FACTUAL ACCURACY** | LCA-008 (**FD-010 APPROVED**) |
| **PLACEHOLDER** | LCA-001, LCA-002, LCA-073, LCA-078 — replace with structure + privacy@ + erasure request entry (**FD-001**) |
| **BROKEN JOURNEY** | LCA-009 (pricing anchor) |
| **SECURITY/PRIVACY DEFECT** | None in content audit |

**Pre-Stage-3 gates:** Stage 2 complete. **Stage 3.5** (Chain Intelligence redesign) required before confidence relied upon for family testing.

### Pre-launch engineering blocker (not Stage 3)

| Blocker | Status |
|---------|--------|
| Chain Confidence algorithm | **CURRENT_IMPLEMENTATION_NOT_APPROVED** — FD-035 Stage 3.5 |
| Estimated Completion consolidation | Stage 3.5 |
| Billing / Stripe | FD-036 — separate gated workstream |

### P1 — Strongly recommended before launch

LCA-009–016, LCA-019 (pricing copy when Stripe ready), LCA-021, LCA-041, LCA-055, LCA-057, LCA-060, LCA-079–080; FD-009; FD-013; **LCA-044 gated to Stage 3.5** not Stage 4 copy alone

### P2 — Polish before / soon after launch

LCA-017, LCA-022, LCA-027–030, LCA-033–037, LCA-045–046, LCA-053, LCA-058–59, LCA-061, LCA-063, LCA-070, LCA-072, LCA-081–085

### P3 — Future optimisation

LCA-040, LCA-064–065, LCA-068, LCA-084

### Removed / deferred from launch scope

| Item | Reason |
|------|--------|
| LCA-042 access-code masking | **FD-022:** Not approved |
| LCA-031 automatic address reduction | **FD-004:** Pending validation — not automatic |

---

## Part 21 — Founder decisions

See **[LAUNCH_CONTENT_FOUNDER_DECISIONS.md](./LAUNCH_CONTENT_FOUNDER_DECISIONS.md)** — **37 decisions** (FD-001–FD-037).

| Status | Count | IDs |
|--------|-------|-----|
| **APPROVED** | 18 | FD-001–003, FD-005, FD-008–010, FD-015–016, FD-018–023, FD-025–027, FD-030–032, FD-034 |
| **APPROVED_IN_PRINCIPLE** | 5 | FD-006, FD-012, FD-017, FD-021, FD-029 |
| **PENDING_VALIDATION** | 5 | FD-004, FD-014, FD-024, FD-028, FD-033 |
| **PENDING_LEGAL_REVIEW** | 4 | FD-011, FD-012 (wording), FD-013, all policy drafts |
| **PENDING_COMMERCIAL_DECISION** | 2 | FD-007, FD-031 (founding pricing copy) |

---

## Part 21A — Founder decision overrides

Original audit recommendations **superseded** by founder review:

| Finding | Original audit recommendation | Founder decision |
|---------|------------------------------|------------------|
| LCA-002 | Erasure request wording | **FD-001:** CTA "Request deletion of your personal data"; Right to erasure; privacy@; no "Remove login account" |
| LCA-004 | Generic Terms | **FD-011:** Platform Terms of Use + EA Business Terms |
| LCA-005 | Cookie banner if needed | **FD-014:** Technical audit first; no assumption-based banner |
| LCA-010–012 | Soften real-time | **FD-002:** Prefer "Live"; not globally banned if supportable |
| LCA-016, LCA-055 | Remove benchmark claims | **FD-003:** Coming soon OK on EA page; remove "anonymised benchmarks" elsewhere; use "Operational insights" |
| LCA-031, LCA-069 | Postcode + town in emails | **FD-004 OVERRIDE:** Do not auto-reduce; Stage 2 validation + legal review |
| LCA-041 | User-friendly labels for IDs | **FD-005:** Remove internal IDs from routine UI (elevated to P1 / Stage 3) |
| LCA-042 | Mask/copy access codes | **FD-022 OVERRIDE:** No behaviour change |
| LCA-044 | Glossary only | **FD-028/029:** Technical validation gate before confidence/completion copy |
| LCA-019 | Billing timeline disclosure | **FD-007:** Commercial unit + Stripe readiness pending; no "first 20 branches" yet |
| Terminology register | "Remove your login account" | **FD-001:** Rejected as customer-facing concept |

---

## Part 21B — Expanded legal document structure (FD-011)

Founder-approved public/legal structure before launch. **All require legal review.** Do not publish as legally approved in implementation without **APPROVED_FOR_PUBLICATION** status.

| Document | Scope | Key topics |
|----------|-------|------------|
| **A. Privacy Policy** | Relevant users/visitors | Collection, purposes, lawful bases, addresses, visibility, email, retention, processors, analytics, rights, Right to Erasure, privacy@, backups (appropriate level) — aligned with `docs/GDPR_*` |
| **B. Website & Platform Terms of Use** | Website/platform users | Acceptable use, accurate info, account security, invitation/access-code misuse, impersonation, unauthorised access, scraping, interference, IP, suspension, availability, disclaimers, prohibited use |
| **C. Estate Agent Terms / Business Terms** | Paying EA customers | Subscription, pricing, billing, cancellation, branch/users, staff responsibility, permitted use, support, IP, confidentiality, liability, termination, data protection — **CRM complement** |
| **D. Cookie Policy** | Based on FD-014 audit | Strictly necessary preference at launch; consent only if non-essential identified |
| **E. Public retention information** | Privacy Policy and/or separate page | Retention categories/principles — not internal runbooks |

**Publication labelling:** `DRAFT_FOR_LEGAL_REVIEW` → `APPROVED_FOR_PUBLICATION`

---

## Part 21C — Platform / professional disclaimer principle (FD-012)

Keynetic is information, visibility, and coordination — **not** conveyancing, legal services, mortgage, estate agency, or substitute for professional confirmation.

Must not guarantee: other participants' accuracy · independent verification · completion · estimates · prevention of chain collapse.

**Placement:** Primarily Terms/legal docs; contextual UX only where estimates/intelligence could be misunderstood.

---

## Part 21D — Chain Intelligence (FD-028 / FD-035)

**Stage 2:** Documented current penalty model — **not approved** as intended behaviour.

**Stage 3.5 — Chain Intelligence redesign (FD-035):**
- Design proposal **before** code
- Expected stage timeframes + buffer/grace + degradation
- Estimated Completion single canonical source
- Scenario validation · bands/tooltips after design approval

**Stage 3 must NOT change Chain Intelligence code.**

**Classification:** `CURRENT_IMPLEMENTATION_NOT_APPROVED` · `PRE_LAUNCH_REVIEW_REQUIRED`

**Blocks:** Family testing relying on Chain Confidence; final confidence/ETA customer copy (Stage 4+).

---

## Part 21E — Cookie / storage validation (FD-014)

**Status:** **VALIDATION_COMPLETE** · **ACCEPTED_IN_PRINCIPLE** for privacy-minimising launch.

Stage 2 inventory complete. No non-essential tracking in current code — **no consent banner technically required** (legal review caveat). Cookie Policy still required.

**Do not implement generic consent banner by assumption.**

---

## Part 21F — Collection-point privacy notices (FD-013)

**APPROVED direction** (wording PENDING_LEGAL_REVIEW):

- Homeowner signup
- EA signup/onboarding
- Start Move / address collection

Link to Privacy Policy. Do not conflate with blanket GDPR consent. Treat Terms acceptance separately.

---

## Part 22 — Implementation roadmap (post–Stage 2)

| Stage | Name | Status |
|-------|------|--------|
| **2** | Technical / content validation | **FOUNDER_APPROVED_COMPLETE** |
| **3** | P0 legal / privacy / content structure | **FOUNDER_APPROVED_COMPLETE** — policies remain **DRAFT_FOR_LEGAL_REVIEW** |
| **3.5** | Chain Intelligence redesign | **FOUNDER_APPROVED_COMPLETE** — [Stage 3.5 report](./LAUNCH_STAGE3_5_COMPLETION_REPORT.md) |
| **4** | Core content / value proposition | **FOUNDER_APPROVED_COMPLETE** — [Stage 4 report](./LAUNCH_STAGE4_COMPLETION_REPORT.md) |
| **5** | Transactional email content | **FOUNDER_APPROVED_COMPLETE** — [Stage 5 report](./LAUNCH_STAGE5_COMPLETION_REPORT.md) |
| **6** | Terminology / UX / brand polish | **FOUNDER_APPROVED_COMPLETE** — [Stage 6 report](./LAUNCH_STAGE6_COMPLETION_REPORT.md) · FD-041 · FD-039 |
| **Next** | **Pre-Launch Operational Readiness** | **Not started** — [Production Readiness Checklist §14](./PRODUCTION_READINESS_CHECKLIST.md) |
| **Billing/Stripe** | Separate gated workstream | FD-036 — awaiting explicit founder approval |

**Launch Content programme (Stages 3–6): complete.**

**Awaiting explicit founder approval:** Billing/Stripe (FD-036)

---

## Part 23 — Formal documentation reconciliation (future)

User-facing claims to reconcile with formal governance pack:

- Live update definitions vs refresh architecture (**FD-002**)
- Operational insights vs anonymised/pseudonymous analytics (**FD-003, FD-030**)
- Retention periods vs lifecycle automation (**FD-011 E**)
- Erasure scope — shared records, backups, processors (**FD-001, FD-009**)
- EA processor/client responsibilities (**FD-011 C**)
- Property address contextual personal data (**FD-032**)
- Founding pricing / subscription terms (**FD-007**)
- Chain confidence / completion semantics (**FD-028**)
- Platform/professional disclaimers (**FD-012**)

---

## Top 10 recommended changes (revised post-founder review)

1. **Replace LegalPrivacySection placeholders** with legal structure + privacy@ + erasure request entry — not self-serve delete (**FD-001**, LCA-001–002, LCA-073) — Stage 3
2. **Prepare expanded legal document set** (Privacy, Platform Terms, EA Terms, Cookie, Retention) as **DRAFT_FOR_LEGAL_REVIEW** (**FD-011**) — Stage 3
3. **Add footer legal links** + `privacy@keynetic.co.uk` (**FD-008**, LCA-006, LCA-024) — Stage 3
4. **Stage 3.5 Chain Intelligence design proposal** before family testing or confidence copy (**FD-035**) — **not** penalty-model copy
5. **Add collection-point privacy notices** at signup/start-move (**FD-013**) — Stage 3
6. **De-link modal: unobtrusive erasure distinction** + privacy@ (**FD-009**) — Stage 3
7. **Update homepage FAQ** for live EA capability (**FD-010**) — Stage 3/4
8. **Prefer "live" over absolute real-time** in marketing (**FD-002**) — Stage 4
9. **Per-branch pricing direction** £79/£99 when Stripe ready (**FD-007/031**) — Stage 4 + FD-036
10. **Remove internal IDs from routine UI** · **Connected** status · **Disconnect from chain** — Stage 3/6

**Removed from top 10:** Automatic invitation-email address reduction (**FD-004 override**); access-code masking (**FD-022 override**).

---

## Part 24 — Output checklist (post–Stage 2 consolidation)

| # | Metric | Value |
|---|--------|-------|
| 1 | Documentation updated | **4 files** (founder decisions, audit, terminology, Stage 2) |
| 2 | Founder decisions | **FD-001–FD-037** |
| 3 | Stage 2 resolved | FD-014, FD-024, FD-028 validation, FD-033, FD-007/031 commercial model |
| 4 | Accepted in principle | Stage 2 recommendations not overridden; cookie launch approach; partial-chain; etc. |
| 5 | Pending legal review | FD-004 (incl. subject line), FD-011–013, all policy drafts |
| 6 | Pending technical redesign | **FD-035** Stage 3.5 Chain Intelligence |
| 7 | Pending provider verification | Supabase, Resend, Vercel, Upstash, future Stripe — per GDPR processor checklist |
| 8 | Commercial resolved | **Per branch** · £79 founding / £99 standard per branch |
| 9 | Billing/Stripe pending | **FD-036** architecture design |
| 10 | Chain Intelligence blocker | **CURRENT_IMPLEMENTATION_NOT_APPROVED** |
| 11 | Roadmap | Stages 3 · 3.5 · 4–6 · Billing/Stripe |
| 12 | Recommended next action | **Approve Stage 3** (legal/content) and/or **Stage 3.5** (design proposal) |
| 13–17 | No changes | Content · behaviour · Chain Intelligence code · billing code · DB/Auth/GDPR |
| 18 | Build | **Not required** |

---

*Launch Content programme complete (Stages 3–6 founder-approved, 21 Jul 2026). Next programme: Pre-Launch Operational Readiness — not started.*
