import type { AgentBranchPropertySummary } from "@/lib/estateAgent/assignmentTypes";
import type { InvitationLifecycleStatus } from "@/lib/propertyClaim/invitationTypes";

export type InvitationStatusBadgeVariant =
  | "claimed"
  | "awaiting_claim"
  | "invitation_active"
  | "invitation_expired"
  | "invitation_deferred"
  | "invitation_declined";

export function getInvitationLifecycleStatus(
  summary: Pick<
    AgentBranchPropertySummary,
    | "origin_type"
    | "claim_status"
    | "invitation_lifecycle_status"
  >
): InvitationLifecycleStatus | null {
  if (summary.origin_type !== "estate_agent") {
    return null;
  }

  if (
    summary.claim_status === "claimed" ||
    summary.invitation_lifecycle_status === "claimed"
  ) {
    return "claimed";
  }

  switch (summary.invitation_lifecycle_status) {
    case "invitation_active":
      return "invitation_active";
    case "invitation_expired":
      return "invitation_expired";
    case "invitation_deferred":
      return "invitation_deferred";
    case "invitation_declined":
      return "invitation_declined";
    case "awaiting_claim":
      return "awaiting_claim";
    default:
      return "awaiting_claim";
  }
}

export function getInvitationStatusBadgeVariant(
  status: InvitationLifecycleStatus
): InvitationStatusBadgeVariant {
  return status;
}

export function getInvitationStatusBadgeLabel(
  status: InvitationLifecycleStatus
): string {
  switch (status) {
    case "claimed":
      return "Claimed";
    case "invitation_active":
      return "Invitation Active";
    case "invitation_expired":
      return "Invitation Expired";
    case "invitation_deferred":
      return "Invitation Deferred";
    case "invitation_declined":
      return "Invitation Declined";
    default:
      return "Awaiting Claim";
  }
}

export function getInvitationStatusBadgeClasses(
  status: InvitationLifecycleStatus
): string {
  switch (status) {
    case "claimed":
      return "bg-green-100 text-green-800";
    case "invitation_active":
      return "bg-amber-100 text-amber-800";
    case "invitation_expired":
      return "bg-red-100 text-red-800";
    case "invitation_deferred":
      return "bg-slate-100 text-slate-700";
    case "invitation_declined":
      return "bg-slate-100 text-slate-700";
    default:
      return "bg-orange-100 text-orange-800";
  }
}

export function getInvitationStatusEmoji(
  status: InvitationLifecycleStatus
): string {
  switch (status) {
    case "claimed":
      return "🟢";
    case "invitation_active":
      return "🟡";
    case "invitation_expired":
      return "🔴";
    case "invitation_deferred":
      return "⚪";
    case "invitation_declined":
      return "⚪";
    default:
      return "🟠";
  }
}

export function formatInvitationExpiryHours(
  hoursRemaining: number | null | undefined
): string {
  if (hoursRemaining == null) {
    return "—";
  }

  return `${hoursRemaining}h`;
}

export function isInvitationExpiredPriority(
  summary: Pick<
    AgentBranchPropertySummary,
    "origin_type" | "invitation_lifecycle_status" | "claim_status"
  >
): boolean {
  return (
    summary.origin_type === "estate_agent" &&
    summary.claim_status !== "claimed" &&
    summary.invitation_lifecycle_status ===
      "invitation_expired"
  );
}

export function isInvitationActivePriority(
  summary: Pick<
    AgentBranchPropertySummary,
    "origin_type" | "invitation_lifecycle_status" | "claim_status"
  >
): boolean {
  return (
    summary.origin_type === "estate_agent" &&
    summary.claim_status !== "claimed" &&
    summary.invitation_lifecycle_status ===
      "invitation_active"
  );
}

export function isInvitationDeclinedPriority(
  summary: Pick<
    AgentBranchPropertySummary,
    "origin_type" | "invitation_lifecycle_status" | "claim_status"
  >
): boolean {
  return (
    summary.origin_type === "estate_agent" &&
    summary.claim_status !== "claimed" &&
    summary.invitation_lifecycle_status ===
      "invitation_declined"
  );
}

export function isUnacknowledgedInvitationDeclinedPriority(
  summary: Pick<
    AgentBranchPropertySummary,
    | "origin_type"
    | "invitation_lifecycle_status"
    | "claim_status"
    | "invitation_rejection_acknowledged_at"
  >
): boolean {
  return (
    isInvitationDeclinedPriority(summary) &&
    summary.invitation_rejection_acknowledged_at == null
  );
}

export function isReadyToInvitePriority(
  summary: Pick<
    AgentBranchPropertySummary,
    "origin_type" | "invitation_lifecycle_status" | "claim_status"
  >
): boolean {
  return (
    summary.origin_type === "estate_agent" &&
    summary.claim_status !== "claimed" &&
    summary.invitation_lifecycle_status !==
      "invitation_active" &&
    summary.invitation_lifecycle_status !==
      "invitation_expired" &&
    summary.invitation_lifecycle_status !==
      "invitation_deferred" &&
    summary.invitation_lifecycle_status !==
      "invitation_declined" &&
    (summary.invitation_lifecycle_status ===
      "awaiting_claim" ||
      summary.invitation_lifecycle_status == null)
  );
}

export function isInvitationDeferred(
  summary: Pick<
    AgentBranchPropertySummary,
    "origin_type" | "invitation_lifecycle_status" | "claim_status"
  >
): boolean {
  return (
    summary.origin_type === "estate_agent" &&
    summary.claim_status !== "claimed" &&
    summary.invitation_lifecycle_status ===
      "invitation_deferred"
  );
}

export function isAwaitingClaimPriority(
  summary: Pick<
    AgentBranchPropertySummary,
    "origin_type" | "invitation_lifecycle_status" | "claim_status"
  >
): boolean {
  return (
    isReadyToInvitePriority(summary) ||
    isInvitationActivePriority(summary)
  );
}
