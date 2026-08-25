# Chain Intelligence Redesign Proposal — Stage 3.5

**Status:** `DESIGN_REFINED_AWAITING_FOUNDER_APPROVAL`  
**Date:** June 2026  
**Authority:** [FD-035](./LAUNCH_CONTENT_FOUNDER_DECISIONS.md) · [Stage 2 Validation](./LAUNCH_STAGE2_TECHNICAL_VALIDATION.md)

> **IMPORTANT:** This document is a design proposal only. **No production Chain Intelligence code, customer-facing behaviour, schema, or migrations were changed in Stage 3.5.**

> **Refinement (June 2026):** Founder approved timing-based direction **in principle** after initial design review. This revision incorporates Buyer Ready as a chain dependency, blocked/delay/withdrawal rules, 42-scenario simulation, and **one final recommended model** (§25). Implementation remains blocked until explicit approval.

---

## Executive summary

The founder has confirmed the current Chain Confidence implementation (`CURRENT_IMPLEMENTATION_NOT_APPROVED_AS_INTENDED_PRODUCT_BEHAVIOUR`) does **not** represent intended product behaviour.

**Four distinct concepts (approved):**

| Concept | Definition |
|---------|------------|
| **Chain Progress** | How far through the property-chain process the chain has progressed |
| **Chain Confidence** | System-generated indication that dependencies appear to be progressing within expected timing and operational parameters |
| **Estimated Completion** | System-generated **estimated completion window** (not "Forecast Engine") |
| **User Sentiment** | Participant Happy / Unsure / Concerned — **must not affect Confidence** |

**Final recommended model (§25):**

1. **Single canonical timeframe source** — `data/stages.ts` + proposed Buyer Ready catalogue.
2. **Property + Buyer Ready timing clocks** — `stage_entered_at` (schema addition); backfill from activities only when reliable.
3. **Hybrid grace** — `G = clamp(round(0.5×E), 3, 14)`.
4. **Progressive degradation** — grace → linear overdue → accelerating severe overdue.
5. **Critical-dependency operational states** — delay · blocked · lost (withdrawal) · broken/pending connection.
6. **Aggregation** — baseline `0.6×min + 0.4×mean`; Buyer Ready overdue uses `0.75×min + 0.25×mean` + caps.
7. **Chain caps** — blocked 50 · lost buyer 35 · explicit delay 79 · BR overdue 65 · BR severely overdue 45.
8. **Data coverage label** — separate from score; partial visibility does not penalise score.
9. **Presentation** — rounded to nearest 5 + band (Strong / Good / Monitor / Needs attention); HO "Keep an eye on" for Monitor.
10. **Estimated Completion** — critical-path hybrid (max tracks + partial overlap credit); unavailable when blocked/lost.
11. **Recalculation** — hybrid: immediate on mutation + daily time-only refresh.
12. **Versioning** — `confidence_algorithm_version: timing_v1` · `eta_algorithm_version: critical_path_v1`.

**Simulation:** `npx tsx scripts/chain-intelligence-redesign-simulation.ts` (42 scenarios)  
**Critical checks:** `npx tsx scripts/verify-chain-intelligence-critical-scenarios.ts` (14/14 pass)  
**Scenario matrix:** [CHAIN_INTELLIGENCE_SCENARIO_MATRIX.md](./CHAIN_INTELLIGENCE_SCENARIO_MATRIX.md)

---

## 1. Product intent (three separate concepts)

| Concept | Definition | Current implementation |
|---------|------------|---------------------|
| **Chain Progress** | How far through the process the chain has progressed (stage-weighted average) | `computeAverageProgress()` — **correct concept, separate metric** |
| **Chain Confidence** | System-generated indication of progression within expected timing + operational signals | Penalty score from fixed 85 — **not approved** |
| **User Sentiment** | User-reported Happy / Unsure / Concerned | **Not implemented** — must remain separate |

**Examples the new model must support:**

- 20% progress + on-time milestones → **high confidence**
- 80% progress + severely overdue milestone → **low confidence**

---

## 2. Core Chain Confidence principle

### Intended timing zones

| Zone | Condition (conceptual) | Intended UX |
|------|------------------------|-------------|
| Within expected | T ≤ E (elapsed ≤ expected max for current stage) | Strong confidence; no timing penalty |
| Grace / slightly overdue | E < T ≤ E + G | Small gradual reduction |
| Materially overdue | T > E + G | Meaningful reduction |
| Severely overdue | T ≫ E + G | Continued deterioration (not flat ~75%) |
| Stage advanced | New stage entered | Timing clock resets to new E |

Operational overlays: explicit delay, blocked, broken/pending connection — **additional** signals, not replacements for timing.

---

## 3. Expected timeframe inventory (canonical audit)

### 3.1 Primary structured source — sale property stages

**File:** `data/stages.ts`  
**Used in calculations today:** **Progress weights only** (`progress` field). **`expectedTimeframe` and `nextStep` are NOT used by Chain Confidence or Estimated Completion.**

| Internal value | Customer label | Next step (display) | Expected timeframe (display string) | Parsed max days (proposal) | Feeds calculation today? |
|----------------|----------------|---------------------|-------------------------------------|---------------------------:|--------------------------|
| `searching` | Next Home Search | Offer Accepted | Variable | — (no timing) | Excluded from confidence scope |
| `property_listed` | Property Listed | Offer Accepted | 1–12 weeks | 84 | Display only |
| `offer_accepted` | Offer Accepted | Solicitors Instructed | 1–7 days | 7 | Display only |
| `solicitors_instructed` | Solicitors Instructed | Searches Ordered | 1–2 weeks | 14 | Display only |
| `searches_ordered` | Searches Ordered | Survey Booked | 1–3 weeks | 21 | Display only |
| `survey_booked` | Survey Booked | Searches Returned | 1–2 weeks | 14 | Display only |
| `searches_returned` | Searches Returned | Survey Completed | 1–2 weeks | 14 | Display only |
| `survey_completed` | Survey Completed | Mortgage Offer Received | 1–2 weeks | 14 | Display only |
| `mortgage_offer_received` | Mortgage Offer Received | Enquiries Raised | 1–2 weeks | 14 | Display only |
| `enquiries_raised` | Enquiries Raised | Enquiries Fully Answered | 1–4 weeks | 28 | Display only |
| `enquiries_fully_answered` | Enquiries Fully Answered | Contracts Issued | 1–2 weeks | 14 | Display only |
| `contracts_issued` | Contracts Issued | Ready To Exchange | 1–2 weeks | 14 | Display only |
| `ready_to_exchange` | Ready To Exchange | Contracts Exchanged | 1–7 days | 7 | Display only |
| `contracts_exchanged` | Contracts Exchanged | Completion Date Agreed | 1–4 weeks | 28 | Display only |
| `completion_date_agreed` | Completion Date Agreed | Completed | 1–4 weeks | 28 | Display only |
| `completed` | Completed | Move In | Complete | 0 (terminal) | Display only |

**Customer display of timeframes:** `app/property/[propertyId]/page.tsx` — "Typical Timeframe" panel reads `currentStage?.expectedTimeframe` directly from `STAGES`.

### 3.2 Buyer-ready stages — gap

**File:** `data/buyerReadyStages.ts`  
**Fields:** `value`, `label`, `progress` only — **no `expectedTimeframe` or `nextStep`**.

Buyer-ready timing is **undefined** for a timeframe-based confidence model. Implementation must add parallel structured timing data (proposal: extend buyer-ready catalog in same shape as sale stages).

### 3.3 Duplicate / divergent timing strings

| Location | Content | Issue |
|----------|---------|-------|
| `lib/chainIntelligence.ts` | ETA bands: 16–20, 12–16, 8–12, 4–8, 1–3 weeks | **Hard-coded progress bands** — not tied to `expectedTimeframe` |
| `app/property/[propertyId]/page.tsx` | Same ETA bands + " remaining" suffix | **Duplicate #2**; stale threshold **14 days** |
| `app/buyer-ready/[chainId]/page.tsx` | Same ETA bands | **Duplicate #3**; stale threshold **7 days** |
| `lib/activityIntelligence.ts` | `STALE_DAYS_CONFIDENCE = 21`, `STALE_DAYS_PAGE_ALERT = 14` | Used for confidence staleness vs page alerts — **not stage timeframes** |
| UI copy on property page | "Estimated timelines are based on current transaction stage…" | Implies stage timing — **not backed by ETA algorithm** |

### 3.4 Homeowner vs EA

Both use the same `STAGES` / `BUYER_READY_STAGES` constants. EA Command Centre reads **cached** `confidence_score` from `chain_operational_summary` via `deriveChainSummary()` — same underlying algorithm.

### 3.5 Recommendation — single source of truth

Create `lib/chainIntelligenceDesign/stageTimingCatalog.ts` (design) → future `lib/milestoneTiming/catalog.ts` (implementation):

- Structured `{ minDays, maxDays, nextStageValue, label }` per stage
- Parsed once from existing display strings (short term) or replaced with explicit numeric fields (preferred for legal/explanatory consistency)
- Buyer-ready catalog added before buyer-ready timing contributes to chain-level confidence

---

## 4. Timing clock audit

### 4.1 Question: "When did this property enter its current stage?"

| Data source | Available? | Authoritative for stage entry? | Classification |
|-------------|------------|-------------------------------|----------------|
| **`properties.stage`** | Yes | Current stage only — **no history** | Insufficient alone |
| **`properties.updated_at`** | Yes (typical) | Updates on many mutations — **not stage-specific** | **C** Approximate only |
| **`properties.last_updated_days`** | Denormalized | Derived from activities — **not stage-specific** | **C** Approximate |
| **`activities` table** | Yes | Stage change via `updatePropertyStage()` inserts activity with formatted stage label | **B** Derivable when latest stage-change activity identifiable |
| **Stage-change activity pattern** | Partial | `ChainContext.updatePropertyStage()` inserts e.g. "Offer Accepted" | **B** Reliable if no later unrelated activity |
| **Dedicated `stage_entered_at` column** | **No** | Would be authoritative | **A** — **proposed schema addition** |
| **Lifecycle events** | Yes | Release/anonymise/completion — not general stage progression | **D** for timing confidence |
| **Milestone activity type** | Partial | "Milestone Reached" generic — does not encode stage | **D** |

### 4.2 Stage-entry derivation algorithm (proposed for implementation)

1. If `stage_entered_at` column populated → **reliable**
2. Else find newest activity where `update` matches formatted label of current stage from catalog → **derived**
3. Else if property created with current stage and creation timestamp → **approximate** (cap confidence at 85)
4. Else → **unavailable** — do not show arbitrary percentage

### 4.3 Per-stage classification (with current data only)

| Stage context | Clock quality (today) |
|---------------|----------------------|
| Stage changed via UI selector | **B** — activity inserted with stage label |
| Property created at stage with seed activity | **B/D** — depends on RPC seeding |
| Stage changed only via DB/admin | **D** |
| General updates after stage change | **C** — breaks naive "latest activity = stage entry" |
| No activities | **D** — current code treats as "0 days idle" (**defect**) |

### 4.4 Proposed schema (NOT implemented)

```sql
-- PROPOSAL ONLY
alter table public.properties
  add column stage_entered_at timestamptz;

alter table public.chain_nodes
  add column stage_entered_at timestamptz;
```

Set on stage mutation; backfill via activity scan + founder-approved defaults for unmigrateable rows.

---

## 5. Current Chain Confidence audit

### 5.1 Formula

```
score = max(0, 85
  − 25 × blockedCount
  − 10 × activeDelayCount
  −  5 × stalePropertyCount      (activity idle > 21 days)
  − 30 × brokenConnectionCount
  −  5 if buyerReadyStale
)
```

| Label | Threshold |
|-------|-----------|
| Healthy | ≥ 70 |
| Progress Slowing | ≥ 40 |
| Needs Attention | < 40 |

**No positive adjustments. No maximum below 85 except penalties. No timeframe logic.**

### 5.2 Inputs in detail

| Input | Logic | Edge cases |
|-------|-------|------------|
| **Stale** | `daysSinceLastActivity(activities) > 21` | **Empty activities → 0 days → never stale** |
| **Active delay** | Latest activity contains `"Delay Reported"` | Cleared only when superseded by newer non-delay activity |
| **Blocked** | `status === 'blocked'` | −25 each |
| **Broken** | `status === 'broken_connection'` | −30 each |
| **Buyer-ready stale** | Activities >21d OR summary `latest_activity_at` null/stale OR **`buyerReadySummary === null`** | **Always −5 when no summary loaded** |
| **Searching placeholder** | Excluded via `isSearchingPlaceholder()` | Correct exclusion |
| **Scheduled completion mode** | Stale penalties suppressed | Confidence still computed; ETA hidden |

### 5.3 Aggregation

Chain-level only — property penalties summed into counts (not averaged). One stale property = −5 regardless of chain size.

### 5.4 Why stale chains stay ~75–85%

1. **Effective baseline 80%** when buyer-ready summary null (−5 always)
2. **−5 per stale property** — one stale → 75% with null buyer-ready
3. **No time-accelerating decay** — 12-month idle same −5 as 22-day idle
4. **Empty activities never stale** — `daysSinceLastActivity([])` returns **0**
5. **Label "Healthy" at 70%+** — 75% still "Healthy"

### 5.6 Defects / misleading cases

| ID | Defect |
|----|--------|
| S2-CC-001 | UI tooltip cites progress/timeframes; algorithm does not |
| S2-CC-002 | Null buyer-ready summary always −5 |
| S2-CC-003 | No activities → never stale |
| S2-CC-004 | "Healthy" label at 75–80% with issues |
| S2-CC-005 | Cached summary vs live page divergence in completion mode |
| S2-CC-006 | Expected timeframe data exists but unused |

---

## 6. Proposed property-level timing model

### 6.1 Three buffer models evaluated

Let **E** = expected maximum days for current stage, **T** = elapsed days in stage, **G** = grace days.

| Model | Rule | Pros | Cons |
|-------|------|------|------|
| **A. Fixed** | G = 7 always | Simple | Too much grace for 7-day milestones; too little for 4-week milestones |
| **B. Proportional** | G = 0.5 × E | Scales naturally | Very short stages get tiny grace (e.g. 3.5d for 7d milestone) |
| **C. Hybrid (recommended)** | G = clamp(round(0.5×E), 3, 14) | Balanced; short milestones get min 3d grace; long capped at 14d | Requires documenting clamp rationale |

**Example hybrid grace values:**

| Stage (max E) | Fixed | Proportional | Hybrid |
|---------------|------:|-------------:|-------:|
| Offer accepted (7d) | 7 | 4 | **3** |
| Solicitors instructed (14d) | 7 | 7 | **7** |
| Enquiries raised (28d) | 7 | 14 | **14** |

### 6.2 Three degradation models evaluated

| Model | Behaviour after E+G | Pros | Cons |
|-------|---------------------|------|------|
| **1. Fixed steps** | −5 per week overdue | Simple | 2 weeks vs 12 months similar |
| **2. Linear ratio** | Score ∝ (T−E−G)/E | Scales with milestone length | Can still flatten for extreme T without floor |
| **3. Progressive (recommended)** | Linear to ~50 at E+G+E; then −8 per extra week, floor 5 | Severe staleness → single-digit scores | Slightly more complex — still deterministic |

**Recommended property timing health (before operational modifiers):**

- T ≤ E → 100
- E < T ≤ E+G → 100 − 15×((T−E)/G)
- E+G < T ≤ E+G+max(E,7) → 85 − 35×ratio
- Beyond → max(5, 50 − 8×extraWeeks)

Implementation reference: `lib/chainIntelligenceDesign/proposedModel.ts`

---

## 7. Confidence degradation design

**Problem to avoid:** 2 weeks overdue and 12 months overdue receiving similar permanent penalties.

**Recommendation:** Progressive model (§6.2) + operational modifiers applied after timing health:

| Signal | Modifier (proposal) |
|--------|--------------------|
| Active delay report | −12 |
| Blocked | −30 (or chain cap — see open questions) |
| Broken connection | −35 |
| Pending connection | −8 |

**Cap:** Property confidence ∈ [0, 100]. Approximate clock → property confidence capped at 85.

---

## 8. Operational signals classification

| Signal | Classification | Proposal |
|--------|----------------|----------|
| Explicit reported delay | **A** | Modifier on timing health |
| Blocked property | **A** | Strong modifier; consider chain-level cap |
| Broken connection | **A** | Strong modifier |
| Pending connection | **B** | Mild modifier; topology uncertainty |
| Missing participant | **C** | **Do not penalise** — use data coverage label |
| Partial chain visibility | **C** | Coverage label, not penalty |
| Recent activity | **C** | **Do not use as proxy for timing** once stage clock exists |
| No activity | **B** | Leads to unavailable confidence without clock |
| Buyer-ready status | **B** | Separate buyer-ready timing sub-score at chain merge |
| Searching placeholder | **C** | Exclude from timing scope |
| User sentiment | **C** | **Must NOT affect Chain Confidence** |
| Chain Progress % | **C** | **Must NOT directly affect Chain Confidence** |

### Data coverage / confidence-in-the-estimate

**Recommendation:** Display alongside score:

> **Chain Confidence: 80% (Good)**  
> Based on 3 of 5 connected properties

Optional second line when chain topology suggests more properties may exist:

> Some chain properties may not yet be connected on Keynetic.

---

## 9. Missing data behaviour

| Condition | Proposed behaviour |
|-----------|-------------------|
| No stage-entry timestamp | **Confidence unavailable** for that property; chain unavailable if no scored properties |
| No activity history | Unavailable until backfill or `stage_entered_at` |
| Newly created property | Clock starts at creation / first stage activity |
| Partial chain | Score visible properties; coverage label shows connected count |
| Searching state | Excluded — variable timeframe |
| Unknown next milestone | Use catalog; if stage unmapped → unavailable |
| Missing buyer-ready | Sale-property timing still works; buyer-ready contributes separately when data exists |

**Do not invent false confidence** — prefer "Unavailable" or "Limited data" over defaulting to 85/80.

---

## 10. Property → chain aggregation

| Model | Formula | Assessment |
|-------|---------|------------|
| A. Simple average | mean(scores) | Underweights severe bottleneck |
| B. Weighted average | weight by chain position | Arbitrary weights |
| C. Worst-property dominance | min(scores) | Over-alarming for minor issue |
| D. Bottleneck-weighted | 0.6×min + 0.4×mean | **Recommended** — balances bottleneck with chain context |
| E. Hybrid percentile | 70th percentile | Less intuitive to explain |

**Recommendation:** **Model D** baseline — bottleneck-weighted hybrid **plus critical-dependency caps** (refined model).

**Resolved (refinement):** When any critical dependency is **blocked**, chain confidence capped at **50%** (founder preference; 40/50/60 simulated — see scenario matrix §21–23).

**Buyer Ready bottleneck (refinement):** When Buyer Ready is materially or severely overdue, use **75/25** weighting and caps at **65** / **45** respectively so healthy sale-side stages cannot mask a buyer readiness bottleneck.

---

## 11. Confidence bands / presentation

### Current bands (not approved for product truth)

| Score | Label |
|------:|-------|
| ≥ 70 | Healthy |
| ≥ 40 | Progress Slowing |
| < 40 | Needs Attention |

EA Command Centre duplicates similar labels via `getConfidenceLabel()`.

### Proposed bands

| Score | Band | Notes |
|------:|------|-------|
| ≥ 85 | **Strong** | Avoid "Healthy" (topology uses Connected) |
| 70–84 | **Good** | |
| 50–69 | **Monitor** | HO: **Keep an eye on** · EA: **Monitor** |
| < 50 | **Needs attention** | Not "At risk" (medical connotation) |

### Display format recommendation

**Option D: Rounded percentage + band**

- Show score rounded to nearest **5** (reduces false precision)
- Always show band label
- Show data coverage line when not `full`
- Optional expand: "How this is calculated"

Avoid **Option A** (exact percentage only) — implies false precision.

---

## 12. Tooltip / explanation design

### Short tooltip (chain page)

> Keynetic calculates Chain Confidence from expected milestone timing and operational signals visible on your chain. It is system-generated from the information available in Keynetic — not independently verified, and not a guarantee your move will complete.

### Expanded help panel

- **Chain Progress** shows how far the chain has moved through stages.
- **Chain Confidence** shows whether connected properties appear to be progressing within typical timeframes, adjusted for reported delays, blocks, and connection issues.
- Confidence can be high at early progress if timing is on track, and lower at late progress if milestones are overdue.
- Coverage line explains how many connected properties contributed.
- Link to glossary; no legal wall in primary UI.

**Remove:** references to penalty starting at 85, "Forecast Engine", progress-driven confidence.

---

## 13. Estimated Completion audit (three implementations)

| # | Location | Input | Stale threshold | Output format |
|---|----------|-------|-----------------|---------------|
| 1 | `lib/chainIntelligence.ts` `computeEstimatedChainCompletion` | Chain `averageProgress` | 21d (suffix only) | `16–20 weeks` + suffix |
| 2 | `app/property/[propertyId]/page.tsx` inline | Single property `progress` | **14d** | `… remaining` + suffix |
| 3 | `app/buyer-ready/[chainId]/page.tsx` inline | Buyer-ready `progress` | **7d** | `… remaining` + suffix |

**Shared drift:** Same progress band thresholds (20/40/60/80) duplicated three times. None use per-stage `expectedTimeframe`. Property/buyer-ready pages ignore blocked/broken chain state.

**Customer locations:**

- `/chain/[chainId]` — "Estimated Chain Completion" + **Forecast Engine badge** (remove badge)
- `/property/[propertyId]` — "Estimated Completion Window"
- `/buyer-ready/[chainId]` — "Estimated Completion Window"

---

## 14. Proposed canonical Estimated Completion

**Customer-facing name:** **Estimated completion window** (remove "Forecast Engine")

### Conveyancing workflow audit (sequential / parallel)

| Phase | Stages | Relationship |
|-------|--------|--------------|
| Early | offer_accepted → solicitors_instructed → mortgage steps | **Sequential** |
| Mid | searches, survey, enquiries, mortgage offer | **Partially parallel** between purchase and sale tracks |
| Late | contracts_signed → ready_to_exchange → exchange → completion | **Sequential** — chain-wide bottleneck |

**Rejected:** naive sum of all remaining max durations (Model A) — double-counts parallel work.

**Recommended (Model D — hybrid critical path):**

1. For each property track and Buyer Ready track, sum remaining max durations from current stage.
2. `criticalPathDays = max(maxPropertyRemaining, buyerReadyRemaining)`.
3. If both tracks in parallel-eligible stages, apply **35% overlap credit** on the shorter track.
4. Add slack (+7d overdue bottleneck, +14d severely overdue).
5. Format as week range; append "(reported delays may extend this)" when explicit delay active.
6. Return **"Unable to estimate"** when blocked or buyer lost — not a stale number.

Implementation reference: `computeEstimatedCompletionWindow()` in `lib/chainIntelligenceDesign/refinedModel.ts`

---

## 15. Scenario simulation

Full **42-scenario** comparison: [CHAIN_INTELLIGENCE_SCENARIO_MATRIX.md](./CHAIN_INTELLIGENCE_SCENARIO_MATRIX.md)

Run:

```bash
npx tsx scripts/chain-intelligence-redesign-simulation.ts
npx tsx scripts/verify-chain-intelligence-critical-scenarios.ts
```

Design-only code:

- `lib/chainIntelligenceDesign/proposedModel.ts` — initial timing functions
- `lib/chainIntelligenceDesign/refinedModel.ts` — **refined model (authoritative for simulation)**
- `lib/chainIntelligenceDesign/buyerReadyTimingCatalog.ts` — Buyer Ready catalogue
- `lib/chainIntelligenceDesign/stageTimingCatalog.ts` — sale stage catalogue
- `scripts/chain-intelligence-redesign-simulation.ts`
- `scripts/verify-chain-intelligence-critical-scenarios.ts`

---

## 16. Old test-chain analysis

Live Development DB was **not queried** (design phase; PII risk; no production changes).

Synthetic equivalents documented in scenario matrix § "Old / stale test-chain patterns".

**Current behaviour:** chains with empty activities or single old activity commonly remain **75–85%** ("Healthy").

**Proposed behaviour:** with reliable `stage_entered_at` or derived clock → **5–40%** for multi-month overdue; without clock → **Unavailable**.

---

## 17. Architecture / cost governance

### Problem

Confidence **decays with time** even without user mutations → pure calculate-on-write becomes stale.

### Options

| Option | Description | Assessment |
|--------|-------------|------------|
| A. Calculate on read | Every dashboard load runs full intelligence | **Reject** — violates query governance |
| B. Calculate on mutation | Refresh on activity/stage/status change | **Necessary but insufficient** alone |
| C. Scheduled recalculation | Cron/worker revisits chains past expected milestones | **Required** for time decay |
| D. Hybrid (recommended) | **B + C** with `next_recalculation_at` | Efficient |

### Recommended architecture

1. **On write:** stage change, delay report, block, connection change → recompute property + chain summary immediately (existing `refreshOperationalSummary` path).
2. **On schedule:** daily (or hourly) job selects chains where `next_recalculation_at <= now()` — recompute timing-based confidence.
3. **Set `next_recalculation_at`** to soonest upcoming zone boundary (E, E+G, etc.) across in-scope properties.
4. **Dashboard reads** consume `chain_operational_summary` / property summaries only — no full recompute on read.
5. **Chain page detail** may compute live for authenticated participant (acceptable on demand) OR read cached with `computed_at` age indicator — founder decision.

**Aligns with:** `docs/PROPERTY_LIFECYCLE_AUTOMATION.md` — "calculated on write; worker evaluates on schedule."

---

## 18. Determinism and versioning

**Requirement:** Same inputs + reference time → same output.

**Proposal:**

```typescript
export const CONFIDENCE_ALGORITHM_VERSION = "timing_v1";
export const ETA_ALGORITHM_VERSION = "critical_path_v1";
```

Persist on `chain_operational_summary.summary_version` (increment from current `1`) and include in debug/admin tooling — **not customer-facing**.

Store `computed_at`, `algorithm_version`, `reference_time` in summary metadata (JSON column proposal).

---

## 19. Test strategy (for implementation phase)

| Category | Tests |
|----------|-------|
| Timeframe parsing | All `STAGES` strings parse correctly |
| Buffer boundaries | T = E, E+1, E+G, E+G+1 |
| Severe staleness | 90d, 365d overdue → score ≤ 10 |
| Missing clock | Returns unavailable |
| Partial chain | Coverage label; no false penalty for missing properties |
| Aggregation | Bottleneck dominates (scenario 20) |
| Delay/block/broken | Modifiers apply |
| Progress independence | Low progress + on-time → high confidence |
| ETA consistency | Single function matches chain/property/buyer-ready pages |
| Determinism | Fixed `referenceDate` snapshots |
| Versioning | Version string stored on recompute |
| Time progression | Simulate `referenceDate` advancing without mutations |

**Regression targets:**

- 1 day beyond estimate → no disproportionate alarm (grace)
- 12 months overdue → not ~75%
- Empty activities → unavailable (not 85%)
- One severe bottleneck → chain score ≤ 50

Existing script to retain: `scripts/verify-chain-confidence-scenarios.ts` (current model baseline).

New script: `scripts/chain-intelligence-redesign-simulation.ts` (proposed model).

---

## 20. Implementation impact analysis

| Item | Category | Risk |
|------|----------|------|
| Replace `computeChainConfidence` with timing model | A code | Medium |
| Add `stage_entered_at` columns | B schema | Medium |
| Backfill from activities | C migration | **High** — needs validation |
| Set clock on stage mutation | A code | Low |
| `next_recalculation_at` + cron job | D infrastructure | Medium |
| Update chain/property/buyer-ready UI | E UI | Low |
| Remove Forecast Engine badge | E UI | Low |
| Consolidate ETA to one function | A code | Medium |
| Extend buyer-ready timing catalog | A + G docs | Medium |
| Update tooltips/help | E + G | Low |
| EA ConfidenceBar labels | E UI | Low |
| `summary_version` bump | B + F tests | Low |
| Terminology register update | G docs | Low |

### Safest backfill strategy (proposal only)

1. Deploy schema with nullable `stage_entered_at`
2. Backfill script: match activity label to stage catalog (newest match)
3. Rows with no match → leave null → confidence **Unavailable** until user updates stage or admin repair
4. Do **not** guess from `updated_at` alone without flagging approximate quality
5. Phase rollout: show coverage "Limited" during backfill period

---

## 25. Final recommended model (Stage 3.5 refinement)

**Single authoritative design** — not a menu of options. Simulation code: `lib/chainIntelligenceDesign/refinedModel.ts`.

### 25.1 Canonical timeframe structure

- **Sale properties:** `data/stages.ts` → `lib/chainIntelligenceDesign/stageTimingCatalog.ts`
- **Buyer Ready:** `lib/chainIntelligenceDesign/buyerReadyTimingCatalog.ts` (14 UI stages + legacy `mortgage_preparation`)
- Shared parser: `parseExpectedTimeframe()` — one source for Confidence and ETA

### 25.2 Property stage timing rules

- Clock: `properties.stage_entered_at` (proposed; set on stage mutation)
- Score timing health 0–100 using hybrid grace + progressive degradation (§6)
- Operational modifiers: delay −8/−12 · blocked −35 (dep max 45) · broken −20 · pending −6
- Variable stages (`searching`) → excluded from timing scope

### 25.3 Buyer Ready timing rules

- Clock: `chain_nodes.stage_entered_at` (proposed; set on buyer-ready stage mutation)
- Same timing health formula as properties
- **Always a critical chain dependency** when buyer-ready data exists
- Legacy `mortgage_preparation` → map to `mortgage_in_principle` on backfill (domain validation)

### 25.4 Grace formula

`G = clamp(round(0.5 × E), 3, 14)` where E = expected max days for current stage.

### 25.5 Progressive degradation formula

| Zone | Condition | Score |
|------|-----------|------:|
| Within | T ≤ E | 100 |
| Grace | E < T ≤ E+G | 100 − 15×((T−E)/G) |
| Overdue | E+G < T ≤ E+G+max(E,7) | 85 − 35×ratio |
| Severely overdue | beyond | max(5, 50 − 8×extraWeeks) |

### 25.6 Delay treatment

Active explicit delay (participant-reported): operational modifier + **chain cap 79** (pre-rounding) so band cannot be Strong. Does not apply when blocked or lost caps take precedence.

### 25.7 Blocked treatment

Blocked critical dependency: dependency score capped at 45; **chain cap 50%** (founder preference).

### 25.8 Buyer withdrawal treatment

Operational state `lost`: dependency scored with −60 adjustment; **chain cap 35%**; ETA **"Unable to estimate — critical buyer dependency lost"**. Does not auto-collapse entire chain topology — replacement buyer path supported.

### 25.9 Connection issue treatment

| State | Dependency modifier | Chain cap |
|-------|--------------------:|-----------|
| Broken Keynetic connection | −20 | none (timing still applies) |
| Pending connection | −6 | none |

Broken connection ≠ blocked — real-world transaction may still progress.

### 25.10 Missing-data treatment

No reliable stage-entry clock → property/BR dependency **not scored** → if no scored dependencies, **Chain Confidence Unavailable**. Do not use `updated_at` as fake stage entry. UI still shows Progress, stages, operational info.

**Customer wording:** "Chain Confidence unavailable — we don't yet have reliable timing for all connected steps."

### 25.11 Partial-chain treatment

Score only dependencies Keynetic can assess. Coverage label: "Based on X of Y connected properties and A of B Buyer Ready steps visible on Keynetic." **No score penalty** for invisible chain length.

### 25.12 Property/dependency aggregation

**Baseline:** `chainScore = round(0.6 × min + 0.4 × mean)` over scored dependencies.

**Buyer Ready bottleneck amplification:** when BR is overdue/severely overdue and is the bottleneck (or within 5 points of min), use `0.75 × min + 0.25 × mean`.

### 25.13 Critical-dependency caps (summary)

| Condition | Chain cap |
|-----------|----------:|
| Blocked critical | 50 |
| Lost buyer (withdrawal) | 35 |
| Explicit delay (no block/lost) | 79 |
| Buyer Ready overdue | 65 |
| Buyer Ready severely overdue | 45 |

Caps apply after aggregation; display score rounded to nearest 5.

### 25.14 Confidence bands

| Score | Band | Homeowner | Estate Agent |
|------:|------|-----------|--------------|
| ≥ 85 | Strong | Strong | Strong |
| 70–84 | Good | Good | Good |
| 50–69 | Monitor | **Keep an eye on** | Monitor |
| < 50 | Needs attention | Needs attention | Needs attention |

Do not use "Healthy" for Chain Confidence (topology uses **Connected**).

### 25.15 Percentage rounding

Round to nearest **5** before band mapping (`roundDisplayScore`).

### 25.16 Coverage wording

`Based on {scored} of {total} connected properties and {scoredBR} of {totalBR} Buyer Ready steps visible on Keynetic`

When insufficient: `Chain Confidence unavailable — timing data is not yet reliable enough`

### 25.17 Tooltip/help approach

Short tooltip (FD-029 direction): system-generated from timing + operational signals; not verified; not a guarantee. Expanded help separates Progress · Confidence · Estimated completion window · User Sentiment.

### 25.18 Estimated Completion algorithm

Critical-path hybrid (§14). Buyer Ready on critical path when its remaining duration exceeds or parallels property tracks.

### 25.19 Buyer Ready integration into ETA

`criticalPathDays = max(maxPropertyRemaining, buyerReadyRemaining)` with overlap credit when parallel stages align.

### 25.20 When ETA cannot be calculated

Prefer **"Unable to estimate"** (+ reason suffix) over displaying a misleading prior estimate — blocked dependency, lost buyer, or no scorable tracks.

### 25.21 Recalculation architecture

**Hybrid D (recommended):** immediate recompute on operational mutation + **daily** batch for time-only deterioration. Dashboard lists read cached summaries only. Optional `next_recalculation_at` at earliest zone boundary.

### 25.22 Versioning

`confidence_algorithm_version: timing_v1` · `eta_algorithm_version: critical_path_v1` on summary metadata.

### 25.23 Required schema changes (proposal — no migration created)

- `properties.stage_entered_at timestamptz`
- `chain_nodes.stage_entered_at timestamptz`
- Summary metadata: `algorithm_version`, `computed_at`, `coverage_status`

### 25.24 Backfill strategy

Newest activity matching formatted stage label; ambiguous → null; never guess from `updated_at` alone; approximate quality flag if derived with low confidence.

### 25.25 Test strategy

- `scripts/verify-chain-intelligence-critical-scenarios.ts` — 14 checks A–M + delay
- `scripts/chain-intelligence-redesign-simulation.ts` — 42 scenarios
- Implementation: unit tests with fixed `referenceDate`; regression for empty activities, 365d stale, blocked cap, BR bottleneck

---

## 21. Risks and open questions

| # | Question | Status after refinement |
|---|----------|-------------------------|
| 1 | Approve **timing-based model**? | **Approved in principle** |
| 2 | Approve **hybrid grace**? | **Approved in principle** |
| 3 | Approve **progressive degradation**? | **Approved in principle** |
| 4 | Approve **bottleneck aggregation + caps**? | **Approved in principle** — 50% blocked cap |
| 5 | **Buyer Ready in Confidence**? | **Required** — incorporated |
| 6 | **`stage_entered_at` schema**? | **Approved in principle** — migration not yet created |
| 7 | Show **Unavailable** vs hide widget? | **Recommend show Unavailable** with Progress still visible |
| 8 | **Buyer-ready timeframe bounds** | Proposed catalogue — **domain validation** on mortgage_application (2–4 wks) |
| 9 | **Rounded % + band**? | **Approved in principle** |
| 10 | **Recalculation frequency**? | **Daily** time refresh + mutation (not hourly) |
| 11 | **ETA model**? | **Critical-path hybrid** recommended |
| 12 | Remove **Forecast Engine**? | **Approved** (FD-035) |
| 13 | HO **"Keep an eye on"** vs EA **"Monitor"**? | **Recommended** — same band, audience-specific label |
| 14 | Explicit buyer **withdrawal workflow** in product? | **Not in codebase** — design models `lost` state; implementation needs product spec |
| 15 | **`mortgage_preparation` legacy stage**? | Map on backfill — remove from default join? (domain decision) |

---

## 22. Files created/updated (Stage 3.5)

### Created / updated (design only)

| File | Purpose |
|------|---------|
| `docs/CHAIN_INTELLIGENCE_REDESIGN_PROPOSAL.md` | This proposal (refined) |
| `docs/CHAIN_INTELLIGENCE_SCENARIO_MATRIX.md` | 42-scenario matrix |
| `docs/LAUNCH_STAGE3_5_COMPLETION_REPORT.md` | Refinement completion report |
| `lib/chainIntelligenceDesign/proposedModel.ts` | Initial timing functions |
| `lib/chainIntelligenceDesign/refinedModel.ts` | **Refined model (simulation authority)** |
| `lib/chainIntelligenceDesign/buyerReadyTimingCatalog.ts` | Buyer Ready catalogue + audit |
| `lib/chainIntelligenceDesign/stageTimingCatalog.ts` | Sale stage catalogue |
| `scripts/chain-intelligence-redesign-simulation.ts` | 42-scenario simulation |
| `scripts/verify-chain-intelligence-critical-scenarios.ts` | Critical checks A–M |

### Updated (documentation status only)

| File | Change |
|------|--------|
| `docs/LAUNCH_CONTENT_FOUNDER_DECISIONS.md` | FD-035 → `DESIGN_REFINED_AWAITING_FOUNDER_APPROVAL` |
| `docs/LAUNCH_STAGE2_TECHNICAL_VALIDATION.md` | Stage 3.5 refined status |
| `docs/LAUNCH_CONTENT_AUDIT.md` | Stage 3.5 refined status |

### NOT changed

- `lib/chainIntelligence.ts`
- `app/chain/[chainId]/page.tsx` (confidence UI)
- `app/property/[propertyId]/page.tsx` (ETA inline)
- `app/buyer-ready/[chainId]/page.tsx` (ETA inline)
- Database / migrations / production

---

## 23. Confirmations

| Constraint | Status |
|------------|--------|
| No production Chain Intelligence code changed | ✓ |
| No customer-facing behaviour changed | ✓ |
| No migrations / database changes | ✓ |
| No Production changes | ✓ |
| No GDPR / Auth / billing / legal page changes | ✓ |

---

## 24. Next step

**Await explicit founder approval** of this **refined** design before implementation.

**Status:** `DESIGN_REFINED_AWAITING_FOUNDER_APPROVAL`

Upon approval, recommended implementation order:

1. Schema + stage mutation hooks (`stage_entered_at` property + chain_nodes)
2. Buyer Ready catalogue in data layer + legacy stage cleanup
3. Backfill + coverage classification
4. Replace `computeChainConfidence` with refined timing model
5. Daily recalculation worker + summary cache
6. Consolidate Estimated Completion to critical-path function
7. UI bands, tooltips, remove Forecast Engine
8. Test suite + terminology register update

**Stop here. Do not implement algorithms without approval.**

---

*Proposal version: Stage 3.5 refined design — June 2026*
