/**
 * Stage 3.5 refined — Chain Intelligence scenario simulation (42 scenarios).
 * DESIGN ONLY — no production behaviour changes.
 *
 * Run: npx tsx scripts/chain-intelligence-redesign-simulation.ts
 */

import { STAGES } from "../data/stages";
import {
  computeChainIntelligence,
  type IntelligenceProperty,
} from "../lib/chainIntelligence";
import { DELAY_REPORTED_PREFIX } from "../lib/activityIntelligence";
import {
  BUYER_READY_STAGE_ORDER,
  CANONICAL_BUYER_READY_TIMING,
} from "../lib/chainIntelligenceDesign/buyerReadyTimingCatalog";
import {
  computeRefinedChainIntelligence,
  simulateBlockedCapComparison,
  type BlockedCapOption,
  type ChainDependencyInput,
  type DependencyOperationalState,
} from "../lib/chainIntelligenceDesign/refinedModel";
import {
  CANONICAL_SALE_STAGE_TIMING,
  SALE_STAGE_ORDER,
} from "../lib/chainIntelligenceDesign/stageTimingCatalog";

const REF = new Date("2026-06-19T12:00:00.000Z");

function daysAgo(days: number): string {
  return new Date(REF.getTime() - days * 86400000).toISOString();
}

function baseProperty(
  overrides: Partial<IntelligenceProperty> = {}
): IntelligenceProperty {
  return {
    id: 1,
    chainPosition: 1,
    stage: "offer_accepted",
    status: "healthy",
    address: "Example property",
    lastUpdatedDays: 0,
    activities: [
      { timestamp: daysAgo(3), update: "Offer Accepted" },
    ],
    ...overrides,
  };
}

function propertyDep(
  property: IntelligenceProperty,
  timing: {
    stageEnteredAt: string | null;
    clockQuality?: ChainDependencyInput["clockQuality"];
    operationalState?: DependencyOperationalState;
  }
): ChainDependencyInput {
  return {
    id: `property-${property.id}`,
    kind: "property",
    label: `Property ${property.chainPosition}`,
    stage: property.stage,
    status: property.status,
    stageEnteredAt: timing.stageEnteredAt,
    clockQuality: timing.clockQuality ?? "reliable",
    operationalState:
      timing.operationalState ??
      (property.status === "blocked"
        ? "blocked"
        : property.status === "broken_connection"
          ? "broken_connection"
          : property.status === "pending_connection"
            ? "pending_connection"
            : property.activities[0]?.update.includes(
                  DELAY_REPORTED_PREFIX
                )
              ? "explicit_delay"
              : "normal"),
    isCritical: true,
  };
}

function buyerReadyDep(params: {
  stage?: string;
  stageEnteredAt: string | null;
  clockQuality?: ChainDependencyInput["clockQuality"];
  operationalState?: DependencyOperationalState;
  status?: string;
}): ChainDependencyInput {
  return {
    id: "buyer-ready-1",
    kind: "buyer_ready",
    label: "Buyer Ready",
    stage: params.stage ?? "mortgage_application",
    status: params.status ?? "healthy",
    stageEnteredAt: params.stageEnteredAt,
    clockQuality: params.clockQuality ?? "reliable",
    operationalState: params.operationalState ?? "normal",
    isCritical: true,
  };
}

type Scenario = {
  id: number;
  name: string;
  properties: IntelligenceProperty[];
  dependencies: ChainDependencyInput[];
  buyerReadySummary?: {
    progress: number;
    latest_activity_at: string | null;
  } | null;
  blockedCap?: BlockedCapOption;
  note: string;
};

const refinedContext = {
  saleTiming: CANONICAL_SALE_STAGE_TIMING,
  buyerReadyTiming: CANONICAL_BUYER_READY_TIMING,
  saleStageOrder: SALE_STAGE_ORDER,
  buyerReadyStageOrder: BUYER_READY_STAGE_ORDER,
  referenceDate: REF,
};

const scenarios: Scenario[] = [
  {
    id: 1,
    name: "New chain, all within expected timing",
    properties: [baseProperty()],
    dependencies: [
      propertyDep(baseProperty(), { stageEnteredAt: daysAgo(2) }),
      buyerReadyDep({ stage: "mortgage_in_principle", stageEnteredAt: daysAgo(3) }),
    ],
    buyerReadySummary: { progress: 10, latest_activity_at: daysAgo(1) },
    note: "On-time sale + buyer ready",
  },
  {
    id: 2,
    name: "Early progress, on-time dependencies",
    properties: [
      baseProperty({ stage: "property_listed", activities: [{ timestamp: daysAgo(14), update: "Property Listed" }] }),
    ],
    dependencies: [
      propertyDep(baseProperty({ stage: "property_listed" }), { stageEnteredAt: daysAgo(14) }),
      buyerReadyDep({ stage: "mortgage_in_principle", stageEnteredAt: daysAgo(5) }),
    ],
    buyerReadySummary: null,
    note: "Low progress, high timing confidence",
  },
  {
    id: 3,
    name: "Late stage, on-time",
    properties: [
      baseProperty({ stage: "ready_to_exchange", activities: [{ timestamp: daysAgo(2), update: "Ready To Exchange" }] }),
    ],
    dependencies: [
      propertyDep(baseProperty({ stage: "ready_to_exchange" }), { stageEnteredAt: daysAgo(2) }),
      buyerReadyDep({ stage: "ready_to_exchange", stageEnteredAt: daysAgo(2) }),
    ],
    buyerReadySummary: { progress: 95, latest_activity_at: daysAgo(1) },
    note: "High progress, on-time",
  },
  {
    id: 4,
    name: "1 day over expected max",
    properties: [baseProperty({ activities: [{ timestamp: daysAgo(8), update: "Offer Accepted" }] })],
    dependencies: [propertyDep(baseProperty(), { stageEnteredAt: daysAgo(8) })],
    buyerReadySummary: { progress: 40, latest_activity_at: daysAgo(1) },
    note: "Grace zone",
  },
  {
    id: 5,
    name: "1 week over expected max",
    properties: [
      baseProperty({ stage: "solicitors_instructed", activities: [{ timestamp: daysAgo(21), update: "Solicitors Instructed" }] }),
    ],
    dependencies: [propertyDep(baseProperty({ stage: "solicitors_instructed" }), { stageEnteredAt: daysAgo(21) })],
    buyerReadySummary: { progress: 40, latest_activity_at: daysAgo(1) },
    note: "Overdue",
  },
  {
    id: 6,
    name: "2 weeks over expected max",
    properties: [
      baseProperty({ stage: "searches_ordered", activities: [{ timestamp: daysAgo(35), update: "Searches Ordered" }] }),
    ],
    dependencies: [propertyDep(baseProperty({ stage: "searches_ordered" }), { stageEnteredAt: daysAgo(35) })],
    buyerReadySummary: null,
    note: "Material overdue",
  },
  {
    id: 7,
    name: "1 month over expected max",
    properties: [
      baseProperty({ stage: "mortgage_offer_received", activities: [{ timestamp: daysAgo(44), update: "Mortgage Offer Received" }] }),
    ],
    dependencies: [propertyDep(baseProperty({ stage: "mortgage_offer_received" }), { stageEnteredAt: daysAgo(44) })],
    buyerReadySummary: null,
    note: "Severe overdue",
  },
  {
    id: 8,
    name: "3 months stale in stage",
    properties: [baseProperty({ activities: [{ timestamp: daysAgo(90), update: "Offer Accepted" }] })],
    dependencies: [propertyDep(baseProperty(), { stageEnteredAt: daysAgo(90) })],
    buyerReadySummary: null,
    note: "Must not remain Good/Strong",
  },
  {
    id: 9,
    name: "12 months stale",
    properties: [
      baseProperty({ stage: "searches_ordered", activities: [{ timestamp: daysAgo(365), update: "Searches Ordered" }] }),
    ],
    dependencies: [propertyDep(baseProperty({ stage: "searches_ordered" }), { stageEnteredAt: daysAgo(365) })],
    buyerReadySummary: null,
    note: "Old test-chain pattern",
  },
  {
    id: 10,
    name: "Explicit delay, timing OK",
    properties: [
      baseProperty({
        activities: [{ timestamp: daysAgo(0), update: `${DELAY_REPORTED_PREFIX}: Solicitor` }],
      }),
    ],
    dependencies: [
      propertyDep(baseProperty(), {
        stageEnteredAt: daysAgo(3),
        operationalState: "explicit_delay",
      }),
    ],
    buyerReadySummary: { progress: 40, latest_activity_at: daysAgo(1) },
    note: "Cap 84 — not Strong",
  },
  {
    id: 11,
    name: "1 blocked in 5-property chain (50% cap default)",
    properties: [1, 2, 3, 4, 5].map((id) =>
      baseProperty({
        id,
        chainPosition: id,
        stage: "searches_ordered",
        status: id === 3 ? "blocked" : "healthy",
        activities: [{ timestamp: daysAgo(5), update: "Searches Ordered" }],
      })
    ),
    dependencies: [1, 2, 3, 4, 5].map((id) =>
      propertyDep(
        baseProperty({ id, chainPosition: id, stage: "searches_ordered", status: id === 3 ? "blocked" : "healthy" }),
        { stageEnteredAt: daysAgo(5), operationalState: id === 3 ? "blocked" : "normal" }
      )
    ),
    buyerReadySummary: { progress: 50, latest_activity_at: daysAgo(2) },
    blockedCap: 50,
    note: "Founder preferred cap",
  },
  {
    id: 12,
    name: "Broken Keynetic connection",
    properties: [baseProperty({ status: "broken_connection" })],
    dependencies: [
      propertyDep(baseProperty({ status: "broken_connection" }), {
        stageEnteredAt: daysAgo(2),
        operationalState: "broken_connection",
      }),
    ],
    buyerReadySummary: null,
    note: "Distinct from blocked transaction",
  },
  {
    id: 13,
    name: "Pending connection",
    properties: [baseProperty({ status: "pending_connection" })],
    dependencies: [
      propertyDep(baseProperty({ status: "pending_connection" }), {
        stageEnteredAt: daysAgo(2),
        operationalState: "pending_connection",
      }),
    ],
    buyerReadySummary: null,
    note: "Mild modifier",
  },
  {
    id: 14,
    name: "Partial chain — 2 connected properties",
    properties: [1, 2].map((id) =>
      baseProperty({ id, chainPosition: id, activities: [{ timestamp: daysAgo(10), update: "Offer Accepted" }] })
    ),
    dependencies: [1, 2].map((id) =>
      propertyDep(baseProperty({ id, chainPosition: id }), { stageEnteredAt: daysAgo(10) })
    ),
    buyerReadySummary: null,
    note: "Coverage context only — no penalty for missing properties",
  },
  {
    id: 15,
    name: "Single-property chain",
    properties: [baseProperty({ activities: [{ timestamp: daysAgo(4), update: "Offer Accepted" }] })],
    dependencies: [propertyDep(baseProperty(), { stageEnteredAt: daysAgo(4) })],
    buyerReadySummary: null,
    note: "Single dependency",
  },
  {
    id: 16,
    name: "No activity history",
    properties: [baseProperty({ activities: [] })],
    dependencies: [
      propertyDep(baseProperty({ activities: [] }), {
        stageEnteredAt: null,
        clockQuality: "unavailable",
      }),
    ],
    buyerReadySummary: { progress: 40, latest_activity_at: daysAgo(1) },
    note: "Unavailable — not 80–85%",
  },
  {
    id: 17,
    name: "No reliable stage-entry timestamp",
    properties: [
      baseProperty({
        stage: "enquiries_raised",
        activities: [{ timestamp: daysAgo(1), update: "General Update" }],
      }),
    ],
    dependencies: [
      propertyDep(baseProperty({ stage: "enquiries_raised" }), {
        stageEnteredAt: null,
        clockQuality: "unavailable",
      }),
    ],
    buyerReadySummary: null,
    note: "Unavailable",
  },
  {
    id: 18,
    name: "Searching placeholder excluded",
    properties: [baseProperty({ stage: "searching", address: null, activities: [] })],
    dependencies: [],
    buyerReadySummary: null,
    note: "No in-scope sale property",
  },
  {
    id: 19,
    name: "Sale on-time, buyer-ready on-time",
    properties: [baseProperty()],
    dependencies: [
      propertyDep(baseProperty(), { stageEnteredAt: daysAgo(3) }),
      buyerReadyDep({ stage: "mortgage_application", stageEnteredAt: daysAgo(10) }),
    ],
    buyerReadySummary: null,
    note: "Buyer Ready included",
  },
  {
    id: 20,
    name: "4 on-time + 1 severely overdue bottleneck",
    properties: [1, 2, 3, 4, 5].map((id) =>
      baseProperty({
        id,
        chainPosition: id,
        stage: id === 5 ? "offer_accepted" : "searches_ordered",
        activities: [
          {
            timestamp: daysAgo(id === 5 ? 120 : 5),
            update: id === 5 ? "Offer Accepted" : "Searches Ordered",
          },
        ],
      })
    ),
    dependencies: [1, 2, 3, 4, 5].map((id) =>
      propertyDep(
        baseProperty({
          id,
          chainPosition: id,
          stage: id === 5 ? "offer_accepted" : "searches_ordered",
        }),
        { stageEnteredAt: daysAgo(id === 5 ? 120 : 5) }
      )
    ),
    buyerReadySummary: { progress: 55, latest_activity_at: daysAgo(1) },
    note: "Bottleneck dominates",
  },
  {
    id: 21,
    name: "Blocked 5-property chain — 40% cap",
    properties: [1, 2, 3, 4, 5].map((id) =>
      baseProperty({
        id,
        chainPosition: id,
        stage: "searches_ordered",
        status: id === 3 ? "blocked" : "healthy",
      })
    ),
    dependencies: [1, 2, 3, 4, 5].map((id) =>
      propertyDep(
        baseProperty({ id, chainPosition: id, status: id === 3 ? "blocked" : "healthy", stage: "searches_ordered" }),
        { stageEnteredAt: daysAgo(5), operationalState: id === 3 ? "blocked" : "normal" }
      )
    ),
    blockedCap: 40,
    note: "Cap comparison A",
  },
  {
    id: 22,
    name: "Blocked 5-property chain — 50% cap",
    properties: [1, 2, 3, 4, 5].map((id) =>
      baseProperty({
        id,
        chainPosition: id,
        stage: "searches_ordered",
        status: id === 3 ? "blocked" : "healthy",
        activities: [{ timestamp: daysAgo(5), update: "Searches Ordered" }],
      })
    ),
    dependencies: [1, 2, 3, 4, 5].map((id) =>
      propertyDep(
        baseProperty({
          id,
          chainPosition: id,
          stage: "searches_ordered",
          status: id === 3 ? "blocked" : "healthy",
        }),
        { stageEnteredAt: daysAgo(5), operationalState: id === 3 ? "blocked" : "normal" }
      )
    ),
    blockedCap: 50,
    note: "Cap comparison B — founder preference",
  },
  {
    id: 23,
    name: "Blocked 5-property chain — 60% cap",
    properties: [1, 2, 3, 4, 5].map((id) =>
      baseProperty({
        id,
        chainPosition: id,
        stage: "searches_ordered",
        status: id === 3 ? "blocked" : "healthy",
        activities: [{ timestamp: daysAgo(5), update: "Searches Ordered" }],
      })
    ),
    dependencies: [1, 2, 3, 4, 5].map((id) =>
      propertyDep(
        baseProperty({
          id,
          chainPosition: id,
          stage: "searches_ordered",
          status: id === 3 ? "blocked" : "healthy",
        }),
        { stageEnteredAt: daysAgo(5), operationalState: id === 3 ? "blocked" : "normal" }
      )
    ),
    blockedCap: 60,
    note: "Cap comparison C",
  },
  {
    id: 24,
    name: "Buyer Ready on time",
    properties: [baseProperty()],
    dependencies: [
      propertyDep(baseProperty(), { stageEnteredAt: daysAgo(3) }),
      buyerReadyDep({ stage: "mortgage_in_principle", stageEnteredAt: daysAgo(5) }),
    ],
    note: "BR within 1–2 week max",
  },
  {
    id: 25,
    name: "Buyer Ready slightly overdue",
    properties: [baseProperty()],
    dependencies: [
      propertyDep(baseProperty(), { stageEnteredAt: daysAgo(3) }),
      buyerReadyDep({ stage: "mortgage_in_principle", stageEnteredAt: daysAgo(10) }),
    ],
    note: "BR grace zone",
  },
  {
    id: 26,
    name: "Buyer Ready materially overdue",
    properties: [baseProperty()],
    dependencies: [
      propertyDep(baseProperty(), { stageEnteredAt: daysAgo(3) }),
      buyerReadyDep({ stage: "mortgage_application", stageEnteredAt: daysAgo(45) }),
    ],
    note: "BR pulls chain down",
  },
  {
    id: 27,
    name: "Buyer Ready severely overdue",
    properties: [baseProperty()],
    dependencies: [
      propertyDep(baseProperty(), { stageEnteredAt: daysAgo(3) }),
      buyerReadyDep({ stage: "mortgage_application", stageEnteredAt: daysAgo(120) }),
    ],
    note: "Whole-chain impact",
  },
  {
    id: 28,
    name: "Buyer Ready explicitly blocked",
    properties: [baseProperty()],
    dependencies: [
      propertyDep(baseProperty(), { stageEnteredAt: daysAgo(3) }),
      buyerReadyDep({
        stage: "mortgage_application",
        stageEnteredAt: daysAgo(5),
        operationalState: "blocked",
      }),
    ],
    blockedCap: 50,
    note: "BR blocked triggers cap",
  },
  {
    id: 29,
    name: "Buyer withdraws from otherwise healthy chain",
    properties: [baseProperty()],
    dependencies: [
      propertyDep(baseProperty(), { stageEnteredAt: daysAgo(3) }),
      buyerReadyDep({
        stage: "mortgage_application",
        stageEnteredAt: daysAgo(10),
        operationalState: "lost",
      }),
    ],
    note: "Lost critical dependency",
  },
  {
    id: 30,
    name: "Replacement buyer — timing restarts",
    properties: [baseProperty()],
    dependencies: [
      propertyDep(baseProperty(), { stageEnteredAt: daysAgo(3) }),
      buyerReadyDep({
        stage: "mortgage_in_principle",
        stageEnteredAt: daysAgo(2),
        operationalState: "normal",
      }),
    ],
    note: "New stage_entered_at after replacement",
  },
  {
    id: 31,
    name: "Explicit delay but within normal timing",
    properties: [baseProperty()],
    dependencies: [
      propertyDep(baseProperty(), {
        stageEnteredAt: daysAgo(3),
        operationalState: "explicit_delay",
      }),
    ],
    note: "Cap 84 max",
  },
  {
    id: 32,
    name: "Explicit delay and overdue",
    properties: [
      baseProperty({ stage: "solicitors_instructed", activities: [{ timestamp: daysAgo(0), update: `${DELAY_REPORTED_PREFIX}: Lender` }] }),
    ],
    dependencies: [
      propertyDep(baseProperty({ stage: "solicitors_instructed" }), {
        stageEnteredAt: daysAgo(25),
        operationalState: "explicit_delay",
      }),
    ],
    note: "Timing + delay compound",
  },
  {
    id: 33,
    name: "Minor delay vs material delay",
    properties: [baseProperty()],
    dependencies: [
      propertyDep(baseProperty(), { stageEnteredAt: daysAgo(3), operationalState: "explicit_delay" }),
    ],
    note: "Same cap rule — distinction via overdue combo (scenario 32)",
  },
  {
    id: 34,
    name: "4 exchange-ready, buyer mortgage materially overdue",
    properties: [1, 2, 3, 4].map((id) =>
      baseProperty({
        id,
        chainPosition: id,
        stage: "ready_to_exchange",
        activities: [{ timestamp: daysAgo(2), update: "Ready To Exchange" }],
      })
    ),
    dependencies: [
      ...[1, 2, 3, 4].map((id) =>
        propertyDep(
          baseProperty({ id, chainPosition: id, stage: "ready_to_exchange" }),
          { stageEnteredAt: daysAgo(2) }
        )
      ),
      buyerReadyDep({ stage: "mortgage_application", stageEnteredAt: daysAgo(50) }),
    ],
    note: "BR bottleneck despite healthy sale stages",
  },
  {
    id: 35,
    name: "4 exchange-ready, buyer mortgage blocked",
    properties: [1, 2, 3, 4].map((id) =>
      baseProperty({ id, chainPosition: id, stage: "ready_to_exchange" })
    ),
    dependencies: [
      ...[1, 2, 3, 4].map((id) =>
        propertyDep(baseProperty({ id, chainPosition: id, stage: "ready_to_exchange" }), {
          stageEnteredAt: daysAgo(2),
        })
      ),
      buyerReadyDep({
        stage: "mortgage_application",
        stageEnteredAt: daysAgo(10),
        operationalState: "blocked",
      }),
    ],
    blockedCap: 50,
    note: "Blocked BR cap",
  },
  {
    id: 36,
    name: "Partial chain with visible Buyer Ready bottleneck",
    properties: [baseProperty()],
    dependencies: [
      propertyDep(baseProperty(), { stageEnteredAt: daysAgo(5) }),
      buyerReadyDep({ stage: "mortgage_application", stageEnteredAt: daysAgo(45) }),
    ],
    note: "Partial visibility + BR overdue",
  },
  {
    id: 37,
    name: "Buyer Ready timing unavailable",
    properties: [baseProperty()],
    dependencies: [
      propertyDep(baseProperty(), { stageEnteredAt: daysAgo(5) }),
      buyerReadyDep({
        stage: "mortgage_application",
        stageEnteredAt: null,
        clockQuality: "unavailable",
      }),
    ],
    note: "Limited coverage",
  },
  {
    id: 38,
    name: "Conveyancing timing unavailable, Buyer Ready known",
    properties: [
      baseProperty({
        stage: "enquiries_raised",
        activities: [{ timestamp: daysAgo(1), update: "General Update" }],
      }),
    ],
    dependencies: [
      propertyDep(baseProperty({ stage: "enquiries_raised" }), {
        stageEnteredAt: null,
        clockQuality: "unavailable",
      }),
      buyerReadyDep({ stage: "mortgage_in_principle", stageEnteredAt: daysAgo(4) }),
    ],
    note: "Limited — BR only",
  },
  {
    id: 39,
    name: "ETA with overlapping stages",
    properties: [
      baseProperty({ stage: "searches_ordered" }),
      baseProperty({ id: 2, chainPosition: 2, stage: "survey_booked" }),
    ],
    dependencies: [
      propertyDep(baseProperty({ stage: "searches_ordered" }), { stageEnteredAt: daysAgo(5) }),
      propertyDep(baseProperty({ id: 2, chainPosition: 2, stage: "survey_booked" }), {
        stageEnteredAt: daysAgo(4),
      }),
      buyerReadyDep({ stage: "searches_ordered", stageEnteredAt: daysAgo(5) }),
    ],
    note: "Critical-path overlap reduction",
  },
  {
    id: 40,
    name: "ETA with Buyer Ready as critical path",
    properties: [baseProperty({ stage: "ready_to_exchange" })],
    dependencies: [
      propertyDep(baseProperty({ stage: "ready_to_exchange" }), { stageEnteredAt: daysAgo(2) }),
      buyerReadyDep({ stage: "mortgage_application", stageEnteredAt: daysAgo(20) }),
    ],
    note: "BR longer remaining path",
  },
  {
    id: 41,
    name: "ETA after buyer withdrawal",
    properties: [baseProperty()],
    dependencies: [
      propertyDep(baseProperty(), { stageEnteredAt: daysAgo(3) }),
      buyerReadyDep({
        stage: "mortgage_application",
        stageEnteredAt: daysAgo(10),
        operationalState: "lost",
      }),
    ],
    note: "Unable to estimate",
  },
  {
    id: 42,
    name: "ETA after replacement buyer joins",
    properties: [baseProperty()],
    dependencies: [
      propertyDep(baseProperty(), { stageEnteredAt: daysAgo(3) }),
      buyerReadyDep({ stage: "mortgage_in_principle", stageEnteredAt: daysAgo(3) }),
    ],
    note: "Estimate restarts from early BR stage",
  },
];

function runScenario(scenario: Scenario) {
  const current = computeChainIntelligence({
    chainProperties: scenario.properties.filter((p) => p.address !== null),
    buyerReadySummary: scenario.buyerReadySummary ?? null,
    stages: STAGES,
  });

  const refined = computeRefinedChainIntelligence({
    ...refinedContext,
    dependencies: scenario.dependencies,
    blockedCap: scenario.blockedCap ?? 50,
  });

  return { current, refined };
}

function main() {
  console.log("Chain Intelligence Refined Simulation — Stage 3.5\n");
  console.log(`Reference: ${REF.toISOString().slice(0, 10)}\n`);

  const rows: string[] = [];

  for (const scenario of scenarios) {
    const { current, refined } = runScenario(scenario);

    console.log(`## ${scenario.id}. ${scenario.name}`);
    console.log(`Note: ${scenario.note}`);
    console.log(
      `Current:  ${current.confidenceScore}% (${current.confidenceLabel}) · ETA ${current.estimatedChainCompletion || "n/a"}`
    );
    console.log(
      `Refined:  ${refined.score ?? "n/a"}% (${refined.band} / HO: ${refined.bandHomeowner}) · caps [${refined.capsApplied.join(", ") || "none"}]`
    );
    console.log(
      `Coverage: ${refined.dataCoverage} · ${refined.coverageLabel}`
    );
    console.log(
      `ETA:      ${refined.estimatedCompletionWindow ?? "n/a"}`
    );
    console.log("");

    rows.push(
      [
        scenario.id,
        scenario.name.slice(0, 40),
        `${current.confidenceScore}%`,
        refined.score == null ? "n/a" : `${refined.score}%`,
        refined.band,
        refined.estimatedCompletionWindow ?? "n/a",
      ].join(" | ")
    );
  }

  console.log("--- Blocked cap comparison (5-property blocked chain) ---");
  const blockedDeps = [1, 2, 3, 4, 5].map((id) =>
    propertyDep(
      baseProperty({
        id,
        chainPosition: id,
        stage: "searches_ordered",
        status: id === 3 ? "blocked" : "healthy",
      }),
      { stageEnteredAt: daysAgo(5), operationalState: id === 3 ? "blocked" : "normal" }
    )
  );
  const capComparison = simulateBlockedCapComparison(
    blockedDeps,
    [40, 50, 60],
    refinedContext
  );

  for (const entry of capComparison) {
    console.log(`Cap ${entry.cap}% → ${entry.score ?? "n/a"}% (${entry.band})`);
  }

  console.log("\n--- Markdown table ---");
  console.log("| # | Scenario | Current | Refined | Band | ETA |");
  console.log("|---:|---|---:|---:|---|---|");
  for (const row of rows) {
    console.log(`| ${row} |`);
  }
}

main();
