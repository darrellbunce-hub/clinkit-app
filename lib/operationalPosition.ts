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
  connectedBuyer: "Connected Buyer",
  connectedPurchase: "Connected Purchase",
  nextHomeSearch: "Next Home Search",
  /** @deprecated Use connectedBuyer */
  connectedSale: "Connected Buyer",
} as const;

export type HomeownerPropertyLabelSurface =
  | "dashboard"
  | "chain"
  | "property";

export type HomeownerPropertyLabelInput = Pick<
  OperationalProperty,
  "relationship_type" | "stage" | "address"
> & {
  id?: number;
  chainPosition?: number;
  chain_position?: number;
  is_own_property?: boolean;
  isOwnProperty?: boolean;
  currentUserRole?: string | null;
};

export type HomeownerPropertyLabelContext = {
  surface: HomeownerPropertyLabelSurface;
  /** Chain topology only: authenticated user's editable Sale tile */
  isOperationalPosition?: boolean;
  /**
   * Dashboard/property: when set, only this property id may show an address
   * (the user's operational Sale hop). Matches chain-page privacy.
   */
  operationalPropertyId?: number | null;
};

/**
 * Primary operational property for the current user (their sale or their purchase).
 * Membership alone (e.g. buyer on someone else's sale) is a connected hop, not "own".
 */
export function isPrimaryHomeownerProperty(
  property: HomeownerPropertyLabelInput
): boolean {
  if (property.relationship_type === "sale") {
    return property.currentUserRole === "seller";
  }

  if (property.relationship_type === "purchase") {
    return property.currentUserRole === "buyer";
  }

  return false;
}

export function shouldShowHomeownerAddress(
  property: HomeownerPropertyLabelInput,
  context: HomeownerPropertyLabelContext
): boolean {
  if (!property.address) {
    return false;
  }

  if (context.surface === "chain") {
    return false;
  }

  return (
    context.operationalPropertyId != null &&
    property.id != null &&
    property.id === context.operationalPropertyId
  );
}

/**
 * Dashboard operational sale hop from participant view fields (no property_members).
 * When the user is seller on multiple sale rows, the downstream hop (highest position) wins.
 */
export function resolveDashboardOperationalPropertyId<
  T extends Pick<
    HomeownerPropertyLabelInput,
    | "id"
    | "relationship_type"
    | "currentUserRole"
    | "chainPosition"
    | "chain_position"
  >
>(chainProperties: T[]): number | null {
  const sellerSaleProperties = chainProperties.filter(
    (property) =>
      property.relationship_type === "sale" &&
      property.currentUserRole === "seller" &&
      property.id != null
  );

  if (sellerSaleProperties.length === 0) {
    return null;
  }

  const operationalProperty = sellerSaleProperties.sort(
    (a, b) =>
      (b.chainPosition ?? b.chain_position ?? 0) -
      (a.chainPosition ?? a.chain_position ?? 0)
  )[0];

  return operationalProperty.id ?? null;
}

function getConnectedPeerLabel(
  property: HomeownerPropertyLabelInput
): string | null {
  if (
    property.relationship_type === "sale" &&
    property.currentUserRole === "buyer"
  ) {
    return CHAIN_TILE_LABEL.connectedBuyer;
  }

  if (
    property.relationship_type === "purchase" &&
    property.currentUserRole === "seller"
  ) {
    return CHAIN_TILE_LABEL.connectedPurchase;
  }

  if (property.relationship_type === "purchase") {
    return CHAIN_TILE_LABEL.connectedPurchase;
  }

  if (property.relationship_type === "sale") {
    return CHAIN_TILE_LABEL.connectedBuyer;
  }

  if (property.currentUserRole === "buyer") {
    return CHAIN_TILE_LABEL.connectedPurchase;
  }

  if (property.currentUserRole === "seller") {
    return CHAIN_TILE_LABEL.connectedBuyer;
  }

  return null;
}

function getPropertyNumberFallbackLabel(
  property: HomeownerPropertyLabelInput
): string {
  const chainPosition = getPropertyChainPosition(property);

  return `Property ${chainPosition ?? ""}`.trim();
}

/**
 * Canonical homeowner-facing property label (privacy-safe).
 * Addresses only for primary homeowner roles on dashboard/property surfaces.
 */
export function getHomeownerPropertyLabel(
  property: HomeownerPropertyLabelInput,
  context: HomeownerPropertyLabelContext
): string {
  if (isSearchingPlaceholder(property)) {
    return CHAIN_TILE_LABEL.nextHomeSearch;
  }

  if (
    context.surface === "chain" &&
    context.isOperationalPosition
  ) {
    return CHAIN_TILE_LABEL.yourSale;
  }

  if (shouldShowHomeownerAddress(property, context)) {
    return property.address as string;
  }

  const connectedLabel = getConnectedPeerLabel(property);

  if (connectedLabel) {
    return connectedLabel;
  }

  return getPropertyNumberFallbackLabel(property);
}

function getPropertyChainPosition(
  property: HomeownerPropertyLabelInput
): number | undefined {
  return property.chainPosition ?? property.chain_position;
}

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

  return getHomeownerPropertyLabel(property, {
    surface: "property",
  });
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

  if (isPrimaryHomeownerProperty(property)) {
    if (property.relationship_type === "sale") {
      return "This is your sale in the chain.";
    }

    if (property.relationship_type === "purchase") {
      return "This is your purchase in the chain.";
    }
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
    return "A connected buyer in this chain.";
  }

  return CONNECTED_POSITION_MESSAGE;
}

export function getParticipantPropertyLabel(
  property: HomeownerPropertyLabelInput,
  operationalPropertyId?: number | null
): string {
  return getHomeownerPropertyLabel(property, {
    surface: "dashboard",
    operationalPropertyId,
  });
}

/** @deprecated Use getParticipantPropertyLabel */
export function getDashboardPropertyLabel(
  property: Parameters<typeof getParticipantPropertyLabel>[0]
): string {
  return getParticipantPropertyLabel(property);
}

export function getDashboardChainTitle(
  chainId: number,
  properties: Array<
    Pick<
      ChainDisplayProperty,
      "stage" | "address" | "relationship_type"
    > & {
      id?: number;
      chainId?: number;
      chain_id?: number;
      chainPosition?: number;
      chain_position?: number;
      currentUserRole?: string | null;
    }
  >,
  operationalPropertyId?: number | null
): string {
  const chainProperties = properties.filter(
    (property) =>
      Number(property.chainId ?? property.chain_id) ===
      Number(chainId)
  );

  if (operationalPropertyId != null) {
    const operationalProperty = chainProperties.find(
      (property) => property.id === operationalPropertyId
    );

    if (operationalProperty?.address) {
      return operationalProperty.address;
    }
  }

  return `Chain #${chainId}`;
}

export function getChainTileDisplayTitle(
  property: HomeownerPropertyLabelInput,
  isOperationalPosition: boolean
): string {
  return getHomeownerPropertyLabel(property, {
    surface: "chain",
    isOperationalPosition,
  });
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
