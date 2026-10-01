/**
 * Arbitrary-length chain invariant regression.
 *
 * Product invariant:
 *   FULL TOPOLOGY + STRUCTURAL STATE FOR RELEVANT NODES
 *   + VIEWER-SPECIFIC LABELS + PRIVACY REDACTION
 *
 * Viewer operational position must not truncate topology or suppress entitled
 * structural synthetics (Awaiting Buyer / Buyer Ready) on upstream nodes.
 *
 * Offline only — does not mutate databases.
 *
 * Usage:
 *   npx tsx scripts/verify-arbitrary-length-chain-invariant.ts
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
  type OperationalProperty,
} from "../lib/operationalPosition";
import {
  applyOperationalSubjectLens,
  resolveOperationalSubject,
  resolveSubjectOperationalPosition,
  type EstateAgentOperationalAssignment,
} from "../lib/operationalSubject";

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

function baseProperty(
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

type ViewerMembership = {
  /** Property ids the viewer owns (address visible; seller/buyer roles set). */
  owned: Array<{
    id: number;
    role: "seller" | "buyer";
    address: string;
  }>;
  userId: string;
};

/**
 * Generates a linear connected chain P1…PN.
 * P1 is an unresolved sale (buyer_connected=false).
 * Intermediate hops are connected; PN is Next Home Search.
 */
function generateLinearChain(length: number): TopologyProperty[] {
  if (length < 3) {
    throw new Error("length must be >= 3");
  }

  const properties: TopologyProperty[] = [];

  for (let index = 0; index < length; index++) {
    const id = index + 1;
    const isLast = index === length - 1;
    const isFirst = index === 0;

    if (isLast) {
      properties.push(
        baseProperty({
          id,
          chainPosition: id,
          stage: "searching",
          address: null,
          relationship_type: "purchase",
          buyer_connected: false,
          seller_connected: true,
          linked_property_id: null,
          is_searching: true,
        })
      );
      continue;
    }

    // Alternate sale / purchase so each mid participant can be seller on a hop.
    const isSaleHop = index % 2 === 0;

    properties.push(
      baseProperty({
        id,
        chainPosition: id,
        stage: isSaleHop ? "property_listed" : "offer_accepted",
        address: `Address ${id}, Test Lane`,
        relationship_type: isSaleHop ? "sale" : "purchase",
        buyer_connected: isFirst ? false : true,
        seller_connected: true,
        linked_property_id: id + 1,
      })
    );
  }

  return properties;
}

function applyViewerPrivacy(
  chain: TopologyProperty[],
  membership: ViewerMembership
): TopologyProperty[] {
  const ownedById = new Map(
    membership.owned.map((entry) => [entry.id, entry])
  );

  return chain.map((property) => {
    const owned = ownedById.get(property.id);

    if (!owned) {
      return {
        ...property,
        address: null,
        currentUserRole: null,
      };
    }

    return {
      ...property,
      address: owned.address,
      currentUserRole: owned.role,
    };
  });
}

function toOperationalProperties(
  properties: TopologyProperty[],
  chainId: number,
  membership: ViewerMembership
): OperationalProperty[] {
  const ownedIds = new Set(membership.owned.map((entry) => entry.id));

  return properties.map((property) => ({
    id: property.id,
    chainId,
    stage: property.stage,
    address: property.address,
    relationship_type: property.relationship_type,
    linked_property_id: property.linked_property_id,
    members: [],
    currentUserRole: property.currentUserRole,
    isOwnProperty: ownedIds.has(property.id),
    chainPosition: property.chainPosition,
    buyer_connected: property.buyer_connected,
  }));
}

function membershipForSellerAt(
  salePropertyId: number,
  purchasePropertyId: number,
  userId: string
): ViewerMembership {
  return {
    userId,
    owned: [
      {
        id: salePropertyId,
        role: "seller",
        address: `Owned sale ${salePropertyId}`,
      },
      {
        id: purchasePropertyId,
        role: "buyer",
        address: `Owned purchase ${purchasePropertyId}`,
      },
    ],
  };
}

function assertNoAddressLeak(
  name: string,
  tiles: ComposedChainTile[],
  forbiddenAddresses: string[]
) {
  const leaked = tiles.some((tile) =>
    forbiddenAddresses.some(
      (address) =>
        (tile.address != null && tile.address.includes(address)) ||
        tile.label.includes(address)
    )
  );

  assert(`${name} — no private address leak`, !leaked);
}

function assertAwaitingBuyerBeforeProperty(
  name: string,
  tiles: ComposedChainTile[],
  propertyId: number
) {
  const awaitingIndex = tiles.findIndex(
    (tile) =>
      tile.kind === "awaiting_buyer" &&
      tile.anchorPropertyId === propertyId
  );
  const propertyIndex = tiles.findIndex(
    (tile) =>
      tile.kind === "property" &&
      tile.anchorPropertyId === propertyId
  );

  assert(
    `${name} — Awaiting Buyer present for P${propertyId}`,
    awaitingIndex >= 0
  );
  assert(
    `${name} — Awaiting Buyer immediately before P${propertyId}`,
    awaitingIndex >= 0 &&
      propertyIndex === awaitingIndex + 1
  );
}

function assertBuyerReadyBeforeProperty(
  name: string,
  tiles: ComposedChainTile[],
  propertyId: number
) {
  const readyIndex = tiles.findIndex(
    (tile) =>
      tile.kind === "buyer_ready" &&
      tile.anchorPropertyId === propertyId
  );
  const propertyIndex = tiles.findIndex(
    (tile) =>
      tile.kind === "property" &&
      tile.anchorPropertyId === propertyId
  );

  assert(
    `${name} — Buyer Ready present for P${propertyId}`,
    readyIndex >= 0
  );
  assert(
    `${name} — Buyer Ready immediately before P${propertyId}`,
    readyIndex >= 0 && propertyIndex === readyIndex + 1
  );
}

// ---------------------------------------------------------------------------
// Part A — A/B smoke (3-node)
// ---------------------------------------------------------------------------

const CHAIN_ID_AB = 9001;

const abBase = generateLinearChain(3);
// Force classic Part 3 shapes: P1 sale, P2 purchase, P3 searching
abBase[0] = baseProperty({
  id: 1,
  chainPosition: 1,
  stage: "property_listed",
  address: "1 Cuckoo Lane",
  relationship_type: "sale",
  buyer_connected: false,
  seller_connected: true,
  linked_property_id: 2,
});
abBase[1] = baseProperty({
  id: 2,
  chainPosition: 2,
  stage: "offer_accepted",
  address: "10 Downing Street",
  relationship_type: "purchase",
  buyer_connected: true,
  seller_connected: true,
  linked_property_id: 3,
});

const membershipA = membershipForSellerAt(1, 2, "user-a");
const membershipB = membershipForSellerAt(2, 3, "user-b");
// B sells the purchase hop (counterparty); searching stays address-null
membershipB.owned = [
  { id: 2, role: "seller", address: "10 Downing Street" },
  { id: 3, role: "buyer", address: "" },
];
// Searching placeholders are address-null even for the owner
function forceSearchingAddressNull(
  properties: TopologyProperty[]
): TopologyProperty[] {
  return properties.map((property) =>
    property.stage === "searching"
      ? { ...property, address: null }
      : property
  );
}

const viewA = forceSearchingAddressNull(
  applyViewerPrivacy(abBase, membershipA)
);
const viewB = forceSearchingAddressNull(
  applyViewerPrivacy(abBase, membershipB)
);

const posA = resolveOperationalPosition(
  membershipA.userId,
  CHAIN_ID_AB,
  toOperationalProperties(viewA, CHAIN_ID_AB, membershipA),
  []
);
const posB = resolveOperationalPosition(
  membershipB.userId,
  CHAIN_ID_AB,
  toOperationalProperties(viewB, CHAIN_ID_AB, membershipB),
  []
);

const tilesA = composeChainTiles({
  chainProperties: viewA,
  operationalPosition: posA.position,
});
const tilesB = composeChainTiles({
  chainProperties: viewB,
  operationalPosition: posB.position,
});

assertEqual(
  "A/B — User A rendered tiles",
  composedTileLabels(tilesA),
  [
    CHAIN_TILE_LABEL.awaitingBuyer,
    CHAIN_TILE_LABEL.yourSale,
    CHAIN_TILE_LABEL.connectedPurchase,
    CHAIN_TILE_LABEL.nextHomeSearch,
  ]
);

assertEqual(
  "A/B — User B rendered tiles (must include P1 Awaiting Buyer)",
  composedTileLabels(tilesB),
  [
    CHAIN_TILE_LABEL.awaitingBuyer,
    CHAIN_TILE_LABEL.connectedBuyer,
    CHAIN_TILE_LABEL.yourSale,
    CHAIN_TILE_LABEL.nextHomeSearch,
  ]
);

assertAwaitingBuyerBeforeProperty("A/B User A", tilesA, 1);
assertAwaitingBuyerBeforeProperty("A/B User B", tilesB, 1);

assertEqual(
  "A/B — both viewers see property ids 1→2→3",
  composedPropertyIds(tilesA),
  [1, 2, 3]
);
assertEqual(
  "A/B — User B property ids unchanged by perspective",
  composedPropertyIds(tilesB),
  [1, 2, 3]
);

assertNoAddressLeak("A/B User B", tilesB, ["1 Cuckoo Lane"]);
assert(
  "A/B User B — P1 address remains null (privacy)",
  viewB.find((p) => p.id === 1)?.address === null
);

// ---------------------------------------------------------------------------
// Part B — 11-node arbitrary-length chain
// ---------------------------------------------------------------------------

const CHAIN_ID_LONG = 9011;
const LENGTH = 11;
const longChain = generateLinearChain(LENGTH);
const expectedIds = Array.from({ length: LENGTH }, (_, i) => i + 1);

type ViewerSpec = {
  name: string;
  saleId: number;
  purchaseId: number;
};

const viewerSpecs: ViewerSpec[] = [
  { name: "P1", saleId: 1, purchaseId: 2 },
  { name: "P3", saleId: 3, purchaseId: 4 },
  { name: "P6", saleId: 6, purchaseId: 7 },
  { name: "P8", saleId: 8, purchaseId: 9 },
  { name: "P11", saleId: 10, purchaseId: 11 },
];

for (const spec of viewerSpecs) {
  const membership = membershipForSellerAt(
    spec.saleId,
    spec.purchaseId,
    `viewer-${spec.name}`
  );

  // Terminal searcher: seller on last connected hop, buyer on searching
  if (spec.name === "P11") {
    membership.owned = [
      {
        id: 10,
        role: "seller",
        address: "Owned sale 10",
      },
      {
        id: 11,
        role: "buyer",
        address: "",
      },
    ];
  }

  // P6 is a purchase-type hop in the alternating model (index 5 → id 6).
  // Viewer at P6 sells that purchase hop (counterparty) and buys P7.
  if (spec.name === "P6") {
    membership.owned = [
      { id: 6, role: "seller", address: "Owned at 6" },
      { id: 7, role: "buyer", address: "Owned at 7" },
    ];
  }

  const view = forceSearchingAddressNull(
    applyViewerPrivacy(longChain, membership)
  );
  const operational = toOperationalProperties(
    view,
    CHAIN_ID_LONG,
    membership
  );
  const { position } = resolveOperationalPosition(
    membership.userId,
    CHAIN_ID_LONG,
    operational,
    []
  );

  const tiles = composeChainTiles({
    chainProperties: view,
    operationalPosition: position,
  });

  const topology = buildChainTopology(view, null);

  assertEqual(
    `${spec.name} — full topology property ids`,
    topology.flatPropertyNodes.map((p) => p.id),
    expectedIds
  );

  assertEqual(
    `${spec.name} — composed property ids match topology`,
    composedPropertyIds(tiles),
    expectedIds
  );

  assertAwaitingBuyerBeforeProperty(spec.name, tiles, 1);

  const yourSaleCount = tiles.filter(
    (tile) => tile.label === CHAIN_TILE_LABEL.yourSale
  ).length;
  assert(
    `${spec.name} — exactly one Your Sale perspective label`,
    yourSaleCount === 1
  );

  assert(
    `${spec.name} — Next Home Search present at end`,
    tiles.some(
      (tile) =>
        tile.kind === "property" &&
        tile.anchorPropertyId === LENGTH &&
        tile.label === CHAIN_TILE_LABEL.nextHomeSearch
    )
  );

  const foreignAddresses = longChain
    .filter((p) => p.address && !membership.owned.some((o) => o.id === p.id))
    .map((p) => p.address as string);

  assertNoAddressLeak(spec.name, tiles, foreignAddresses);

  for (const property of view) {
    if (!membership.owned.some((o) => o.id === property.id)) {
      assert(
        `${spec.name} — P${property.id} redacted address null`,
        property.address === null
      );
    }
  }

  assert(
    `${spec.name} — redaction does not drop P1 node`,
    composedPropertyIds(tiles).includes(1)
  );
  assert(
    `${spec.name} — redaction does not drop P${LENGTH} node`,
    composedPropertyIds(tiles).includes(LENGTH)
  );
}

// Mid-chain (P8) must still see P1 structural state — multi-hop proof
{
  const membership = membershipForSellerAt(8, 9, "viewer-P8-proof");
  const view = forceSearchingAddressNull(
    applyViewerPrivacy(longChain, membership)
  );
  const { position } = resolveOperationalPosition(
    membership.userId,
    CHAIN_ID_LONG,
    toOperationalProperties(view, CHAIN_ID_LONG, membership),
    []
  );
  const tiles = composeChainTiles({
    chainProperties: view,
    operationalPosition: position,
  });

  assert(
    "Multi-hop — P8 operational sale is not P1",
    position?.kind === "sale" && position.propertyId === 8
  );
  assertAwaitingBuyerBeforeProperty("Multi-hop P8→P1", tiles, 1);
  assertEqual(
    "Multi-hop — P8 still sees through P11",
    composedPropertyIds(tiles),
    expectedIds
  );
}

// Downstream proof from near-start (P1 viewer sees through P11)
{
  const membership = membershipForSellerAt(1, 2, "viewer-P1-down");
  const view = applyViewerPrivacy(longChain, membership);
  const { position } = resolveOperationalPosition(
    membership.userId,
    CHAIN_ID_LONG,
    toOperationalProperties(view, CHAIN_ID_LONG, membership),
    []
  );
  const tiles = composeChainTiles({
    chainProperties: view,
    operationalPosition: position,
  });
  assertEqual(
    "Downstream — P1 viewer sees complete chain through P11",
    composedPropertyIds(tiles),
    expectedIds
  );
}

// ---------------------------------------------------------------------------
// Part C — Buyer Ready structural state (same per-property principle)
// ---------------------------------------------------------------------------

{
  const brChain = generateLinearChain(5).map((property) =>
    property.id === 1
      ? { ...property, buyer_connected: true }
      : property
  );

  const buyerReadySummary: ChainNodesChainSummary = {
    id: 5001,
    chain_id: CHAIN_ID_LONG,
    node_type: "buyer_ready",
    position: 0,
    linked_property_id: 1,
    status: "healthy",
    progress: 20,
    public_stage_label: "Mortgage preparation",
    latest_activity_at: null,
  };

  const midMembership = membershipForSellerAt(3, 4, "viewer-br-mid");
  const midView = forceSearchingAddressNull(
    applyViewerPrivacy(brChain, midMembership)
  );
  const { position } = resolveOperationalPosition(
    midMembership.userId,
    CHAIN_ID_LONG,
    toOperationalProperties(midView, CHAIN_ID_LONG, midMembership),
    []
  );

  assert(
    "Buyer Ready fixture — mid viewer ops sale is P3 not P1",
    position?.kind === "sale" && position.propertyId === 3
  );

  const tiles = composeChainTiles({
    chainProperties: midView,
    operationalPosition: position,
    buyerReadySummaries: [buyerReadySummary],
  });

  assertBuyerReadyBeforeProperty(
    "Buyer Ready mid-chain viewer",
    tiles,
    1
  );
  assertEqual(
    "Buyer Ready — full property topology retained",
    composedPropertyIds(tiles),
    [1, 2, 3, 4, 5]
  );
}

// ---------------------------------------------------------------------------
// Part D — EA mid-chain inherits client topology + structural states
// ---------------------------------------------------------------------------

{
  // Assign EA to a mid-chain sale-type hop (P3) so subject lens matches
  // the client's seller perspective (purchase-row assignment uses
  // relationship_type, not counterparty seller role).
  const eaChainId = 9020;
  const clientMembership = membershipForSellerAt(3, 4, "client-at-p3");

  const clientView = forceSearchingAddressNull(
    applyViewerPrivacy(longChain, clientMembership)
  );
  const clientOps = toOperationalProperties(
    clientView,
    eaChainId,
    clientMembership
  );

  const clientPos = resolveOperationalPosition(
    clientMembership.userId,
    eaChainId,
    clientOps,
    []
  );
  const clientTiles = composeChainTiles({
    chainProperties: clientView,
    operationalPosition: clientPos.position,
  });

  const assignments: EstateAgentOperationalAssignment[] = [
    {
      propertyId: 3,
      chainId: eaChainId,
      subjectUserId: clientMembership.userId,
      homeownerOnlyUpdates: false,
    },
  ];

  const eaSubject = resolveOperationalSubject({
    viewerUserId: "ea-agent-1",
    accountType: "estate_agent",
    chainId: eaChainId,
    chainProperties: clientOps,
    estateAgentAssignments: assignments,
  });

  const eaPos = resolveSubjectOperationalPosition({
    subject: eaSubject,
    chainId: eaChainId,
    chainProperties: clientOps,
    chainNodes: [] as OperationalBuyerReadyNode[],
  });

  const eaLensed = applyOperationalSubjectLens(clientOps, eaSubject);
  const eaTopologyProps = clientView.map((property) => {
    const lensed = eaLensed.find((row) => row.id === property.id);
    return {
      ...property,
      currentUserRole:
        lensed?.currentUserRole ?? property.currentUserRole,
    };
  });

  const eaTiles = composeChainTiles({
    chainProperties: eaTopologyProps,
    operationalPosition: eaPos.position,
  });

  assert(
    "EA mid-chain — assigned to P3 (not chain start)",
    eaSubject?.assignedPropertyId === 3
  );
  assertEqual(
    "EA mid-chain — same property topology as client",
    composedPropertyIds(eaTiles),
    composedPropertyIds(clientTiles)
  );
  assertAwaitingBuyerBeforeProperty("EA mid-chain", eaTiles, 1);
  assertEqual(
    "EA mid-chain — same structural tile labels as client",
    composedTileLabels(eaTiles),
    composedTileLabels(clientTiles)
  );
  assertNoAddressLeak("EA mid-chain", eaTiles, [
    "Address 1, Test Lane",
    "Address 2, Test Lane",
  ]);
}

if (process.exitCode && process.exitCode !== 0) {
  console.error(
    "\nArbitrary-length chain invariant verification FAILED"
  );
  process.exit(process.exitCode);
}

console.log("\nArbitrary-length chain invariant verification PASSED");
