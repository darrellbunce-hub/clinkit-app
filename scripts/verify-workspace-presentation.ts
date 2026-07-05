import type { AgentBranchPropertySummary } from "../lib/estateAgent/assignmentTypes";
import { filterActionRequiredSummaries } from "../lib/estateAgent/commandCentrePresentation";
import {
  buildOperationalBriefModel,
  getHomeownerConnectionStatusLabel,
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

function testOperationalBriefHero() {
  const brief = buildOperationalBriefModel([
    summary({
      assignment_id: "a",
      property_id: 1,
      chain_id: 10,
      needs_attention: false,
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
      days_since_last_update: 18,
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
      days_since_last_update: 18,
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

const tests = [
  ["operational brief hero", testOperationalBriefHero],
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
] as const;

for (const [name, run] of tests) {
  run();
  console.log(`PASS ${name}`);
}

console.log(
  `\n${tests.length}/${tests.length} workspace presentation checks passed.`
);
