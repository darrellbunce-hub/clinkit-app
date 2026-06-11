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
  findSearchingPlaceholderLinkedFromSale,
  getChainTileDisplayTitle,
  isContextualPurchaseProperty,
  isNonOperationalPropertyTarget,
  isOperationalSaleProperty,
  isViewOnlyPurchaseTile,
  OPERATIONAL_EDIT_DENIED_MESSAGE,
  resolveOperationalPosition,
  VIEW_ONLY_PURCHASE_MESSAGE,
} from "@/lib/operationalPosition";

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
  chainNodes: OperationalBuyerReadyNode[]
): boolean {
  return canMutatePropertyTarget(
    property,
    userId,
    chainProperties,
    chainNodes
  );
}

export function canEditBuyerReady(
  nodeId: number,
  chainId: number,
  userId: string | null | undefined,
  chainProperties: OperationalProperty[],
  chainNodes: OperationalBuyerReadyNode[]
): boolean {
  return canMutateBuyerReadyTarget(
    nodeId,
    chainId,
    userId,
    chainProperties,
    chainNodes
  );
}
