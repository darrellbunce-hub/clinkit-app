/**
 * Shared chain-tile composition — mirrors the homeowner chain page assembly.
 *
 * Topology (buildChainTopology) supplies ordered property nodes.
 * Structural synthetics (Awaiting Buyer / Buyer Ready) attach per property.
 * Labels remain viewer/operational-perspective relative.
 */

import {
  buildChainTopology,
  type TopologyProperty,
} from "@/lib/buildChainTopology";
import type { ChainNodesChainSummary } from "@/lib/chainNodesSummary";
import {
  CHAIN_TILE_LABEL,
  getChainTileDisplayTitle,
  type OperationalPosition,
} from "@/lib/operationalPosition";
import {
  resolvePurchaserStatesByPropertyId,
  shouldRenderUpstreamPurchaserBeforeProperty,
} from "@/lib/resolveUpstreamPurchaser";

export type ComposedChainTileKind =
  | "awaiting_buyer"
  | "buyer_ready"
  | "property"
  | "synthetic_terminus";

export type ComposedChainTile = {
  kind: ComposedChainTileKind;
  /** Property the synthetic belongs to, or the property tile id. */
  anchorPropertyId: number | null;
  label: string;
  /** Present for property tiles — privacy-sensitive address as loaded. */
  address: string | null;
};

export type ComposeChainTilesParams<T extends TopologyProperty> = {
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
      })),
      buyerReadySummaries,
    });

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

      const upstreamPurchaser =
        purchaserStatesByPropertyId.get(property.id) ?? null;

      if (
        shouldRenderUpstreamPurchaserBeforeProperty(
          upstreamPurchaser,
          property.id
        )
      ) {
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
        }
      }

      tiles.push({
        kind: "property",
        anchorPropertyId: property.id,
        label: getChainTileDisplayTitle(property, isOperationalSale),
        address: property.address,
      });
    }
  }

  if (topology.syntheticTerminus) {
    tiles.push({
      kind: "synthetic_terminus",
      anchorPropertyId: null,
      label:
        topology.syntheticTerminus.terminus === "end_of_chain"
          ? "End Of Chain"
          : CHAIN_TILE_LABEL.nextHomeSearch,
      address: null,
    });
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
