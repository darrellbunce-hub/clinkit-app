import type { AgentBranchPropertySummary } from "../lib/estateAgent/assignmentTypes";
import {
  getEstateAgentManagementModeForOperationalAssignment,
  getEstateAgentManagementModePresentation,
  getEstateAgentManagementModePresentationFromSummary,
  resolveEstateAgentManagementMode,
} from "../lib/estateAgent/managementModePresentation";

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

function testAwaitingHomeownerBeforeClaim() {
  const presentation =
    getEstateAgentManagementModePresentationFromSummary(
      summary({
        assignment_id: "ea-unclaimed",
        property_id: 1,
        chain_id: 10,
        origin_type: "estate_agent",
        claim_status: "unclaimed",
        homeowner_only_updates: false,
      })
    );

  assert(
    presentation.mode === "awaiting_homeowner",
    "EA-originated unclaimed property is awaiting homeowner"
  );
  assert(
    presentation.badge === "⏳ Awaiting Homeowner",
    "awaiting homeowner badge label"
  );
  assert(
    presentation.editable === true,
    "EA can edit while awaiting homeowner claim"
  );
}

function testSharedManagementAfterClaim() {
  const presentation =
    getEstateAgentManagementModePresentationFromSummary(
      summary({
        assignment_id: "shared",
        property_id: 2,
        chain_id: 11,
        origin_type: "estate_agent",
        claim_status: "claimed",
        homeowner_only_updates: false,
      })
    );

  assert(
    presentation.mode === "shared_management",
    "claimed property with shared updates"
  );
  assert(
    presentation.badge === "🟢 Shared Management",
    "shared management badge label"
  );
  assert(
    presentation.editable === true,
    "EA can edit under shared management"
  );
}

function testHomeownerManagingReadOnly() {
  const presentation =
    getEstateAgentManagementModePresentationFromSummary(
      summary({
        assignment_id: "homeowner-only",
        property_id: 3,
        chain_id: 12,
        origin_type: "homeowner",
        claim_status: "claimed",
        homeowner_only_updates: true,
      })
    );

  assert(
    presentation.mode === "homeowner_managing",
    "claimed property with homeowner-only updates"
  );
  assert(
    presentation.badge === "🔒 Homeowner Managing",
    "homeowner managing badge label"
  );
  assert(
    presentation.editable === false,
    "EA is read-only when homeowner manages updates"
  );
}

function testDashboardAndWorkspaceParity() {
  const dashboardPresentation =
    getEstateAgentManagementModePresentationFromSummary(
      summary({
        assignment_id: "parity",
        property_id: 4,
        chain_id: 13,
        origin_type: "estate_agent",
        claim_status: "claim_invited",
        homeowner_only_updates: false,
      })
    );

  const workspacePresentation =
    getEstateAgentManagementModeForOperationalAssignment({
      homeownerOnlyUpdates: false,
      claimStatus: "claim_invited",
    });

  assert(
    workspacePresentation != null,
    "workspace assignment resolves management mode"
  );

  const workspace = workspacePresentation!;

  assert(
    dashboardPresentation.mode === workspace.mode,
    "dashboard and workspace share the same mode"
  );
  assert(
    dashboardPresentation.badge === workspace.badge,
    "dashboard and workspace share the same badge"
  );
  assert(
    dashboardPresentation.editable === workspace.editable,
    "dashboard and workspace share the same editable flag"
  );
}

function testResolveModeFromAssignmentFields() {
  assert(
    resolveEstateAgentManagementMode({
      claimStatus: "claimed",
      homeownerOnlyUpdates: false,
    }) === "shared_management",
    "assignment fields resolve shared management"
  );

  const homeownerOriginatedShared =
    getEstateAgentManagementModePresentation({
      claim_status: "claimed",
      homeowner_only_updates: false,
      origin_type: "homeowner",
    });

  assert(
    homeownerOriginatedShared.mode === "shared_management",
    "homeowner-originated delegated property uses shared management"
  );
}

function main() {
  testAwaitingHomeownerBeforeClaim();
  testSharedManagementAfterClaim();
  testHomeownerManagingReadOnly();
  testDashboardAndWorkspaceParity();
  testResolveModeFromAssignmentFields();

  console.log(
    "verify-management-mode-presentation: 5/5 passed"
  );
}

main();
