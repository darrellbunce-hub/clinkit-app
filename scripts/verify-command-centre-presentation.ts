import type { AgentBranchPropertySummary } from "../lib/estateAgent/assignmentTypes";
import {
  computeTodaysOperationsKpis,
  filterActionRequiredSummaries,
  getOperationalPriorityTier,
  sortActionRequiredSummaries,
  sortManagedPropertySummaries,
} from "../lib/estateAgent/commandCentrePresentation";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

function summary(
  overrides: Partial<AgentBranchPropertySummary> &
    Pick<
      AgentBranchPropertySummary,
      "assignment_id" | "property_id" | "chain_id"
    >
): AgentBranchPropertySummary {
  return {
    branch_id: "branch-1",
    assignment_status: "active",
    homeowner_only_updates: false,
    assigned_at: "2026-01-01T00:00:00.000Z",
    address: "10 Example Street",
    postcode: "AB1 2CD",
    stage: "searches_ordered",
    property_status: "healthy",
    completion_lifecycle_status: null,
    completion_scheduled_date: null,
    completed_at: null,
    ...overrides,
  };
}

function testActionRequiredFilter() {
  const rows = [
    summary({
      assignment_id: "a",
      property_id: 1,
      chain_id: 10,
      needs_attention: true,
    }),
    summary({
      assignment_id: "b",
      property_id: 2,
      chain_id: 11,
      needs_attention: false,
    }),
  ];

  assert(
    filterActionRequiredSummaries(rows).length ===
      1,
    "only needs_attention rows should appear in action required"
  );
}

function testActionRequiredSorting() {
  const rows = sortActionRequiredSummaries([
    summary({
      assignment_id: "warning",
      property_id: 1,
      chain_id: 10,
      needs_attention: true,
      days_since_last_update: 5,
      operational_alerts: [
        { code: "delay_reported", severity: "warning" },
      ],
    }),
    summary({
      assignment_id: "critical",
      property_id: 2,
      chain_id: 11,
      needs_attention: true,
      days_since_last_update: 2,
      operational_alerts: [
        { code: "broken_connection", severity: "critical" },
      ],
    }),
  ]);

  assert(
    rows[0]?.assignment_id === "critical",
    "critical alerts should sort ahead of warning alerts"
  );
}

function testManagedSorting() {
  const rows = sortManagedPropertySummaries([
    summary({
      assignment_id: "healthy",
      property_id: 1,
      chain_id: 10,
      needs_attention: false,
      days_since_last_update: 1,
    }),
    summary({
      assignment_id: "critical",
      property_id: 2,
      chain_id: 11,
      needs_attention: true,
      operational_alerts: [
        { code: "property_blocked", severity: "critical" },
      ],
      days_since_last_update: 10,
    }),
  ]);

  assert(
    rows[0]?.assignment_id === "critical",
    "critical managed properties should sort first"
  );
}

function testKpiAggregation() {
  const kpis = computeTodaysOperationsKpis([
    summary({
      assignment_id: "a",
      property_id: 1,
      chain_id: 10,
      needs_attention: true,
      confidence_score: 80,
      completion_lifecycle_status: "scheduled",
      completion_scheduled_date: new Date(
        Date.now() + 2 * 86400000
      )
        .toISOString()
        .slice(0, 10),
      operational_alerts: [
        { code: "stale_update", severity: "critical" },
      ],
    }),
    summary({
      assignment_id: "b",
      property_id: 2,
      chain_id: 11,
      confidence_score: 60,
    }),
  ]);

  assert(kpis.activeChains === 2, "active chain count");
  assert(kpis.needsAttention === 1, "needs attention count");
  assert(kpis.critical === 1, "critical count");
  assert(kpis.averageConfidence === 70, "average confidence");
  assert(kpis.completingThisWeek === 1, "completing this week count");
}

function testPriorityTierFromSummaryAlerts() {
  const tier = getOperationalPriorityTier(
    summary({
      assignment_id: "a",
      property_id: 1,
      chain_id: 10,
      operational_alerts: [
        { code: "delay_reported", severity: "warning" },
      ],
    })
  );

  assert(tier === "attention", "warning alerts map to attention tier");
}

const tests = [
  ["action required filter", testActionRequiredFilter],
  ["action required sorting", testActionRequiredSorting],
  ["managed sorting", testManagedSorting],
  ["kpi aggregation", testKpiAggregation],
  ["priority tier mapping", testPriorityTierFromSummaryAlerts],
] as const;

for (const [name, run] of tests) {
  run();
  console.log(`PASS ${name}`);
}

console.log(`\n${tests.length}/${tests.length} command centre presentation checks passed.`);
