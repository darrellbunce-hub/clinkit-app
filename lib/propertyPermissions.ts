import {
  canMutateBuyerReadyTarget,
  canMutatePropertyTarget,
  OPERATIONAL_EDIT_DENIED_MESSAGE,
  resolveOperationalPosition,
  type OperationalBuyerReadyNode,
  type OperationalProperty,
  type OperationalPosition,
  type ResolveOperationalPositionResult,
  VIEW_ONLY_PURCHASE_MESSAGE,
} from "@/lib/operationalPosition";

export {
  canMutateBuyerReadyTarget,
  canMutatePropertyTarget,
  CHAIN_TILE_LABEL,
  CONNECTED_POSITION_MESSAGE,
  findSearchingPlaceholderLinkedFromSale,
  getChainTileDisplayTitle,
  getDashboardChainTitle,
  getDashboardPropertyLabel,
  getHomeownerPropertyLabel,
  getParticipantPropertyLabel,
  isPrimaryHomeownerProperty,
  shouldShowHomeownerAddress,
  getOperationalBuyerReadyHeadline,
  getOperationalSaleChainHeadline,
  getPropertyPageHeadline,
  getPropertyPageSubtitle,
  isContextualPurchaseProperty,
  isNonOperationalPropertyTarget,
  isOperationalSaleProperty,
  isOperationalSaleTile,
  isViewOnlyPurchaseTile,
  OPERATIONAL_BUYER_READY_BANNER_MESSAGE,
  OPERATIONAL_EDIT_DENIED_MESSAGE,
  OPERATIONAL_SALE_BANNER_MESSAGE,
  resolveDashboardOperationalPropertyId,
  resolveOperationalSalePropertyId,
  resolveOperationalPosition,
  VIEW_ONLY_PURCHASE_MESSAGE,
} from "@/lib/operationalPosition";

export {
  findBuyerReadyNodeForChain,
  formatActivityUpdaterLabel,
  getBuyerReadyActionMessage,
  getBuyerReadyStatusDescription,
  resolveWorkflowAccess,
  WORKFLOW_EA_DELEGATED_BANNER_MESSAGE,
  WORKFLOW_READ_ONLY_BANNER_MESSAGE,
} from "@/lib/workflowPermissions";

export type {
  WorkflowAccess,
  WorkflowAccessMode,
  WorkflowKind,
  WorkflowPermissionContext,
  WorkflowTarget,
  WorkflowViewerRole,
} from "@/lib/workflowPermissions";

export type {
  OperationalBuyerReadyNode,
  OperationalProperty,
  OperationalPosition,
  ResolveOperationalPositionResult,
};

/** @deprecated Use OPERATIONAL_EDIT_DENIED_MESSAGE */
export const PROPERTY_EDIT_DENIED_MESSAGE =
  OPERATIONAL_EDIT_DENIED_MESSAGE;

/**
 * Application-facing gate for property mutations.
 * Participant-centric: only the user's Sale operational position is editable.
 */
export function canEditProperty(
  property: OperationalProperty | null | undefined,
  userId: string | null | undefined,
  chainProperties: OperationalProperty[],
  chainNodes: OperationalBuyerReadyNode[],
  mutationContext?: import("@/lib/mutationPermission").MutationPermissionContext
): boolean {
  return canMutatePropertyTarget(
    property,
    userId,
    chainProperties,
    chainNodes,
    mutationContext
  );
}

export function canEditBuyerReady(
  nodeId: number,
  chainId: number,
  userId: string | null | undefined,
  chainProperties: OperationalProperty[],
  chainNodes: OperationalBuyerReadyNode[],
  mutationContext?: import("@/lib/mutationPermission").MutationPermissionContext
): boolean {
  return canMutateBuyerReadyTarget(
    nodeId,
    chainId,
    userId,
    chainProperties,
    chainNodes,
    mutationContext
  );
}
