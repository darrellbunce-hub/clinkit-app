import { BUYER_READY_STAGES } from "@/data/buyerReadyStages";
import { STAGES } from "@/data/stages";
import type { AgentBranchPropertySummary } from "@/lib/estateAgent/assignmentTypes";
import { classifyAgentDashboardTab } from "@/lib/estateAgent/classifyAgentDashboard";
import { mapChainHealthSlugToLabel } from "@/lib/operationalSummary/mapHealthStatus";
import {
  getInvitationLifecycleStatus,
  isAwaitingClaimPriority,
  isInvitationExpiredPriority,
} from "@/lib/propertyClaim/invitationPresentation";

export type OperationalPriorityTier =
  | "healthy"
  | "attention"
  | "critical";

export type StoredOperationalAlert = {
  code: string;
  severity: string;
};

export type TodaysOperationsKpis = {
  activeChains: number;
  needsAttention: number;
  critical: number;
  averageConfidence: number | null;
  completingThisWeek: number;
};

export type ClaimOverviewKpis = {
  awaitingClaim: number;
  invitationActive: number;
  invitationExpired: number;
  claimed: number;
};

export type BranchHealthOverview = {
  healthy: number;
  attention: number;
  critical: number;
  confidenceHealthy: number;
  confidenceSlowing: number;
  confidenceLow: number;
};

const CONFIDENCE_HEALTHY_MIN = 70;
const CONFIDENCE_SLOWING_MIN = 40;

const SEVERITY_RANK: Record<string, number> = {
  critical: 3,
  warning: 2,
  info: 1,
};

export function getSummaryAlerts(
  summary: AgentBranchPropertySummary
): StoredOperationalAlert[] {
  return summary.operational_alerts ?? [];
}

export function countAlertsBySeverity(
  alerts: StoredOperationalAlert[],
  severity: string
): number {
  return alerts.filter(
    (alert) => alert.severity === severity
  ).length;
}

export function getOperationalPriorityTier(
  summary: AgentBranchPropertySummary
): OperationalPriorityTier {
  const alerts = getSummaryAlerts(summary);

  if (
    alerts.some(
      (alert) => alert.severity === "critical"
    )
  ) {
    return "critical";
  }

  if (
    summary.needs_attention ||
    alerts.some(
      (alert) => alert.severity === "warning"
    )
  ) {
    return "attention";
  }

  return "healthy";
}

export function getHighestPriorityAlert(
  summary: AgentBranchPropertySummary
): StoredOperationalAlert | null {
  if (summary.next_recommended_action) {
    return summary.next_recommended_action;
  }

  const alerts = getSummaryAlerts(summary);

  if (alerts.length === 0) {
    return null;
  }

  return [...alerts].sort(
    (left, right) =>
      (SEVERITY_RANK[right.severity] ?? 0) -
      (SEVERITY_RANK[left.severity] ?? 0)
  )[0];
}

export function filterActiveSummaries(
  summaries: AgentBranchPropertySummary[]
): AgentBranchPropertySummary[] {
  return summaries.filter(
    (summary) =>
      classifyAgentDashboardTab(summary) ===
      "active"
  );
}

export function filterActionRequiredSummaries(
  summaries: AgentBranchPropertySummary[]
): AgentBranchPropertySummary[] {
  return filterActiveSummaries(summaries).filter(
    (summary) =>
      summary.needs_attention === true ||
      isInvitationExpiredPriority(summary) ||
      isAwaitingClaimPriority(summary)
  );
}

export function sortActionRequiredSummaries(
  summaries: AgentBranchPropertySummary[]
): AgentBranchPropertySummary[] {
  return [...summaries].sort((left, right) => {
    const leftExpired =
      isInvitationExpiredPriority(left);
    const rightExpired =
      isInvitationExpiredPriority(right);

    if (leftExpired !== rightExpired) {
      return leftExpired ? -1 : 1;
    }

    const leftAwaiting =
      isAwaitingClaimPriority(left);
    const rightAwaiting =
      isAwaitingClaimPriority(right);

    if (leftAwaiting !== rightAwaiting) {
      return leftAwaiting ? -1 : 1;
    }

    const leftCritical = countAlertsBySeverity(
      getSummaryAlerts(left),
      "critical"
    );
    const rightCritical = countAlertsBySeverity(
      getSummaryAlerts(right),
      "critical"
    );

    if (leftCritical !== rightCritical) {
      return rightCritical - leftCritical;
    }

    const leftWarning = countAlertsBySeverity(
      getSummaryAlerts(left),
      "warning"
    );
    const rightWarning = countAlertsBySeverity(
      getSummaryAlerts(right),
      "warning"
    );

    if (leftWarning !== rightWarning) {
      return rightWarning - leftWarning;
    }

    return (
      (right.days_since_last_update ?? 0) -
      (left.days_since_last_update ?? 0)
    );
  });
}

export function sortManagedPropertySummaries(
  summaries: AgentBranchPropertySummary[]
): AgentBranchPropertySummary[] {
  return [...summaries].sort((left, right) => {
    const tierRank: Record<
      OperationalPriorityTier,
      number
    > = {
      critical: 3,
      attention: 2,
      healthy: 1,
    };

    const leftTier = getOperationalPriorityTier(
      left
    );
    const rightTier = getOperationalPriorityTier(
      right
    );

    if (tierRank[leftTier] !== tierRank[rightTier]) {
      return (
        tierRank[rightTier] - tierRank[leftTier]
      );
    }

    if (left.needs_attention !== right.needs_attention) {
      return left.needs_attention ? -1 : 1;
    }

    const leftDays =
      left.days_since_last_update ?? 0;
    const rightDays =
      right.days_since_last_update ?? 0;

    if (leftDays !== rightDays) {
      return rightDays - leftDays;
    }

    return 0;
  });
}

export function computeTodaysOperationsKpis(
  summaries: AgentBranchPropertySummary[]
): TodaysOperationsKpis {
  const activeSummaries =
    filterActiveSummaries(summaries);

  const chainIds = new Set(
    activeSummaries.map(
      (summary) => summary.chain_id
    )
  );

  const needsAttention =
    activeSummaries.filter(
      (summary) => summary.needs_attention
    ).length;

  const critical = activeSummaries.filter(
    (summary) =>
      getOperationalPriorityTier(summary) ===
      "critical"
  ).length;

  const confidenceScores = activeSummaries
    .map(
      (summary) => summary.confidence_score
    )
    .filter(
      (score): score is number =>
        typeof score === "number"
    );

  const averageConfidence =
    confidenceScores.length > 0
      ? Math.round(
          confidenceScores.reduce(
            (total, score) => total + score,
            0
          ) / confidenceScores.length
        )
      : null;

  const completingThisWeek =
    activeSummaries.filter((summary) =>
      isCompletingThisWeek(summary)
    ).length;

  return {
    activeChains: chainIds.size,
    needsAttention,
    critical,
    averageConfidence,
    completingThisWeek,
  };
}

export function computeClaimOverviewKpis(
  summaries: AgentBranchPropertySummary[]
): ClaimOverviewKpis {
  const eaSummaries = filterActiveSummaries(
    summaries
  ).filter(
    (summary) =>
      summary.origin_type === "estate_agent"
  );

  const counts = {
    awaitingClaim: 0,
    invitationActive: 0,
    invitationExpired: 0,
    claimed: 0,
  };

  for (const summary of eaSummaries) {
    const status =
      getInvitationLifecycleStatus(summary);

    switch (status) {
      case "claimed":
        counts.claimed += 1;
        break;
      case "invitation_active":
        counts.invitationActive += 1;
        break;
      case "invitation_expired":
        counts.invitationExpired += 1;
        break;
      case "invitation_deferred":
      case "awaiting_claim":
        counts.awaitingClaim += 1;
        break;
      default:
        counts.awaitingClaim += 1;
        break;
    }
  }

  return counts;
}

export function countAwaitingHomeowners(
  summaries: AgentBranchPropertySummary[]
): number {
  const claimKpis =
    computeClaimOverviewKpis(summaries);

  return (
    claimKpis.awaitingClaim +
    claimKpis.invitationActive +
    claimKpis.invitationExpired
  );
}

export function computeBranchHealthOverview(
  summaries: AgentBranchPropertySummary[]
): BranchHealthOverview {
  const activeSummaries =
    filterActiveSummaries(summaries);

  return {
    healthy: activeSummaries.filter(
      (summary) =>
        getOperationalPriorityTier(summary) ===
        "healthy"
    ).length,
    attention: activeSummaries.filter(
      (summary) =>
        getOperationalPriorityTier(summary) ===
        "attention"
    ).length,
    critical: activeSummaries.filter(
      (summary) =>
        getOperationalPriorityTier(summary) ===
        "critical"
    ).length,
    confidenceHealthy: activeSummaries.filter(
      (summary) =>
        typeof summary.confidence_score ===
          "number" &&
        summary.confidence_score >=
          CONFIDENCE_HEALTHY_MIN
    ).length,
    confidenceSlowing: activeSummaries.filter(
      (summary) =>
        typeof summary.confidence_score ===
          "number" &&
        summary.confidence_score >=
          CONFIDENCE_SLOWING_MIN &&
        summary.confidence_score <
          CONFIDENCE_HEALTHY_MIN
    ).length,
    confidenceLow: activeSummaries.filter(
      (summary) =>
        typeof summary.confidence_score ===
          "number" &&
        summary.confidence_score <
          CONFIDENCE_SLOWING_MIN
    ).length,
  };
}

export function filterUpcomingCompletionSummaries(
  summaries: AgentBranchPropertySummary[]
): {
  scheduled: AgentBranchPropertySummary[];
  awaitingConfirmation: AgentBranchPropertySummary[];
} {
  const activeSummaries =
    filterActiveSummaries(summaries);

  return {
    scheduled: activeSummaries.filter(
      (summary) =>
        summary.completion_lifecycle_status ===
          "scheduled" &&
        !!summary.completion_scheduled_date
    ),
    awaitingConfirmation: activeSummaries.filter(
      (summary) =>
        summary.completion_lifecycle_status ===
        "awaiting_confirmation"
    ),
  };
}

export function formatManagedStageLabel(
  stage: string | null | undefined
): string {
  if (!stage) {
    return "Unknown";
  }

  return (
    STAGES.find((entry) => entry.value === stage)
      ?.label ??
    BUYER_READY_STAGES.find(
      (entry) => entry.value === stage
    )?.label ??
    stage.replaceAll("_", " ")
  );
}

export function formatHealthLabel(
  healthStatus: string | null | undefined
): string {
  if (!healthStatus) {
    return "Unknown";
  }

  return mapChainHealthSlugToLabel(
    healthStatus
  );
}

export function formatDaysSinceLastUpdate(
  days: number | null | undefined
): string {
  if (days == null) {
    return "No updates recorded";
  }

  if (days === 0) {
    return "Updated today";
  }

  if (days === 1) {
    return "Updated yesterday";
  }

  return `${days} days since last update`;
}

export function formatCompletionStatus(
  summary: AgentBranchPropertySummary
): string {
  if (
    summary.completion_lifecycle_status ===
    "completed"
  ) {
    return "Completed";
  }

  if (
    summary.completion_lifecycle_status ===
    "awaiting_confirmation"
  ) {
    return "Awaiting confirmation";
  }

  if (
    summary.completion_lifecycle_status ===
      "scheduled" &&
    summary.completion_scheduled_date
  ) {
    return `Scheduled ${summary.completion_scheduled_date}`;
  }

  return "Not scheduled";
}

export function getPriorityTierCardClasses(
  tier: OperationalPriorityTier
): string {
  switch (tier) {
    case "critical":
      return "border-red-200 bg-red-50/40";
    case "attention":
      return "border-amber-200 bg-amber-50/40";
    default:
      return "border-slate-200 bg-white";
  }
}

export function getHealthStatusClasses(
  healthStatus: string | null | undefined
): string {
  switch (healthStatus) {
    case "stable":
      return "bg-status-success-soft text-status-success-text";
    case "active":
      return "bg-status-warning-soft text-status-warning-text";
    case "at_risk":
      return "bg-status-warning-soft text-status-warning-text";
    case "replacement_buyer_required":
      return "bg-status-critical-soft text-status-critical-text";
    default:
      return "bg-status-unknown-soft text-text-muted";
  }
}

function isCompletingThisWeek(
  summary: AgentBranchPropertySummary
): boolean {
  if (
    !summary.completion_scheduled_date ||
    summary.completion_lifecycle_status !==
      "scheduled"
  ) {
    return false;
  }

  const scheduledDate = new Date(
    `${summary.completion_scheduled_date}T00:00:00`
  );

  if (Number.isNaN(scheduledDate.getTime())) {
    return false;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const weekEnd = new Date(today);
  weekEnd.setDate(weekEnd.getDate() + 7);

  return (
    scheduledDate >= today &&
    scheduledDate <= weekEnd
  );
}

export function formatPropertyAddress(
  summary: AgentBranchPropertySummary
): string {
  const address = summary.address?.trim();

  if (address) {
    return address;
  }

  return "Assigned property";
}

export function formatPropertyLocationLine(
  summary: AgentBranchPropertySummary
): string {
  const postcode = summary.postcode?.trim();

  if (postcode) {
    return postcode;
  }

  return `Chain ${summary.chain_id}`;
}
