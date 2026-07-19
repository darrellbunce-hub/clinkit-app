/**
 * Stage 3.5 — Critical scenario pass/fail checks for refined model.
 * Run: npx tsx scripts/verify-chain-intelligence-critical-scenarios.ts
 */

import {
  BUYER_READY_STAGE_ORDER,
  CANONICAL_BUYER_READY_TIMING,
} from "../lib/chainIntelligenceDesign/buyerReadyTimingCatalog";
import {
  computeRefinedChainIntelligence,
  type ChainDependencyInput,
} from "../lib/chainIntelligenceDesign/refinedModel";
import {
  CANONICAL_SALE_STAGE_TIMING,
  SALE_STAGE_ORDER,
} from "../lib/chainIntelligenceDesign/stageTimingCatalog";

const REF = new Date("2026-06-19T12:00:00.000Z");

function daysAgo(days: number): string {
  return new Date(REF.getTime() - days * 86400000).toISOString();
}

function dep(
  overrides: Partial<ChainDependencyInput> & Pick<ChainDependencyInput, "id">
): ChainDependencyInput {
  return {
    kind: "property",
    label: overrides.id,
    stage: "offer_accepted",
    status: "healthy",
    stageEnteredAt: daysAgo(3),
    clockQuality: "reliable",
    operationalState: "normal",
    isCritical: true,
    ...overrides,
  };
}

const ctx = {
  saleTiming: CANONICAL_SALE_STAGE_TIMING,
  buyerReadyTiming: CANONICAL_BUYER_READY_TIMING,
  saleStageOrder: SALE_STAGE_ORDER,
  buyerReadyStageOrder: BUYER_READY_STAGE_ORDER,
  referenceDate: REF,
  blockedCap: 50 as const,
};

type Check = {
  id: string;
  name: string;
  pass: boolean;
  detail: string;
};

const checks: Check[] = [];

function check(id: string, name: string, pass: boolean, detail: string) {
  checks.push({ id, name, pass, detail });
}

// A. 1 day beyond typical — not alarming
{
  const r = computeRefinedChainIntelligence({
    ...ctx,
    dependencies: [dep({ id: "p1", stageEnteredAt: daysAgo(8) })],
  });
  check("A", "1 day over max not alarming", (r.score ?? 0) >= 85, `score=${r.score}`);
}

// B. 3 months overdue — not Good/Strong
{
  const r = computeRefinedChainIntelligence({
    ...ctx,
    dependencies: [dep({ id: "p1", stageEnteredAt: daysAgo(90) })],
  });
  check("B", "3 months overdue not Good/Strong", (r.score ?? 100) < 70, `score=${r.score} band=${r.band}`);
}

// C. 12 months stale — not ~75-85
{
  const r = computeRefinedChainIntelligence({
    ...ctx,
    dependencies: [
      dep({ id: "p1", stage: "searches_ordered", stageEnteredAt: daysAgo(365) }),
    ],
  });
  check("C", "12 months stale very low", (r.score ?? 100) <= 10, `score=${r.score}`);
}

// D. Low progress alone — use early stage on-time + BR on-time
{
  const r = computeRefinedChainIntelligence({
    ...ctx,
    dependencies: [
      dep({ id: "p1", stage: "property_listed", stageEnteredAt: daysAgo(14) }),
      dep({
        id: "br1",
        kind: "buyer_ready",
        stage: "mortgage_in_principle",
        stageEnteredAt: daysAgo(5),
      }),
    ],
  });
  check("D", "Low progress high confidence when on-time", (r.score ?? 0) >= 85, `score=${r.score}`);
}

// E. High progress alone — late stage but overdue
{
  const r = computeRefinedChainIntelligence({
    ...ctx,
    dependencies: [
      dep({ id: "p1", stage: "ready_to_exchange", stageEnteredAt: daysAgo(30) }),
    ],
  });
  check("E", "High progress does not protect overdue", (r.score ?? 100) < 70, `score=${r.score}`);
}

// F. Blocked not averaged away
{
  const deps = [1, 2, 3, 4, 5].map((id) =>
    dep({
      id: `p${id}`,
      stage: "searches_ordered",
      stageEnteredAt: daysAgo(3),
      operationalState: id === 3 ? "blocked" : "normal",
    })
  );
  const r = computeRefinedChainIntelligence({ ...ctx, dependencies: deps });
  check("F", "Blocked cap applied", (r.score ?? 100) <= 50, `score=${r.score} caps=${r.capsApplied.join(",")}`);
}

// G. Overdue Buyer Ready affects chain
{
  const r = computeRefinedChainIntelligence({
    ...ctx,
    dependencies: [
      dep({ id: "p1", stageEnteredAt: daysAgo(3) }),
      dep({
        id: "br1",
        kind: "buyer_ready",
        stage: "mortgage_application",
        stageEnteredAt: daysAgo(60),
      }),
    ],
  });
  check("G", "Overdue BR affects chain", (r.score ?? 100) < 70, `score=${r.score}`);
}

// H. Blocked Buyer Ready
{
  const r = computeRefinedChainIntelligence({
    ...ctx,
    dependencies: [
      dep({ id: "p1", stageEnteredAt: daysAgo(3) }),
      dep({
        id: "br1",
        kind: "buyer_ready",
        stage: "mortgage_application",
        stageEnteredAt: daysAgo(5),
        operationalState: "blocked",
      }),
    ],
  });
  check("H", "Blocked BR capped", (r.score ?? 100) <= 50, `score=${r.score}`);
}

// I. Buyer withdrawal
{
  const r = computeRefinedChainIntelligence({
    ...ctx,
    dependencies: [
      dep({ id: "p1", stageEnteredAt: daysAgo(3) }),
      dep({
        id: "br1",
        kind: "buyer_ready",
        stage: "mortgage_application",
        stageEnteredAt: daysAgo(10),
        operationalState: "lost",
      }),
    ],
  });
  check("I", "Buyer withdrawal major impact", (r.score ?? 100) <= 35, `score=${r.score}`);
}

// J. Withdrawal ETA unavailable
{
  const r = computeRefinedChainIntelligence({
    ...ctx,
    dependencies: [
      dep({ id: "p1", stageEnteredAt: daysAgo(3) }),
      dep({
        id: "br1",
        kind: "buyer_ready",
        operationalState: "lost",
        stageEnteredAt: daysAgo(10),
      }),
    ],
  });
  check(
    "J",
    "Withdrawal ETA unavailable",
    r.estimatedCompletionWindow?.includes("Unable") ?? false,
    r.estimatedCompletionWindow ?? "null"
  );
}

// K. Replacement buyer restarts
{
  const r = computeRefinedChainIntelligence({
    ...ctx,
    dependencies: [
      dep({ id: "p1", stageEnteredAt: daysAgo(3) }),
      dep({
        id: "br1",
        kind: "buyer_ready",
        stage: "mortgage_in_principle",
        stageEnteredAt: daysAgo(2),
      }),
    ],
  });
  check("K", "Replacement buyer on-time restarts", (r.score ?? 0) >= 85, `score=${r.score}`);
}

// L. Missing timing unavailable
{
  const r = computeRefinedChainIntelligence({
    ...ctx,
    dependencies: [
      dep({ id: "p1", stageEnteredAt: null, clockQuality: "unavailable" }),
    ],
  });
  check("L", "Missing clock unavailable", r.score == null, `score=${r.score}`);
}

// M. Partial chain no penalty
{
  const onTimePartial = computeRefinedChainIntelligence({
    ...ctx,
    dependencies: [
      dep({ id: "p1", stageEnteredAt: daysAgo(3) }),
      dep({ id: "p2", stageEnteredAt: daysAgo(4) }),
    ],
  });
  const single = computeRefinedChainIntelligence({
    ...ctx,
    dependencies: [dep({ id: "p1", stageEnteredAt: daysAgo(3) })],
  });
  check(
    "M",
    "Partial visibility no score penalty",
    (onTimePartial.score ?? 0) >= (single.score ?? 0) - 5,
    `partial=${onTimePartial.score} single=${single.score}`
  );
}

// Explicit delay prevents Strong
{
  const r = computeRefinedChainIntelligence({
    ...ctx,
    dependencies: [
      dep({ id: "p1", stageEnteredAt: daysAgo(2), operationalState: "explicit_delay" }),
    ],
  });
  check(
    "delay",
    "Explicit delay prevents Strong",
    r.band !== "Strong",
    `score=${r.score} band=${r.band}`
  );
}

let failed = 0;

for (const entry of checks) {
  if (entry.pass) {
    console.log(`PASS ${entry.id}: ${entry.name} — ${entry.detail}`);
  } else {
    console.error(`FAIL ${entry.id}: ${entry.name} — ${entry.detail}`);
    failed += 1;
  }
}

console.log(`\n${checks.length - failed}/${checks.length} critical checks passed`);

if (failed > 0) {
  process.exitCode = 1;
}
