# Launch Content — Founder Decision Register

**Version:** Post–Stage 2 consolidation — authoritative for implementation  
**Status:** Source of truth for Stages 3–6 and pre-launch workstreams  
**Related:** [Launch Content Audit](./LAUNCH_CONTENT_AUDIT.md) · [Terminology Register](./KEYNETIC_TERMINOLOGY_REGISTER.md) · [Stage 2 Validation](./LAUNCH_STAGE2_TECHNICAL_VALIDATION.md)

Decisions below supersede conflicting recommendations in the original audit and Stage 2 report where this register states an override.  
**Do not begin Stage 3 or Stage 3.5 without explicit founder approval.**

**Legal / billing commercial decisions (Phase 2A):** see [LAUNCH_LEGAL_FOUNDER_DECISIONS.md](./LAUNCH_LEGAL_FOUNDER_DECISIONS.md) for locked founding, cancellation, and related legal decisions (D-F*, D-B*, D-S*, D-D1, D-A1, D-G1, D-C1). That register is authoritative for Terms drafting; do not invent OPEN items (VAT, liability caps, retention periods, DPA).

---

## Decision status key

| Status | Meaning |
|--------|---------|
| **APPROVED** | Ready to implement as specified |
| **APPROVED_IN_PRINCIPLE** | Direction approved; final copy/design requires review |
| **ACCEPTED_IN_PRINCIPLE** | Stage 2 recommendation accepted unless superseded here |
| **PENDING_LEGAL_REVIEW** | Requires formal legal review before publication |
| **PENDING_TECHNICAL_REDESIGN** | Requires design/engineering proposal before implementation |
| **STRIPE_IMPLEMENTATION_READINESS_PENDING** | Commercial model decided; billing architecture/Stripe not ready |
| **CURRENT_IMPLEMENTATION_NOT_APPROVED** | Existing code behaviour not accepted as intended product |
| **PRODUCT_ROADMAP** | Future direction — not current implementation |
| **VALIDATION_COMPLETE** | Stage 2 audit complete; see Stage 2 report |

---

## FD-001 — Account deletion / GDPR erasure

| Field | Detail |
|-------|--------|
| **Status** | **APPROVED** |
| **Decision** | Email-based Right to Erasure via **privacy@keynetic.co.uk**. Do **not** present GDPR erasure as instant or automatic self-service "Delete account". |
| **Customer-facing CTA** | **"Request deletion of your personal data"** |
| **Legal/privacy terminology** | **"Right to erasure"** — handled in accordance with Privacy Policy and applicable data protection law |
| **Must not imply** | Every shared transaction record will automatically or immediately be deleted |
| **Implementation** | Formal GDPR erasure remains the controlled Privacy Admin workflow already implemented |
| **Future option** | In-app erasure request form post-launch may feed existing controlled workflow only — no separate deletion mechanism |
| **Auth account deletion** | Internal implementation step in GDPR workflow only |
| **Do NOT create** | Separate customer-facing concept "Remove your login account" |
| **Affected** | `/account`, footer, Privacy Policy, erasure request entry points |
| **Legal review** | **Yes** |

---

## FD-002 — Real-time / live claims

| Field | Detail |
|-------|--------|
| **Status** | **APPROVED** |
| **Decision** | Prefer **"Live"** over absolute **"real-time"** claims for launch |
| **Direction (not final copy)** | "Track your property chain with live shared updates" · "Live property chain visibility" · "Live shared updates" |
| **Homepage** | **FOUNDER_APPROVED** — see [Stage 4 report](./LAUNCH_STAGE4_COMPLETION_REPORT.md) |
| **Avoid** | Claims implying guaranteed sub-second streaming or instantaneous updates unless technically verified |
| **"Real-time"** | Not globally banned; any use must be factually supportable |
| **Affected** | `/`, homepage FAQ, metrics band, verify-email |
| **Legal review** | No |

---

## FD-003 — Regional benchmarking

| Field | Detail |
|-------|--------|
| **Status** | **APPROVED** |
| **Decision** | Regional benchmarking may remain explicitly labelled **"Coming soon"** on EA marketing page |
| **Required cleanup** | Audit and remove or qualify any other wording implying benchmarking is currently available |
| **Interim terminology** | **"Operational insights"** — not "anonymised benchmarks" until technical and legal verification |
| **Future benchmarking** | May be described as planned or Coming soon |
| **Anonymity claims** | Require technical and legal verification before use |
| **Affected** | `EaLandingPage.tsx`, EA dashboard copy, any stray benchmark references |
| **Legal review** | Yes (if anonymity claims used) |

---

## FD-004 — Property addresses in invitation emails

| Field | Detail |
|-------|--------|
| **Status** | **APPROVED** (product) · **PENDING_LEGAL_REVIEW** (legal sign-off — **not resolved**) |
| **Stage 5 founder confirmation (21 Jul 2026)** | Full property address **retained in invitation email body**. Full property address **retained in invitation subject for now** (`Connect {address} on Keynetic`). |
| **Stage 2 validated** | Address shown is **invitee's own property** — not another participant's |
| **Product preference** | **Retain full property address in email body** |
| **Subject line** | **PENDING_LEGAL_REVIEW** — subject-line exposure (lock screen / notification) requires explicit legal/privacy review **before Production launch** |
| **Do not** | Remove or reduce body address · change subject or body **automatically** without outcome of FD-004 legal review · expand disclosure beyond approved product direction |
| **Affected** | `HomeownerInvitation.tsx` · `PropertyClaimed.tsx` (when wired) |
| **Legal review** | **Yes — required before Production launch** for subject-line decision |

---

## FD-005 — Internal property / chain IDs

| Field | Detail |
|-------|--------|
| **Status** | **APPROVED** |
| **Decision** | Remove **"Chain #123"**, **"Property 456"**, and similar internal IDs from routine customer-facing UI |
| **May remain** | In URLs and technical systems |
| **Support reference** | Discreet support reference permitted on genuine error/support contexts |
| **Must not expose** | Internal database terminology as normal product language |
| **Affected** | `/my-chains`, `/chain/[chainId]`, dashboard, error messages |
| **Legal review** | No |

---

## FD-006 — Partial / incomplete chains

| Field | Detail |
|-------|--------|
| **Status** | **APPROVED_IN_PRINCIPLE** |
| **Decision** | Must not imply every chain participant must be connected before Keynetic provides value |
| **Positioning principle** | Keynetic can provide useful visibility before the entire chain is connected; becomes more powerful as more connects |
| **Avoid** | Product limitations as headline marketing message |
| **Avoid absolute claims** | e.g. "See your entire chain" where product cannot guarantee every participant is connected |
| **Implementation** | Homepage, FAQ, EA messaging — honest but positive; final copy requires review |
| **Affected** | `/`, FAQ, EA landing |
| **Legal review** | No |

---

## FD-007 — Founding pricing & billing unit

| Field | Detail |
|-------|--------|
| **Status** | **APPROVED** (commercial model) · **STRIPE_IMPLEMENTATION_READINESS_PENDING** |
| **MVP subscription unit** | **Per estate agent branch** — see FD-031 |
| **Founding pricing** | First **20 founding branch** customers: **£79/month per branch** |
| **Standard pricing direction** | After founding cohort: **£99/month per branch** |
| **Commercial principle** | A multi-branch organisation does **not** pay the same as a single independent branch under initial standard offering |
| **Billing readiness** | Stripe/checkout not live — do not imply immediate paid checkout |
| **Architecture note** | Current schema leans `ea_companies` for billing stub — **requires separate billing architecture design** before Stripe (FD-036) |
| **Affected** | `EaLandingPage.tsx`, EA signup, future checkout, EA Business Terms |
| **Legal review** | Yes (subscription/pricing claims when published) |
| **SUPERSEDED PRICING (2026-07-29)** | Founder-approved Billing Stage 1: **£99 founding / £129 standard** per branch (first 20). Historical £79/£99 figures above retained for audit trail. See `docs/EA_BILLING_STAGE1_ARCHITECTURE.md`. |
| **LEGAL PHASE 2A (2026-08)** | Founding permanence, non-transfer, multi-branch eligibility, cancel-at-period-end, and related locked decisions: [LAUNCH_LEGAL_FOUNDER_DECISIONS.md](./LAUNCH_LEGAL_FOUNDER_DECISIONS.md). VAT / final list-price confirmation remain OPEN. |

---

## FD-008 — Privacy contact

| Field | Detail |
|-------|--------|
| **Status** | **APPROVED** |
| **Decision** | **privacy@keynetic.co.uk** must appear in at least: (1) global footer/legal navigation · (2) Account Legal & Privacy · (3) public Privacy Policy / privacy page |
| **Purpose** | Public contact for privacy and data-rights requests |
| **admin@keynetic.co.uk** | Platform administration only — **never** present as public privacy contact |
| **Affected** | Global footer, `/account`, `/privacy` (future) |
| **Legal review** | Yes |

---

## FD-009 — De-link vs GDPR erasure

| Field | Detail |
|-------|--------|
| **Status** | **APPROVED** |
| **Decision** | Participation de-link / Leave Transaction flow must include short, unobtrusive explanation that leaving is separate from requesting deletion of personal data |
| **Direction (not final copy)** | "Leaving this transaction is separate from requesting deletion of your personal data." + route to privacy information / privacy@keynetic.co.uk |
| **UX constraint** | Do not turn normal de-link flow into large legal notice |
| **Architecture distinction** | Participation de-link ≠ Lifecycle release/anonymisation ≠ Formal GDPR Right to Erasure |
| **Affected** | `ParticipationDelinkPanel`, `participationDelinkPresentation.ts`, account legal |
| **Legal review** | **Yes** |

---

## FD-010 — Estate agent present-tense

| Field | Detail |
|-------|--------|
| **Status** | **APPROVED** |
| **Decision** | Update outdated homeowner FAQ wording that says estate agents participate "eventually" — EA functionality now exists |
| **Affected** | `app/page.tsx` FAQ |
| **Legal review** | No |

---

## FD-011 — Expanded legal document structure

| Field | Detail |
|-------|--------|
| **Status** | **PENDING_LEGAL_REVIEW** |
| **Decision** | Prepare public/legal structure before launch (do **not** publish as legally approved in documentation/planning phase) |

### A. Privacy Policy
- Personal data, purposes, lawful bases, property addresses, participant visibility, email/communications, retention, processors, analytics, data subject rights, Right to Erasure, privacy@, backup treatment at appropriate level
- Must reflect actual GDPR architecture in `docs/GDPR_*`

### B. Website & Platform Terms of Use
- Acceptable use, accurate information, account responsibility/security, invitation/access-code misuse, impersonation, unauthorised access, scraping, interference, IP, suspension/termination, service availability, disclaimers, prohibited use

### C. Estate Agent Terms of Service / Business Terms
- Subscription, pricing, billing, cancellation, authorised branch/users, staff responsibility, permitted use, availability, support, IP, confidentiality, liability, termination, data protection responsibilities
- Reinforce Keynetic works **alongside** CRM — not CRM replacement

### D. Cookie Policy
- Based on **actual technical audit** of cookies/storage — not generic banner by assumption
- Founder preference: strictly necessary cookies/storage at launch where practical
- Non-essential analytics/marketing → identify and determine consent requirements

### E. Public data retention information
- Part of Privacy Policy and/or separate public Data Retention page
- Explain retention categories/principles — do not expose internal runbooks verbatim

**Publication states:** Interim content must be labelled **DRAFT_FOR_LEGAL_REVIEW** until **APPROVED_FOR_PUBLICATION**.

---

## FD-012 — Platform / professional disclaimer principle

| Field | Detail |
|-------|--------|
| **Status** | **APPROVED_IN_PRINCIPLE** |
| **Decision** | Keynetic is information, visibility, and coordination — **not** conveyancing, legal, mortgage, estate agency, or substitute for professional confirmation |
| **Must not guarantee** | Other participants' accuracy · independent verification · transaction completion · displayed estimates · prevention of chain collapse |
| **Placement** | Primarily in appropriate Terms/legal documentation |
| **UX constraint** | Do not overload normal product UX with legal disclaimers; contextual explanations where estimates/intelligence could be misunderstood |
| **Legal review** | **Yes** |

---

## FD-013 — Collection-point privacy notices

| Field | Detail |
|-------|--------|
| **Status** | **APPROVED** (wording **PENDING_LEGAL_REVIEW**) |
| **Decision** | Short contextual privacy notices at launch at: homeowner signup · EA signup/onboarding · Start Move / property-address collection |
| **Must** | Link to Privacy Policy |
| **Must not** | Present Privacy Policy acknowledgement as blanket GDPR consent |
| **Must treat separately** | Terms acceptance vs Privacy Policy transparency |
| **Affected** | `/login`, EA signup/onboarding, `/start-move` |
| **Legal review** | **Yes** |

---

## FD-014 — Cookie / storage validation

| Field | Detail |
|-------|--------|
| **Status** | **APPROVED_IN_PRINCIPLE** · **ACCEPTED_IN_PRINCIPLE** (Stage 2 privacy-minimising launch) |
| **Launch direction** | Preserve privacy-minimising position; **no non-essential analytics/marketing tracking before launch** without deliberate review |
| **Technical finding** | Current code appears capable of launch **without non-essential consent banner** — **legal review required** |
| **Cookie Policy** | Still required — must accurately describe technologies used |
| **Do not** | Implement generic consent banner by assumption |
| **Reassess if** | Non-essential tracking added before launch |
| **Invitation tokens** | Agent localStorage/sessionStorage — document and classify in Cookie Policy |
| **Report** | [Stage 2 §4](./LAUNCH_STAGE2_TECHNICAL_VALIDATION.md) |

---

## FD-015 — Terminology: product category

| Field | Detail |
|-------|--------|
| **Status** | **APPROVED** |
| **Public/homeowner** | "Property chain tracking and coordination platform" |
| **Estate agent** | "Shared operational platform for property chains" |
| **Do not force** | One description everywhere |
| **Keynetic is not a CRM** | "Works alongside your CRM" remains approved EA positioning |

---

## FD-016 — Terminology: chain / move / transaction

| Field | Detail |
|-------|--------|
| **Status** | **APPROVED** |
| **Homeowner/public** | "Your move" · "Your property chain" |
| **Estate agent/formal** | "Transaction" where appropriate |
| **Legal** | "Property transaction" where appropriate |
| **Note** | Legitimate contextual variation permitted |

---

## FD-017 — Shared platform concept

| Field | Detail |
|-------|--------|
| **Status** | **APPROVED_IN_PRINCIPLE** |
| **Underlying concept** | "One shared view of the chain" (marketing variations allowed) |
| **Avoid** | Implying every participant must be connected before value exists |

---

## FD-018 — Operational owner

| Field | Detail |
|-------|--------|
| **Status** | **APPROVED** |
| **Internal only** | "Operational owner" |
| **Customer-facing** | e.g. "You manage this property" — contextual plain language |
| **Avoid** | Confusing operational control on Keynetic with legal property ownership |

---

## FD-019 — Participant terminology

| Field | Detail |
|-------|--------|
| **Status** | **APPROVED** |
| **Use** | Homeowner · Estate agent · Buyer · Seller |
| **Branch** | EA branch/account structures only — not synonym for estate agent |
| **Avoid** | Ambiguous standalone "agent" where "estate agent" is clearer |

---

## FD-020 — Delegation

| Field | Detail |
|-------|--------|
| **Status** | **APPROVED** |
| **Internal** | "Delegate" where possible |
| **Customer-facing** | e.g. "Can update this property on your behalf" |
| **Avoid** | Requiring homeowners to understand delegation architecture |

---

## FD-021 — Invite / connect / claim

| Field | Detail |
|-------|--------|
| **Status** | **FOUNDER_APPROVED** (Stage 5 transactional copy) |
| **Journey** | INVITE → CONNECT |
| **Invitation** | Communication sent |
| **Connect** | Desired customer action/outcome |
| **Claim** | Technical mechanism — internal where possible |
| **Direction example (not final)** | "You've been invited to connect your property to a chain on Keynetic." |

---

## FD-022 — Chain access code

| Field | Detail |
|-------|--------|
| **Status** | **APPROVED** |
| **Terminology** | "Chain access code" approved |
| **Behaviour** | Masking/security changes **NOT approved** as part of content work — do not change access-code behaviour during content implementation |

**Audit override:** Original audit LCA-042 (mask/copy pattern) is **not approved**.

---

## FD-023 — Searching placeholder

| Field | Detail |
|-------|--------|
| **Status** | **APPROVED** |
| **Never expose** | "Searching placeholder" to customers |
| **Preferred** | "Searching for your next home" or contextual equivalent |

---

## FD-024 — Break / disconnect terminology

| Field | Detail |
|-------|--------|
| **Status** | **APPROVED** |
| **Topology disconnect** | **"Disconnect from chain"** — not "Break chain connection" where it implies real-world chain collapse |
| **Context** | Action affects Keynetic connection only — not legal/real-world transaction completion |
| **Participation exit** | **"Leave this transaction"** — separate (FD-025) |
| **Do not conflate** | Disconnect · Leave · Withdraw · Lifecycle release · GDPR erasure |
| **Report** | [Stage 2 §7](./LAUNCH_STAGE2_TECHNICAL_VALIDATION.md) |

---

## FD-025 — Participation exit

| Field | Detail |
|-------|--------|
| **Status** | **APPROVED** |
| **Preferred destructive action** | **"Leave this transaction"** |
| **Supporting copy** | e.g. "Stop participating in this move" |
| **Do not use for de-link** | Delete · Erase |

---

## FD-026 — Lifecycle terminology

| Field | Detail |
|-------|--------|
| **Status** | **APPROVED** |
| **Internal/legal** | Lifecycle state-machine terms (e.g. lifecycle anonymisation, dormancy release) |
| **Customer-facing** | Explain what happened, why, what user can do next — not internal mechanics |
| **"Anonymised"** | Requires care and legal/technical accuracy |

---

## FD-027 — Chain intelligence terminology

| Field | Detail |
|-------|--------|
| **Status** | **APPROVED** (conceptual separation) · **PENDING_TECHNICAL_REDESIGN** (algorithm) |
| **Chain progress** | How far through the relevant property-chain process the chain has progressed |
| **Chain confidence** | Keynetic **system-generated** assessment of whether the chain appears to be progressing within **expected stage timeframes** and operational parameters — **not** user sentiment |
| **User sentiment** | Happy / Unsure / Concerned (if in product) — **third distinct concept** |
| **Critical rule** | Do **not** reduce Chain Confidence simply because Chain Progress is low — early stage ≠ inherently low confidence |
| **Must not describe as** | Independently verified · guaranteed · professional advice · predictive AI (unless true) |
| **Presentation** | System-generated estimate/indicator — tooltip **APPROVED IN PRINCIPLE** after redesign (FD-029) |

---

## FD-028 — Chain Confidence: current implementation

| Field | Detail |
|-------|--------|
| **Status** | **VALIDATION_COMPLETE** · **CURRENT_IMPLEMENTATION_NOT_APPROVED** |
| **Stage 2 documented** | Fixed penalty model from 85 — does **not** use `expectedTimeframe` from `data/stages.ts` |
| **Founder decision** | Current implementation is **NOT working as intended** |
| **Intended behaviour** | Confidence reflects progression **within expected stage timeframes** (e.g. "Instruct solicitors — 1–2 weeks") with **buffer/grace** after exceedance (~1–2 weeks initial thinking — design required) |
| **Principles** | Strong within timeframe · stable/gradual in buffer · meaningful reduction when materially overdue · continuing deterioration when severely overdue · reset on new stage · delays/blocks/connections as additional signals |
| **Do not implement** | New algorithm in Stage 3 content work — see **FD-035** |
| **Verification** | `scripts/verify-chain-confidence-scenarios.ts` documents **current** behaviour only |
| **Classification** | **PRE_LAUNCH_REVIEW_REQUIRED** · blocks reliance on Chain Confidence for family testing until redesign |

---

## FD-029 — Chain intelligence help / tooltips

| Field | Detail |
|-------|--------|
| **Status** | **APPROVED_IN_PRINCIPLE** — final wording **after FD-035 design approval** |
| **Chain Confidence direction** | "Keynetic calculates Chain Confidence using the progress and timing information available for your property chain. It is an indication only and is not independently verified or a guarantee that your move will complete." |
| **Estimated completion direction** | Keynetic-generated estimate from available platform information — not guaranteed completion date |
| **Do not use** | "Forecast Engine" marketing positioning |
| **Preferred term** | **Estimated completion window** |
| **Implementation** | After Stage 3.5 redesign validated |

---

## FD-030 — Live / analytics terminology

| Field | Detail |
|-------|--------|
| **Status** | **APPROVED** |
| **Prefer** | "Live updates" · "Live shared updates" · "Live property chain visibility" |
| **Avoid** | Absolute real-time guarantees unless verified |
| **Analytics at launch** | "Operational insights" |
| **Regional benchmarking** | "Coming soon" on EA page OK |
| **Do not use** | "Anonymised benchmarks" until technically and legally verified |

---

## FD-031 — Estate agent commercial terminology & billing unit

| Field | Detail |
|-------|--------|
| **Status** | **APPROVED** |
| **MVP billing unit** | **Per estate agent branch** |
| **Approved terminology** | "Works alongside your CRM" · "Operational Command Centre" · "Free for homeowners" |
| **Pricing** | See FD-007 — £79/month per founding branch · £99/month per branch standard direction |
| **Copy** | Final customer-facing pricing copy subject to Stripe readiness |

---

## FD-032 — Privacy terminology

| Field | Detail |
|-------|--------|
| **Status** | **APPROVED** |
| **Product language** | "Your information" |
| **Legal language** | "Personal data" |
| **Property addresses** | Contextually capable of being personal data — not universally public or private |
| **Portal availability** | Does not automatically justify indefinite retention or disclosure |

---

## FD-033 — Status labels

| Field | Detail |
|-------|--------|
| **Status** | **APPROVED** |
| **`pending_connection`** | **Awaiting connection** |
| **`broken_connection`** | **Connection issue** |
| **`delayed`** | **Delay reported** |
| **`healthy` (topology)** | **Connected** — **not** "On track" · **not** customer-facing "Healthy" (conflicts with Chain Confidence band) |
| **Chain Confidence bands** | **FOUNDER_APPROVED** — Strong · Good · Keep an eye on / Monitor · Needs attention (Stage 3.5) |
| **Chain status** (homeowner chain page) | **FD-041** — supersedes FD-038 Operational status for homeowners; distinct from Chain Confidence |

---

## FD-034 — Internal IDs (duplicate of FD-005)

| Field | Detail |
|-------|--------|
| **Status** | **APPROVED** |
| **See** | FD-005 |

---

## FD-035 — Chain Intelligence redesign / correction (Stage 3.5)

| Field | Detail |
|-------|--------|
| **Status** | **FOUNDER_APPROVED_COMPLETE** — see [Stage 3.5 report](./LAUNCH_STAGE3_5_COMPLETION_REPORT.md) · [Stage 4 report](./LAUNCH_STAGE4_COMPLETION_REPORT.md) |
| **Trigger** | FD-028: current implementation **not approved** as intended product behaviour |
| **Scope** | Chain Confidence algorithm **and** Estimated Completion consolidation |
| **First deliverable** | **Proposed technical design + scenario model** — **delivered Stage 3.5** (`docs/CHAIN_INTELLIGENCE_REDESIGN_PROPOSAL.md`) |
| **Design must address** | Stage/timeframe mapping · timing clock start · stage transition reset · buffer/grace (fixed vs proportional vs capped) · degradation beyond buffer · multi-property aggregation · missing data · partial chains · searching states · delays · blocked · broken/pending connections · activity influence · min/max behaviour · stale-chain high-confidence prevention · deterministic tests · customer band/label alignment |
| **Estimated Completion goals** | Single canonical source of truth · remove 3-way drift · consider milestone timing · delay/partial-chain treatment · customer explanation · no "Forecast Engine" |
| **Timing** | **Before broad family testing** relies on Chain Confidence · **separate from Stage 3** legal/content |
| **Do not** | Implement in this documentation consolidation step |

---

## FD-038 — Operational status (chain page label)

| Field | Detail |
|-------|--------|
| **Status** | **FOUNDER_APPROVED** — **superseded for homeowner-facing presentation** by **FD-041** (Stage 6) |
| **Customer-facing label (Stage 4)** | **Operational status** |
| **EA / internal** | Operational terminology remains valid in estate-agent surfaces and internal architecture |
| **Purpose** | Highlights operational conditions — stale updates, reported delays, broken connections — separate from Chain Progress, Chain Confidence, and Estimated completion window |
| **Status values (unchanged)** | Stable · Active · At Risk · Replacement Buyer Required |
| **Implementation** | Customer-facing label and explainer only — `computeChainHealth()` behaviour unchanged |
| **Affected** | `app/chain/[chainId]/page.tsx` |
| **Legal review** | No |

---

## FD-041 — Homeowner chain status label (Stage 6 — supersedes FD-038 homeowner presentation)

| Field | Detail |
|-------|--------|
| **Status** | **FOUNDER_APPROVED** (21 Jul 2026) |
| **Customer-facing label (homeowner chain page)** | **Chain status** |
| **Supersedes** | FD-038 **Operational status** on homeowner-facing surfaces only |
| **Does not change** | `computeChainHealth()` · status values · internal operational architecture/code identifiers |
| **EA / internal** | Estate-agent professional use of **operational** remains permitted where appropriate (Command Centre, EA landing, internal modules) |
| **Explainer** | Plain English — stale updates, reported delays, connection issues; distinct from Chain Progress and Chain Confidence |
| **Legal review** | No |

---

## FD-039 — “Moving Made Clear” tagline (Stage 6)

| Field | Detail |
|-------|--------|
| **Status** | **FOUNDER_APPROVED** (21 Jul 2026) |
| **Tagline** | **Moving Made Clear** — official Keynetic brand tagline |
| **Canonical constant** | `KEYNETIC_TAGLINE` in `lib/theme/logoAssets.ts` (re-exported from `lib/customerFacingLabels.ts`) |
| **Public marketing homepage header** | Navbar on `/` — logo + tagline beneath wordmark. **Route context only** — tagline remains visible for authenticated visitors on the public homepage; auth affects nav actions only, not brand presentation. |
| **Public EA marketing header** | `EaMarketingShell` / `LightShellHeader` — same brand treatment (`showBrandTagline`). Route/layout context; not conditional on auth. |
| **Authenticated application navigation** | `Navbar` on app routes (not `/`) · `AgentShell` · dashboard/chain/property chrome — **logo/wordmark only** (no tagline) |
| **Rule** | **Public marketing context determines tagline visibility; authentication state does not.** |
| **Supporting brand contexts** | Homepage footer · Estate-agent landing footer · Transactional email footer |
| **Visual hierarchy** | Keynetic wordmark primary; **Moving Made Clear** secondary beneath wordmark — does not compete with navigation |
| **Mobile** | Responsive tagline sizing (`text-[11px] sm:text-xs`); truncate on narrow viewports where needed |
| **Compact rule** | Tagline does **not** need to appear beneath every logo instance |
| **Do not** | Modify logo artwork · generate new logo assets · duplicate hardcoded tagline strings in UI |
| **Legal review** | No |

---

## Stage 6 founder sign-off — additional locked decisions (21 Jul 2026)

| Item | Decision |
|------|----------|
| **EA hero headline** | **Approved:** *“One shared chain view — whether a homeowner or your branch joins first.”* |
| **Partial-chain positioning** | **Preserved:** do not imply every real-world chain participant uses Keynetic; visibility improves as more connect; homeowners and estate agents contribute to the **same shared chain model** (not separate versions) |
| **Invite → Connect** | **Preserved** for customer-facing terminology; internal `property_claim` / claim architecture unchanged |
| **“Keynetic meets everyone where the move starts”** (EA landing section title) | **Not a launch blocker.** May be revisited during final visual/marketing review if founder decides it is unclear. **Not changed** at Stage 6 sign-off. |

---

## FD-040 — Pre-Launch transactional email environment (Production readiness)

| Field | Detail |
|-------|--------|
| **Status** | **PRE_LAUNCH_REQUIREMENT** — verify before Production launch |
| **Scope** | Recorded at Stage 5 founder sign-off; detailed checklist in [Production Readiness Checklist §13](./PRODUCTION_READINESS_CHECKLIST.md) |
| **`NEXT_PUBLIC_APP_URL`** | Must be set to approved Production Keynetic origin. Verify all transactional email links in Production resolve correctly. localhost / Development / Preview URLs must **not** appear in Production emails. |
| **`RESEND_API_KEY` + sender/domain** | Verify approved Resend configuration in Production. **Do not** expose or document secret values in repo docs. |
| **Supabase Auth templates** | Manually verify Production Dashboard content for **`reset-password`** and **`confirm-signup`** before launch (`docs/AUTH_ARCHITECTURE.md`). |
| **Unwired templates** | **Welcome** and **Property connected** must remain documented as **inactive** until send paths implemented and verified |
| **Implementation** | Configuration verification only — **no** email architecture / Auth behaviour changes without separate approval |

---

## FD-036 — Billing architecture design review

| Field | Detail |
|-------|--------|
| **Status** | **STRIPE_IMPLEMENTATION_READINESS_PENDING** |
| **Commercial decision** | Subscriptions attach to **`ea_branches`** (FD-031) |
| **Technical gap** | Schema stub on `ea_companies.stripe_customer_id` — may not match branch-level MVP |
| **Required before Stripe** | Design review: how subscriptions attach to branches while preserving `ea_companies` as organisation layer |
| **Do not** | Implement billing changes during Stage 3 content/legal workstream |
| **Gated workstream** | Billing / Stripe — separate from Stages 3–6 |

---

## FD-037 — Future EA commercial tiers (roadmap)

| Field | Detail |
|-------|--------|
| **Status** | **PRODUCT_ROADMAP** — not current implementation |
| **Standard branch tier (MVP)** | Per-branch subscription · branch Operational Command Centre · branch users/agents |
| **Future enhanced/analytics tier** | Potentially detailed analytics · intelligence · benchmarking (if verified) — pricing/features TBD |
| **Future enterprise/multi-branch tier** | Organisation-level billing · consolidated payment · org dashboard · multi-branch view · drill-down · enhanced management/analytics — architecture/pricing/permissions TBD |
| **Do not implement now** | Record for roadmap only |

---

## Post–Stage 2 consolidation record (authoritative)

| Letter | Decision |
|--------|----------|
| **A** | Current Chain Confidence implementation **not approved** as intended behaviour |
| **B** | Chain Intelligence redesign = **Stage 3.5** pre-launch engineering workstream |
| **C** | Estimated Completion consolidation belongs in Stage 3.5 |
| **D** | `healthy` topology label = **Connected** (**APPROVED**) |
| **E** | Privacy-minimising / no non-essential tracking launch approach **accepted in principle** |
| **F** | Full homeowner invitation address **retained** (body); subject line **separate legal review** |
| **G** | MVP EA subscription unit = **branch** |
| **H** | Founding pricing = **£79/month per branch** (first 20 founding branches) |
| **I** | Standard direction = **£99/month per branch** |
| **J** | Future enterprise/multi-branch = **roadmap only** (FD-037) |
| **K** | Billing architecture review required before Stripe (FD-036) |
| **L** | **"Disconnect from chain"** approved for topology disconnect |

---

## Open items summary

| Category | Items |
|----------|-------|
| **APPROVED (ready for Stage 3+)** | FD-001–003, FD-005–010, FD-015–025, FD-030–034, FD-033 Connected, FD-024 disconnect, FD-007/031 commercial model |
| **FOUNDER_APPROVED (Stage 4 complete)** | FD-002 live terminology · FD-006 partial-chain · FD-017 shared platform · FD-038 Operational status (EA/internal; homeowner superseded by FD-041) · Stage 4 homepage/EA/journey content · Estimated Completion presentation · benefit strip |
| **FOUNDER_APPROVED (Stage 5 complete)** | Transactional email content · FD-021 invite→connect · transactional footer · active vs unwired template documentation |
| **FOUNDER_APPROVED (Stage 6 complete)** | FD-041 **Chain status** · FD-039 **Moving Made Clear** · homeowner no-operational rule · EA shared-chain hero · invite→connect UI polish · [Stage 6 report](./LAUNCH_STAGE6_COMPLETION_REPORT.md) |
| **APPROVED_IN_PRINCIPLE / ACCEPTED_IN_PRINCIPLE** | FD-012 · FD-014 launch cookie approach · Stage 2 recommendations not overridden |
| **PENDING_LEGAL_REVIEW** | **FD-004 (subject line — not resolved)** · FD-011–013 · all policy drafts · Cookie Policy · **professional legal review and publication approval** |
| **PRE_LAUNCH_REQUIREMENT** | **Pre-Launch Operational Readiness programme** — see [Production Readiness Checklist §14](./PRODUCTION_READINESS_CHECKLIST.md) · **FD-040** · privacy@ verification · provider/DPA · Production env/secrets · Resend · Supabase Auth templates · EA access revocation · EA owner transfer · observability · metrics · analytics decision · run-cost governance · refund/cancellation/disputes · final security review · final Production launch checklist |
| **STRIPE_IMPLEMENTATION_READINESS_PENDING** | FD-036 billing architecture · FD-007 final pricing copy when checkout live |
| **PRODUCT_ROADMAP** | FD-037 future EA tiers |

---

## Implementation roadmap (revised)

| Stage | Name | Scope | Do not include |
|-------|------|-------|----------------|
| **2** | Technical / content validation | **Complete** — see [Stage 2 report](./LAUNCH_STAGE2_TECHNICAL_VALIDATION.md) | — |
| **3** | P0 legal / privacy / content structure | privacy@ · legal page structure · remove legal Coming soon · erasure entry · de-link vs erasure · collection notices · FAQ corrections · internal ID cleanup · pricing anchor fix · **DRAFT_FOR_LEGAL_REVIEW** policies only | Chain Confidence algorithm |
| **3.5** | Chain Intelligence redesign | **FOUNDER_APPROVED_COMPLETE** — [Stage 3.5 report](./LAUNCH_STAGE3_5_COMPLETION_REPORT.md) |
| **4** | Core content / value proposition | **FOUNDER_APPROVED_COMPLETE** — [Stage 4 report](./LAUNCH_STAGE4_COMPLETION_REPORT.md) |
| **5** | Transactional email content | **FOUNDER_APPROVED_COMPLETE** — [Stage 5 report](./LAUNCH_STAGE5_COMPLETION_REPORT.md) · invite→connect · FD-004 body + subject retained pending legal · unwired templates documented · [Pre-Launch email checks §13](./PRODUCTION_READINESS_CHECKLIST.md) |
| **6** | Terminology / UX polish | **FOUNDER_APPROVED_COMPLETE** — [Stage 6 report](./LAUNCH_STAGE6_COMPLETION_REPORT.md) · FD-041 · FD-039 · homeowner no-operational rule | Pre-Launch implementation |
| **Next** | **Pre-Launch Operational Readiness** | **In progress** — Workstream 1 EA Access **`FOUNDER_APPROVED_COMPLETE`** · Observability **not started** — see [Checklist §14](./PRODUCTION_READINESS_CHECKLIST.md) | Launch content Stages 3–6 |
| **Billing/Stripe** | Separate gated workstream | FD-036 architecture · Stripe integration · founding branch counter | Not in Stage 3–6 content |

**Launch Content programme (Stages 3–6):** **FOUNDER_APPROVED_COMPLETE** (21 Jul 2026).

**Next programme:** **Pre-Launch Operational Readiness** — Workstream 1 (EA Access) **`FOUNDER_APPROVED_COMPLETE`**; Observability **not started**.

**Awaiting explicit founder approval:** Billing/Stripe (FD-036) · Observability implementation (§14.3 A)

**Pre-Launch requirements (unchanged — not resolved by Stage 6 or EA Access sign-off):** FD-004 subject legal review · FD-040 transactional email environment · Supabase Auth template verification · Production security parity · full §14 checklist · **FD-042–FD-045** EA invitation/UX follow-ups

---

## Pre-Launch Workstream 1 — EA Access & Branch Membership

**Status:** **`FOUNDER_APPROVED_COMPLETE`** (22 Jul 2026)  
**Record:** [PRELAUNCH_EA_ACCESS_FOUNDER_SIGNOFF.md](./PRELAUNCH_EA_ACCESS_FOUNDER_SIGNOFF.md)

Founder-approved based on Development **29/29** integration tests plus manual Staging verification (Staff removal, property access revocation, re-invitation, `email_mismatch`, ownership transfer remain + leave).

**Production:** Not deployed. **Observability:** Not started.

### FD-042 — Existing-account invitation UX

| Field | Decision |
|-------|----------|
| **Issue** | Removed Staff retain Auth accounts; unauthenticated invite open can show account creation for existing users |
| **Workaround verified** | Sign in → reopen invitation link → accept |
| **Follow-up** | “Already have a Keynetic account? Sign in to accept” path; preserve invite context through auth |
| **Constraints** | No Auth deletion on branch removal · no enumeration · no weakening one-company-per-domain |
| **Status** | **OPEN** — not an EA Access security blocker |

### FD-043 — Wrong-email invitation UX

| Field | Decision |
|-------|----------|
| **Security** | `email_mismatch` blocking is **correct** |
| **Follow-up** | Plain-English customer message; safe sign-out/switch-account; preserve invitation context |
| **Status** | **OPEN** |

### FD-044 — Invitation timestamp / timezone

| Field | Decision |
|-------|----------|
| **Observation** | ~1 hour discrepancy in July (displayed ~7:49pm vs UK ~8:49pm) |
| **Follow-up** | UTC vs `Europe/London`; BST/GMT-aware display; expiry presentation; EA + homeowner invites; DB stays UTC; no hardcoded +1 offset |
| **Status** | **OPEN** |

### FD-045 — EA mobile/visual UX (non-blockers)

| Field | Decision |
|-------|----------|
| **Scope** | Mobile Team layout · mobile remove/transfer dialogs · EA marketing nav anchors · revoked invitation visible state |
| **Status** | **OPEN** — UX checks only; not access-control blockers |

**Preserved at Stage 6 sign-off:** Invite → Connect customer terminology · partial-chain honesty · shared chain model positioning · unwired Welcome / Property connected templates documented inactive · EA hero approved wording · “everyone where the move starts” not a launch blocker

---

*Launch Content programme complete (Stages 3–6 founder-approved). Pre-Launch Workstream 1 (EA Access) **FOUNDER_APPROVED_COMPLETE** (22 Jul 2026). Observability not started. No application behaviour changed in this sign-off documentation update.*
