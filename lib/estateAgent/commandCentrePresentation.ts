import { BUYER_READY_STAGES } from "@/data/buyerReadyStages";
import { STAGES } from "@/data/stages";
import {
  STALE_DAYS_CONFIDENCE,
  STALE_DAYS_PAGE_ALERT,
  wholeDaysSinceTimestamp,
} from "@/lib/activityIntelligence";
import type {
  AgentBranchPropertySummary,
  OperationalSummaryState,
} from "@/lib/estateAgent/assignmentTypes";
import { classifyAgentDashboardTab } from "@/lib/estateAgent/classifyAgentDashboard";
import { isChainInScheduledCompletionMode } from "@/lib/completionLifecycle";
import { mapChainHealthSlugToLabel } from "@/lib/operationalSummary/mapHealthStatus";
import {
  getInvitationLifecycleStatus,
  isInvitationActivePriority,
  isInvitationEligibleSummary,
  isInvitationExpiredPriority,
  isReadyToInvitePriority,
  isUnacknowledgedInvitationDeclinedPriority,
} from "@/lib/propertyClaim/invitationPresentation";
import { toCustomerFacingConfidenceScore } from "@/lib/chainIntelligence/presentation";

export type OperationalPriorityTier =
  | "healthy"
  | "pending"
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

export function getCustomerFacingConfidenceScore(
  summary: Pick<
    AgentBranchPropertySummary,
    "confidence_score" | "confidence_unavailable" | "summary_state"
  >
): number | null {
  if (
    summary.confidence_unavailable ||
    summary.summary_state === "missing"
  ) {
    return null;
  }

  return toCustomerFacingConfidenceScore(
    summary.confidence_score ?? null
  );
}

export type ClaimOverviewKpis = {
  awaitingClaim: number;
  invitationActive: number;
  invitationExpired: number;
  invitationDeclined: number;
  claimed: number;
};

export type BranchHealthOverview = {
  healthy: number;
  pending: number;
  attention: number;
  critical: number;
  confidenceHealthy: number;
  confidenceSlowing: number;
  confidenceLow: number;
};

const CONFIDENCE_STRONG_MIN = 85;
const CONFIDENCE_MONITOR_MIN = 50;

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

export function getSummaryState(
  summary: Pick<
    AgentBranchPropertySummary,
    "summary_state" | "health_status" | "confidence_score"
  >
): OperationalSummaryState {
  if (summary.summary_state) {
    return summary.summary_state;
  }

  return summary.health_status == null &&
    summary.confidence_score == null
    ? "missing"
    : "fresh";
}

export function isSummaryMissing(
  summary: AgentBranchPropertySummary
): boolean {
  return getSummaryState(summary) === "missing";
}

/** Whole days on the live activity clock; null without a clock. */
export function resolveActivityClockDays(
  summary: Pick<
    AgentBranchPropertySummary,
    "activity_clock_at" | "last_update_at"
  >,
  referenceDate: Date = new Date()
): number | null {
  return wholeDaysSinceTimestamp(
    summary.activity_clock_at ?? summary.last_update_at,
    referenceDate
  );
}

/**
 * Live safety net, independent of the cached summary: the activity clock has
 * passed the 14-day alert threshold outside scheduled completion.
 */
export function hasLiveStaleActivityClock(
  summary: AgentBranchPropertySummary,
  referenceDate: Date = new Date()
): boolean {
  if (
    isChainInScheduledCompletionMode({
      completionLifecycleStatus:
        summary.completion_lifecycle_status,
      completionScheduledDate:
        summary.completion_scheduled_date,
    })
  ) {
    return false;
  }

  const days = resolveActivityClockDays(
    summary,
    referenceDate
  );

  return days != null && days > STALE_DAYS_PAGE_ALERT;
}

function hasLiveCriticalActivityClock(
  summary: AgentBranchPropertySummary,
  referenceDate: Date = new Date()
): boolean {
  if (!hasLiveStaleActivityClock(summary, referenceDate)) {
    return false;
  }

  const days = resolveActivityClockDays(
    summary,
    referenceDate
  );

  return days != null && days > STALE_DAYS_CONFIDENCE;
}

/** Cached needs_attention, or the live 14-day activity clock. */
export function summaryRequiresOperationalAction(
  summary: AgentBranchPropertySummary
): boolean {
  return (
    summary.needs_attention === true ||
    hasLiveStaleActivityClock(summary)
  );
}

export function getOperationalPriorityTier(
  summary: AgentBranchPropertySummary
): OperationalPriorityTier {
  const alerts = getSummaryAlerts(summary);

  if (
    alerts.some(
      (alert) => alert.severity === "critical"
    ) ||
    hasLiveCriticalActivityClock(summary)
  ) {
    return "critical";
  }

  if (
    summaryRequiresOperationalAction(summary) ||
    alerts.some(
      (alert) => alert.severity === "warning"
    )
  ) {
    return "attention";
  }

  if (isSummaryMissing(summary)) {
    return "pending";
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
      summaryRequiresOperationalAction(summary) ||
      isInvitationExpiredPriority(summary) ||
      isInvitationActivePriority(summary) ||
      isReadyToInvitePriority(summary) ||
      isUnacknowledgedInvitationDeclinedPriority(summary)
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

    const leftDeclined =
      isUnacknowledgedInvitationDeclinedPriority(left);
    const rightDeclined =
      isUnacknowledgedInvitationDeclinedPriority(right);

    if (leftDeclined !== rightDeclined) {
      return leftDeclined ? -1 : 1;
    }

    const leftActive =
      isInvitationActivePriority(left);
    const rightActive =
      isInvitationActivePriority(right);

    if (leftActive !== rightActive) {
      return leftActive ? -1 : 1;
    }

    const leftReady =
      isReadyToInvitePriority(left);
    const rightReady =
      isReadyToInvitePriority(right);

    if (leftReady !== rightReady) {
      return leftReady ? -1 : 1;
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

    return compareLeastRecentlyUpdatedFirst(left, right);
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
      critical: 4,
      attention: 3,
      pending: 2,
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

    const leftAction = summaryRequiresOperationalAction(left);
    const rightAction = summaryRequiresOperationalAction(right);

    if (leftAction !== rightAction) {
      return leftAction ? -1 : 1;
    }

    return compareLeastRecentlyUpdatedFirst(left, right);
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

  const needsAttention = activeSummaries.filter(
    summaryRequiresOperationalAction
  ).length;

  const critical = activeSummaries.filter(
    (summary) =>
      getOperationalPriorityTier(summary) ===
      "critical"
  ).length;

  const confidenceScores = activeSummaries
    .map((summary) =>
      getCustomerFacingConfidenceScore(summary)
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
  ).filter(isInvitationEligibleSummary);

  const counts = {
    awaitingClaim: 0,
    invitationActive: 0,
    invitationExpired: 0,
    invitationDeclined: 0,
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
      case "invitation_declined":
        counts.invitationDeclined += 1;
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
    pending: activeSummaries.filter(
      (summary) =>
        getOperationalPriorityTier(summary) ===
        "pending"
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
      (summary) => {
        const score =
          getCustomerFacingConfidenceScore(summary);
        return (
          score != null &&
          score >= CONFIDENCE_STRONG_MIN
        );
      }
    ).length,
    confidenceSlowing: activeSummaries.filter(
      (summary) => {
        const score =
          getCustomerFacingConfidenceScore(summary);
        return (
          score != null &&
          score >= CONFIDENCE_MONITOR_MIN &&
          score < CONFIDENCE_STRONG_MIN
        );
      }
    ).length,
    confidenceLow: activeSummaries.filter(
      (summary) => {
        const score =
          getCustomerFacingConfidenceScore(summary);
        return (
          score != null && score < CONFIDENCE_MONITOR_MIN
        );
      }
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

export const SUMMARY_NOT_YET_CALCULATED_LABEL =
  "Not yet calculated";

export const SUMMARY_UPDATING_LABEL = "Updating";

/** A missing summary never presents a health status. */
export function formatSummaryHealthLabel(
  summary: AgentBranchPropertySummary
): string {
  if (isSummaryMissing(summary)) {
    return SUMMARY_NOT_YET_CALCULATED_LABEL;
  }

  return formatHealthLabel(summary.health_status);
}

export function getSummaryHealthStatusClasses(
  summary: AgentBranchPropertySummary
): string {
  return getHealthStatusClasses(
    isSummaryMissing(summary)
      ? null
      : summary.health_status
  );
}

export function isSummaryUpdating(
  summary: AgentBranchPropertySummary
): boolean {
  return getSummaryState(summary) === "stale";
}

const MS_PER_DAY = 1000 * 60 * 60 * 24;

const LONDON_CALENDAR_DATE = new Intl.DateTimeFormat(
  "en-GB",
  {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }
);

function londonCalendarDayNumber(date: Date): number {
  const parts = LONDON_CALENDAR_DATE.formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((entry) => entry.type === type)?.value);

  return (
    Date.UTC(part("year"), part("month") - 1, part("day")) /
    MS_PER_DAY
  );
}

/**
 * Europe/London calendar days since the latest genuine property activity
 * (last_update_at, derived from activity history by the dashboard view).
 * Null when the property has no genuine activity.
 */
export function resolveDaysSinceLastUpdate(
  summary: Pick<AgentBranchPropertySummary, "last_update_at">,
  referenceDate: Date = new Date()
): number | null {
  if (!summary.last_update_at) {
    return null;
  }

  const updatedAt = new Date(summary.last_update_at);

  if (Number.isNaN(updatedAt.getTime())) {
    return null;
  }

  return Math.max(
    0,
    londonCalendarDayNumber(referenceDate) -
      londonCalendarDayNumber(updatedAt)
  );
}

/**
 * Europe/London calendar days on the live activity clock (genuine activity,
 * else stage entry / creation). Used for staleness wording only; "Last
 * updated" stays on genuine activity.
 */
export function resolveDaysOnActivityClock(
  summary: Pick<
    AgentBranchPropertySummary,
    "activity_clock_at" | "last_update_at"
  >,
  referenceDate: Date = new Date()
): number | null {
  return resolveDaysSinceLastUpdate(
    {
      last_update_at:
        summary.activity_clock_at ?? summary.last_update_at ?? null,
    },
    referenceDate
  );
}

/** Sort comparator: least recently updated first; no genuine activity sorts oldest. */
export function compareLeastRecentlyUpdatedFirst(
  left: Pick<AgentBranchPropertySummary, "last_update_at">,
  right: Pick<AgentBranchPropertySummary, "last_update_at">
): number {
  const leftDays =
    resolveDaysSinceLastUpdate(left) ??
    Number.POSITIVE_INFINITY;
  const rightDays =
    resolveDaysSinceLastUpdate(right) ??
    Number.POSITIVE_INFINITY;

  if (leftDays === rightDays) {
    return 0;
  }

  return leftDays > rightDays ? -1 : 1;
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
    case "pending":
      return "border-slate-200 bg-slate-50/60";
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
