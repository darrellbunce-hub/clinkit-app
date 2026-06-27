import type { AccountType } from "@/lib/accountType";
import {
  getOperationalBuyerReadyHeadline,
  getOperationalSaleChainHeadline,
} from "@/lib/operationalPosition";
import type { WorkflowAccessMode, WorkflowViewerRole } from "@/lib/workflowPermissions";

export type OperationalWorkspaceSurface =
  | "property"
  | "buyer_ready";

export type OperationalUpdateKind =
  | "property_stage"
  | "buyer_ready_stage"
  | "structured_update";

export function getOperationalWorkspaceTitle(params: {
  surface: OperationalWorkspaceSurface;
  isOperationalDisplay: boolean;
  viewerRole: WorkflowViewerRole;
}): string {
  if (
    params.viewerRole === "estate_agent" &&
    params.isOperationalDisplay
  ) {
    return "Managing Transaction";
  }

  if (!params.isOperationalDisplay) {
    return params.surface === "buyer_ready"
      ? "Buyer Ready"
      : "Property";
  }

  return params.surface === "buyer_ready"
    ? getOperationalBuyerReadyHeadline()
    : getOperationalSaleChainHeadline();
}

export function getOperationalWorkspaceSubtitle(params: {
  surface: OperationalWorkspaceSurface;
  isOperationalDisplay: boolean;
  viewerRole: WorkflowViewerRole;
  canEdit: boolean;
}): string {
  if (
    params.viewerRole === "estate_agent" &&
    params.isOperationalDisplay
  ) {
    return params.canEdit
      ? "Delegated operational management"
      : "Viewing the operational workspace for this transaction";
  }

  if (params.isOperationalDisplay && params.canEdit) {
    return params.surface === "buyer_ready"
      ? "This is your Buyer Ready step in the chain. You can update progress here."
      : "This is your sale in the chain. You can update progress here.";
  }

  if (params.isOperationalDisplay) {
    return params.surface === "buyer_ready"
      ? "This is your Buyer Ready step in the chain."
      : "This is your sale in the chain.";
  }

  return "Connected chain position";
}

export function getOperationalEditingModeLabel(
  mode: WorkflowAccessMode
): "Owner" | "Delegated" | "View only" {
  switch (mode) {
    case "editable":
      return "Owner";
    case "read_only":
      return "View only";
    default:
      return "View only";
  }
}

export function getOperationalEditingModeLabelForViewer(params: {
  viewerRole: WorkflowViewerRole;
  mode: WorkflowAccessMode;
}): "Owner" | "Delegated" | "View only" {
  if (
    params.viewerRole === "estate_agent" &&
    params.mode === "editable"
  ) {
    return "Delegated";
  }

  if (params.mode === "editable") {
    return "Owner";
  }

  return "View only";
}

export function getOperationalUpdateSuccessMessage(
  accountType: AccountType | null | undefined,
  kind: OperationalUpdateKind
): string {
  if (accountType === "estate_agent") {
    switch (kind) {
      case "property_stage":
        return "Status updated on behalf of the operational owner.";
      case "buyer_ready_stage":
        return "Buyer Ready status updated on behalf of the operational owner.";
      case "structured_update":
        return "Update recorded on behalf of the operational owner.";
    }
  }

  switch (kind) {
    case "property_stage":
      return "Property status updated successfully.";
    case "buyer_ready_stage":
      return "Buyer Ready status updated successfully.";
    case "structured_update":
      return "Update shared with the chain.";
  }
}

export function formatOperationalManagerLabel(
  companyName: string | null | undefined,
  branchName: string | null | undefined
): string {
  const company = companyName?.trim();
  const branch = branchName?.trim();

  if (company && branch) {
    return `${company} · ${branch}`;
  }

  return company || branch || "Operational manager";
}

export const OPERATIONAL_OWNER_FALLBACK_LABEL =
  "Operational owner";

export const OPERATIONAL_MANAGER_FALLBACK_LABEL =
  "Operational manager";
