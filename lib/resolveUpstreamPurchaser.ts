import type { ChainNodesChainSummary } from "@/lib/chainNodesSummary";

/**
 * Purchaser presentation — anchored to each chain property/node.
 *
 * Structural synthetics (Awaiting Buyer, Buyer Ready) belong to the property
 * that owns the unresolved/connected purchaser state. They are not limited to
 * the viewer's operational sale. Viewer position only affects labels/perspective.
 *
 * Phase 1: Awaiting Buyer (render-time).
 * Phase 2: Buyer Ready (chain_nodes summary anchored to that property).
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
  relationship_type?: string | null;
  stage?: string | null;
  address?: string | null;
};

export type ResolvePurchaserStateForPropertyParams = {
  propertyId: number;
  chainProperties: UpstreamPurchaserAnchorProperty[];
  buyerReadySummaries: ChainNodesChainSummary[];
};

/**
 * Resolves structural purchaser state for a single chain property.
 *
 * Precedence:
 * 1. eligible sale with buyer_connected === false → Awaiting Buyer
 * 2. buyer_connected === true + buyer_ready summary for this property → Buyer Ready
 * 3. else → null
 *
 * Searching placeholders never receive Awaiting Buyer / Buyer Ready tiles.
 */
export function resolvePurchaserStateForProperty(
  params: ResolvePurchaserStateForPropertyParams
): UpstreamPurchaserState {
  const { propertyId, chainProperties, buyerReadySummaries } =
    params;

  const anchorProperty = chainProperties.find(
    (property) => property.id === propertyId
  );

  if (!anchorProperty) {
    return null;
  }

  if (!isPurchaserStateEligibleProperty(anchorProperty)) {
    return null;
  }

  if (!anchorProperty.buyer_connected) {
    return {
      kind: "awaiting_buyer",
      anchorPropertyId: propertyId,
    };
  }

  const buyerReadyForAnchor = findBuyerReadySummaryForAnchor(
    buyerReadySummaries,
    propertyId
  );

  if (
    buyerReadyForAnchor &&
    buyerReadyForAnchor.linked_property_id === propertyId
  ) {
    return {
      kind: "buyer_ready",
      anchorPropertyId: propertyId,
      summary: buyerReadyForAnchor,
    };
  }

  return null;
}

/**
 * Resolves purchaser synthetics for every eligible property in the chain.
 * Used by tile composition so mid-chain viewers still see upstream states.
 */
export function resolvePurchaserStatesByPropertyId(params: {
  chainProperties: UpstreamPurchaserAnchorProperty[];
  buyerReadySummaries: ChainNodesChainSummary[];
}): Map<number, NonNullable<UpstreamPurchaserState>> {
  const { chainProperties, buyerReadySummaries } = params;
  const states = new Map<number, NonNullable<UpstreamPurchaserState>>();

  for (const property of chainProperties) {
    const state = resolvePurchaserStateForProperty({
      propertyId: property.id,
      chainProperties,
      buyerReadySummaries,
    });

    if (state) {
      states.set(property.id, state);
    }
  }

  return states;
}

export type ResolveUpstreamPurchaserParams = {
  /**
   * Property id to resolve. Historically the viewer's operational sale;
   * callers should prefer resolvePurchaserStateForProperty /
   * resolvePurchaserStatesByPropertyId for full-chain composition.
   */
  operationalSalePropertyId: number | null;
  chainProperties: UpstreamPurchaserAnchorProperty[];
  buyerReadyForAnchor: ChainNodesChainSummary | null;
};

/**
 * Resolves purchaser state for one property id.
 * Prefer resolvePurchaserStatesByPropertyId when composing a full chain.
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

  return resolvePurchaserStateForProperty({
    propertyId: operationalSalePropertyId,
    chainProperties,
    buyerReadySummaries: buyerReadyForAnchor
      ? [buyerReadyForAnchor]
      : [],
  });
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

/**
 * Whether a purchaser synthetic should render immediately before this property.
 * Structural — not gated on the viewer's operational sale.
 */
export function shouldRenderUpstreamPurchaserBeforeProperty(
  upstreamPurchaser: UpstreamPurchaserState,
  propertyId: number,
  /** @deprecated Ignored — retained for call-site compatibility. */
  _isOperationalSale?: boolean
): boolean {
  if (!upstreamPurchaser) {
    return false;
  }

  if (
    upstreamPurchaser.kind === "awaiting_buyer" ||
    upstreamPurchaser.kind === "buyer_ready"
  ) {
    return upstreamPurchaser.anchorPropertyId === propertyId;
  }

  return false;
}

/** @deprecated Use shouldRenderUpstreamPurchaserBeforeProperty */
export function shouldRenderAwaitingBuyerBeforeProperty(
  upstreamPurchaser: UpstreamPurchaserState,
  propertyId: number,
  isOperationalSale?: boolean
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

function isPurchaserStateEligibleProperty(
  property: UpstreamPurchaserAnchorProperty
): boolean {
  if (property.stage === "searching" && !property.address) {
    return false;
  }

  // Awaiting Buyer / Buyer Ready attach to sale hops (and sale-shaped
  // operational properties). Purchase / searching rows are not anchors.
  if (property.relationship_type === "purchase") {
    return false;
  }

  if (property.relationship_type === "sale") {
    return true;
  }

  // If relationship_type is absent, allow resolution (unit tests / partial rows).
  return property.relationship_type == null;
}
