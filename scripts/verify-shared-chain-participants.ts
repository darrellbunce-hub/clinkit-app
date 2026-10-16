/**
 * Shared chain participant visibility (offline).
 *
 * Every participant sees the same tiles, in the same order, for the same
 * chain; only viewer-relative labels differ. Modelled on a buyer-only
 * purchase that a seller then joined, with the seller's onward purchase
 * linked after it and the buyer's Buyer Ready step linked to the purchase.
 *
 * Usage:
 *   npx tsx scripts/verify-shared-chain-participants.ts
 */

import {
  buildChainTopology,
  type TopologyProperty,
} from "../lib/buildChainTopology";
import type { ChainNodesChainSummary } from "../lib/chainNodesSummary";
import {
  composeChainTiles,
  composedPropertyIds,
  composedTileLabels,
  type ComposedChainTile,
} from "../lib/composeChainTiles";
import {
  CHAIN_TILE_LABEL,
  resolveOperationalPosition,
  type OperationalBuyerReadyNode,
  type OperationalPosition,
  type OperationalProperty,
} from "../lib/operationalPosition";

function assert(name: string, condition: boolean) {
  if (!condition) {
    console.error("FAIL:", name);
    process.exitCode = 1;
  } else {
    console.log("PASS:", name);
  }
}

function assertEqual<T>(name: string, actual: T, expected: T) {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);

  if (actualJson !== expectedJson) {
    console.error("FAIL:", name);
    console.error("  expected:", expectedJson);
    console.error("  actual:  ", actualJson);
    process.exitCode = 1;
  } else {
    console.log("PASS:", name);
  }
}

const CHAIN_ID = 2087;
const PURCHASE_ID = 3173;
const ONWARD_ID = 3174;
const NODE_ID = 156;
const BUYER_ID = "buyer-user";
const SELLER_ID = "seller-user";
const PURCHASE_ADDRESS = "Fixture Purchase House";
const ONWARD_ADDRESS = "Fixture Onward House";

function row(
  overrides: Partial<TopologyProperty> &
    Pick<TopologyProperty, "id" | "chainPosition" | "stage">
): TopologyProperty {
  return {
    status: "healthy",
    currentUserRole: null,
    lastUpdatedDays: 0,
    address: null,
    awaiting_buyer: false,
    is_searching: false,
    buyer_connected: false,
    seller_connected: true,
    relationship_type: null,
    linked_property_id: null,
    ...overrides,
  };
}

type ViewerRow = TopologyProperty & { isOwnProperty: boolean };

function summary(
  overrides: Partial<ChainNodesChainSummary> = {}
): ChainNodesChainSummary {
  return {
    id: NODE_ID,
    chain_id: CHAIN_ID,
    node_type: "buyer_ready",
    position: 0,
    linked_property_id: PURCHASE_ID,
    status: "healthy",
    progress: 10,
    public_stage_label: "Mortgage preparation",
    latest_activity_at: null,
    ...overrides,
  };
}

const buyerNode: OperationalBuyerReadyNode = {
  id: NODE_ID,
  chain_id: CHAIN_ID,
  user_id: BUYER_ID,
  node_type: "buyer_ready",
};

function toOperational(rows: ViewerRow[]): OperationalProperty[] {
  return rows.map((r) => ({
    id: r.id,
    chainId: CHAIN_ID,
    stage: r.stage,
    address: r.address,
    relationship_type: r.relationship_type,
    linked_property_id: r.linked_property_id,
    members: [],
    currentUserRole: r.currentUserRole,
    isOwnProperty: r.isOwnProperty,
    chainPosition: r.chainPosition,
    buyer_connected: r.buyer_connected,
  }));
}

function tilesFor(
  viewerUserId: string | null,
  rows: ViewerRow[],
  nodes: OperationalBuyerReadyNode[],
  summaries: ChainNodesChainSummary[],
  positionOverride?: OperationalPosition | null
): { tiles: ComposedChainTile[]; position: OperationalPosition | null } {
  const position =
    positionOverride !== undefined
      ? positionOverride
      : resolveOperationalPosition(
          viewerUserId,
          CHAIN_ID,
          toOperational(rows),
          nodes
        ).position;

  return {
    position,
    tiles: composeChainTiles({
      chainProperties: rows,
      operationalPosition: position,
      buyerReadySummaries: summaries,
    }),
  };
}

function kinds(tiles: ComposedChainTile[]) {
  return tiles.map((tile) => tile.kind);
}

function buyerReadyCount(tiles: ComposedChainTile[]) {
  return tiles.filter((tile) => tile.kind === "buyer_ready").length;
}

// ---------------------------------------------------------------------------
// 1. Joined buyer-only purchase with onward purchase (chain 2087 shape)
// ---------------------------------------------------------------------------

const purchaseRow = row({
  id: PURCHASE_ID,
  chainPosition: 2,
  stage: "offer_accepted",
  relationship_type: "purchase",
  buyer_connected: true,
  seller_connected: true,
  linked_property_id: ONWARD_ID,
});

const onwardRow = row({
  id: ONWARD_ID,
  chainPosition: 3,
  stage: "offer_accepted",
  status: "pending_connection",
  relationship_type: "purchase",
  buyer_connected: true,
  seller_connected: false,
});

/** Buyer: member (buyer) of the purchase only; onward address masked. */
const buyerView: ViewerRow[] = [
  {
    ...purchaseRow,
    address: PURCHASE_ADDRESS,
    currentUserRole: "buyer",
    isOwnProperty: true,
  },
  { ...onwardRow, address: null, currentUserRole: null, isOwnProperty: false },
];

/** Seller: counterparty seller on the purchase, buyer on the onward row. */
const sellerView: ViewerRow[] = [
  {
    ...purchaseRow,
    address: PURCHASE_ADDRESS,
    currentUserRole: "seller",
    isOwnProperty: true,
  },
  {
    ...onwardRow,
    address: ONWARD_ADDRESS,
    currentUserRole: "buyer",
    isOwnProperty: true,
  },
];

const buyer = tilesFor(BUYER_ID, buyerView, [buyerNode], [summary()]);
const seller = tilesFor(SELLER_ID, sellerView, [buyerNode], [summary()]);

assertEqual(
  "Buyer position is their Buyer Ready step",
  buyer.position,
  { kind: "buyer_ready", chainId: CHAIN_ID, nodeId: NODE_ID }
);
assertEqual(
  "Seller position is the joined purchase (their sale)",
  seller.position,
  { kind: "sale", chainId: CHAIN_ID, propertyId: PURCHASE_ID }
);

assertEqual(
  "Buyer and seller see the same tile kinds in the same order",
  kinds(seller.tiles),
  kinds(buyer.tiles)
);
assertEqual(
  "Shared tile sequence is Buyer Ready, purchase, onward purchase",
  kinds(buyer.tiles),
  ["buyer_ready", "property", "property"]
);
assert(
  "Buyer and seller see the same participant/tile count",
  buyer.tiles.length === 3 && seller.tiles.length === 3
);

for (const [label, view] of [
  ["buyer", buyer],
  ["seller", seller],
] as const) {
  assert(
    `Buyer Ready appears exactly once for the ${label}`,
    buyerReadyCount(view.tiles) === 1
  );
  assert(
    `Buyer Ready is immediately before property ${PURCHASE_ID} for the ${label}`,
    view.tiles[0]?.kind === "buyer_ready" &&
      view.tiles[1]?.kind === "property" &&
      view.tiles[1]?.anchorPropertyId === PURCHASE_ID
  );
  assertEqual(
    `Property order is ${PURCHASE_ID} then ${ONWARD_ID} for the ${label}`,
    composedPropertyIds(view.tiles),
    [PURCHASE_ID, ONWARD_ID]
  );
}

assertEqual(
  "Buyer labels stay viewer-relative",
  composedTileLabels(buyer.tiles),
  [
    CHAIN_TILE_LABEL.buyerReady,
    CHAIN_TILE_LABEL.yourPurchase,
    CHAIN_TILE_LABEL.connectedPurchase,
  ]
);
assertEqual(
  "Seller labels stay viewer-relative",
  composedTileLabels(seller.tiles),
  [
    CHAIN_TILE_LABEL.buyerReady,
    CHAIN_TILE_LABEL.yourSale,
    CHAIN_TILE_LABEL.yourPurchase,
  ]
);

const buyerTopology = buildChainTopology(buyerView, null);
const sellerTopology = buildChainTopology(sellerView, null);
assertEqual(
  "Topology segments and links are identical for both viewers",
  sellerTopology.segments.map((segment) => ({
    gapBefore: segment.gapBefore,
    ids: segment.propertyNodes.map((p) => p.id),
  })),
  buyerTopology.segments.map((segment) => ({
    gapBefore: segment.gapBefore,
    ids: segment.propertyNodes.map((p) => p.id),
  }))
);
assertEqual(
  "Purchase and onward purchase form one linked segment",
  buyerTopology.segments.map((segment) =>
    segment.propertyNodes.map((p) => p.id)
  ),
  [[PURCHASE_ID, ONWARD_ID]]
);

// ---------------------------------------------------------------------------
// 2. Privacy: synthetic tiles carry no address; masked rows stay masked
// ---------------------------------------------------------------------------

for (const [label, view] of [
  ["buyer", buyer],
  ["seller", seller],
] as const) {
  const synthetic = view.tiles.filter((tile) => tile.kind !== "property");
  assert(
    `Synthetic tiles carry no address for the ${label}`,
    synthetic.every((tile) => tile.address === null)
  );
  assert(
    `Synthetic tiles expose only kind, anchor, label and address keys for the ${label}`,
    synthetic.every(
      (tile) =>
        JSON.stringify(Object.keys(tile).sort()) ===
        JSON.stringify(["address", "anchorPropertyId", "kind", "label"])
    )
  );
}

assertEqual(
  "Buyer does not see the seller's onward address",
  buyer.tiles.find((tile) => tile.anchorPropertyId === ONWARD_ID && tile.kind === "property")
    ?.address,
  null
);
assert(
  "No tile shows an address the viewer's rows did not already contain",
  buyer.tiles.every(
    (tile) =>
      tile.address === null ||
      buyerView.some((r) => r.address === tile.address)
  )
);

// ---------------------------------------------------------------------------
// 3. Ambiguous or non-owner perspectives still show one Buyer Ready
// ---------------------------------------------------------------------------

const buyerNoPosition = tilesFor(
  BUYER_ID,
  buyerView,
  [buyerNode],
  [summary()],
  null
);
assertEqual(
  "Buyer with no resolved position still gets one Buyer Ready before the purchase",
  kinds(buyerNoPosition.tiles),
  ["buyer_ready", "property", "property"]
);

const eaView: ViewerRow[] = buyerView.map((r) => ({
  ...r,
  address: null,
  currentUserRole: null,
  isOwnProperty: false,
}));
const ea = tilesFor("ea-user", eaView, [buyerNode], [summary()], null);
assertEqual(
  "Estate-agent viewer sees the same tile sequence",
  kinds(ea.tiles),
  ["buyer_ready", "property", "property"]
);

// ---------------------------------------------------------------------------
// 4. Buyer-only purchase before the seller joins
// ---------------------------------------------------------------------------

const buyerOnlyView: ViewerRow[] = [
  {
    ...purchaseRow,
    status: "pending_connection",
    seller_connected: false,
    linked_property_id: null,
    address: PURCHASE_ADDRESS,
    currentUserRole: "buyer",
    isOwnProperty: true,
  },
];
const buyerOnly = tilesFor(BUYER_ID, buyerOnlyView, [buyerNode], [summary()]);
assertEqual(
  "Buyer-only purchase shows Buyer Ready once and the purchase",
  kinds(buyerOnly.tiles),
  ["buyer_ready", "property"]
);

// ---------------------------------------------------------------------------
// 5. Guards: inbound sale, no summary, Searching placeholder
// ---------------------------------------------------------------------------

const inboundSaleView: ViewerRow[] = [
  {
    ...row({
      id: 3100,
      chainPosition: 1,
      stage: "offer_accepted",
      relationship_type: "sale",
      buyer_connected: true,
      linked_property_id: PURCHASE_ID,
    }),
    isOwnProperty: false,
  },
  { ...purchaseRow, linked_property_id: null, isOwnProperty: false },
];
const inboundSale = tilesFor(null, inboundSaleView, [], [summary()], null);
assertEqual(
  "Purchase with an inbound sale does not add a duplicate Buyer Ready",
  kinds(inboundSale.tiles),
  ["connected_buyer", "property", "property"]
);
assert(
  "Inbound-sale chain has no Buyer Ready tile",
  buyerReadyCount(inboundSale.tiles) === 0
);

const noSummary = tilesFor(SELLER_ID, sellerView, [], []);
assertEqual(
  "Purchase without a matching Buyer Ready summary gets no synthetic tile",
  kinds(noSummary.tiles),
  ["property", "property"]
);

const otherAnchor = tilesFor(
  SELLER_ID,
  sellerView,
  [],
  [summary({ linked_property_id: 9999 })]
);
assertEqual(
  "Summary anchored elsewhere does not attach to the purchase",
  kinds(otherAnchor.tiles),
  ["property", "property"]
);

const searchingView: ViewerRow[] = [
  {
    ...row({
      id: 4001,
      chainPosition: 1,
      stage: "property_listed",
      relationship_type: "sale",
      buyer_connected: false,
      linked_property_id: 4002,
    }),
    address: "Fixture Sale House",
    currentUserRole: "seller",
    isOwnProperty: true,
  },
  {
    ...row({
      id: 4002,
      chainPosition: 2,
      stage: "searching",
      relationship_type: "purchase",
      buyer_connected: true,
      is_searching: true,
    }),
    currentUserRole: "buyer",
    isOwnProperty: true,
  },
];
const searching = tilesFor(
  "sale-seller",
  searchingView,
  [],
  [summary({ id: 900, chain_id: CHAIN_ID, linked_property_id: 4002 })]
);
assertEqual(
  "Searching placeholder never receives a Buyer Ready tile",
  kinds(searching.tiles),
  ["awaiting_buyer", "property", "property"]
);

// ---------------------------------------------------------------------------
// 6. Existing shapes: sale-only and buyer joined to a sale
// ---------------------------------------------------------------------------

const saleOnly = tilesFor(
  "sale-seller",
  [searchingView[0]].map((r) => ({ ...r, linked_property_id: null })),
  [],
  []
);
assertEqual(
  "Sale-only listing still shows Awaiting Buyer then the sale",
  kinds(saleOnly.tiles),
  ["awaiting_buyer", "property"]
);

const joinedSaleRows = (role: "seller" | "buyer"): ViewerRow[] => [
  {
    ...row({
      id: 5001,
      chainPosition: 1,
      stage: "offer_accepted",
      relationship_type: "sale",
      buyer_connected: true,
      linked_property_id: 5002,
    }),
    address: "Fixture Sale House",
    currentUserRole: role,
    isOwnProperty: true,
  },
  {
    ...row({
      id: 5002,
      chainPosition: 2,
      stage: "searching",
      relationship_type: "purchase",
      buyer_connected: true,
      is_searching: true,
    }),
    currentUserRole: role === "seller" ? "buyer" : null,
    isOwnProperty: role === "seller",
  },
];
const joinedSaleNode: OperationalBuyerReadyNode = {
  id: 600,
  chain_id: CHAIN_ID,
  user_id: "joining-buyer",
  node_type: "buyer_ready",
};
const joinedSaleSummary = summary({ id: 600, linked_property_id: 5001 });
const joinedSeller = tilesFor(
  "sale-seller",
  joinedSaleRows("seller"),
  [joinedSaleNode],
  [joinedSaleSummary]
);
const joinedBuyer = tilesFor(
  "joining-buyer",
  joinedSaleRows("buyer"),
  [joinedSaleNode],
  [joinedSaleSummary]
);
assertEqual(
  "Buyer joined to a sale: seller sees Buyer Ready, sale, Searching",
  kinds(joinedSeller.tiles),
  ["buyer_ready", "property", "property"]
);
assertEqual(
  "Buyer joined to a sale: buyer sees the same sequence",
  kinds(joinedBuyer.tiles),
  kinds(joinedSeller.tiles)
);
assert(
  "Buyer joined to a sale: Buyer Ready appears once for each viewer",
  buyerReadyCount(joinedSeller.tiles) === 1 &&
    buyerReadyCount(joinedBuyer.tiles) === 1
);

console.log(
  process.exitCode === 1
    ? "\nSome shared chain participant checks failed."
    : "\nAll shared chain participant checks passed."
);
