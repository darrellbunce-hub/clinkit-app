# Launch Stage 2 — Technical & Content Validation

**Phase:** Stage 2 complete · Post–Stage 2 founder consolidation recorded  
**Date:** 19 July 2026  
**Authority:** [Founder Decisions](./LAUNCH_CONTENT_FOUNDER_DECISIONS.md) (FD-028–FD-037) · [Launch Content Audit](./LAUNCH_CONTENT_AUDIT.md) · [Terminology Register](./KEYNETIC_TERMINOLOGY_REGISTER.md)

---

## Executive summary

Stage 2 established the factual technical/product position. **Post–Stage 2 founder review** supersedes Stage 2 recommendations where stated in [Founder Decisions](./LAUNCH_CONTENT_FOUNDER_DECISIONS.md).

| Area | Stage 2 finding | Post–Stage 2 founder status |
|------|-----------------|----------------------------|
| **Chain Confidence** | Penalty model from 85 — not timeframe-based | **CURRENT_IMPLEMENTATION_NOT_APPROVED** → **Stage 3.5 refined design** — [proposal](./CHAIN_INTELLIGENCE_REDESIGN_PROPOSAL.md) (FD-035) |
| **Estimated Completion** | Heuristic; 3 implementations drifted | Include in **Stage 3.5**; no "Forecast Engine" |
| **`healthy` status** | Topology connection flag | Customer label **"Connected"** — **APPROVED** (FD-033) |
| **Cookies/storage** | No non-essential tracking in repo | **Accepted in principle** for launch; Cookie Policy still required (FD-014) |
| **Invitation emails** | Invitee's own full address | **Retain in body**; subject line **separate legal review** (FD-004) |
| **Billing** | Schema stub on `ea_companies` | **Per branch** subscription **APPROVED** (FD-007/031); **FD-036** before Stripe |
| **Break/disconnect** | Topology break vs de-link | **"Disconnect from chain"** — **APPROVED** (FD-024) |

**No user-facing content, algorithms, billing, or database behaviour was modified in Stage 2 or this consolidation.**

---

## Part 1 — Chain Confidence technical audit

### 1.1 What Chain Confidence represents (current code)

Chain Confidence is a **deterministic penalty score**:

```
score = max(0, 85
  − 25 × blocked properties
  − 10 × active delay reports
  − 5 × stale in-scope properties
  − 30 × broken_connection properties
  − 5 if buyer-ready operationally stale
)
```

| Label | Threshold |
|-------|-----------|
| Healthy | score ≥ 70 |
| Progress Slowing | score ≥ 40 |
| Needs Attention | score < 40 |

**It does NOT use:** milestone `expectedTimeframe` from `data/stages.ts`, chain progress percentage, buffer calculations, or time-since-stage logic.

### 1.2 Source files

| File | Role |
|------|------|
| `lib/chainIntelligence.ts` | `computeChainConfidence`, `computeChainIntelligence`, scope, ETA, health |
| `lib/activityIntelligence.ts` | Stale thresholds (21d confidence, 14d page alert), delay detection |
| `lib/chainNodesSummary.ts` | Buyer-ready staleness via `latest_activity_at` |
| `lib/buildChainTopology.ts` | `isSearchingPlaceholder()` — excludes from scope |
| `lib/operationalSummary/deriveChainSummary.ts` | Persists `confidence_score` to DB |
| `app/chain/[chainId]/page.tsx` | Live UI + **misleading tooltip** |
| `components/agent/commandCentre/ConfidenceBar.tsx` | EA display from cached summary |

### 1.3 Penalty inputs

| Input | Detection |
|-------|-----------|
| **Stale property** | Last activity > **21 days** (`STALE_DAYS_CONFIDENCE`) |
| **Active delay** | **Most recent** activity contains `"Delay Reported"` |
| **Blocked** | `properties.status === 'blocked'` |
| **Broken** | `properties.status === 'broken_connection'` |
| **Buyer-ready stale** | Buyer-ready activities >21d stale **OR** summary `latest_activity_at` missing/stale **OR** `buyerReadySummary === null`** |

### 1.4 Explanation of ~75% stale-chain behaviour

**There is no 75% floor in code.**

Founder observation (~75% on old stale chains) is explained by:

1. **Typical effective baseline 80%** — `isBuyerReadySummaryStale(null)` returns **true**, applying **−5** even when no buyer-ready node exists (`buyerReadySummary: null`).
2. **One additional −5 stale property** → **75%** (two stale properties with fresh buyer-ready also → 75%).
3. **One active delay with fresh buyer-ready** → **75%** (−10).
4. **Properties with zero activities** never become stale (`daysSinceLastActivity` returns **0**) — old chains without activity records can stay **80–85%** despite being operationally stale.

**Not caused by:** old schema alone, intentional 75% floor, or progress weighting.

### 1.5 Scenario matrix

Run: `npx tsx scripts/verify-chain-confidence-scenarios.ts`

| # | Scenario | Score | Label | Misleading? |
|---|----------|------:|-------|-------------|
| 1 | New healthy chain, fresh buyer-ready activity | **85** | Healthy | No |
| 2 | High progress, no penalties | **85** | Healthy | Progress implies faster confidence — **yes** if copy links them |
| 3b | Null buyer-ready summary only | **80** | Healthy | **Yes** — looks "Healthy" at 80% baseline |
| 3 | 1 stale property + null buyer-ready | **75** | Healthy | **Yes** — matches founder observation |
| 4 | 2 stale properties, fresh buyer-ready | **75** | Healthy | Moderate |
| 5 | 3 stale + buyer-ready stale | **65** | Progress Slowing | No |
| 6 | 1 active delay, fresh buyer-ready | **75** | Healthy | Delay severity not reflected in label band |
| 7 | No property activities (empty) | **80** | Healthy | **Yes** — never stale without activities |
| 8 | Partial chain; searching placeholder excluded | **75** | Healthy | OK |
| 9 | Worst penalties | **0** | Needs Attention | No |

### 1.6 Explicit answers (FD-028)

| Question | Answer |
|----------|--------|
| **A. Can confidence fall below 75%?** | **Yes** — e.g. 2 delays → 65%, blocked/broken lower |
| **B. True minimum?** | **0** |
| **C. Degrades indefinitely with staleness?** | **No** — capped at −5 per stale property; no time-accelerating decay |
| **D. Extremely stale chain still high confidence?** | **Yes** — no activities → not stale; null buyer-ready → 80% floor common |
| **E. Explicit delay affects confidence?** | **Yes** — −10 per active delay (latest activity must be delay) |
| **F. Independent from Chain Progress?** | **Yes** — separate functions |
| **G. Defensible as customer-facing metric?** | **Not without rewrite of explanation** — UI tooltip claims progress/timeframes; algorithm is penalty-only |
| **H. Accurate tooltip for CURRENT implementation?** | See §1.7 |

### 1.7 Recommended tooltip/help wording (current implementation — not final approved copy)

**Chain Confidence (direction only):**

> Keynetic calculates chain confidence from reported delays, connection issues, blocked properties, and how recently properties in your chain were updated. It starts at 85 and reduces when issues are detected. It is an indication only — not a guarantee that your move will complete.

**Do not say:** progress milestones, expected timeframes, buffers, AI, or independent verification.

### 1.8 PRE_LAUNCH_REVIEW_REQUIRED (confidence)

| ID | Finding | Severity |
|----|---------|----------|
| **S2-CC-001** | UI tooltip claims progress/timeframes; code does not use them | **PRE_LAUNCH_REVIEW_REQUIRED** |
| **S2-CC-002** | `buyerReadySummary: null` always applies −5 stale penalty | **PRE_LAUNCH_REVIEW_REQUIRED** |
| **S2-CC-003** | Properties with no activities never penalised for staleness | **PRE_LAUNCH_REVIEW_REQUIRED** |
| **S2-CC-004** | Label "Healthy" at 70%+ including 75–80% with issues present | **PRE_LAUNCH_REVIEW_REQUIRED** |
| **S2-CC-005** | Cached summary vs live page: completed chains freeze staleness on page only | **PRE_LAUNCH_REVIEW_REQUIRED** (engineering) |
| **S2-CC-006** | FD-028/029 assumed timeframe/buffer logic — **not implemented** | Blocks final copy until founder accepts penalty model **or** algorithm change approved separately |

**Do not fix algorithm in Stage 2.**

---

## Part 2 — Estimated Completion Window audit

### 2.1 Calculation (canonical: `lib/chainIntelligence.ts`)

| `averageProgress` | Window |
|--------------------|--------|
| < 20 (default) | 16–20 weeks |
| ≥ 20 | 12–16 weeks |
| ≥ 40 | 8–12 weeks |
| ≥ 60 | 4–8 weeks |
| ≥ 80 | 1–3 weeks |

**Modifiers:** blocked → suffix; delays → suffix; stale → suffix; broken → `"Awaiting chain recovery"`.

**Hidden when:** scheduled/completion lifecycle frozen (agreed date recorded).

**Not used:** `expectedTimeframe` per stage, benchmarks, ML, Chain Confidence score.

### 2.2 Three implementations (drift)

| Location | Input | Stale threshold | Wording |
|----------|-------|-----------------|---------|
| `lib/chainIntelligence.ts` | Chain average progress | 21d (suffix) | `16–20 weeks (awaiting updates)` |
| `app/property/[propertyId]/page.tsx` | Single property progress | 14d | `… remaining (stale activity)` |
| `app/buyer-ready/[chainId]/page.tsx` | Buyer-ready stage progress | **7d** | Same as property page |

### 2.3 Customer-facing locations

| Route | Label | Notes |
|-------|-------|-------|
| `/chain/[chainId]` | Estimated Chain Completion + **"Forecast Engine"** badge | Canonical engine |
| `/property/[propertyId]` | Estimated Completion Window | Inline duplicate |
| `/buyer-ready/[chainId]` | Estimated Completion Window | Inline duplicate |

### 2.4 Recommended tooltip (current implementation — direction only)

> This is a rough guide based on how far the chain has progressed on Keynetic. It is not a guaranteed completion date. Actual times depend on solicitors, lenders, and other parties.

**Classification:** Heuristic estimate — not forecast, not AI, not benchmarked.

### 2.5 PRE_LAUNCH_REVIEW_REQUIRED (completion)

| ID | Finding |
|----|---------|
| **S2-EC-001** | "Forecast Engine" branding overstates capability |
| **S2-EC-002** | Three implementations with different thresholds/wording |
| **S2-EC-003** | Property/buyer-ready pages ignore blocked/broken chain state |

---

## Part 3 — `healthy` status semantics (FD-033)

### 3.1 Internal meaning

`properties.status = 'healthy'` means **normal connection/linkage state** in the topology model — set on join/create, distinct from `pending_connection` and `broken_connection`.

**Set by:** join RPC, start-move, ChainContext, buyer-ready creation.

**Used by:** `buildChainTopology.ts` segment gap calculation, dashboard/my-chains display, chain node styling.

### 3.2 What it does NOT mean

- Recent activity
- No delays reported
- High chain confidence
- Lifecycle `active`
- Progress on expected timeframe

### 3.3 Overloaded "healthy" elsewhere (different concepts)

| Context | Meaning |
|---------|---------|
| Chain confidence label ≥70 | Algorithmic band — **"Healthy"** |
| EA command centre tier | No critical alerts |
| Homepage demo | Static marketing decoration |

### 3.4 Customer label

| Internal | Founder-approved label | Status |
|----------|------------------------|--------|
| `properties.status = healthy` | **Connected** | **APPROVED** (FD-033) |
| ~~"On track"~~ | Rejected for topology status | — |
| ~~"Healthy"~~ | Avoid as customer topology label | Conflicts with Chain Confidence band |

**FD-033:** **APPROVED** — implement in Stage 6.

---

## Part 4 — Cookie / storage / tracking audit (FD-014)

### 4.1 Inventory

| Technology | Storage | Classification | Purpose | Lifetime | Consent implication (technical) |
|------------|---------|----------------|---------|----------|--------------------------------|
| Supabase Auth (SSR) | HTTP cookies | **STRICTLY_NECESSARY** | Session/auth | Session / refresh policy | Essential for service |
| Supabase MFA (Privacy Admin) | HTTP cookies | **STRICTLY_NECESSARY** | AAL2 | Session | Admin security |
| Invitation claim (homeowner/EA) | URL `?token=` → React state | **STRICTLY_NECESSARY** | Invitation gate | Session | Essential for invite flow |
| Agent invitation resend | `localStorage` + `sessionStorage` `claim-invitation-token:{propertyId}` | **FUNCTIONAL** | Agent workflow aid | Until cleared | Non-essential; low risk |
| Dev brand theme | `localStorage` `keynetic-brand-theme` | **FUNCTIONAL** | Preview/dev UX only | Persistent | Not production default |
| Upstash Redis | Server-side only | N/A (not browser) | Cache/rate limit | Server TTL | Not cookie policy |
| Vercel Live | Preview CSP script | **FUNCTIONAL** | Preview toolbar | Session | Preview only |
| Google Analytics, PostHog, Sentry, Meta, TikTok, Hotjar | — | **Not present** | — | — | — |
| IndexedDB | — | **Not used** | — | — | — |
| `document.cookie` direct | — | **Not used** | — | — | — |

### 4.2 Cookie consent banner — technical assessment

Based on **current repository implementation**:

**Keynetic appears capable of launching without a marketing/analytics consent banner** if:
- No non-essential tracking SDKs are added at deploy time
- Production does not enable dev theme localStorage for end users
- Legal review accepts Supabase auth cookies as strictly necessary

**Caveats (not legal advice):**
- Agent invitation token storage may need disclosure in Cookie Policy
- Vercel infrastructure logs may exist at platform level — document in policy
- Any future analytics requires re-audit before enablement

**FD-014 status:** **VALIDATION_COMPLETE** — Cookie Policy drafting remains **PENDING_LEGAL_REVIEW**.

---

## Part 5 — Invitation email property address audit (FD-004)

### 5.1 Email inventory

| Template | Wired? | Address in subject | Address in body | Whose address |
|----------|--------|-------------------|-----------------|---------------|
| **HomeownerInvitation** | Yes | Full `{propertyAddress}` | Full strong text | **Invited homeowner's property** (EA-created) |
| **PropertyClaimed** | No (preview only) | Full | Full | Claimant's property |
| **EstateAgentInvitation** | Yes | None | None | N/A |
| **DormancyWarning** | Yes | None | None (generic) | N/A — by design |
| **WelcomeEmail** | No | None | None | N/A |
| **PasswordReset** | Supabase native | None | None | N/A |

### 5.2 Homeowner invitation — option assessment

| Option | Clarity | Wrong-property risk | Trust | Minimisation | Feasible |
|--------|---------|----------------------|-------|--------------|----------|
| **A. Full address (current)** | High | Low | High | Lower | Yes |
| **B. Postcode + town** | Medium | Medium | Medium | Better | Yes — if stored separately |
| **C. Generic "your property"** | Low | Higher | Lower | Best | Yes |
| **D. Partial (e.g. street without number)** | Medium | Medium | Medium | Medium | Requires address parsing |

### 5.3 Cross-participant disclosure risk

Homeowner invitation shows **the invitee's property** (EA branch invited them to connect **their** sale/purchase). **No other participant's address** is included in the template.

Risk is **email channel security**, not cross-homeowner leakage in template design.

### 5.4 FD-004 post–Stage 2 status

| Aspect | Status |
|--------|--------|
| Body full address | **APPROVED** product preference — retain for now |
| Subject full address | **Flagged for separate legal/privacy review** |
| Legal sign-off | **PENDING_LEGAL_REVIEW** — do not change template yet |

---

## Part 6 — Founding pricing / billing readiness (FD-007 / FD-031)

### 6.1 Architecture answers

| Question | Finding |
|----------|---------|
| **A. Subscription owner entity** | **`ea_companies`** — schema comment: billing entity; `stripe_customer_id` reserved |
| **B. £79/month natural unit** | **Per company/organisation** per schema — **not per branch** (branches have no billing fields) |
| **C. Multiple branches per company?** | **Yes** — `ea_branches.company_id` |
| **D. Multiple agents per branch?** | **Yes** — `ea_branch_members` |
| **E. Billing implemented?** | **No** — no Stripe SDK, checkout, subscription logic |
| **F. Pricing CTA today** | → `/estate-agents/signup` (free signup/onboarding) |
| **G. Payment collection?** | **No** |
| **H. Safe wording before billing live** | FAQ already states billing enabled when subscriptions go live; **do not imply instant checkout**; **do not state "first 20 branches"** until unit confirmed |

### 6.2 Technical vs commercial (post–Stage 2)

| Question | Stage 2 finding | Founder decision |
|----------|-----------------|------------------|
| Subscription unit | Schema stub on `ea_companies` | **Per branch** — **APPROVED** (FD-031) |
| Founding price | £79 in marketing | **£79/month per branch** — first 20 founding branches (FD-007) |
| Standard price | £99 in marketing | **£99/month per branch** direction (FD-007) |
| Stripe | Not implemented | **STRIPE_IMPLEMENTATION_READINESS_PENDING** (FD-036) |
| Architecture mismatch | Company-oriented stub | **Billing architecture design review required** before Stripe |

**FD-007 / FD-031:** **APPROVED** at commercial-model level. **Not** resolved at implementation level.

---

## Part 7 — Break / disconnect terminology (FD-024)

### 7.1 Customer-facing actions mapped to behaviour

| Customer wording | Location | Actual behaviour | Recommended term (Stage 2) |
|------------------|----------|------------------|----------------------------|
| **Break Chain Connection** | Property page | RPC `break_chain_connection`; sets `broken_connection` | **Disconnect from chain** (topology) |
| **Chain break** | Chain viz gap label | Read-only broken segment | **Connection issue** (display) |
| **Leave this transaction** | De-link panel | Participation exit + lifecycle release | **Leave this transaction** ✓ (FD-025) |
| **Remove estate agent** | De-link | Revokes EA assignment | **Remove estate agent** ✓ |
| **Release branch management** | De-link | EA releases management | **Release branch management** ✓ |
| **Withdraw homeowner association** | De-link | EA withdraws pending homeowner | **Withdraw homeowner association** ✓ |
| **Revoke invitation** | Agent panel | Cancels pending invite | **Revoke invitation** ✓ |

**Not customer-facing:** GDPR erasure (Privacy Admin only); lifecycle dormancy release; topology vs de-link distinction.

### 7.2 FD-024 recommendation

Replace **"Break Chain Connection"** with **"Disconnect from chain"** after founder confirms behaviour matches intent (topology disconnect only, not real-world chain collapse).

Warning copy should clarify: *disconnects this property's link on Keynetic* — not legal completion of the transaction.

**FD-024 status:** **APPROVED** — "Disconnect from chain" for topology break. Stage 6 implementation.

---

## Part 8 — Legal / governance source inventory

Maps internal docs to future public legal documents. **Not legal advice. Not approved policies.**

### 8.1 Source document index

| Document | Primary future use |
|----------|-------------------|
| `GDPR_DATA_INVENTORY.md` | Privacy Policy — data categories, processors |
| `GDPR_RIGHT_TO_ERASURE_ARCHITECTURE.md` | Privacy Policy — erasure scope, shared records |
| `GDPR_ERASURE_OPERATIONAL_RUNBOOK.md` | Internal; informs erasure description only |
| `GDPR_PHASE2–4 docs` | Privacy Policy — execution, backups, suppression |
| `GDPR_DATA_RETENTION_SCHEDULE.md` | Public retention (many rows **TBD/proposed**) |
| `GDPR_PROCESSOR_DPA_CHECKLIST.md` | Privacy Policy processors; provider verification |
| `GDPR_BACKUP_ERASURE_RUNBOOK.md` | Privacy Policy backup treatment (high level) |
| `GDPR_PHASE3B_PRIVACY_ADMIN*.md` | Internal; erasure is not self-serve |
| `GDPR_LAUNCH_CHECKLIST.md` | Implementation tracker |
| `GDPR_WEBSITE_CONTENT_REGISTER.md` | Content cross-reference |
| `LAUNCH_CONTENT_*` docs | Founder-approved product decisions |
| Participation de-link / lifecycle docs | Terms + Privacy — de-link vs erasure vs release |
| Account security docs | Platform Terms — account responsibility |

### 8.2 Mapping to future public documents

| Future doc | Verified code facts | Founder decisions | Legal review required | Unresolved |
|------------|--------------------|--------------------|----------------------|------------|
| **A. Privacy Policy** | RLS, erasure RPCs, processors list, lifecycle | FD-001, FD-032, FD-009 | **Yes — full draft** | Retention periods (TBD rows) |
| **B. Platform Terms** | Permission model, access codes | FD-012 disclaimers | **Yes** | — |
| **C. EA Business Terms** | Branch subscription model (founder); schema stub on company | FD-007, FD-031, FD-036 | **Yes** | Branch-level Stripe architecture |
| **D. Cookie Policy** | Stage 2 inventory §4 | FD-014 complete | **Yes** | Agent token storage wording |
| **E. Public retention** | Lifecycle automation in code | — | **Yes** | Founder approval of periods |

### 8.3 Provider verification still required

Supabase, Resend, Vercel, Upstash (if enabled in production), Stripe (future) — per `GDPR_PROCESSOR_DPA_CHECKLIST.md`.

---

## Part 9 — Launch blockers (post–Stage 2)

### P0 content (Stage 3 — unchanged from audit)

Legal placeholders · privacy@ · erasure entry · legal structure · collection notices · FAQ · internal IDs · pricing anchor.

### Pre-launch engineering blocker

| Blocker | Status |
|---------|--------|
| **Chain Confidence current implementation** | **CURRENT_IMPLEMENTATION_NOT_APPROVED** — **Stage 3.5 redesign required** before family testing relies on confidence |
| **Estimated Completion drift** | Consolidate in Stage 3.5 |
| **Chain Confidence customer copy / tooltips** | Blocked until Stage 3.5 design approved |
| **Billing / Stripe** | **STRIPE_IMPLEMENTATION_READINESS_PENDING** (FD-036) — separate from Stage 3 |

---

## Part 10 — Founder decision status

See **[LAUNCH_CONTENT_FOUNDER_DECISIONS.md](./LAUNCH_CONTENT_FOUNDER_DECISIONS.md)** — post–Stage 2 consolidation (FD-028–FD-037).

---

## Part 11 — Post–Stage 2 founder consolidation

### Chain Confidence — not approved

Founder **rejects current penalty model** as intended behaviour. Target: **expected stage timeframes** + **buffer/grace** + meaningful degradation when materially overdue.

- `CURRENT_IMPLEMENTATION_NOT_APPROVED_AS_INTENDED_PRODUCT_BEHAVIOUR`
- **Stage 3.5** — **DESIGN_REFINED_AWAITING_FOUNDER_APPROVAL** — see [CHAIN_INTELLIGENCE_REDESIGN_PROPOSAL.md](./CHAIN_INTELLIGENCE_REDESIGN_PROPOSAL.md)
- Part 1 of this document remains accurate record of **current code**

### Stage 3.5 deliverables (design before code)

**Status:** `DESIGN_REFINED_AWAITING_FOUNDER_APPROVAL` (June 2026)

Delivered: [CHAIN_INTELLIGENCE_REDESIGN_PROPOSAL.md](./CHAIN_INTELLIGENCE_REDESIGN_PROPOSAL.md) · [CHAIN_INTELLIGENCE_SCENARIO_MATRIX.md](./CHAIN_INTELLIGENCE_SCENARIO_MATRIX.md) · simulation script · design-only model code.

Timeframe mapping · clock start · stage reset · buffer options · degradation model · multi-property aggregation · edge cases · min/max behaviour · scenario tests · ETA consolidation · bands/tooltips.

### Consolidation decisions (A–L)

Recorded in [Founder Decisions — Post–Stage 2 consolidation record](./LAUNCH_CONTENT_FOUNDER_DECISIONS.md).

---

## Part 12 — Implementation roadmap

| Stage | Scope |
|-------|--------|
| **3** | P0 legal/privacy/content — **no Chain Confidence code** |
| **3.5** | Chain Intelligence redesign — **DESIGN_REFINED_AWAITING_FOUNDER_APPROVAL** |
| **4–6** | Content · emails · terminology polish |
| **Billing/Stripe** | FD-036 — gated separately |

---

## Part 13 — Verification & confirmations

| Item | Status |
|------|--------|
| `scripts/verify-chain-confidence-scenarios.ts` | Documents **current** behaviour — 10/10 passed |
| Customer-facing content | **Not modified** |
| Application behaviour | **Not modified** |
| Chain Intelligence code | **Not modified** |
| Billing code | **Not modified** |
| Migrations / DB / Auth / GDPR / Privacy Admin | **Not modified** |

---

*Post–Stage 2 consolidation complete. Awaiting founder approval for Stage 3 and Stage 3.5.*
