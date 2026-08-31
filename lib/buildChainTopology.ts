/**
 * Chain topology builder — single source of truth for chain row structure.
 *
 * Phase 3: addressless searching placeholders (stage = searching) participate
 * in linked_property_id walks. Lifecycle is stage-authoritative.
 */

export type SegmentGapState =
  | "connected"
  | "awaiting_connection"
  | "broken";

/** Minimum property shape required for topology walks and gap classification. */
export type TopologyProperty = {
  id: number;
  chainPosition: number;
  stage: string;
  status: string;
  currentUserRole: string | null;
  lastUpdatedDays: number;
  address: string | null;
  awaiting_buyer: boolean;
  is_searching: boolean;
  buyer_connected: boolean;
  seller_connected: boolean;
  relationship_type: string | null;
  linked_property_id: number | null;
};

/** Minimum buyer_ready input for prefix topology (summary or owner row). */
export type TopologyBuyerReadyNode = {
  id: number;
  node_type: string;
  stage?: string;
  /** Participant-safe coarse label from chain_nodes_chain_summary. */
  public_stage_label?: string;
  status: string;
  progress: number;
  latest_activity_at?: string | null;
  activities?: {
    id: number;
    timestamp: string;
    update: string;
    updated_by?: string;
  }[];
};

export type ChainTopologyBuyerReadyPrefix = {
  kind: "buyer_ready";
  node: TopologyBuyerReadyNode;
  stageLabel: string;
};

export type SyntheticTerminusKind =
  | "searching"
  | "end_of_chain";

export type ChainTopologySyntheticTerminus = {
  kind: "synthetic";
  terminus: SyntheticTerminusKind;
  propertyNumber: number;
};

/**
 * One property segment: a root and its linked_property_id walk.
 * gapBefore is null for the first segment; otherwise classifies the
 * boundary between the previous segment and this one.
 */
export type ChainTopologySegment = {
  propertyNodes: TopologyProperty[];
  gapBefore: SegmentGapState | null;
};

export type ChainTopology = {
  buyerReadyPrefix: ChainTopologyBuyerReadyPrefix | null;
  segments: ChainTopologySegment[];
  syntheticTerminus: ChainTopologySyntheticTerminus | null;
  /** Flat property list across all segments (formerly flatNodes). */
  flatPropertyNodes: TopologyProperty[];
  /** Addressed properties participating in segment walks. */
  renderableProperties: TopologyProperty[];
};

type GapProperty = {
  id: number;
  status: string;
  linked_property_id: number | null;
  buyer_connected: boolean;
  seller_connected: boolean;
  stage: string;
  address: string | null;
  relationship_type?: string | null;
};

/**
 * Connection state between two adjacent properties in the same topology segment.
 */
export function getLinkedPropertyGapState(
  tail: GapProperty,
  head: GapProperty
): SegmentGapState {
  if (
    tail.status === "broken_connection" ||
    head.status === "broken_connection"
  ) {
    return "broken";
  }

  const hasTopologyLink =
    tail.linked_property_id === head.id;

  if (!hasTopologyLink) {
    return "awaiting_connection";
  }

  if (isSearchingPlaceholder(head)) {
    return tail.status === "healthy" &&
      tail.seller_connected
      ? "connected"
      : "awaiting_connection";
  }

  if (
    tail.status === "healthy" &&
    head.status === "healthy" &&
    tail.seller_connected &&
    head.seller_connected &&
    head.buyer_connected &&
    tail.buyer_connected
  ) {
    return "connected";
  }

  if (
    tail.status === "pending_connection" ||
    head.status === "pending_connection" ||
    !tail.seller_connected ||
    !head.seller_connected ||
    !head.buyer_connected ||
    !tail.buyer_connected
  ) {
    return "awaiting_connection";
  }

  return "connected";
}

/**
 * Classifies the connector between two adjacent segments using tail/head
 * boundary properties and their connection flags.
 */
export function getSegmentGapState(
  previousSegment: GapProperty[],
  nextSegment: GapProperty[]
): SegmentGapState {
  const tail =
    previousSegment[
      previousSegment.length - 1
    ];
  const head = nextSegment[0];

  if (
    tail.status === "broken_connection" ||
    head.status === "broken_connection"
  ) {
    return "broken";
  }

  if (isSearchingPlaceholder(tail)) {
    return getLinkedPropertyGapState(tail, head);
  }

  if (isSearchingPlaceholder(head)) {
    return getLinkedPropertyGapState(tail, head);
  }

  return getLinkedPropertyGapState(tail, head);
}

function formatBuyerReadyStageLabel(
  stage: string | undefined,
  publicStageLabel?: string
): string {
  if (publicStageLabel) {
    return publicStageLabel;
  }

  return (
    stage
      ?.replaceAll("_", " ")
      .replace(
        /\b\w/g,
        (char: string) => char.toUpperCase()
      ) || "Buyer Ready"
  );
}

/**
 * Stage-authoritative searching placeholder (address/postcode null at DB).
 */
export function isSearchingPlaceholder<
  T extends Pick<
    TopologyProperty,
    "stage" | "address"
  >
>(property: T): boolean {
  return (
    property.stage === "searching" &&
    !property.address
  );
}

/**
 * Peer property whose address was redacted by the participant privacy view
 * (address null) but which still participates in linked_property_id topology.
 * Distinct from searching placeholders (stage === searching).
 *
 * Does not restore or expose the redacted address — existence/position only.
 */
export function isPrivacyRedactedPeerProperty<
  T extends Pick<
    TopologyProperty,
    "stage" | "address" | "relationship_type"
  >
>(property: T): boolean {
  return (
    !property.address &&
    property.stage !== "searching" &&
    (property.relationship_type === "sale" ||
      property.relationship_type === "purchase")
  );
}

/**
 * Addressed properties, searching placeholders, and privacy-redacted peers
 * participate in linked_property_id walks.
 */
export function isRenderableTopologyProperty<
  T extends TopologyProperty
>(property: T): boolean {
  return (
    !!property.address ||
    isSearchingPlaceholder(property) ||
    isPrivacyRedactedPeerProperty(property)
  );
}

function getRenderableProperties<
  T extends TopologyProperty
>(chainProperties: T[]): T[] {
  return chainProperties.filter(
    isRenderableTopologyProperty
  );
}

/**
 * Segment roots: renderable properties not referenced as another property's
 * linked_property_id target.
 */
function getRootProperties<
  T extends TopologyProperty
>(
  renderableProperties: T[]
): T[] {
  return renderableProperties.filter(
    (property) =>
      !renderableProperties.some(
        (candidate) =>
          candidate.linked_property_id ===
          property.id
      )
  );
}

/**
 * Walk linked_property_id from a root until the chain ends, producing one
 * ordered property segment. Shared by topology rendering and placeholder
 * resolution — do not duplicate this graph walk elsewhere.
 */
export function walkLinkedPropertySegment<
  T extends Pick<
    TopologyProperty,
    "id" | "linked_property_id"
  >
>(root: T, properties: T[]): T[] {
  const segment: T[] = [];
  let current: T | undefined = root;
  const visited = new Set<number>();

  while (current) {
    if (visited.has(current.id)) {
      break;
    }

    visited.add(current.id);
    segment.push(current);

    const linkedProperty = properties.find(
      (candidate) =>
        candidate.id === current!.linked_property_id
    );

    if (!linkedProperty) {
      break;
    }

    current = linkedProperty;
  }

  return segment;
}

function buildPropertySegment<
  T extends TopologyProperty
>(
  root: T,
  renderableProperties: T[]
): T[] {
  return walkLinkedPropertySegment(
    root,
    renderableProperties
  );
}

/**
 * Synthetic Searching / End Of Chain suffix rules (unchanged from pre-refactor):
 * - Shown when the chain has renderable properties but no purchase property.
 * - End Of Chain when a sale has awaiting_buyer; otherwise Searching.
 */
function resolveSyntheticTerminus<
  T extends TopologyProperty
>(
  renderableProperties: T[],
  flatPropertyNodes: T[]
): ChainTopologySyntheticTerminus | null {
  const hasPurchaseProperty =
    renderableProperties.some(
      (property) =>
        property.relationship_type ===
        "purchase"
    );

  if (
    hasPurchaseProperty ||
    renderableProperties.length === 0
  ) {
    return null;
  }

  const sellerConfirmedEndOfChain =
    renderableProperties
      .filter(
        (property) =>
          property.relationship_type ===
          "sale"
      )
      .some(
        (property) =>
          property.awaiting_buyer
      );

  return {
    kind: "synthetic",
    terminus: sellerConfirmedEndOfChain
      ? "end_of_chain"
      : "searching",
    propertyNumber:
      flatPropertyNodes.length + 1,
  };
}

/**
 * Builds the canonical chain topology from persisted chain data.
 *
 * Input:
 * - chainProperties: all properties for the chain (sorted by chain_position
 *   before calling is recommended but not required).
 * - buyerReadyNode: buyer_ready chain_nodes row when the client can load it.
 *
 * Output:
 * - buyerReadyPrefix: upstream Buyer Ready tile when node is present.
 * - segments: property segments with inter-segment gap classification.
 * - syntheticTerminus: downstream Searching / End Of Chain when rules match.
 * - flatPropertyNodes / renderableProperties: helpers for rendering overlays
 *   and intelligence calculations.
 */
export function buildChainTopology<
  T extends TopologyProperty
>(
  chainProperties: T[],
  buyerReadyNode:
    | TopologyBuyerReadyNode
    | null
    | undefined
): ChainTopology {
  const renderableProperties =
    getRenderableProperties(
      chainProperties
    );

  const rootProperties =
    getRootProperties(
      renderableProperties
    );

  // Topology node creation: each root starts a segment via linked_property_id walk.
  const segmentPropertyLists =
    rootProperties
      .map((root) =>
        buildPropertySegment(
          root,
          renderableProperties
        )
      )
      .filter(
        (segment) =>
          segment.length > 0
      );

  const flatPropertyNodes =
    segmentPropertyLists.flat();

  // Segment creation: attach gap classification between adjacent segments.
  const segments: ChainTopologySegment[] =
    segmentPropertyLists.map(
      (propertyNodes, segmentIndex) => ({
        propertyNodes,
        gapBefore:
          segmentIndex > 0
            ? getSegmentGapState(
                segmentPropertyLists[
                  segmentIndex - 1
                ],
                propertyNodes
              )
            : null,
      })
    );

  // Buyer Ready prefix: present when chain_nodes buyer_ready row is available.
  const buyerReadyPrefix =
    buyerReadyNode &&
    buyerReadyNode.node_type ===
      "buyer_ready"
      ? {
          kind: "buyer_ready" as const,
          node: buyerReadyNode,
          stageLabel:
            formatBuyerReadyStageLabel(
              buyerReadyNode.stage,
              buyerReadyNode.public_stage_label
            ),
        }
      : null;

  const syntheticTerminus =
    resolveSyntheticTerminus(
      renderableProperties,
      flatPropertyNodes
    );

  return {
    buyerReadyPrefix,
    segments,
    syntheticTerminus,
    flatPropertyNodes,
    renderableProperties,
  };
}
