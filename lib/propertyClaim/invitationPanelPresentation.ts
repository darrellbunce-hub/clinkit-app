import type { PropertyInvitationStatus } from "@/lib/propertyClaim/invitationTypes";

export type HomeownerInvitationPanelPhase =
  | "ready"
  | "awaiting_claim"
  | "expired"
  | "declined"
  | "not_ready"
  | "connected";

export function getHomeownerInvitationPanelPhase(
  status: Extract<PropertyInvitationStatus, { ok: true }>
): HomeownerInvitationPanelPhase {
  switch (status.state) {
    case "claimed":
      return "connected";
    case "active":
      return "awaiting_claim";
    case "expired":
      return "expired";
    case "declined":
      return "declined";
    case "deferred":
      return "not_ready";
    default:
      return "ready";
  }
}

export function getHomeownerInvitationPillLabel(
  phase: HomeownerInvitationPanelPhase
): string {
  switch (phase) {
    case "ready":
      return "READY TO INVITE";
    case "awaiting_claim":
      return "INVITATION ACTIVE";
    case "expired":
      return "INVITATION EXPIRED";
    case "declined":
      return "INVITATION DECLINED";
    case "not_ready":
      return "NOT READY";
    case "connected":
      return "CONNECTED";
  }
}

export function getHomeownerInvitationPillClasses(
  phase: HomeownerInvitationPanelPhase
): string {
  switch (phase) {
    case "connected":
      return "bg-status-success-soft text-status-success-text ring-1 ring-status-success/20";
    case "awaiting_claim":
      return "bg-status-warning-soft text-status-warning-text ring-1 ring-status-warning/20";
    case "expired":
      return "bg-status-critical-soft text-status-critical-text ring-1 ring-status-critical/20";
    case "declined":
      return "bg-status-unknown-soft text-text-muted ring-1 ring-surface-card-border";
    case "not_ready":
      return "bg-status-unknown-soft text-text-muted ring-1 ring-surface-card-border";
    default:
      return "bg-surface-mist text-text-charcoal ring-1 ring-surface-card-border";
  }
}

export function getHomeownerInvitationHeadline(
  status: Extract<PropertyInvitationStatus, { ok: true }>
): string {
  const phase = getHomeownerInvitationPanelPhase(status);

  switch (phase) {
    case "ready":
      return "Ready to invite this homeowner.";
    case "awaiting_claim":
      if (status.state === "active" && !status.emailSent) {
        return "Invitation active — email not yet sent.";
      }

      return "Waiting for homeowner to claim.";
    case "expired":
      return "Invitation expired.";
    case "declined":
      return "Homeowner declined this invitation.";
    case "not_ready":
      return "Invitation paused.";
    case "connected":
      return "Homeowner connected.";
  }
}

export function hasActiveInvitationRecord(
  status: Extract<PropertyInvitationStatus, { ok: true }>
): boolean {
  return status.state === "active";
}
