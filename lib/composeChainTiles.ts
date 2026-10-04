/**
 * Shared chain-tile composition — mirrors the homeowner chain page assembly.
 *
 * Topology (buildChainTopology) supplies ordered property nodes.
 * Structural synthetics (Awaiting Buyer / Buyer Ready / Connected Buyer)
 * attach per property. Labels remain viewer/operational-perspective relative.
 */

import {
  buildChainTopology,
  type TopologyProperty,
} from "@/lib/buildChainTopology";
import type { ChainNodesChainSummary } from "@/lib/chainNodesSummary";
import {
  CHAIN_TILE_LABEL,
  resolveChainPropertyTileTitle,
  type OperationalPosition,
} from "@/lib/operationalPosition";
import {
  resolvePurchaserStatesByPropertyId,
  resolveRenderedUpstreamPurchaser,
} from "@/lib/resolveUpstreamPurchaser";

export type ComposedChainTileKind =
  | "awaiting_buyer"
  | "buyer_ready"
  | "connected_buyer"
  | "property";

export type ComposedChainTile = {
  kind: ComposedChainTileKind;
  /** Property the synthetic belongs to, or the property tile id. */
  anchorPropertyId: number | null;
  label: string;
  /** Present for property tiles — privacy-sensitive address as loaded. */
  address: string | null;
};

export type ComposeChainTilesParams<T extends TopologyProperty> = {
  /**
   * Viewer-scoped rows (participant view, with the operational subject lens
   * applied for estate agents). Every row in the chain is included.
   */
  chainProperties: T[];
  operationalPosition: OperationalPosition | null;
  buyerReadySummaries?: ChainNodesChainSummary[];
};

/**
 * Builds the ordered rendered tile list for a viewer.
 *
 * Structural purchaser synthetics are resolved for every eligible property
 * in the topology (not only the viewer's operational sale).
 */
export function composeChainTiles<T extends TopologyProperty>(
  params: ComposeChainTilesParams<T>
): ComposedChainTile[] {
  const {
    chainProperties,
    operationalPosition,
    buyerReadySummaries = [],
  } = params;

  const topology = buildChainTopology(chainProperties, null);
  const tiles: ComposedChainTile[] = [];

  const purchaserStatesByPropertyId =
    resolvePurchaserStatesByPropertyId({
      chainProperties: chainProperties.map((property) => ({
        id: property.id,
        buyer_connected: property.buyer_connected,
        relationship_type: property.relationship_type,
        stage: property.stage,
        address: property.address,
        linked_property_id: property.linked_property_id,
      })),
      buyerReadySummaries,
    });

  const ownerBuyerReadyNodeId =
    operationalPosition?.kind === "buyer_ready"
      ? operationalPosition.nodeId
      : null;

  const ownerBuyerReadyLinkedPropertyId =
    ownerBuyerReadyNodeId != null
      ? buyerReadySummaries.find(
          (summary) => summary.id === ownerBuyerReadyNodeId
        )?.linked_property_id ?? null
      : null;

  if (operationalPosition?.kind === "buyer_ready") {
    tiles.push({
      kind: "buyer_ready",
      anchorPropertyId: null,
      label: CHAIN_TILE_LABEL.buyerReady,
      address: null,
    });
  }

  for (const segment of topology.segments) {
    for (const property of segment.propertyNodes) {
      const isOperationalSale =
        operationalPosition?.kind === "sale" &&
        operationalPosition.propertyId === property.id;

      const upstreamPurchaser = resolveRenderedUpstreamPurchaser({
        upstreamPurchaser:
          purchaserStatesByPropertyId.get(property.id) ?? null,
        propertyId: property.id,
        ownerBuyerReadyNodeId,
        viewerIsAnchorBuyer: property.currentUserRole === "buyer",
      });

      if (upstreamPurchaser?.kind === "awaiting_buyer") {
        tiles.push({
          kind: "awaiting_buyer",
          anchorPropertyId: upstreamPurchaser.anchorPropertyId,
          label: CHAIN_TILE_LABEL.awaitingBuyer,
          address: null,
        });
      } else if (upstreamPurchaser?.kind === "buyer_ready") {
        tiles.push({
          kind: "buyer_ready",
          anchorPropertyId: upstreamPurchaser.anchorPropertyId,
          label: CHAIN_TILE_LABEL.buyerReady,
          address: null,
        });
      } else if (upstreamPurchaser?.kind === "connected_buyer") {
        tiles.push({
          kind: "connected_buyer",
          anchorPropertyId: upstreamPurchaser.anchorPropertyId,
          label: CHAIN_TILE_LABEL.connectedBuyer,
          address: null,
        });
      }

      tiles.push({
        kind: "property",
        anchorPropertyId: property.id,
        label: resolveChainPropertyTileTitle(property, {
          isOperationalPosition: isOperationalSale,
          ownerBuyerReadyLinkedPropertyId,
        }),
        address: property.address,
      });
    }
  }

  return tiles;
}

export function composedTileLabels(
  tiles: ComposedChainTile[]
): string[] {
  return tiles.map((tile) => tile.label);
}

export function composedPropertyIds(
  tiles: ComposedChainTile[]
): number[] {
  return tiles
    .filter((tile) => tile.kind === "property")
    .map((tile) => tile.anchorPropertyId!)
    .filter((id): id is number => id != null);
}
