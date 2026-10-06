import type { AgentBranchPropertySummary } from "@/lib/estateAgent/assignmentTypes";
import type { OperationalPriorityTier } from "@/lib/estateAgent/commandCentrePresentation";
import {
  computeBranchHealthOverview,
  computeTodaysOperationsKpis,
  countAwaitingHomeowners,
  filterActionRequiredSummaries,
  filterUpcomingCompletionSummaries,
  getHighestPriorityAlert,
  hasLiveStaleActivityClock,
  isSummaryMissing,
  resolveDaysOnActivityClock,
} from "@/lib/estateAgent/commandCentrePresentation";
import type { InvitationLifecycleStatus } from "@/lib/propertyClaim/invitationTypes";
import { INVITATION_DECLINED_ACTION_REASON } from "@/lib/propertyClaim/invitationDeclinedPresentation";
import {
  getInvitationLifecycleStatus,
  isInvitationActivePriority,
  isInvitationDeclinedPriority,
  isInvitationDeferred,
  isInvitationEligibleSummary,
  isInvitationExpiredPriority,
  isReadyToInvitePriority,
  isUnacknowledgedInvitationDeclinedPriority,
} from "@/lib/propertyClaim/invitationPresentation";

export type OperationalHealthLevel =
  | "normal"
  | "pending"
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
  healthStatusLabel: string;
  healthHeadline: string;
  summarySentence: string;
  reassuranceSentence: string;
  activeTransactions: number;
  kpis: OperationalBriefKpi[];
};

export function getOperationalHealthStatusLabel(
  level: OperationalHealthLevel
): string {
  switch (level) {
    case "critical":
      return "IMMEDIATE ACTION REQUIRED";
    case "attention":
      return "ATTENTION REQUIRED";
    case "pending":
      return "CALCULATING";
    default:
      return "OPERATING NORMALLY";
  }
}

export function getOperationalHealthHeadline(
  level: OperationalHealthLevel
): string {
  switch (level) {
    case "critical":
      return "Immediate operational action required";
    case "attention":
      return "Attention required";
    case "pending":
      return "Operational status is being calculated";
    default:
      return "Branch operating normally";
  }
}

function formatTransactionCount(count: number): string {
  return `${count} transaction${count === 1 ? "" : "s"}`;
}

export function getOperationalHealthSummarySentence(
  level: OperationalHealthLevel,
  actionRequiredCount: number,
  activeTransactions: number,
  pendingCount = 0
): string {
  switch (level) {
    case "critical":
      return `${formatTransactionCount(actionRequiredCount)} need immediate review`;
    case "attention":
      return `${formatTransactionCount(actionRequiredCount)} require${actionRequiredCount === 1 ? "s" : ""} attention`;
    case "pending":
      return `${formatTransactionCount(pendingCount)} not yet calculated`;
    default:
      return `${formatTransactionCount(activeTransactions)} progressing normally`;
  }
}

export function getOperationalHealthReassuranceSentence(
  level: OperationalHealthLevel,
  actionRequiredCount: number,
  activeTransactions: number
): string {
  if (
    level === "normal" &&
    actionRequiredCount === 0
  ) {
    return "Nothing requires your attention today.";
  }

  if (
    actionRequiredCount > 0 &&
    actionRequiredCount < activeTransactions
  ) {
    return "Everything else is operating normally.";
  }

  if (
    level === "critical" &&
    actionRequiredCount > 0 &&
    actionRequiredCount < activeTransactions
  ) {
    return "Review critical items first, then check remaining transactions.";
  }

  return "";
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

  if (branchHealth.pending > 0) {
    return "pending";
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
  const pendingCount =
    computeBranchHealthOverview(summaries).pending;

  const requiresActionTone: BriefKpiTone =
    actionRequired.length > 0
      ? healthLevel === "critical"
        ? "critical"
        : "attention"
      : "positive";

  return {
    healthLevel,
    healthStatusLabel:
      getOperationalHealthStatusLabel(healthLevel),
    healthHeadline:
      getOperationalHealthHeadline(healthLevel),
    summarySentence:
      getOperationalHealthSummarySentence(
        healthLevel,
        actionRequired.length,
        operationsKpis.activeChains,
        pendingCount
      ),
    reassuranceSentence:
      getOperationalHealthReassuranceSentence(
        healthLevel,
        actionRequired.length,
        operationsKpis.activeChains
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
    case "invitation_declined":
      return "Invitation declined";
    default:
      return "Awaiting homeowner";
  }
}

export function getHomeownerConnectionStatusClasses(
  status: InvitationLifecycleStatus | null
): string {
  switch (status) {
    case "claimed":
      return "bg-status-success-soft text-status-success-text ring-1 ring-status-success/20";
    case "invitation_active":
      return "bg-status-warning-soft text-status-warning-text ring-1 ring-status-warning/20";
    case "invitation_expired":
      return "bg-status-critical-soft text-status-critical-text ring-1 ring-status-critical/20";
    case "invitation_deferred":
      return "bg-status-unknown-soft text-text-muted ring-1 ring-surface-card-border";
    case "invitation_declined":
      return "bg-status-unknown-soft text-text-muted ring-1 ring-surface-card-border";
    default:
      return "bg-surface-mist text-text-charcoal ring-1 ring-surface-card-border";
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

  if (isUnacknowledgedInvitationDeclinedPriority(summary)) {
    reasons.push(INVITATION_DECLINED_ACTION_REASON);
  }

  if (isInvitationActivePriority(summary)) {
    reasons.push("Awaiting homeowner claim");
  }

  if (isReadyToInvitePriority(summary)) {
    reasons.push("Invite homeowner");
  }

  const alerts = summary.operational_alerts ?? [];

  for (const alert of alerts) {
    reasons.push(
      getWorkspaceAlertReason(
        alert.code,
        resolveDaysOnActivityClock(summary)
      )
    );
  }

  if (
    hasLiveStaleActivityClock(summary) &&
    !alerts.some((alert) => alert.code === "stale_update")
  ) {
    reasons.push(
      getWorkspaceAlertReason(
        "stale_update",
        resolveDaysOnActivityClock(summary)
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
    INVITATION_DECLINED_ACTION_REASON,
    "Awaiting homeowner claim",
    "Completion awaiting confirmation",
    "Buyer Ready requires attention",
    "Invite homeowner",
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
      return "bg-status-critical";
    case "attention":
      return "bg-status-warning";
    case "pending":
      return "bg-status-unknown";
    default:
      return "bg-status-success";
  }
}

export function getBriefHealthHeroClasses(
  level: OperationalHealthLevel
): {
  panel: string;
  accent: string;
  icon: string;
  headline: string;
  indicator: string;
} {
  switch (level) {
    case "critical":
      return {
        panel: "bg-status-critical-soft/55",
        accent: "border-status-critical",
        icon: "text-status-critical",
        headline: "text-status-critical-text",
        indicator: "bg-status-critical",
      };
    case "attention":
      return {
        panel: "bg-status-warning-soft/60",
        accent: "border-status-warning",
        icon: "text-status-warning",
        headline: "text-status-warning-text",
        indicator: "bg-status-warning",
      };
    case "pending":
      return {
        panel: "bg-status-unknown-soft",
        accent: "border-surface-card-border",
        icon: "text-text-muted",
        headline: "text-text-charcoal",
        indicator: "bg-status-unknown",
      };
    default:
      return {
        panel: "bg-status-success-soft/55",
        accent: "border-status-success",
        icon: "text-status-success",
        headline: "text-status-success-text",
        indicator: "bg-status-success",
      };
  }
}

export function getBriefKpiToneClasses(
  tone: BriefKpiTone
): string {
  switch (tone) {
    case "critical":
      return "text-status-critical";
    case "attention":
      return "text-status-warning";
    case "positive":
      return "text-status-success";
    default:
      return "text-text-charcoal";
  }
}

export function getBriefKpiIndicatorClasses(
  tone: BriefKpiTone
): string {
  switch (tone) {
    case "critical":
      return "bg-status-critical";
    case "attention":
      return "bg-status-warning";
    case "positive":
      return "bg-status-success";
    default:
      return "bg-status-unknown";
  }
}

export function getActionReasonBannerClasses(
  tier: OperationalPriorityTier
): {
  container: string;
  icon: string;
  text: string;
} {
  switch (tier) {
    case "critical":
      return {
        container: "bg-status-critical-soft ring-1 ring-status-critical/15",
        icon: "text-status-critical",
        text: "text-status-critical-text",
      };
    case "attention":
      return {
        container: "bg-status-warning-soft ring-1 ring-status-warning/15",
        icon: "text-status-warning",
        text: "text-status-warning-text",
      };
    default:
      return {
        container: "bg-surface-mist ring-1 ring-surface-card-border",
        icon: "text-brand-primary",
        text: "text-text-charcoal",
      };
  }
}

import { confidenceBand } from "@/lib/chainIntelligence/presentation";

export function getConfidenceBarFillClass(
  score: number
): string {
  const band = confidenceBand(score);

  switch (band) {
    case "Strong":
      return "bg-status-success";
    case "Good":
      return "bg-emerald-500";
    case "Monitor":
      return "bg-status-warning";
    default:
      return "bg-status-critical";
  }
}

export function getConfidenceLabel(score: number): string {
  const band = confidenceBand(score);

  if (band === "Monitor") {
    return "Monitor";
  }

  return band;
}

export function getManagedPropertyOperationalState(
  summary: AgentBranchPropertySummary
): string {
  if (
    isInvitationEligibleSummary(summary) &&
    isInvitationDeclinedPriority(summary)
  ) {
    return "Homeowner declined invitation";
  }

  const topAlert = getHighestPriorityAlert(summary);

  if (topAlert) {
    return getWorkspaceAlertReason(
      topAlert.code,
      resolveDaysOnActivityClock(summary)
    );
  }

  if (hasLiveStaleActivityClock(summary)) {
    return getWorkspaceAlertReason(
      "stale_update",
      resolveDaysOnActivityClock(summary)
    );
  }

  if (summary.needs_attention) {
    return "Needs attention";
  }

  if (isSummaryMissing(summary)) {
    return MANAGED_PROPERTY_CALCULATING_STATE;
  }

  return "Progressing normally";
}

export const MANAGED_PROPERTY_CALCULATING_STATE =
  "Calculating operational status";

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
