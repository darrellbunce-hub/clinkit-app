/**
 * Chain page "Recent Chain Activity".
 *
 * Collects every activity the viewer received for the chain — property rows and
 * every Buyer Ready step — and labels each with the same viewer-relative title
 * as its chain tile (resolveChainPropertyTileTitle). Titles never carry an
 * address or postcode. A title shared by more than one tile is told apart by the
 * tile's place in the chain ("Connected Buyer · Property 4"); Buyer Ready steps
 * are told apart by the property they are buying.
 */

import type { OperationalActivity } from "@/lib/activityIntelligence";
import {
  buildChainTopology,
  type TopologyProperty,
} from "@/lib/buildChainTopology";
import {
  CHAIN_TILE_LABEL,
  resolveChainPropertyTileTitle,
  type HomeownerPropertyLabelInput,
  type OperationalPosition,
} from "@/lib/operationalPosition";

export const CHAIN_ACTIVITY_POSITION_SEPARATOR = " · ";

export type ChainActivitySource =
  | { kind: "property"; propertyId: number }
  | { kind: "buyer_ready"; chainNodeId: number };

export type ChainTimelineActivity = OperationalActivity & {
  key: string;
  source: ChainActivitySource;
  positionLabel: string;
};

export type ChainActivityProperty = TopologyProperty & {
  activities?: OperationalActivity[];
};

export type ChainActivityLabelProperty = HomeownerPropertyLabelInput & {
  id: number;
};

export type ChainActivityNode = {
  id: number;
  chain_id: number;
  node_type: string;
  linked_property_id?: number | null;
  activities?: OperationalActivity[] | null;
};

export type ChainActivityPositionParams = {
  chainId: number;
  /** Chain rows as loaded (topology order and property activities). */
  chainProperties: ChainActivityProperty[];
  /**
   * Viewer-scoped rows used for titles: the participant rows with the
   * operational subject lens applied for estate agents.
   */
  labelProperties: ChainActivityLabelProperty[];
  operationalPosition: OperationalPosition | null;
  ownerBuyerReadyLinkedPropertyId?: number | null;
};

export type BuildChainActivityTimelineParams =
  ChainActivityPositionParams & {
    chainNodes: ChainActivityNode[];
  };

function propertyNumberLabel(propertyNumber: number): string {
  return `Property ${propertyNumber}`;
}

function isPropertyNumberLabel(label: string): boolean {
  return /^Property( \d+)?$/.test(label);
}

/** 1-based place of each property tile in the rendered chain order. */
export function resolveChainPropertyNumbers(
  chainProperties: ChainActivityProperty[]
): Map<number, number> {
  const ordered = buildChainTopology(chainProperties, null).flatPropertyNodes;
  const orderedIds = new Set(ordered.map((property) => property.id));
  const remaining = chainProperties
    .filter((property) => !orderedIds.has(property.id))
    .sort((left, right) => left.chainPosition - right.chainPosition);

  const numbers = new Map<number, number>();
  for (const property of [...ordered, ...remaining]) {
    if (!numbers.has(property.id)) {
      numbers.set(property.id, numbers.size + 1);
    }
  }
  return numbers;
}

/** Viewer-relative position label per property id, matching the chain tile titles. */
export function resolveChainPropertyPositionLabels(
  params: ChainActivityPositionParams
): Map<number, string> {
  const propertyNumbers = resolveChainPropertyNumbers(params.chainProperties);
  const labelRowsById = new Map(
    params.labelProperties.map((row) => [Number(row.id), row])
  );

  const titles = new Map<number, string>();
  for (const property of params.chainProperties) {
    const labelRow = labelRowsById.get(property.id) ?? property;
    titles.set(
      property.id,
      resolveChainPropertyTileTitle(labelRow, {
        isOperationalPosition:
          params.operationalPosition?.kind === "sale" &&
          params.operationalPosition.propertyId === property.id,
        ownerBuyerReadyLinkedPropertyId:
          params.ownerBuyerReadyLinkedPropertyId ?? null,
      })
    );
  }

  const titleCounts = new Map<string, number>();
  for (const title of titles.values()) {
    titleCounts.set(title, (titleCounts.get(title) ?? 0) + 1);
  }

  const labels = new Map<number, string>();
  for (const [propertyId, title] of titles) {
    const propertyNumber = propertyNumbers.get(propertyId);
    if ((titleCounts.get(title) ?? 0) < 2 || propertyNumber == null) {
      labels.set(propertyId, title);
    } else if (isPropertyNumberLabel(title)) {
      labels.set(propertyId, propertyNumberLabel(propertyNumber));
    } else {
      labels.set(
        propertyId,
        `${title}${CHAIN_ACTIVITY_POSITION_SEPARATOR}${propertyNumberLabel(propertyNumber)}`
      );
    }
  }
  return labels;
}

function chainBuyerReadyNodes(
  chainId: number,
  chainNodes: ChainActivityNode[]
): ChainActivityNode[] {
  const nodes = new Map<number, ChainActivityNode>();
  for (const node of chainNodes) {
    if (
      Number(node.chain_id) === Number(chainId) &&
      node.node_type === "buyer_ready" &&
      !nodes.has(Number(node.id))
    ) {
      nodes.set(Number(node.id), node);
    }
  }
  return [...nodes.values()].sort((left, right) => left.id - right.id);
}

/** "Buyer Ready", or "Buyer Ready · Property N" (the property being bought) when the chain has several. */
export function resolveBuyerReadyPositionLabels(params: {
  chainId: number;
  chainNodes: ChainActivityNode[];
  chainProperties: ChainActivityProperty[];
}): Map<number, string> {
  const nodes = chainBuyerReadyNodes(params.chainId, params.chainNodes);
  const propertyNumbers = resolveChainPropertyNumbers(params.chainProperties);

  const labels = new Map<number, string>();
  for (const node of nodes) {
    const anchorNumber =
      node.linked_property_id != null
        ? propertyNumbers.get(Number(node.linked_property_id))
        : undefined;
    labels.set(
      node.id,
      nodes.length > 1 && anchorNumber != null
        ? `${CHAIN_TILE_LABEL.buyerReady}${CHAIN_ACTIVITY_POSITION_SEPARATOR}${propertyNumberLabel(anchorNumber)}`
        : CHAIN_TILE_LABEL.buyerReady
    );
  }
  return labels;
}

function activityKey(
  activity: OperationalActivity,
  source: ChainActivitySource
): string {
  if (activity.id != null) {
    return `activity:${activity.id}`;
  }
  const origin =
    source.kind === "property"
      ? `property:${source.propertyId}`
      : `buyer_ready:${source.chainNodeId}`;
  return `${origin}:${activity.timestamp}:${activity.update}`;
}

/** Every chain activity the viewer received, newest first, each once, with its position label. */
export function buildChainActivityTimeline(
  params: BuildChainActivityTimelineParams
): ChainTimelineActivity[] {
  const propertyLabels = resolveChainPropertyPositionLabels(params);
  const buyerReadyLabels = resolveBuyerReadyPositionLabels(params);
  const propertyNumbers = resolveChainPropertyNumbers(params.chainProperties);

  const entries: ChainTimelineActivity[] = [];
  const seen = new Set<string>();

  const push = (
    activity: OperationalActivity,
    source: ChainActivitySource,
    positionLabel: string
  ) => {
    const key = activityKey(activity, source);
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    entries.push({
      id: activity.id,
      timestamp: activity.timestamp,
      update: activity.update,
      updated_by: activity.updated_by,
      key,
      source,
      positionLabel,
    });
  };

  const orderedProperties = [...params.chainProperties].sort(
    (left, right) =>
      (propertyNumbers.get(left.id) ?? 0) -
      (propertyNumbers.get(right.id) ?? 0)
  );

  for (const property of orderedProperties) {
    const positionLabel = propertyLabels.get(property.id);
    if (positionLabel == null) {
      continue;
    }
    for (const activity of property.activities ?? []) {
      push(
        activity,
        { kind: "property", propertyId: property.id },
        positionLabel
      );
    }
  }

  for (const node of chainBuyerReadyNodes(params.chainId, params.chainNodes)) {
    const positionLabel =
      buyerReadyLabels.get(node.id) ?? CHAIN_TILE_LABEL.buyerReady;
    for (const activity of node.activities ?? []) {
      push(
        activity,
        { kind: "buyer_ready", chainNodeId: node.id },
        positionLabel
      );
    }
  }

  return entries.sort(
    (left, right) =>
      new Date(right.timestamp || 0).getTime() -
      new Date(left.timestamp || 0).getTime()
  );
}
