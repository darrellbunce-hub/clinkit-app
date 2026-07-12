import type { EaBranchMemberRole } from "@/lib/estateAgent/types";

export function formatEaBranchMemberRoleLabel(
  role: EaBranchMemberRole
): string {
  switch (role) {
    case "branch_admin":
      return "Owner";
    case "agent":
      return "Staff";
    default:
      return "Staff";
  }
}

export function formatEaBranchMemberStatusLabel(
  status: "active" | "pending" | "expired" | "inactive"
): string {
  switch (status) {
    case "active":
      return "Active";
    case "pending":
      return "Pending Invitation";
    case "expired":
      return "Invitation Expired";
    case "inactive":
      return "Inactive";
    default:
      return "Unknown";
  }
}

export function getEaBranchMemberStatusClasses(
  status: "active" | "pending" | "expired" | "inactive"
): string {
  switch (status) {
    case "active":
      return "bg-status-success-soft text-status-success-text ring-1 ring-status-success/20";
    case "pending":
      return "bg-status-warning-soft text-status-warning-text ring-1 ring-status-warning/20";
    case "expired":
      return "bg-status-unknown-soft text-text-muted ring-1 ring-surface-card-border";
    case "inactive":
      return "bg-slate-100 text-slate-600 ring-1 ring-slate-200";
    default:
      return "bg-surface-mist text-text-muted ring-1 ring-surface-card-border";
  }
}
