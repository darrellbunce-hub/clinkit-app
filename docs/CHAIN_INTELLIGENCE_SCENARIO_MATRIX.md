# Chain Intelligence Scenario Matrix — Stage 3.5 Refinement

**Status:** `DESIGN_REFINED_AWAITING_FOUNDER_APPROVAL` — simulation only  
**Run:** `npx tsx scripts/chain-intelligence-redesign-simulation.ts`  
**Critical checks:** `npx tsx scripts/verify-chain-intelligence-critical-scenarios.ts` (14/14 pass)  
**Reference date:** 2026-06-19 (synthetic scenarios)

See [CHAIN_INTELLIGENCE_REDESIGN_PROPOSAL.md](./CHAIN_INTELLIGENCE_REDESIGN_PROPOSAL.md) for the final recommended model.

**Model:** `timing_v1_refined` — hybrid grace · progressive degradation · 60/40 baseline aggregation · Buyer Ready bottleneck amplification (75/25 + caps) · blocked cap 50% · explicit delay cap 79 · critical-path ETA

---

## Scenarios 1–20 (original matrix — refined results)

| # | Scenario | Current | Refined | Band | Caps | ETA | Key insight |
|---:|---|---:|---:|---|---|---|---|
| 1 | New chain, within expected timing | 75% | 100% | Strong | — | 32–33 wks | On-time → Strong |
| 2 | Early progress, on-time | 75% | 100% | Strong | — | 43–44 wks | **Progress ≠ confidence** |
| 3 | Late stage, on-time | 75% | 100% | Strong | — | 9–10 wks | High progress + on-time → Strong |
| 4 | 1 day over expected max | 75% | 95% | Strong | — | 31–32 wks | Grace prevents alarm |
| 5 | 1 week over expected max | 75% | 85% | Strong | — | 30–31 wks | Mild overdue |
| 6 | 2 weeks over expected max | 75% | 80% | Good | — | 29–30 wks | Material overdue |
| 7 | 1 month over expected max | 75% | 40% | Needs attention | — | 21–22 wks | Severe overdue |
| 8 | 3 months stale in stage | 75% | 5% | Needs attention | — | 33–34 wks | Fixes stale high-confidence defect |
| 9 | 12 months stale | 75% | 5% | Needs attention | — | 30–31 wks | Long idle → very low |
| 10 | Explicit delay, timing OK | 65% | 80% | Good | delay cap 79 | 31–32 wks | **Delay prevents Strong** |
| 11 | 1 blocked in 5-property chain | 30% | 50% | Monitor | blocked 50 | Unable | **Blocked cap — not averaged away** |
| 12 | Broken Keynetic connection | 45% | 80% | Good | — | 31–32 wks | Lighter than blocked (~−20 dep) |
| 13 | Pending connection | 75% | 95% | Strong | — | 31–32 wks | Mild connection modifier |
| 14 | Partial chain — 2 properties | 70% | 90% | Strong | — | 31–32 wks | Coverage label; no score penalty |
| 15 | Single-property chain | 75% | 100% | Strong | — | 31–32 wks | Single dep = score |
| 16 | No activity history | 80% | n/a | Unavailable | — | Unable | No false confidence |
| 17 | No reliable stage-entry timestamp | 75% | n/a | Unavailable | — | Unable | Requires stage clock |
| 18 | Searching placeholder | 80% | n/a | Unavailable | — | Unable | Variable timeframe excluded |
| 19 | Sale on-time, buyer-ready on-time | 75% | 100% | Strong | — | 31–32 wks | **BR integrated as dependency** |
| 20 | 4 on-time + 1 severely overdue | 55% | 35% | Needs attention | lost n/a | 33–34 wks | Bottleneck dominates |

---

## Scenarios 21–42 (refinement additions)

| # | Scenario | Refined | Band | Caps | ETA | Key insight |
|---:|---|---:|---|---|---|---|
| 21 | Blocked 5-property chain — **40% cap** | 40% | Needs attention | blocked 40 | Unable | Stricter; may over-alarm EA ops |
| 22 | Blocked 5-property chain — **50% cap** | 50% | Monitor | blocked 50 | Unable | **Recommended** — founder preference |
| 23 | Blocked 5-property chain — **60% cap** | 60% | Monitor | blocked 60 | Unable | Too lenient for blocked critical dep |
| 24 | Buyer Ready on time | 100% | Strong | — | 32–33 wks | BR within 1–2 wk MIP window |
| 25 | Buyer Ready slightly overdue | 100% | Strong | — | 32–33 wks | Still in grace (MIP 10d / max 14d) |
| 26 | Buyer Ready materially overdue | 65% | Monitor | BR overdue 65 | 32–33 wks | **BR bottleneck rule** — not averaged away |
| 27 | Buyer Ready severely overdue | 15% | Needs attention | BR severe 45 | 33–34 wks | Whole-chain impact |
| 28 | Buyer Ready explicitly blocked | 50% | Monitor | blocked 50 | Unable | Same cap as blocked property |
| 29 | Buyer withdraws — healthy chain | 35% | Needs attention | lost 35 | Unable — buyer lost | Major impact; chain may continue |
| 30 | Replacement buyer — timing restarts | 100% | Strong | — | 32–33 wks | New `stage_entered_at` resets assessment |
| 31 | Explicit delay, within normal timing | 80% | Good | delay 79 | 31–32 wks | Good not Strong |
| 32 | Explicit delay and overdue | 65% | Monitor | — | 31–32 wks | Timing + delay compound |
| 33 | Minor delay (same cap as 31) | 80% | Good | delay 79 | 31–32 wks | Minor delay not over-penalised |
| 34 | 4 exchange-ready, buyer mortgage overdue | 65% | Monitor | BR overdue 65 | 31–32 wks | **Healthy sale stages do not mask BR** |
| 35 | 4 exchange-ready, buyer mortgage blocked | 50% | Monitor | blocked 50 | Unable | Blocked BR caps chain |
| 36 | Partial chain + BR bottleneck | 65% | Monitor | BR overdue 65 | 32–33 wks | Partial visibility + BR overdue |
| 37 | Buyer Ready timing unavailable | 100% | Strong | — | 31–32 wks | Score from sale only; **limited coverage** |
| 38 | Conveyancing unavailable, BR known | 100% | Strong | — | 32–33 wks | Limited — BR only |
| 39 | ETA overlapping stages | 100% | Strong | — | 42–44 wks | Overlap credit in critical-path ETA |
| 40 | ETA — BR is critical path | 100% | Strong | — | 30–31 wks | max(property, BR) not sum |
| 41 | ETA after buyer withdrawal | 35% | Needs attention | lost 35 | Unable — buyer lost | **No misleading old estimate** |
| 42 | ETA after replacement buyer | 100% | Strong | — | 32–33 wks | Estimate restarts from early BR |

---

## Blocked cap comparison (scenario 21–23)

| Cap | 5-property chain (1 blocked, 4 at 100%) | Band | UX meaning |
|-----|----------------------------------------:|------|------------|
| **40%** | 40% | Needs attention | Correct severity; may feel harsh for transient blocks |
| **50%** | 50% | Monitor | **Recommended** — acknowledges blocker without collapsing chain |
| **60%** | 60% | Monitor | Still displays Monitor/Good-adjacent; founder rejected ~80% |

With remaining chain at 100% timing health, raw 60/40 score would be ~80%; cap enforces operational truth.

---

## Critical scenario verification (A–M)

| ID | Test | Result | Refined score |
|----|------|--------|---------------|
| A | 1 day beyond typical — not alarming | **PASS** | 95% Strong |
| B | 3 months overdue — not Good/Strong | **PASS** | 5% Needs attention |
| C | 12 months stale — not ~75–85% | **PASS** | 5% |
| D | Low progress alone — no confidence penalty | **PASS** | 100% |
| E | High progress alone — no protection | **PASS** | 40% |
| F | Blocked critical — not averaged away | **PASS** | 50% (cap) |
| G | Overdue Buyer Ready affects chain | **PASS** | 65% Monitor |
| H | Blocked Buyer Ready affects chain | **PASS** | 50% (cap) |
| I | Buyer withdrawal major impact | **PASS** | 35% |
| J | Withdrawal → ETA unavailable | **PASS** | Unable to estimate |
| K | Replacement buyer restarts | **PASS** | 100% |
| L | Missing timing → unavailable | **PASS** | n/a |
| M | Partial visibility — no score penalty | **PASS** | 100% = 100% |

Additional: explicit delay prevents Strong — **PASS** (80% Good).

---

## Explicit delay options compared

| Option | Simulation result | Assessment |
|--------|-------------------|------------|
| A. Fixed penalty only | 90% Strong (misleading) | Rejected |
| B. Max band Good while delay active | 80% Good | **Adopted via cap 79** |
| C. Cap at 84% | Rounds to 85% Strong | Rejected (rounding bug) |
| D. Delay only after overdue | 90% Strong when on-time | Rejected — ignores operational signal |
| **E. Cap 79 pre-rounding** | 80% Good | **Recommended** |

---

*Refined simulation — June 2026. Numbers from `lib/chainIntelligenceDesign/refinedModel.ts`.*
