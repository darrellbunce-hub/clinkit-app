import type { ChainNodesChainSummary } from "@/lib/chainNodesSummary";

/**
 * Upstream purchaser presentation — anchor-relative to the operational sale.
 *
 * Phase 1: Awaiting Buyer (render-time).
 * Phase 2: Buyer Ready (chain_nodes summary anchored to operational sale).
 * Phase 3: Connected Buyer (future).
 */

export type UpstreamPurchaserAwaitingBuyer = {
  kind: "awaiting_buyer";
  anchorPropertyId: number;
};

export type UpstreamPurchaserBuyerReady = {
  kind: "buyer_ready";
  anchorPropertyId: number;
  summary: ChainNodesChainSummary;
};

export type UpstreamPurchaserState =
  | UpstreamPurchaserAwaitingBuyer
  | UpstreamPurchaserBuyerReady
  | null;

export type UpstreamPurchaserAnchorProperty = {
  id: number;
  buyer_connected: boolean;
};

export type ResolveUpstreamPurchaserParams = {
  operationalSalePropertyId: number | null;
  chainProperties: UpstreamPurchaserAnchorProperty[];
  buyerReadyForAnchor: ChainNodesChainSummary | null;
};

/**
 * Resolves the upstream purchaser tile for the operational sale anchor.
 *
 * Precedence:
 * 1. buyer_connected === false → Awaiting Buyer
 * 2. buyer_connected === true + buyer_ready for anchor → Buyer Ready
 * 3. else → null
 */
export function resolveUpstreamPurchaserState(
  params: ResolveUpstreamPurchaserParams
): UpstreamPurchaserState {
  const {
    operationalSalePropertyId,
    chainProperties,
    buyerReadyForAnchor,
  } = params;

  if (operationalSalePropertyId == null) {
    return null;
  }

  const anchorProperty = chainProperties.find(
    (property) =>
      property.id === operationalSalePropertyId
  );

  if (!anchorProperty) {
    return null;
  }

  if (!anchorProperty.buyer_connected) {
    return {
      kind: "awaiting_buyer",
      anchorPropertyId: operationalSalePropertyId,
    };
  }

  if (
    buyerReadyForAnchor &&
    buyerReadyForAnchor.linked_property_id ===
      operationalSalePropertyId
  ) {
    return {
      kind: "buyer_ready",
      anchorPropertyId: operationalSalePropertyId,
      summary: buyerReadyForAnchor,
    };
  }

  return null;
}

export function findBuyerReadySummaryForAnchor(
  summaries: ChainNodesChainSummary[],
  anchorPropertyId: number | null
): ChainNodesChainSummary | null {
  if (anchorPropertyId == null) {
    return null;
  }

  return (
    summaries.find(
      (summary) =>
        summary.linked_property_id === anchorPropertyId
    ) ?? null
  );
}

export function shouldRenderUpstreamPurchaserBeforeProperty(
  upstreamPurchaser: UpstreamPurchaserState,
  propertyId: number,
  isOperationalSale: boolean
): boolean {
  if (!isOperationalSale || !upstreamPurchaser) {
    return false;
  }

  if (
    upstreamPurchaser.kind === "awaiting_buyer" ||
    upstreamPurchaser.kind === "buyer_ready"
  ) {
    return (
      upstreamPurchaser.anchorPropertyId === propertyId
    );
  }

  return false;
}

/** @deprecated Use shouldRenderUpstreamPurchaserBeforeProperty */
export function shouldRenderAwaitingBuyerBeforeProperty(
  upstreamPurchaser: UpstreamPurchaserState,
  propertyId: number,
  isOperationalSale: boolean
): boolean {
  return (
    shouldRenderUpstreamPurchaserBeforeProperty(
      upstreamPurchaser,
      propertyId,
      isOperationalSale
    ) &&
    upstreamPurchaser?.kind === "awaiting_buyer"
  );
}
