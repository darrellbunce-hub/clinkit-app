import type {
  AgentBranchPropertySummary,
  AgentDashboardTab,
} from "@/lib/estateAgent/assignmentTypes";

export function classifyAgentDashboardTab(
  summary: AgentBranchPropertySummary
): AgentDashboardTab {
  if (summary.assignment_status === "revoked") {
    return "archived";
  }

  if (
    summary.completion_lifecycle_status ===
    "completed"
  ) {
    return "archived";
  }

  if (summary.completed_at) {
    return "archived";
  }

  return "active";
}

export function filterSummariesByTab(
  summaries: AgentBranchPropertySummary[],
  tab: AgentDashboardTab
): AgentBranchPropertySummary[] {
  return summaries.filter(
    (summary) =>
      classifyAgentDashboardTab(summary) === tab
  );
}

export function computeAgentDashboardStats(
  summaries: AgentBranchPropertySummary[]
) {
  const activeSummaries =
    filterSummariesByTab(summaries, "active");
  const archivedSummaries =
    filterSummariesByTab(summaries, "archived");

  const scheduledCompletions =
    activeSummaries.filter(
      (summary) =>
        summary.completion_lifecycle_status ===
        "scheduled"
    ).length;

  const awaitingConfirmation =
    activeSummaries.filter(
      (summary) =>
        summary.completion_lifecycle_status ===
        "awaiting_confirmation"
    ).length;

  return {
    activeCount: activeSummaries.length,
    archivedCount: archivedSummaries.length,
    scheduledCompletions,
    awaitingConfirmation,
  };
}
