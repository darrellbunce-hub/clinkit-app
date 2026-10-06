import type { AgentBranchPropertySummary } from "../lib/estateAgent/assignmentTypes";
import {
  filterActionRequiredSummaries,
  formatSummaryHealthLabel,
  getCustomerFacingConfidenceScore,
  hasLiveStaleActivityClock,
  isSummaryUpdating,
  resolveDaysSinceLastUpdate,
} from "../lib/estateAgent/commandCentrePresentation";
import {
  buildOperationalBriefModel,
  getHomeownerConnectionStatusLabel,
  getManagedPropertyOperationalState,
  getPrimaryActionRequiredReason,
  getWorkspaceAlertReason,
  resolveOperationalHealthLevel,
} from "../lib/estateAgent/workspacePresentation";
import { isInvitationDeferred } from "../lib/propertyClaim/invitationPresentation";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

function londonNoonDaysAgo(days: number): string {
  const [year, month, day] = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
  })
    .format(new Date())
    .split("-")
    .map(Number);
  return new Date(Date.UTC(year, month - 1, day - days, 12)).toISOString();
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

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

function clockDaysAgo(days: number): string {
  return new Date(Date.now() - days * DAY_MS - HOUR_MS).toISOString();
}

function calculated(
  overrides: Parameters<typeof summary>[0]
): AgentBranchPropertySummary {
  return summary({
    summary_state: "fresh",
    health_status: "stable",
    confidence_score: 90,
    needs_attention: false,
    activity_clock_at: clockDaysAgo(2),
    activity_clock_source: "genuine_activity",
    last_update_at: clockDaysAgo(2),
    ...overrides,
  });
}

function testOperationalBriefHero() {
  const brief = buildOperationalBriefModel([
    calculated({
      assignment_id: "a",
      property_id: 1,
      chain_id: 10,
      origin_type: "estate_agent",
      claim_status: "claimed",
      invitation_lifecycle_status: "claimed",
    }),
  ]);

  assert(
    brief.healthLevel === "normal",
    "healthy branch level"
  );
  assert(
    brief.kpis.length === 4,
    "brief includes four KPI tiles"
  );
  assert(
    brief.healthStatusLabel.length > 0,
    "brief health status label"
  );
  assert(
    brief.healthHeadline.length > 0,
    "brief health headline"
  );
  assert(
    brief.summarySentence.includes("transaction"),
    "brief summary uses transaction count"
  );
}

function testDeferredExcludesActionRequired() {
  const deferred = summary({
    assignment_id: "deferred",
    property_id: 1,
    chain_id: 10,
    origin_type: "estate_agent",
    claim_status: "unclaimed",
    invitation_lifecycle_status:
      "invitation_deferred",
    needs_attention: false,
  });

  assert(
    isInvitationDeferred(deferred),
    "deferred lifecycle detected"
  );
  assert(
    filterActionRequiredSummaries([deferred])
      .length === 0,
    "deferred alone should not require action"
  );
  assert(
    getHomeownerConnectionStatusLabel(
      "invitation_deferred"
    ) === "Invitation deferred",
    "deferred homeowner label"
  );
}

function testPrimaryActionReason() {
  const reason = getPrimaryActionRequiredReason(
    summary({
      assignment_id: "a",
      property_id: 1,
      chain_id: 10,
      origin_type: "estate_agent",
      claim_status: "unclaimed",
      invitation_lifecycle_status:
        "awaiting_claim",
      last_update_at: londonNoonDaysAgo(18),
      operational_alerts: [
        { code: "stale_update", severity: "warning" },
      ],
    })
  );

  assert(
    reason === "Invite homeowner",
    "invitation reason takes priority over stale"
  );

  const staleReason = getPrimaryActionRequiredReason(
    summary({
      assignment_id: "b",
      property_id: 2,
      chain_id: 11,
      origin_type: "estate_agent",
      claim_status: "unclaimed",
      invitation_lifecycle_status:
        "invitation_deferred",
      last_update_at: londonNoonDaysAgo(18),
      operational_alerts: [
        { code: "stale_update", severity: "warning" },
      ],
    })
  );

  assert(
    staleReason ===
      "No updates received for 18 days",
    "stale reason includes day count"
  );
}

function testHealthLevelCritical() {
  assert(
    resolveOperationalHealthLevel([
      summary({
        assignment_id: "a",
        property_id: 1,
        chain_id: 10,
        operational_alerts: [
          {
            code: "broken_connection",
            severity: "critical",
          },
        ],
      }),
    ]) === "critical",
    "critical alerts elevate health level"
  );
}

function testWorkspaceAlertReasons() {
  assert(
    getWorkspaceAlertReason(
      "buyer_ready_stale"
    ) === "Buyer Ready requires attention",
    "buyer ready reason"
  );
  assert(
    getWorkspaceAlertReason(
      "stale_update",
      3
    ) === "No updates received for 3 days",
    "stale reason with days"
  );
}

function testManagedDeclinedState() {
  const declined = summary({
    assignment_id: "declined",
    property_id: 3,
    chain_id: 12,
    origin_type: "estate_agent",
    claim_status: "unclaimed",
    invitation_lifecycle_status: "invitation_declined",
  });

  assert(
    getManagedPropertyOperationalState(declined) ===
      "Homeowner declined invitation",
    "managed tile shows declined state"
  );
}

function testMissingSummaryIsNeverHealthy() {
  const missing = summary({
    assignment_id: "missing",
    property_id: 4,
    chain_id: 13,
    origin_type: "estate_agent",
    claim_status: "claimed",
    invitation_lifecycle_status: "claimed",
    summary_state: "missing",
    activity_clock_at: clockDaysAgo(2),
    activity_clock_source: "property_record_created",
  });

  assert(
    getManagedPropertyOperationalState(missing) ===
      "Calculating operational status",
    "missing summary shows calculating state"
  );
  assert(
    getManagedPropertyOperationalState(missing) !==
      "Progressing normally",
    "missing summary is never progressing normally"
  );
  assert(
    resolveOperationalHealthLevel([missing]) === "pending",
    "missing summary makes the branch level pending, not normal"
  );
  assert(
    formatSummaryHealthLabel(missing) === "Not yet calculated",
    "missing summary health label"
  );
  assert(
    getCustomerFacingConfidenceScore(missing) == null,
    "missing summary has no confidence"
  );
}

function testLiveStalenessSafetyNet() {
  const day14 = calculated({
    assignment_id: "d14",
    property_id: 5,
    chain_id: 14,
    activity_clock_at: clockDaysAgo(14),
    activity_clock_source: "stage_entered_at",
    last_update_at: null,
  });
  const day15 = calculated({
    assignment_id: "d15",
    property_id: 6,
    chain_id: 15,
    activity_clock_at: clockDaysAgo(15),
    activity_clock_source: "stage_entered_at",
    last_update_at: null,
  });

  assert(
    !hasLiveStaleActivityClock(day14) &&
      getManagedPropertyOperationalState(day14) ===
        "Progressing normally",
    "14 days on the clock is not stale"
  );
  assert(
    hasLiveStaleActivityClock(day15) &&
      filterActionRequiredSummaries([day15]).length === 1,
    "15 days on the fallback clock requires action without a cached alert"
  );
  assert(
    getManagedPropertyOperationalState(day15).startsWith(
      "No updates received for"
    ),
    "15-day fallback clock shows the stale wording"
  );
  assert(
    resolveDaysSinceLastUpdate(day15) == null,
    "fallback clock never becomes Last updated"
  );

  const scheduled = calculated({
    assignment_id: "sched",
    property_id: 7,
    chain_id: 16,
    activity_clock_at: clockDaysAgo(30),
    completion_lifecycle_status: "scheduled",
    completion_scheduled_date: "2026-12-01",
  });

  assert(
    !hasLiveStaleActivityClock(scheduled),
    "scheduled completion suppresses the live stale safety net"
  );

  const updating = calculated({
    assignment_id: "upd",
    property_id: 8,
    chain_id: 17,
    summary_state: "stale",
  });

  assert(
    isSummaryUpdating(updating) &&
      formatSummaryHealthLabel(updating) === "Stable",
    "stale summary keeps its last health and shows Updating"
  );
}

const tests = [
  ["operational brief hero", testOperationalBriefHero],
  ["missing summary is never healthy", testMissingSummaryIsNeverHealthy],
  ["live staleness safety net", testLiveStalenessSafetyNet],
  [
    "deferred excludes action required",
    testDeferredExcludesActionRequired,
  ],
  [
    "primary action reason",
    testPrimaryActionReason,
  ],
  ["health level critical", testHealthLevelCritical],
  [
    "workspace alert reasons",
    testWorkspaceAlertReasons,
  ],
  ["managed declined state", testManagedDeclinedState],
] as const;

for (const [name, run] of tests) {
  run();
  console.log(`PASS ${name}`);
}

console.log(
  `\n${tests.length}/${tests.length} workspace presentation checks passed.`
);
