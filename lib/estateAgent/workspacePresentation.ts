import type { AgentBranchPropertySummary } from "@/lib/estateAgent/assignmentTypes";
import {
  computeBranchHealthOverview,
  computeTodaysOperationsKpis,
  countAwaitingHomeowners,
  filterActionRequiredSummaries,
  filterUpcomingCompletionSummaries,
  getHighestPriorityAlert,
} from "@/lib/estateAgent/commandCentrePresentation";
import type { InvitationLifecycleStatus } from "@/lib/propertyClaim/invitationTypes";
import {
  getInvitationLifecycleStatus,
  isAwaitingClaimPriority,
  isInvitationDeferred,
  isInvitationExpiredPriority,
} from "@/lib/propertyClaim/invitationPresentation";

export type OperationalHealthLevel =
  | "normal"
  | "attention"
  | "critical";

export type BriefKpiTone =
  | "neutral"
  | "attention"
  | "critical"
  | "positive";

export type OperationalBriefKpi = {
  label: string;
  value: string;
  tone: BriefKpiTone;
};

export type OperationalBriefModel = {
  healthLevel: OperationalHealthLevel;
  healthHeadline: string;
  summarySentence: string;
  activeTransactions: number;
  kpis: OperationalBriefKpi[];
};

export function getOperationalHealthHeadline(
  level: OperationalHealthLevel
): string {
  switch (level) {
    case "critical":
      return "Critical operational issues detected";
    case "attention":
      return "Operational attention required";
    default:
      return "Branch operating normally";
  }
}

export function getOperationalHealthSummarySentence(
  level: OperationalHealthLevel
): string {
  switch (level) {
    case "critical":
      return "Several transactions need immediate operational review.";
    case "attention":
      return "Several transactions would benefit from operational attention.";
    default:
      return "Most managed properties are progressing normally.";
  }
}

export function resolveOperationalHealthLevel(
  summaries: AgentBranchPropertySummary[]
): OperationalHealthLevel {
  const branchHealth =
    computeBranchHealthOverview(summaries);

  if (branchHealth.critical > 0) {
    return "critical";
  }

  const actionRequiredCount =
    filterActionRequiredSummaries(summaries).length;

  if (
    actionRequiredCount > 0 ||
    branchHealth.attention > 0
  ) {
    return "attention";
  }

  return "normal";
}

export function buildOperationalBriefModel(
  summaries: AgentBranchPropertySummary[]
): OperationalBriefModel {
  const operationsKpis =
    computeTodaysOperationsKpis(summaries);
  const actionRequired =
    filterActionRequiredSummaries(summaries);
  const upcoming =
    filterUpcomingCompletionSummaries(summaries);
  const awaitingHomeowners =
    countAwaitingHomeowners(summaries);

  const upcomingCompletions =
    upcoming.scheduled.length +
    upcoming.awaitingConfirmation.length;

  const healthLevel =
    resolveOperationalHealthLevel(summaries);

  const requiresActionTone: BriefKpiTone =
    actionRequired.length > 0
      ? healthLevel === "critical"
        ? "critical"
        : "attention"
      : "positive";

  return {
    healthLevel,
    healthHeadline:
      getOperationalHealthHeadline(healthLevel),
    summarySentence:
      getOperationalHealthSummarySentence(
        healthLevel
      ),
    activeTransactions:
      operationsKpis.activeChains,
    kpis: [
      {
        label: "Requires action",
        value: String(actionRequired.length),
        tone: requiresActionTone,
      },
      {
        label: "Awaiting homeowners",
        value: String(awaitingHomeowners),
        tone:
          awaitingHomeowners > 0
            ? "attention"
            : "neutral",
      },
      {
        label: "Upcoming completions",
        value: String(upcomingCompletions),
        tone:
          upcomingCompletions > 0
            ? "neutral"
            : "neutral",
      },
      {
        label: "Average confidence",
        value:
          operationsKpis.averageConfidence == null
            ? "—"
            : `${operationsKpis.averageConfidence}%`,
        tone: "neutral",
      },
    ],
  };
}

export function getHomeownerConnectionStatusLabel(
  status: InvitationLifecycleStatus | null
): string {
  switch (status) {
    case "claimed":
      return "Homeowner connected";
    case "invitation_active":
      return "Invitation active";
    case "invitation_expired":
      return "Invitation expired";
    case "invitation_deferred":
      return "Invitation deferred";
    default:
      return "Awaiting homeowner";
  }
}

export function getHomeownerConnectionStatusClasses(
  status: InvitationLifecycleStatus | null
): string {
  switch (status) {
    case "claimed":
      return "text-green-700 bg-green-50 ring-1 ring-green-200/60";
    case "invitation_active":
      return "text-amber-800 bg-amber-50 ring-1 ring-amber-200/60";
    case "invitation_expired":
      return "text-red-800 bg-red-50 ring-1 ring-red-200/60";
    case "invitation_deferred":
      return "text-slate-700 bg-slate-100 ring-1 ring-slate-200/60";
    default:
      return "text-slate-700 bg-slate-100 ring-1 ring-slate-200/60";
  }
}

const WORKSPACE_ALERT_REASONS: Record<string, string> =
  {
    stale_update:
      "No updates received recently",
    delay_reported:
      "A delay has been reported on this transaction",
    buyer_ready_stale:
      "Buyer Ready requires attention",
    buyer_ready_delayed:
      "Buyer Ready requires attention",
    completion_awaiting_confirmation:
      "Completion awaiting confirmation",
    chain_confidence_low:
      "Chain confidence has reduced",
    broken_connection:
      "A chain connection requires attention",
    property_blocked:
      "This property is blocked",
  };

export function getWorkspaceAlertReason(
  code: string,
  daysSinceLastUpdate?: number | null
): string {
  if (
    code === "stale_update" &&
    typeof daysSinceLastUpdate === "number" &&
    daysSinceLastUpdate > 0
  ) {
    return `No updates received for ${daysSinceLastUpdate} day${
      daysSinceLastUpdate === 1 ? "" : "s"
    }`;
  }

  return (
    WORKSPACE_ALERT_REASONS[code] ??
    code.replaceAll("_", " ")
  );
}

function buildReasonCandidates(
  summary: AgentBranchPropertySummary
): string[] {
  const reasons: string[] = [];

  if (isInvitationExpiredPriority(summary)) {
    reasons.push("Invitation expired");
  }

  if (isAwaitingClaimPriority(summary)) {
    reasons.push(
      "No homeowner invitation has been sent"
    );
  }

  for (const alert of summary.operational_alerts ??
    []) {
    reasons.push(
      getWorkspaceAlertReason(
        alert.code,
        summary.days_since_last_update
      )
    );
  }

  if (
    summary.completion_lifecycle_status ===
    "awaiting_confirmation"
  ) {
    reasons.push(
      "Completion awaiting confirmation"
    );
  }

  if (
    reasons.length === 0 &&
    summary.needs_attention
  ) {
    reasons.push(
      "This transaction needs operational attention"
    );
  }

  return reasons;
}

export function getPrimaryActionRequiredReason(
  summary: AgentBranchPropertySummary
): string | null {
  const reasons = buildReasonCandidates(summary);

  if (reasons.length === 0) {
    return null;
  }

  const priorityOrder = [
    "Invitation expired",
    "Completion awaiting confirmation",
    "Buyer Ready requires attention",
    "No homeowner invitation has been sent",
  ];

  for (const preferred of priorityOrder) {
    const match = reasons.find(
      (reason) => reason === preferred
    );

    if (match) {
      return match;
    }
  }

  const staleReason = reasons.find((reason) =>
    reason.startsWith("No updates received for")
  );

  if (staleReason) {
    return staleReason;
  }

  return reasons[0] ?? null;
}

export function getSupportingActionRequiredReasons(
  summary: AgentBranchPropertySummary
): string[] {
  const reasons = buildReasonCandidates(summary);
  const primary =
    getPrimaryActionRequiredReason(summary);

  if (!primary) {
    return [];
  }

  return reasons.filter(
    (reason) => reason !== primary
  );
}

export function getActionRequiredReasons(
  summary: AgentBranchPropertySummary
): string[] {
  const primary =
    getPrimaryActionRequiredReason(summary);

  if (!primary) {
    return [];
  }

  return [
    primary,
    ...getSupportingActionRequiredReasons(
      summary
    ),
  ];
}

export function formatInvitationExpiryCountdown(
  hoursRemaining: number | null | undefined
): string {
  if (hoursRemaining == null) {
    return "Expiry unavailable";
  }

  if (hoursRemaining <= 1) {
    return "Expires within 1 hour";
  }

  return `${hoursRemaining} hours remaining`;
}

export function getInvitationPanelStatusLabel(
  state:
    | "none"
    | "active"
    | "expired"
    | "claimed"
    | "deferred"
): string {
  switch (state) {
    case "active":
      return "Invitation active";
    case "expired":
      return "Invitation expired";
    case "claimed":
      return "Homeowner connected";
    case "deferred":
      return "Invitation deferred";
    default:
      return "No invitation sent";
  }
}

export function formatScheduledCompletionDate(
  date: string | null | undefined
): string {
  if (!date) {
    return "Date not set";
  }

  const parsed = new Date(`${date}T00:00:00`);

  if (Number.isNaN(parsed.getTime())) {
    return date;
  }

  return parsed.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function getCompletionConfirmationLabel(
  summary: AgentBranchPropertySummary
): string {
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
    return "Scheduled";
  }

  return "Not scheduled";
}

export function getHomeownerStatusForSummary(
  summary: Pick<
    AgentBranchPropertySummary,
    | "origin_type"
    | "claim_status"
    | "invitation_lifecycle_status"
  >
): InvitationLifecycleStatus | null {
  return getInvitationLifecycleStatus(summary);
}

export function getBriefHealthIndicatorClasses(
  level: OperationalHealthLevel
): string {
  switch (level) {
    case "critical":
      return "bg-red-500";
    case "attention":
      return "bg-amber-500";
    default:
      return "bg-green-500";
  }
}

export function getBriefKpiToneClasses(
  tone: BriefKpiTone
): string {
  switch (tone) {
    case "critical":
      return "text-red-700";
    case "attention":
      return "text-amber-700";
    case "positive":
      return "text-green-700";
    default:
      return "text-slate-900";
  }
}

export function getBriefKpiIndicatorClasses(
  tone: BriefKpiTone
): string {
  switch (tone) {
    case "critical":
      return "bg-red-500";
    case "attention":
      return "bg-amber-500";
    case "positive":
      return "bg-green-500";
    default:
      return "bg-slate-400";
  }
}

export function getManagedPropertyOperationalState(
  summary: AgentBranchPropertySummary
): string {
  const homeownerStatus =
    getHomeownerStatusForSummary(summary);

  if (
    summary.origin_type === "estate_agent" &&
    homeownerStatus &&
    homeownerStatus !== "claimed"
  ) {
    return getHomeownerConnectionStatusLabel(
      homeownerStatus
    );
  }

  const topAlert = getHighestPriorityAlert(summary);

  if (topAlert) {
    return getWorkspaceAlertReason(
      topAlert.code,
      summary.days_since_last_update
    );
  }

  if (summary.needs_attention) {
    return "Operational attention required";
  }

  return "Progressing normally";
}

export function isDeferredInvitationSummary(
  summary: Pick<
    AgentBranchPropertySummary,
    | "origin_type"
    | "claim_status"
    | "invitation_lifecycle_status"
  >
): boolean {
  return isInvitationDeferred(summary);
}
