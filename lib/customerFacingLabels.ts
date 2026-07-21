import type { WorkflowViewerRole } from "@/lib/workflowPermissions";
import { KEYNETIC_TAGLINE } from "@/lib/theme/logoAssets";

export { KEYNETIC_TAGLINE };

/** Homeowner chain health panel label (supersedes FD-038 homeowner presentation). */
export const CHAIN_STATUS_LABEL = "Chain status";

export const CHAIN_STATUS_EXPLAINER =
  "Reflects stale updates, reported delays, or connection issues that may need attention. Separate from Chain Confidence, which reflects timing health for steps where reliable timing data is available.";

export function getOperationalContextOwnerLabel(
  viewerRole: WorkflowViewerRole
): string {
  return viewerRole === "estate_agent"
    ? "Operational owner"
    : "Managed by";
}

export function getOperationalContextManagerLabel(
  viewerRole: WorkflowViewerRole
): string {
  return viewerRole === "estate_agent"
    ? "Operational manager"
    : "Your estate agent";
}

export function getOperationalOwnerDisplayFallback(
  viewerRole: WorkflowViewerRole
): string {
  return viewerRole === "estate_agent"
    ? "Operational owner"
    : "You manage this property";
}

export function getActionAlertBadgeLabel(
  viewerRole: WorkflowViewerRole
): string {
  return viewerRole === "estate_agent"
    ? "Operational alert"
    : "Attention needed";
}

export function getNextMilestoneHint(
  viewerRole: WorkflowViewerRole
): string {
  return viewerRole === "estate_agent"
    ? "This is typically the next operational milestone in the property transaction."
    : "This is typically the next milestone in your property transaction.";
}

export function getShareUpdatesIntro(
  viewerRole: WorkflowViewerRole
): string {
  return viewerRole === "estate_agent"
    ? "Share operational updates with the chain."
    : "Share updates with the chain.";
}

export function getActivityHistoryIntro(
  viewerRole: WorkflowViewerRole
): string {
  return viewerRole === "estate_agent"
    ? "Structured updates and operational events recorded for this transaction."
    : "Structured updates recorded for this property.";
}

export function getActivityHistoryEmptyState(
  viewerRole: WorkflowViewerRole
): string {
  return viewerRole === "estate_agent"
    ? "Operational updates will appear here as this transaction progresses."
    : "Updates will appear here as your property progresses.";
}
