import { isSearchingPlaceholder } from "@/lib/buildChainTopology";

export type OperationalPropertyMember = {
  user_id: string;
  role: string;
};

export type OperationalProperty = {
  id: number;
  chainId: number;
  stage: string;
  address: string | null;
  relationship_type: string | null;
  linked_property_id: number | null;
  members: OperationalPropertyMember[];
};

export type OperationalBuyerReadyNode = {
  id: number;
  chain_id: number;
  user_id: string;
  node_type: string;
};

export type OperationalPosition =
  | {
      kind: "buyer_ready";
      chainId: number;
      nodeId: number;
    }
  | {
      kind: "sale";
      chainId: number;
      propertyId: number;
    };

export type ResolveOperationalPositionResult = {
  position: OperationalPosition | null;
  ambiguity?: "multiple_sale_positions" | "buyer_ready_and_sale";
};

export const OPERATIONAL_EDIT_DENIED_MESSAGE =
  "Updates can only be made from your operational position in the chain.";

export const CONNECTED_POSITION_MESSAGE =
  "This is a connected chain position. Progress is updated from the participant's operational position.";

/** @deprecated Use CONNECTED_POSITION_MESSAGE */
export const VIEW_ONLY_PURCHASE_MESSAGE =
  CONNECTED_POSITION_MESSAGE;

export const OPERATIONAL_SALE_BANNER_MESSAGE =
  "This is your sale in the chain. You can update progress here.";

export const OPERATIONAL_BUYER_READY_BANNER_MESSAGE =
  "This is your Buyer Ready step in the chain. You can update progress here.";

function isSellerHopForUser(
  property: OperationalProperty,
  userId: string
): boolean {
  return property.members.some(
    (member) =>
      member.user_id === userId &&
      member.role === "seller"
  );
}

function findBuyerReadyNodeForUser(
  chainNodes: OperationalBuyerReadyNode[],
  chainId: number,
  userId: string
): OperationalBuyerReadyNode | undefined {
  return chainNodes.find(
    (node) =>
      Number(node.chain_id) === Number(chainId) &&
      node.node_type === "buyer_ready" &&
      node.user_id === userId
  );
}

function findSellerHopPropertiesForUser(
  chainProperties: OperationalProperty[],
  chainId: number,
  userId: string
): OperationalProperty[] {
  return chainProperties.filter(
    (property) =>
      Number(property.chainId) === Number(chainId) &&
      isSellerHopForUser(property, userId)
  );
}

function resolveSellerHopProperty(
  sellerHopProperties: OperationalProperty[]
): OperationalProperty | null {
  if (sellerHopProperties.length === 0) {
    return null;
  }

  if (sellerHopProperties.length === 1) {
    return sellerHopProperties[0];
  }

  const saleTypeHops = sellerHopProperties.filter(
    (property) => property.relationship_type === "sale"
  );

  if (saleTypeHops.length === 1) {
    return saleTypeHops[0];
  }

  return null;
}

/**
 * Resolves the authenticated user's single operational position in a chain.
 * Participant-centric: Buyer Ready OR Sale (seller hop), regardless of row type.
 */
export function resolveOperationalPosition(
  userId: string | null | undefined,
  chainId: number,
  chainProperties: OperationalProperty[],
  chainNodes: OperationalBuyerReadyNode[]
): ResolveOperationalPositionResult {
  if (!userId) {
    return { position: null };
  }

  const buyerReadyNode = findBuyerReadyNodeForUser(
    chainNodes,
    chainId,
    userId
  );

  const sellerHopProperties = findSellerHopPropertiesForUser(
    chainProperties,
    chainId,
    userId
  );

  if (buyerReadyNode && sellerHopProperties.length > 0) {
    return {
      position: null,
      ambiguity: "buyer_ready_and_sale",
    };
  }

  if (buyerReadyNode) {
    return {
      position: {
        kind: "buyer_ready",
        chainId: Number(chainId),
        nodeId: buyerReadyNode.id,
      },
    };
  }

  const sellerHopProperty =
    resolveSellerHopProperty(sellerHopProperties);

  if (
    sellerHopProperties.length > 1 &&
    !sellerHopProperty
  ) {
    return {
      position: null,
      ambiguity: "multiple_sale_positions",
    };
  }

  if (sellerHopProperty) {
    return {
      position: {
        kind: "sale",
        chainId: Number(chainId),
        propertyId: sellerHopProperty.id,
      },
    };
  }

  return { position: null };
}

export function isContextualPurchaseProperty(
  property: Pick<
    OperationalProperty,
    "relationship_type"
  >
): boolean {
  return property.relationship_type === "purchase";
}

export function isViewOnlyPurchaseTile(
  property: Pick<
    OperationalProperty,
    "relationship_type"
  >,
  isOperationalPosition: boolean
): boolean {
  return (
    isContextualPurchaseProperty(property) &&
    !isOperationalPosition
  );
}

/** Searching placeholders are never operational mutation targets. */
export function isNonOperationalPropertyTarget(
  property: Pick<
    OperationalProperty,
    "stage" | "address" | "relationship_type"
  >
): boolean {
  return isSearchingPlaceholder(property);
}

export function canMutatePropertyTarget(
  property: OperationalProperty | null | undefined,
  userId: string | null | undefined,
  chainProperties: OperationalProperty[],
  chainNodes: OperationalBuyerReadyNode[]
): boolean {
  if (!property || !userId) {
    return false;
  }

  if (isNonOperationalPropertyTarget(property)) {
    return false;
  }

  const { position } = resolveOperationalPosition(
    userId,
    property.chainId,
    chainProperties,
    chainNodes
  );

  return (
    position?.kind === "sale" &&
    position.propertyId === property.id
  );
}

export function canMutateBuyerReadyTarget(
  nodeId: number,
  chainId: number,
  userId: string | null | undefined,
  chainProperties: OperationalProperty[],
  chainNodes: OperationalBuyerReadyNode[]
): boolean {
  if (!userId) {
    return false;
  }

  const { position } = resolveOperationalPosition(
    userId,
    chainId,
    chainProperties,
    chainNodes
  );

  return (
    position?.kind === "buyer_ready" &&
    position.nodeId === nodeId
  );
}

export function findSearchingPlaceholderLinkedFromSale(
  chainProperties: OperationalProperty[],
  salePropertyId: number
): OperationalProperty | null {
  const saleProperty = chainProperties.find(
    (property) => property.id === salePropertyId
  );

  if (!saleProperty?.linked_property_id) {
    return null;
  }

  const linkedProperty = chainProperties.find(
    (property) =>
      property.id === saleProperty.linked_property_id
  );

  if (
    linkedProperty &&
    isSearchingPlaceholder(linkedProperty)
  ) {
    return linkedProperty;
  }

  return null;
}

export function mapToOperationalProperties<
  T extends OperationalProperty
>(properties: T[]): OperationalProperty[] {
  return properties;
}

export const CHAIN_TILE_LABEL = {
  buyerReady: "Buyer Ready",
  yourSale: "Your Sale",
  connectedSale: "Connected Sale",
  connectedPurchase: "Connected Purchase",
  nextHomeSearch: "Next Home Search",
} as const;

export function getOperationalSaleChainHeadline(): string {
  return `★ ${CHAIN_TILE_LABEL.yourSale}`;
}

export function getOperationalBuyerReadyHeadline(): string {
  return `★ ${CHAIN_TILE_LABEL.buyerReady}`;
}

type ChainDisplayProperty = Pick<
  OperationalProperty,
  "relationship_type" | "stage" | "address"
> & {
  currentUserRole?: string | null;
  chainPosition?: number;
};

export function getPropertyPageHeadline(
  property: ChainDisplayProperty,
  canEdit: boolean
): string {
  if (canEdit) {
    return getOperationalSaleChainHeadline();
  }

  if (isSearchingPlaceholder(property)) {
    return CHAIN_TILE_LABEL.nextHomeSearch;
  }

  return getChainTileDisplayTitle(property, false);
}

export function getPropertyPageSubtitle(
  property: ChainDisplayProperty,
  canEdit: boolean
): string {
  if (canEdit) {
    return OPERATIONAL_SALE_BANNER_MESSAGE;
  }

  if (isSearchingPlaceholder(property)) {
    return "Your onward home has not been chosen yet.";
  }

  if (
    property.relationship_type === "purchase" ||
    property.currentUserRole === "buyer"
  ) {
    return CONNECTED_POSITION_MESSAGE;
  }

  if (
    property.relationship_type === "sale" ||
    property.currentUserRole === "seller"
  ) {
    return "A connected sale in this chain.";
  }

  return CONNECTED_POSITION_MESSAGE;
}

export function getDashboardPropertyLabel(
  property: Pick<
    ChainDisplayProperty,
    "relationship_type" | "stage" | "address"
  > & {
    chainPosition?: number;
    chain_position?: number;
  }
): string {
  if (isSearchingPlaceholder(property)) {
    return CHAIN_TILE_LABEL.nextHomeSearch;
  }

  if (property.relationship_type === "sale") {
    return CHAIN_TILE_LABEL.connectedSale;
  }

  if (property.relationship_type === "purchase") {
    return CHAIN_TILE_LABEL.connectedPurchase;
  }

  const chainPosition =
    property.chainPosition ?? property.chain_position;

  return `Chain Property ${chainPosition ?? ""}`.trim();
}

export function getChainTileDisplayTitle(
  property: Pick<
    OperationalProperty,
    "relationship_type" | "stage" | "address"
  > & {
    currentUserRole?: string | null;
  },
  isOperationalPosition: boolean
): string {
  if (isSearchingPlaceholder(property)) {
    return CHAIN_TILE_LABEL.nextHomeSearch;
  }

  if (isOperationalPosition) {
    return CHAIN_TILE_LABEL.yourSale;
  }

  if (isViewOnlyPurchaseTile(property, isOperationalPosition)) {
    return CHAIN_TILE_LABEL.connectedPurchase;
  }

  if (property.currentUserRole === "seller") {
    return CHAIN_TILE_LABEL.connectedSale;
  }

  if (property.currentUserRole === "buyer") {
    return CHAIN_TILE_LABEL.connectedPurchase;
  }

  if (property.relationship_type === "sale") {
    return CHAIN_TILE_LABEL.connectedSale;
  }

  if (property.relationship_type === "purchase") {
    return CHAIN_TILE_LABEL.connectedPurchase;
  }

  return CHAIN_TILE_LABEL.connectedSale;
}

export function isOperationalSaleProperty(
  propertyId: number,
  userId: string | null | undefined,
  chainId: number,
  chainProperties: OperationalProperty[],
  chainNodes: OperationalBuyerReadyNode[]
): boolean {
  const { position } = resolveOperationalPosition(
    userId,
    chainId,
    chainProperties,
    chainNodes
  );

  return (
    position?.kind === "sale" &&
    position.propertyId === propertyId
  );
}
