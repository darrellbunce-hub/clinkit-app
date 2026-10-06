/**
 * Offline checks for the operational intelligence cache (summary v3):
 * activity clocks, staleness boundaries, Buyer Ready, missing-summary
 * presentation and Dashboard / Chain view parity.
 *
 * Usage:
 *   npx tsx scripts/verify-operational-intelligence-cache.ts
 */
import { readFileSync } from "fs";
import { join } from "path";

import {
  describeChainHealth,
} from "../lib/chainIntelligence";
import {
  presentCachedChainIntelligence,
  type CachedChainIntelligence,
} from "../lib/chainIntelligence/cachedChainIntelligence";
import type { AgentBranchPropertySummary } from "../lib/estateAgent/assignmentTypes";
import {
  formatSummaryHealthLabel,
  getCustomerFacingConfidenceScore,
  getOperationalPriorityTier,
} from "../lib/estateAgent/commandCentrePresentation";
import { getManagedPropertyOperationalState } from "../lib/estateAgent/workspacePresentation";
import { OPERATIONAL_SUMMARY_VERSION } from "../lib/operationalSummary/constants";
import { deriveOperationalSummaries } from "../lib/operationalSummary/processOperationalRefresh";
import type {
  OperationalRefreshChainNode,
  OperationalRefreshDataset,
  OperationalRefreshProperty,
} from "../lib/operationalSummary/types";

const ROOT = join(import.meta.dirname, "..");
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const NOW = new Date("2026-06-15T12:00:00.000Z");

type TestResult = { name: string; pass: boolean; detail?: string };
const results: TestResult[] = [];

function record(name: string, pass: boolean, detail?: string) {
  results.push({ name, pass, detail });
  console.log(pass ? `✓ ${name}` : `✗ ${name}${detail ? `: ${detail}` : ""}`);
}

function daysBefore(reference: Date, days: number, extraMs = HOUR_MS): string {
  return new Date(reference.getTime() - days * DAY_MS - extraMs).toISOString();
}

function property(
  overrides: Partial<OperationalRefreshProperty> & { id: number }
): OperationalRefreshProperty {
  return {
    chainId: 1,
    chainPosition: overrides.id,
    stage: "searches_ordered",
    status: "healthy",
    address: `${overrides.id} Example Street`,
    stageEnteredAt: daysBefore(NOW, 10),
    activities: [],
    genuineLastActivityAt: null,
    activityClockAt: daysBefore(NOW, 2),
    activityClockSource: "stage_entered_at",
    hasActiveOperationalDelay: false,
    ...overrides,
  };
}

function buyerReadyNode(
  overrides: Partial<OperationalRefreshChainNode>
): OperationalRefreshChainNode {
  return {
    id: 900,
    chain_id: 1,
    node_type: "buyer_ready",
    linked_property_id: 1,
    stage: "mortgage_in_principle",
    status: "healthy",
    progress: 20,
    stageEnteredAt: daysBefore(NOW, 30),
    activities: [],
    genuineLastActivityAt: null,
    activityClockAt: daysBefore(NOW, 2),
    activityClockSource: "node_created",
    hasActiveOperationalDelay: false,
    ...overrides,
  };
}

function dataset(
  properties: OperationalRefreshProperty[],
  chainNodes: OperationalRefreshChainNode[] = [],
  chainOverrides: Partial<OperationalRefreshDataset["chain"]> = {}
): OperationalRefreshDataset {
  return {
    chain: {
      id: 1,
      completionLifecycleStatus: null,
      completionScheduledDate: null,
      completionConfirmedAt: null,
      completedAt: null,
      ...chainOverrides,
    },
    properties,
    chainNodes,
  };
}

function hasAlert(
  summary: { operational_alerts: Array<{ code: string }> },
  code: string
) {
  return summary.operational_alerts.some((alert) => alert.code === code);
}

function testDayOneDayThree() {
  const day1 = new Date("2026-06-01T10:00:00.000Z");
  const day3 = new Date("2026-06-03T10:00:00.000Z");
  const { propertySummaries, chainSummary } = deriveOperationalSummaries(
    dataset([
      property({
        id: 1,
        genuineLastActivityAt: day1.toISOString(),
        activityClockAt: day1.toISOString(),
        activityClockSource: "genuine_activity",
        activities: [
          { timestamp: day1.toISOString(), update: "Searches ordered", updated_by: "user" },
        ],
      }),
    ]),
    day3
  );
  const summary = propertySummaries[0];

  record(
    "Day 1 activity, Day 3 worker run: last_update_at stays Day 1",
    summary.last_update_at === day1.toISOString() &&
      summary.activity_clock_at === day1.toISOString() &&
      summary.days_since_last_update === 2 &&
      summary.computed_at === day3.toISOString(),
    JSON.stringify({
      last: summary.last_update_at,
      days: summary.days_since_last_update,
    })
  );
  record(
    "Summary version 3 on chain and property rows",
    OPERATIONAL_SUMMARY_VERSION === 3 &&
      chainSummary.summary_version === 3 &&
      summary.summary_version === 3
  );
}

function testSystemNoticeDoesNotMoveClock() {
  const fallback = daysBefore(NOW, 18);
  const { propertySummaries } = deriveOperationalSummaries(
    dataset([
      property({
        id: 1,
        genuineLastActivityAt: null,
        activityClockAt: fallback,
        activityClockSource: "stage_entered_at",
        activities: [
          {
            timestamp: daysBefore(NOW, 0),
            update: "Chain connection updated",
            updated_by: "system",
          },
        ],
      }),
    ]),
    NOW
  );
  const summary = propertySummaries[0];

  record(
    "System notice does not move the clock or Last updated",
    summary.last_update_at === null &&
      summary.activity_clock_at === fallback &&
      summary.days_since_last_update === 18 &&
      summary.stale_update,
    JSON.stringify({
      last: summary.last_update_at,
      days: summary.days_since_last_update,
      stale: summary.stale_update,
    })
  );
}

function testFallbackClock() {
  const { propertySummaries } = deriveOperationalSummaries(
    dataset([
      property({
        id: 1,
        activityClockAt: daysBefore(NOW, 16),
        activityClockSource: "property_record_created",
      }),
    ]),
    NOW
  );
  const summary = propertySummaries[0];

  record(
    "Fallback clock: an untouched property goes stale; source kept; Last updated stays null",
    summary.stale_update &&
      hasAlert(summary, "stale_update") &&
      summary.needs_attention &&
      summary.activity_clock_source === "property_record_created" &&
      summary.last_update_at === null
  );

  const placeholder = deriveOperationalSummaries(
    dataset([
      property({ id: 1 }),
      property({
        id: 2,
        stage: "searching",
        address: null,
        activityClockAt: daysBefore(NOW, 40),
        activityClockSource: "chain_created",
      }),
    ]),
    NOW
  ).propertySummaries[1];

  record(
    "Searching placeholder never gets a stale alert from its fallback clock",
    !placeholder.stale_update && !hasAlert(placeholder, "stale_update")
  );
}

function testPageAlertBoundary() {
  const summaryAt = (days: number) =>
    deriveOperationalSummaries(
      dataset([
        property({ id: 1, activityClockAt: daysBefore(NOW, days) }),
      ]),
      NOW
    ).propertySummaries[0];

  const day14 = summaryAt(14);
  const day15 = summaryAt(15);

  record(
    "14/15-day boundary: 14 days not stale, 15 days stale (page alert)",
    !day14.stale_update &&
      !hasAlert(day14, "stale_update") &&
      day15.stale_update &&
      hasAlert(day15, "stale_update"),
    `${day14.days_since_last_update}/${day15.days_since_last_update}`
  );
}

function testConfidenceBoundary() {
  const chainAt = (days: number) =>
    deriveOperationalSummaries(
      dataset([
        property({ id: 1, activityClockAt: daysBefore(NOW, 2) }),
        property({ id: 2, activityClockAt: daysBefore(NOW, days) }),
      ]),
      NOW
    ).chainSummary;

  const day21 = chainAt(21);
  const day22 = chainAt(22);

  record(
    "21/22-day boundary: 21 days not confidence-stale, 22 days stale",
    day21.stale_count === 0 &&
      day21.stale_property_ids.length === 0 &&
      day21.health_status === "stable" &&
      day22.stale_count === 1 &&
      day22.stale_property_ids.join(",") === "2" &&
      day22.health_status !== "stable",
    JSON.stringify({ d21: day21.health_status, d22: day22.health_status })
  );
}

function testRecalculationSchedule() {
  const activityAt = new Date("2026-06-01T09:00:00.000Z");
  const build = () =>
    dataset([
      property({
        id: 1,
        stage: "offer_accepted",
        stageEnteredAt: activityAt.toISOString(),
        genuineLastActivityAt: activityAt.toISOString(),
        activityClockAt: activityAt.toISOString(),
        activityClockSource: "genuine_activity",
      }),
    ]);

  const day2 = deriveOperationalSummaries(
    build(),
    new Date(activityAt.getTime() + 1 * DAY_MS)
  ).chainSummary;
  const plus15 = new Date(activityAt.getTime() + 15 * DAY_MS);
  const plus22 = new Date(activityAt.getTime() + 22 * DAY_MS);

  const afterPageAlert = deriveOperationalSummaries(
    build(),
    new Date(plus15.getTime() + HOUR_MS)
  ).chainSummary;

  const firstRecalc = day2.next_recalculation_at
    ? new Date(day2.next_recalculation_at).getTime()
    : null;
  const secondRecalc = afterPageAlert.next_recalculation_at
    ? new Date(afterPageAlert.next_recalculation_at).getTime()
    : null;

  record(
    "Recalculation without page views: due by activity +15 days, then by +22 days",
    firstRecalc != null &&
      firstRecalc <= plus15.getTime() &&
      secondRecalc != null &&
      secondRecalc <= plus22.getTime() &&
      secondRecalc > plus15.getTime(),
    JSON.stringify({
      first: day2.next_recalculation_at,
      second: afterPageAlert.next_recalculation_at,
    })
  );
}

function testBuyerReady() {
  const unrelatedActivity = daysBefore(NOW, 5);
  const { chainSummary, propertySummaries } = deriveOperationalSummaries(
    dataset(
      [
        property({ id: 1, activityClockAt: daysBefore(NOW, 2) }),
        property({
          id: 2,
          genuineLastActivityAt: unrelatedActivity,
          activityClockAt: unrelatedActivity,
          activityClockSource: "genuine_activity",
        }),
      ],
      [
        buyerReadyNode({
          linked_property_id: 1,
          genuineLastActivityAt: null,
          activityClockAt: daysBefore(NOW, 25),
        }),
      ]
    ),
    NOW
  );
  const anchor = propertySummaries.find((s) => s.property_id === 1)!;
  const unrelated = propertySummaries.find((s) => s.property_id === 2)!;

  const withoutBuyerReady = deriveOperationalSummaries(
    dataset([property({ id: 1, activityClockAt: daysBefore(NOW, 2) })]),
    NOW
  ).chainSummary;
  const freshBuyerReady = deriveOperationalSummaries(
    dataset(
      [property({ id: 1, activityClockAt: daysBefore(NOW, 2) })],
      [buyerReadyNode({ linked_property_id: 1, activityClockAt: daysBefore(NOW, 21) })]
    ),
    NOW
  ).chainSummary;

  record(
    "Buyer Ready: a chain without Buyer Ready, or with Buyer Ready at 21 days, stays Stable",
    withoutBuyerReady.health_status === "stable" &&
      !withoutBuyerReady.buyer_ready_stale &&
      freshBuyerReady.health_status === "stable" &&
      !freshBuyerReady.buyer_ready_stale,
    JSON.stringify([withoutBuyerReady.health_status, freshBuyerReady.health_status])
  );
  record(
    "Buyer Ready: a stalled bottom node makes the chain not Stable",
    chainSummary.buyer_ready_stale &&
      chainSummary.health_status !== "stable",
    chainSummary.health_status
  );
  record(
    "Buyer Ready: anchor property gets the buyer_ready_stale alert",
    anchor.buyer_ready_stale && hasAlert(anchor, "buyer_ready_stale")
  );
  record(
    "Buyer Ready: unrelated property's last_update_at is its own activity only",
    unrelated.last_update_at === unrelatedActivity &&
      !unrelated.buyer_ready_stale &&
      anchor.last_update_at === null
  );

  const nodeActivity = daysBefore(NOW, 1);
  const recent = deriveOperationalSummaries(
    dataset(
      [property({ id: 1, activityClockAt: daysBefore(NOW, 3) })],
      [
        buyerReadyNode({
          linked_property_id: 1,
          genuineLastActivityAt: nodeActivity,
          activityClockAt: nodeActivity,
          activityClockSource: "genuine_activity",
        }),
      ]
    ),
    NOW
  ).propertySummaries[0];

  record(
    "Buyer Ready activity never becomes the property's Last updated",
    recent.last_update_at === null &&
      recent.buyer_ready_last_update === nodeActivity &&
      recent.derived_from_activity_at === nodeActivity
  );
}

function cached(
  overrides: Partial<CachedChainIntelligence>
): CachedChainIntelligence {
  return {
    chain_id: 1,
    summary_state: "fresh",
    computed_at: NOW.toISOString(),
    summary_version: 3,
    health_status: "stable",
    confidence_score: 87,
    confidence_band: "Strong",
    confidence_unavailable: false,
    data_coverage_status: "full",
    coverage_label: null,
    estimated_completion_window: "8–12 weeks",
    next_recalculation_at: daysBefore(NOW, -5),
    blocked_count: 0,
    delay_count: 0,
    stale_count: 0,
    buyer_ready_stale: false,
    requires_replacement_buyer: false,
    bottleneck_property_id: null,
    stale_property_ids: [],
    property_clocks: [],
    ...overrides,
  };
}

function dashboardRow(
  overrides: Partial<AgentBranchPropertySummary>
): AgentBranchPropertySummary {
  return {
    assignment_id: "a",
    branch_id: "b",
    property_id: 1,
    chain_id: 1,
    assignment_status: "active",
    homeowner_only_updates: false,
    assigned_at: "2026-01-01T00:00:00.000Z",
    address: "1 Example Street",
    postcode: "AB1 2CD",
    stage: "searches_ordered",
    property_status: "healthy",
    completion_lifecycle_status: null,
    completion_scheduled_date: null,
    completed_at: null,
    ...overrides,
  };
}

function testMissingNeverHealthy() {
  const chainProperties = [{ id: 1, chainPosition: 1 }];
  const loading = presentCachedChainIntelligence({
    cached: undefined,
    chainProperties,
    scheduledCompletionMode: false,
  });
  const missing = presentCachedChainIntelligence({
    cached: cached({
      summary_state: "missing",
      health_status: null,
      confidence_score: null,
    }),
    chainProperties,
    scheduledCompletionMode: false,
  });

  record(
    "Chain view: missing or loading summary is Calculating, never Stable",
    [loading, missing].every(
      (view) =>
        view.chainHealth === null &&
        view.chainHealthLabel === "Calculating" &&
        view.confidenceScore === null &&
        view.confidenceUnavailable &&
        view.estimatedChainCompletion === "Calculating" &&
        view.bottleneckProperty === null &&
        view.staleProperties.length === 0
    ) &&
      loading.state === "loading" &&
      missing.state === "missing"
  );

  const row = dashboardRow({ summary_state: "missing" });

  record(
    "Dashboard: missing summary is Not yet calculated / pending, never Progressing normally",
    formatSummaryHealthLabel(row) === "Not yet calculated" &&
      getOperationalPriorityTier(row) === "pending" &&
      getManagedPropertyOperationalState(row) !== "Progressing normally" &&
      getCustomerFacingConfidenceScore(row) === null
  );

  const legacyRow = dashboardRow({});

  record(
    "Dashboard: a row without summary_state and without any cached values is missing",
    formatSummaryHealthLabel(legacyRow) === "Not yet calculated"
  );
}

function testParity() {
  const chainSummary = cached({
    health_status: "at_risk",
    confidence_score: 73,
    stale_count: 1,
    stale_property_ids: [2],
    bottleneck_property_id: 2,
    property_clocks: [
      { property_id: 1, activity_clock_at: daysBefore(NOW, 1) },
      { property_id: 2, activity_clock_at: daysBefore(NOW, 23) },
    ],
  });
  const row = dashboardRow({
    summary_state: "fresh",
    health_status: "at_risk",
    confidence_score: 73,
    confidence_unavailable: false,
  });
  const view = presentCachedChainIntelligence({
    cached: chainSummary,
    chainProperties: [
      { id: 1, chainPosition: 1 },
      { id: 2, chainPosition: 2 },
    ],
    scheduledCompletionMode: false,
    referenceDate: NOW,
  });

  record(
    "Parity: Chain view and Dashboard show the same health and confidence from the same cache",
    view.chainHealthLabel === formatSummaryHealthLabel(row) &&
      view.confidenceScore === getCustomerFacingConfidenceScore(row),
    JSON.stringify({
      chain: [view.chainHealthLabel, view.confidenceScore],
      dashboard: [formatSummaryHealthLabel(row), getCustomerFacingConfidenceScore(row)],
    })
  );
  record(
    "Chain view: bottleneck and stale warning map cached IDs onto the viewer's properties with clock days",
    view.bottleneckProperty?.chainPosition === 2 &&
      view.bottleneckProperty.lastUpdatedDays === 23 &&
      view.staleProperties.length === 1 &&
      view.staleProperties[0].lastUpdatedDays === 23 &&
      view.chainHealthMessage === describeChainHealth("At Risk", false)
  );

  const hidden = presentCachedChainIntelligence({
    cached: chainSummary,
    chainProperties: [{ id: 1, chainPosition: 1 }],
    scheduledCompletionMode: false,
    referenceDate: NOW,
  });

  record(
    "Chain view: cached IDs outside the viewer's chain properties are not shown",
    hidden.bottleneckProperty === null && hidden.staleProperties.length === 0
  );

  const stale = presentCachedChainIntelligence({
    cached: cached({ summary_state: "stale" }),
    chainProperties: [],
    scheduledCompletionMode: false,
  });

  record(
    "Chain view: a stale summary keeps its last health (Updating), not Calculating",
    stale.state === "stale" && stale.chainHealthLabel === "Stable"
  );
}

function testChainViewReadsCache() {
  const page = readFileSync(join(ROOT, "app/chain/[chainId]/page.tsx"), "utf8");
  const context = readFileSync(join(ROOT, "context/ChainContext.tsx"), "utf8");

  record(
    "Chain view no longer calculates chain intelligence in the browser",
    !page.includes("computeChainIntelligence(") &&
      page.includes("loadCachedChainIntelligence(") &&
      page.includes("presentCachedChainIntelligence(")
  );
  record(
    "Chain view keeps topology, operational subject lens and activity timeline",
    page.includes("buildChainTopology") &&
      page.includes("applyOperationalSubjectLens") &&
      page.includes("buildChainActivityTimeline(")
  );
  record(
    "Browser never writes summaries; refresh goes through the server route",
    !context.includes("upsert_operational_summaries") &&
      context.includes("requestOperationalSummaryRefresh(")
  );
}

function main() {
  testDayOneDayThree();
  testSystemNoticeDoesNotMoveClock();
  testFallbackClock();
  testPageAlertBoundary();
  testConfidenceBoundary();
  testRecalculationSchedule();
  testBuyerReady();
  testMissingNeverHealthy();
  testParity();
  testChainViewReadsCache();

  const passed = results.filter((result) => result.pass).length;
  console.log(`\n${passed}/${results.length} checks passed.`);

  if (passed !== results.length) {
    process.exitCode = 1;
  }
}

main();
