/**
 * Buyer join / Buyer Ready / chain visibility regression (offline).
 *
 * Scenario: an estate agent lists "887 Jenni Road" with the seller's onward
 * search as an (unowned) searching placeholder. A buying-only homeowner joins
 * the sale with the access code.
 *
 * Product rules:
 *   - Start Move carries "not selling" to Join Chain; Buyer Ready is created
 *     for the joining buyer only.
 *   - Every authorised viewer sees the same topology (incl. every searching
 *     placeholder, exactly once); only relative labels differ.
 *   - The EA never loses the connected-buyer state.
 *   - The homeowner sees "Your Purchase", never "Connected Buyer".
 *
 * Usage:
 *   npx tsx scripts/verify-buyer-join-perspective.ts
 */

import { readFileSync } from "node:fs";
import path from "node:path";

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
  buildJoinExistingChainHref,
  readJoinChainIntent,
  resolveBuyingAwaitingConnectionAction,
  shouldCreateBuyerReadyOnJoin,
} from "../lib/onboarding/joinChainIntent";
import {
  CHAIN_TILE_LABEL,
  getDashboardChainTitle,
  getParticipantPropertyLabel,
  getPropertyPageHeadline,
  getPropertyPageSubtitle,
  resolveOperationalPosition,
  type OperationalBuyerReadyNode,
  type OperationalPosition,
  type OperationalProperty,
} from "../lib/operationalPosition";
import {
  applyOperationalSubjectLens,
  resolveOperationalSubject,
  resolveSubjectOperationalPosition,
} from "../lib/operationalSubject";
import {
  resolvePurchaserStateForProperty,
  resolveRenderedUpstreamPurchaser,
} from "../lib/resolveUpstreamPurchaser";

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

function searchParams(query: string) {
  return new URLSearchParams(query.replace(/^.*\?/, ""));
}

// ---------------------------------------------------------------------------
// 1. Intent hand-off (Start Move → Join Chain)
// ---------------------------------------------------------------------------

const buyingOnlyAction = resolveBuyingAwaitingConnectionAction({
  hasSellingAddress: false,
});
assertEqual(
  "Buying-only awaiting-connection match joins directly with not-selling intent",
  buyingOnlyAction,
  { kind: "join", notSelling: true }
);
assertEqual(
  "Buyer with a sale creates the sale first (no not-selling intent)",
  resolveBuyingAwaitingConnectionAction({ hasSellingAddress: true }),
  { kind: "join_after_sale" }
);

const buyingOnlyHref = buildJoinExistingChainHref({
  sourceChainId: null,
  searching: false,
  notSelling: true,
});
assertEqual(
  "Buying-only join href carries notSelling",
  buyingOnlyHref,
  "/join-chain?notSelling=1"
);
assertEqual(
  "Join Chain reads not-selling intent from the route",
  readJoinChainIntent(searchParams(buyingOnlyHref)),
  { sourceChainId: null, searchingIntent: false, notSellingIntent: true }
);
assertEqual(
  "Source-chain join never carries notSelling (migration path unchanged)",
  buildJoinExistingChainHref({
    sourceChainId: 42,
    searching: true,
    notSelling: true,
  }),
  "/join-chain?sourceChain=42&searching=1"
);
assertEqual(
  "notSelling is ignored when a source chain is present",
  readJoinChainIntent(searchParams("?sourceChain=42&notSelling=1"))
    .notSellingIntent,
  false
);
assertEqual(
  "Seller-side direct join carries no intent",
  buildJoinExistingChainHref({
    sourceChainId: null,
    searching: false,
    notSelling: false,
  }),
  "/join-chain"
);
assertEqual(
  "Bare /join-chain defaults to selling (manual checkbox still applies)",
  readJoinChainIntent(searchParams("")),
  { sourceChainId: null, searchingIntent: false, notSellingIntent: false }
);

assert(
  "Buyer Ready created for a buyer join with nothing to sell",
  shouldCreateBuyerReadyOnJoin({ joiningRole: "buyer", nothingToSell: true })
);
assert(
  "No Buyer Ready for a buyer join that is selling",
  !shouldCreateBuyerReadyOnJoin({
    joiningRole: "buyer",
    nothingToSell: false,
  })
);
assert(
  "No Buyer Ready for a seller join",
  !shouldCreateBuyerReadyOnJoin({ joiningRole: "seller", nothingToSell: true })
);

const root = path.resolve(__dirname, "..");
const startMoveSource = readFileSync(
  path.join(root, "app/start-move/page.tsx"),
  "utf8"
);
const joinChainSource = readFileSync(
  path.join(root, "app/join-chain/page.tsx"),
  "utf8"
);

assert(
  "Start Move resolves the buying awaiting-connection action via the shared helper",
  startMoveSource.includes("resolveBuyingAwaitingConnectionAction(")
);
assert(
  "Start Move builds the Join Chain href via the shared helper",
  startMoveSource.includes("buildJoinExistingChainHref(") &&
    startMoveSource.includes("notSelling: action.notSelling")
);
assert(
  "Join Chain initialises nothingToSell from route intent",
  joinChainSource.includes("readJoinChainIntent(searchParams)") &&
    joinChainSource.includes("useState(notSellingIntent)")
);
assert(
  "Join Chain gates Buyer Ready on the shared rule and the guarded helper",
  joinChainSource.includes("shouldCreateBuyerReadyOnJoin(") &&
    joinChainSource.includes("ensureBuyerReadyOnJoin(")
);
assert(
  "Join Chain only migrates/cleans up with a source chain",
  /if\s*\(\s*sourceChainId\s*\)/.test(joinChainSource)
);

// ---------------------------------------------------------------------------
// 2. Purchaser state + de-duplication
// ---------------------------------------------------------------------------

const SALE_ID = 887;
const PLACEHOLDER_ID = 888;
const CHAIN_ID = 7887;
const HOMEOWNER_ID = "homeowner-buyer";
const SELLER_ID = "seller-887";
const EA_ID = "ea-887";
const NODE_ID = 5001;
const SALE_ADDRESS = "887 Jenni Road";

const buyerReadySummary: ChainNodesChainSummary = {
  id: NODE_ID,
  chain_id: CHAIN_ID,
  node_type: "buyer_ready",
  position: 0,
  linked_property_id: SALE_ID,
  status: "healthy",
  progress: 10,
  public_stage_label: "Mortgage in principle",
  latest_activity_at: null,
};

assertEqual(
  "Joined sale with Buyer Ready → buyer_ready",
  resolvePurchaserStateForProperty({
    propertyId: SALE_ID,
    chainProperties: [
      {
        id: SALE_ID,
        buyer_connected: true,
        relationship_type: "sale",
        linked_property_id: PLACEHOLDER_ID,
      },
    ],
    buyerReadySummaries: [buyerReadySummary],
  })?.kind,
  "buyer_ready"
);
assertEqual(
  "Joined sale without a node → connected_buyer (never disappears)",
  resolvePurchaserStateForProperty({
    propertyId: SALE_ID,
    chainProperties: [
      {
        id: SALE_ID,
        buyer_connected: true,
        relationship_type: "sale",
        linked_property_id: PLACEHOLDER_ID,
      },
    ],
    buyerReadySummaries: [],
  }),
  { kind: "connected_buyer", anchorPropertyId: SALE_ID }
);
assertEqual(
  "Unjoined sale → awaiting_buyer",
  resolvePurchaserStateForProperty({
    propertyId: SALE_ID,
    chainProperties: [
      { id: SALE_ID, buyer_connected: false, relationship_type: "sale" },
    ],
    buyerReadySummaries: [],
  })?.kind,
  "awaiting_buyer"
);

assertEqual(
  "Owner's own Buyer Ready is not drawn twice (prefix only)",
  resolveRenderedUpstreamPurchaser({
    upstreamPurchaser: {
      kind: "buyer_ready",
      anchorPropertyId: SALE_ID,
      summary: buyerReadySummary,
    },
    propertyId: SALE_ID,
    ownerBuyerReadyNodeId: NODE_ID,
  }),
  null
);
assertEqual(
  "Other viewers still see the anchored Buyer Ready",
  resolveRenderedUpstreamPurchaser({
    upstreamPurchaser: {
      kind: "buyer_ready",
      anchorPropertyId: SALE_ID,
      summary: buyerReadySummary,
    },
    propertyId: SALE_ID,
    ownerBuyerReadyNodeId: null,
  })?.kind,
  "buyer_ready"
);
assertEqual(
  "Connected Buyer is not drawn for the buyer themself",
  resolveRenderedUpstreamPurchaser({
    upstreamPurchaser: {
      kind: "connected_buyer",
      anchorPropertyId: SALE_ID,
    },
    propertyId: SALE_ID,
    viewerIsAnchorBuyer: true,
  }),
  null
);

// ---------------------------------------------------------------------------
// 3. Jenni Road scenario — homeowner and EA perspectives
// ---------------------------------------------------------------------------

function topologyRow(
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

type ScenarioOptions = {
  joined: boolean;
  placeholderConverted?: boolean;
};

/** Canonical chain rows (no viewer applied). */
function canonicalRows(options: ScenarioOptions): TopologyProperty[] {
  return [
    topologyRow({
      id: SALE_ID,
      chainPosition: 1,
      stage: "property_listed",
      address: SALE_ADDRESS,
      relationship_type: "sale",
      buyer_connected: options.joined,
      linked_property_id: PLACEHOLDER_ID,
    }),
    options.placeholderConverted
      ? topologyRow({
          id: PLACEHOLDER_ID,
          chainPosition: 2,
          stage: "awaiting_connection",
          address: "Flat 1, Onward Court",
          relationship_type: "purchase",
          buyer_connected: true,
          seller_connected: false,
        })
      : topologyRow({
          id: PLACEHOLDER_ID,
          chainPosition: 2,
          stage: "searching",
          address: null,
          relationship_type: "purchase",
          buyer_connected: true,
          is_searching: true,
        }),
  ];
}

/** Participant view for the joined buyer: address only on the sale they buy. */
function homeownerView(options: ScenarioOptions): TopologyProperty[] {
  return canonicalRows(options).map((row) =>
    row.id === SALE_ID
      ? { ...row, currentUserRole: "buyer" }
      : { ...row, address: null, currentUserRole: null }
  );
}

/** Participant view for the assigned EA (no membership roles). */
function eaView(options: ScenarioOptions): TopologyProperty[] {
  return canonicalRows(options).map((row) => ({
    ...row,
    currentUserRole: null,
  }));
}

function toOperational(
  rows: TopologyProperty[],
  ownIds: number[] = []
): OperationalProperty[] {
  return rows.map((row) => ({
    id: row.id,
    chainId: CHAIN_ID,
    stage: row.stage,
    address: row.address,
    relationship_type: row.relationship_type,
    linked_property_id: row.linked_property_id,
    members: [],
    currentUserRole: row.currentUserRole,
    isOwnProperty: ownIds.includes(row.id),
    chainPosition: row.chainPosition,
    buyer_connected: row.buyer_connected,
  }));
}

function homeownerTiles(
  options: ScenarioOptions,
  hasBuyerReady: boolean
): { tiles: ComposedChainTile[]; position: OperationalPosition | null } {
  const rows = homeownerView(options);
  const nodes: OperationalBuyerReadyNode[] = hasBuyerReady
    ? [
        {
          id: NODE_ID,
          chain_id: CHAIN_ID,
          user_id: HOMEOWNER_ID,
          node_type: "buyer_ready",
        },
      ]
    : [];
  const { position } = resolveOperationalPosition(
    HOMEOWNER_ID,
    CHAIN_ID,
    toOperational(rows),
    nodes
  );

  return {
    position,
    tiles: composeChainTiles({
      chainProperties: rows,
      operationalPosition: position,
      buyerReadySummaries: hasBuyerReady ? [buyerReadySummary] : [],
    }),
  };
}

function eaTiles(
  options: ScenarioOptions,
  hasBuyerReady: boolean,
  subjectUserId: string | null
): { tiles: ComposedChainTile[]; position: OperationalPosition | null } {
  const rows = eaView(options);
  const operational = toOperational(rows);
  const subject = resolveOperationalSubject({
    viewerUserId: EA_ID,
    accountType: "estate_agent",
    chainId: CHAIN_ID,
    chainProperties: operational,
    estateAgentAssignments: [
      {
        propertyId: SALE_ID,
        chainId: CHAIN_ID,
        subjectUserId,
        homeownerOnlyUpdates: true,
      },
    ],
  });
  const lensed = applyOperationalSubjectLens(operational, subject);
  const roleById = new Map(
    lensed.map((property) => [property.id, property.currentUserRole ?? null])
  );
  const subjectRows = rows.map((row) => ({
    ...row,
    currentUserRole: roleById.get(row.id) ?? null,
  }));
  const { position } = resolveSubjectOperationalPosition({
    subject,
    chainId: CHAIN_ID,
    chainProperties: operational,
    chainNodes: hasBuyerReady
      ? [
          {
            id: NODE_ID,
            chain_id: CHAIN_ID,
            user_id: HOMEOWNER_ID,
            node_type: "buyer_ready",
          },
        ]
      : [],
  });

  return {
    position,
    tiles: composeChainTiles({
      chainProperties: subjectRows,
      operationalPosition: position,
      buyerReadySummaries: hasBuyerReady ? [buyerReadySummary] : [],
    }),
  };
}

function searchTiles(tiles: ComposedChainTile[]) {
  return tiles.filter(
    (tile) =>
      tile.label === CHAIN_TILE_LABEL.nextHomeSearch ||
      tile.label === CHAIN_TILE_LABEL.sellerNextHomeSearch
  );
}

for (const [label, subjectUserId] of [
  ["seller connected", SELLER_ID],
  ["EA-only listing", null],
] as const) {
  const before = eaTiles({ joined: false }, false, subjectUserId);
  assertEqual(
    `EA (${label}) before join: Awaiting Buyer / Your Sale / Next Home Search`,
    composedTileLabels(before.tiles),
    [
      CHAIN_TILE_LABEL.awaitingBuyer,
      CHAIN_TILE_LABEL.yourSale,
      CHAIN_TILE_LABEL.nextHomeSearch,
    ]
  );

  const after = eaTiles({ joined: true }, true, subjectUserId);
  assertEqual(
    `EA (${label}) after join: Buyer Ready / Your Sale / Next Home Search`,
    composedTileLabels(after.tiles),
    [
      CHAIN_TILE_LABEL.buyerReady,
      CHAIN_TILE_LABEL.yourSale,
      CHAIN_TILE_LABEL.nextHomeSearch,
    ]
  );
  assertEqual(
    `EA (${label}) position stays the sale (buyer's node is never the EA's)`,
    after.position?.kind === "sale" ? after.position.propertyId : null,
    SALE_ID
  );

  const legacy = eaTiles({ joined: true }, false, subjectUserId);
  assertEqual(
    `EA (${label}) legacy join without node: Connected Buyer / Your Sale / Next Home Search`,
    composedTileLabels(legacy.tiles),
    [
      CHAIN_TILE_LABEL.connectedBuyer,
      CHAIN_TILE_LABEL.yourSale,
      CHAIN_TILE_LABEL.nextHomeSearch,
    ]
  );
}

const homeownerAfter = homeownerTiles({ joined: true }, true);
assertEqual(
  "Homeowner position is Buyer Ready",
  homeownerAfter.position?.kind,
  "buyer_ready"
);
assertEqual(
  "Homeowner after join: Buyer Ready / Your Purchase / Seller's Next Home Search",
  composedTileLabels(homeownerAfter.tiles),
  [
    CHAIN_TILE_LABEL.buyerReady,
    CHAIN_TILE_LABEL.yourPurchase,
    CHAIN_TILE_LABEL.sellerNextHomeSearch,
  ]
);
assert(
  "Homeowner never sees Connected Buyer for their own purchase",
  !composedTileLabels(homeownerAfter.tiles).includes(
    CHAIN_TILE_LABEL.connectedBuyer
  )
);
assertEqual(
  "Homeowner sees exactly one Buyer Ready tile",
  homeownerAfter.tiles.filter((tile) => tile.kind === "buyer_ready").length,
  1
);

const homeownerLegacy = homeownerTiles({ joined: true }, false);
assertEqual(
  "Homeowner legacy join without node: Your Purchase / Seller's Next Home Search",
  composedTileLabels(homeownerLegacy.tiles),
  [CHAIN_TILE_LABEL.yourPurchase, CHAIN_TILE_LABEL.sellerNextHomeSearch]
);

const eaAfter = eaTiles({ joined: true }, true, SELLER_ID);
for (const [viewer, tiles] of [
  ["homeowner", homeownerAfter.tiles],
  ["EA", eaAfter.tiles],
] as const) {
  assertEqual(
    `${viewer}: same property topology (sale → placeholder)`,
    composedPropertyIds(tiles),
    [SALE_ID, PLACEHOLDER_ID]
  );
  const search = searchTiles(tiles);
  assert(
    `${viewer}: placeholder visible exactly once, as the real placeholder row`,
    search.length === 1 &&
      search[0].kind === "property" &&
      search[0].anchorPropertyId === PLACEHOLDER_ID
  );
}

// Dashboard / property page labels for the joined buyer
const homeownerDashboardRows = homeownerView({ joined: true }).map((row) => ({
  ...row,
  chainId: CHAIN_ID,
  isOwnProperty: false,
}));
assertEqual(
  "Homeowner dashboard chain title is the purchase address (not Property chain)",
  getDashboardChainTitle(CHAIN_ID, homeownerDashboardRows),
  SALE_ADDRESS
);
assertEqual(
  "Homeowner dashboard chain title with explicit null operational id",
  getDashboardChainTitle(CHAIN_ID, homeownerDashboardRows, null),
  SALE_ADDRESS
);
assertEqual(
  "Homeowner dashboard row label: Your Purchase — address",
  getParticipantPropertyLabel(homeownerDashboardRows[0], null),
  `${CHAIN_TILE_LABEL.yourPurchase} — ${SALE_ADDRESS}`
);
assertEqual(
  "Homeowner dashboard placeholder label is relative (seller's search)",
  getParticipantPropertyLabel(homeownerDashboardRows[1], null),
  CHAIN_TILE_LABEL.sellerNextHomeSearch
);
assertEqual(
  "Property page headline for the purchase",
  getPropertyPageHeadline(homeownerDashboardRows[0], false),
  `${CHAIN_TILE_LABEL.yourPurchase} — ${SALE_ADDRESS}`
);
assertEqual(
  "Property page subtitle for the purchase",
  getPropertyPageSubtitle(homeownerDashboardRows[0], false),
  "This is your purchase in the chain."
);
assertEqual(
  "Property page subtitle for the seller's placeholder",
  getPropertyPageSubtitle(homeownerDashboardRows[1], false),
  "The seller's onward home has not been chosen yet."
);

// ---------------------------------------------------------------------------
// 4. Onward progression: placeholder converted → awaiting connection
// ---------------------------------------------------------------------------

const homeownerConverted = homeownerTiles(
  { joined: true, placeholderConverted: true },
  true
);
assertEqual(
  "Homeowner after seller's purchase identified: Buyer Ready / Your Purchase / Connected Purchase",
  composedTileLabels(homeownerConverted.tiles),
  [
    CHAIN_TILE_LABEL.buyerReady,
    CHAIN_TILE_LABEL.yourPurchase,
    CHAIN_TILE_LABEL.connectedPurchase,
  ]
);
const eaConverted = eaTiles(
  { joined: true, placeholderConverted: true },
  true,
  SELLER_ID
);
assertEqual(
  "EA after seller's purchase identified: Buyer Ready / Your Sale / Your Purchase",
  composedTileLabels(eaConverted.tiles),
  [
    CHAIN_TILE_LABEL.buyerReady,
    CHAIN_TILE_LABEL.yourSale,
    CHAIN_TILE_LABEL.yourPurchase,
  ]
);
assertEqual(
  "Converted purchase ends the chain for both viewers (no invented search)",
  [
    searchTiles(homeownerConverted.tiles).length,
    searchTiles(eaConverted.tiles).length,
  ],
  [0, 0]
);

// ---------------------------------------------------------------------------
// 5. Chain end states — Awaiting Buyer vs Searching (never synthesised)
// ---------------------------------------------------------------------------

const END_CHAIN_ID = 7999;
const END_SALE = 901;
const END_SEARCH = 902;
const END_PURCHASE = 903;
const END_ONWARD_SEARCH = 904;
const SELLER_A = "seller-a";
const BUYER_B = "buyer-b";
const SELLER_C = "seller-c";
const END_NODE_ID = 6001;

const endSummary: ChainNodesChainSummary = {
  ...buyerReadySummary,
  id: END_NODE_ID,
  chain_id: END_CHAIN_ID,
  linked_property_id: END_SALE,
};

type EndRowSpec = Partial<TopologyProperty> &
  Pick<TopologyProperty, "id" | "chainPosition" | "stage"> & {
    own?: boolean;
  };

function endRows(specs: EndRowSpec[]): Array<TopologyProperty & { own: boolean }> {
  return specs.map(({ own = false, ...spec }) => ({ ...topologyRow(spec), own }));
}

function homeownerEndTiles(
  rows: Array<TopologyProperty & { own: boolean }>,
  viewerId: string,
  options: {
    nodes?: OperationalBuyerReadyNode[];
    summaries?: ChainNodesChainSummary[];
  } = {}
): ComposedChainTile[] {
  const operational = rows.map((row) => ({
    ...toOperational([row], row.own ? [row.id] : [])[0],
    chainId: END_CHAIN_ID,
  }));
  const { position } = resolveOperationalPosition(
    viewerId,
    END_CHAIN_ID,
    operational,
    options.nodes ?? []
  );

  return composeChainTiles({
    chainProperties: rows,
    operationalPosition: position,
    buyerReadySummaries: options.summaries ?? [],
  });
}

function eaEndTiles(
  rows: TopologyProperty[],
  assignedPropertyId: number,
  subjectUserId: string | null,
  summaries: ChainNodesChainSummary[] = []
): ComposedChainTile[] {
  const neutral = rows.map((row) => ({ ...row, currentUserRole: null }));
  const operational = toOperational(neutral).map((row) => ({
    ...row,
    chainId: END_CHAIN_ID,
  }));
  const subject = resolveOperationalSubject({
    viewerUserId: EA_ID,
    accountType: "estate_agent",
    chainId: END_CHAIN_ID,
    chainProperties: operational,
    estateAgentAssignments: [
      {
        propertyId: assignedPropertyId,
        chainId: END_CHAIN_ID,
        subjectUserId,
        homeownerOnlyUpdates: true,
      },
    ],
  });
  const roleById = new Map(
    applyOperationalSubjectLens(operational, subject).map((property) => [
      property.id,
      property.currentUserRole ?? null,
    ])
  );
  const { position } = resolveSubjectOperationalPosition({
    subject,
    chainId: END_CHAIN_ID,
    chainProperties: operational,
    chainNodes: [],
  });

  return composeChainTiles({
    chainProperties: neutral.map((row) => ({
      ...row,
      currentUserRole: roleById.get(row.id) ?? null,
    })),
    operationalPosition: position,
    buyerReadySummaries: summaries,
  });
}

function hasSearchTile(tiles: ComposedChainTile[]): boolean {
  return searchTiles(tiles).length > 0;
}

const saleNoBuyer: EndRowSpec = {
  id: END_SALE,
  chainPosition: 1,
  stage: "property_listed",
  address: "1 End Street",
  relationship_type: "sale",
  buyer_connected: false,
  currentUserRole: "seller",
  own: true,
};

// Sale only, nothing recorded onward: Awaiting Buyer, and no invented search.
const saleOnly = endRows([saleNoBuyer]);
const saleOnlyTiles = homeownerEndTiles(saleOnly, SELLER_A);
assertEqual(
  "End state: active sale with no buyer → Awaiting Buyer / Your Sale",
  composedTileLabels(saleOnlyTiles),
  [CHAIN_TILE_LABEL.awaitingBuyer, CHAIN_TILE_LABEL.yourSale]
);
assert(
  "End state: no purchase row does not create a Searching tile",
  !hasSearchTile(saleOnlyTiles) && saleOnlyTiles.length === 2
);
assert(
  "End state: topology carries no synthesised terminus",
  !("syntheticTerminus" in buildChainTopology(saleOnly, null))
);

// Seller explicitly not buying (awaiting_buyer column = no onward purchase).
const notBuyingTiles = homeownerEndTiles(
  endRows([{ ...saleNoBuyer, awaiting_buyer: true }]),
  SELLER_A
);
assertEqual(
  "End state: seller not buying → Awaiting Buyer / Your Sale (no Searching, no End Of Chain tile)",
  composedTileLabels(notBuyingTiles),
  [CHAIN_TILE_LABEL.awaitingBuyer, CHAIN_TILE_LABEL.yourSale]
);

for (const [label, createdBy] of [
  ["EA-created", EA_ID],
  ["homeowner-created", SELLER_A],
] as const) {
  const rows = endRows([
    { ...saleNoBuyer, currentUserRole: null, own: false, created_by_user_id: createdBy } as EndRowSpec,
  ]);
  assertEqual(
    `End state: ${label} sale with no buyer → EA sees Awaiting Buyer / Your Sale`,
    composedTileLabels(eaEndTiles(rows, END_SALE, label === "EA-created" ? null : SELLER_A)),
    [CHAIN_TILE_LABEL.awaitingBuyer, CHAIN_TILE_LABEL.yourSale]
  );
}

assertEqual(
  "End state: Awaiting Buyer does not depend on a Buyer Ready summary existing",
  composedTileLabels(
    homeownerEndTiles(saleOnly, SELLER_A, { summaries: [endSummary] })
  ),
  [CHAIN_TILE_LABEL.awaitingBuyer, CHAIN_TILE_LABEL.yourSale]
);

// Sale + seller genuinely searching (homeowner-owned placeholder).
const sellerSearch: EndRowSpec = {
  id: END_SEARCH,
  chainPosition: 2,
  stage: "searching",
  address: null,
  relationship_type: "purchase",
  buyer_connected: true,
  is_searching: true,
  currentUserRole: "buyer",
  own: true,
};
const saleWithSearch = endRows([
  { ...saleNoBuyer, linked_property_id: END_SEARCH },
  sellerSearch,
]);
assertEqual(
  "End state: sale + seller searching → Awaiting Buyer still shown, plus Next Home Search",
  composedTileLabels(homeownerEndTiles(saleWithSearch, SELLER_A)),
  [
    CHAIN_TILE_LABEL.awaitingBuyer,
    CHAIN_TILE_LABEL.yourSale,
    CHAIN_TILE_LABEL.nextHomeSearch,
  ]
);
assertEqual(
  "End state: homeowner-created search visible to the EA (same tiles, client-relative labels)",
  composedTileLabels(eaEndTiles(saleWithSearch, END_SALE, SELLER_A)),
  [
    CHAIN_TILE_LABEL.awaitingBuyer,
    CHAIN_TILE_LABEL.yourSale,
    CHAIN_TILE_LABEL.nextHomeSearch,
  ]
);

// Buyer joins: Awaiting Buyer is replaced, never duplicated.
const joinedWithSearch = endRows([
  { ...saleNoBuyer, buyer_connected: true, linked_property_id: END_SEARCH },
  sellerSearch,
]);
const sellerJoinedTiles = homeownerEndTiles(joinedWithSearch, SELLER_A, {
  summaries: [endSummary],
});
assertEqual(
  "End state: buyer joins → Buyer Ready / Your Sale / Next Home Search",
  composedTileLabels(sellerJoinedTiles),
  [
    CHAIN_TILE_LABEL.buyerReady,
    CHAIN_TILE_LABEL.yourSale,
    CHAIN_TILE_LABEL.nextHomeSearch,
  ]
);
assert(
  "End state: no Awaiting Buyer remains once the buyer joins",
  !sellerJoinedTiles.some((tile) => tile.kind === "awaiting_buyer")
);
assertEqual(
  "End state: buyer joined without Buyer Ready → Connected Buyer replaces Awaiting Buyer",
  composedTileLabels(homeownerEndTiles(joinedWithSearch, SELLER_A)),
  [
    CHAIN_TILE_LABEL.connectedBuyer,
    CHAIN_TILE_LABEL.yourSale,
    CHAIN_TILE_LABEL.nextHomeSearch,
  ]
);

// Buyer joined, not selling; seller not buying: nothing beyond either side.
const joinedNotBuying = endRows([
  { ...saleNoBuyer, buyer_connected: true, awaiting_buyer: true },
]);
assertEqual(
  "End state: buyer joined (not selling), seller not buying → Buyer Ready / Your Sale only",
  composedTileLabels(
    homeownerEndTiles(joinedNotBuying, SELLER_A, { summaries: [endSummary] })
  ),
  [CHAIN_TILE_LABEL.buyerReady, CHAIN_TILE_LABEL.yourSale]
);
assertEqual(
  "End state: the not-selling buyer sees Buyer Ready / Your Purchase only (no further sale)",
  composedTileLabels(
    homeownerEndTiles(
      endRows([
        {
          ...saleNoBuyer,
          buyer_connected: true,
          awaiting_buyer: true,
          currentUserRole: "buyer",
          own: false,
        },
      ]),
      BUYER_B,
      {
        nodes: [
          { id: END_NODE_ID, chain_id: END_CHAIN_ID, user_id: BUYER_B, node_type: "buyer_ready" },
        ],
        summaries: [endSummary],
      }
    )
  ),
  [CHAIN_TILE_LABEL.buyerReady, CHAIN_TILE_LABEL.yourPurchase]
);

// Buying-only Start Move: purchase row + own Buyer Ready, no sale behind it.
const buyingOnlyTiles = homeownerEndTiles(
  endRows([
    {
      id: END_PURCHASE,
      chainPosition: 2,
      stage: "offer_accepted",
      status: "pending_connection",
      address: "3 Bought Lane",
      relationship_type: "purchase",
      buyer_connected: true,
      seller_connected: false,
      currentUserRole: "buyer",
      own: true,
    },
  ]),
  BUYER_B,
  {
    nodes: [
      { id: END_NODE_ID, chain_id: END_CHAIN_ID, user_id: BUYER_B, node_type: "buyer_ready" },
    ],
    summaries: [{ ...endSummary, linked_property_id: END_PURCHASE }],
  }
);
assertEqual(
  "End state: buying-only (not selling) → Buyer Ready / Your Purchase; no Awaiting Buyer, no Searching",
  composedTileLabels(buyingOnlyTiles),
  [CHAIN_TILE_LABEL.buyerReady, CHAIN_TILE_LABEL.yourPurchase]
);

// Onward chain: A's sale → A's purchase (seller C) → C's search, three viewers.
const onwardBase: TopologyProperty[] = [
  topologyRow({
    id: END_SALE,
    chainPosition: 1,
    stage: "offer_accepted",
    address: "1 End Street",
    relationship_type: "sale",
    buyer_connected: true,
    linked_property_id: END_PURCHASE,
  }),
  topologyRow({
    id: END_PURCHASE,
    chainPosition: 2,
    stage: "offer_accepted",
    address: "3 Onward Lane",
    relationship_type: "purchase",
    buyer_connected: true,
    seller_connected: true,
    linked_property_id: END_ONWARD_SEARCH,
  }),
  topologyRow({
    id: END_ONWARD_SEARCH,
    chainPosition: 3,
    stage: "searching",
    address: null,
    relationship_type: "purchase",
    buyer_connected: true,
    is_searching: true,
  }),
];

function onwardView(
  roles: Record<number, "seller" | "buyer">
): Array<TopologyProperty & { own: boolean }> {
  return onwardBase.map((row) => ({
    ...row,
    address: roles[row.id] || row.stage === "searching" ? row.address : null,
    currentUserRole: roles[row.id] ?? null,
    own: roles[row.id] != null,
  }));
}

const onwardSummaries = [endSummary];
const viewA = homeownerEndTiles(
  onwardView({ [END_SALE]: "seller", [END_PURCHASE]: "buyer" }),
  SELLER_A,
  { summaries: onwardSummaries }
);
const viewB = homeownerEndTiles(onwardView({ [END_SALE]: "buyer" }), BUYER_B, {
  nodes: [
    { id: END_NODE_ID, chain_id: END_CHAIN_ID, user_id: BUYER_B, node_type: "buyer_ready" },
  ],
  summaries: onwardSummaries,
});
const viewC = homeownerEndTiles(
  onwardView({ [END_PURCHASE]: "seller", [END_ONWARD_SEARCH]: "buyer" }),
  SELLER_C,
  { summaries: onwardSummaries }
);

assertEqual(
  "Onward: seller A sees Buyer Ready / Your Sale / Your Purchase / Seller's Next Home Search",
  composedTileLabels(viewA),
  [
    CHAIN_TILE_LABEL.buyerReady,
    CHAIN_TILE_LABEL.yourSale,
    CHAIN_TILE_LABEL.yourPurchase,
    CHAIN_TILE_LABEL.sellerNextHomeSearch,
  ]
);
assertEqual(
  "Onward: buyer B sees Buyer Ready / Your Purchase / Connected Purchase / Seller's Next Home Search",
  composedTileLabels(viewB),
  [
    CHAIN_TILE_LABEL.buyerReady,
    CHAIN_TILE_LABEL.yourPurchase,
    CHAIN_TILE_LABEL.connectedPurchase,
    CHAIN_TILE_LABEL.sellerNextHomeSearch,
  ]
);
assertEqual(
  "Onward: seller C sees Buyer Ready / Connected Buyer / Your Sale / Next Home Search",
  composedTileLabels(viewC),
  [
    CHAIN_TILE_LABEL.buyerReady,
    CHAIN_TILE_LABEL.connectedBuyer,
    CHAIN_TILE_LABEL.yourSale,
    CHAIN_TILE_LABEL.nextHomeSearch,
  ]
);
assert(
  "Onward: all three viewers see the same topology and C's search exactly once",
  [viewA, viewB, viewC].every(
    (tiles) =>
      JSON.stringify(composedPropertyIds(tiles)) ===
        JSON.stringify([END_SALE, END_PURCHASE, END_ONWARD_SEARCH]) &&
      searchTiles(tiles).length === 1
  )
);

console.log(
  process.exitCode === 1
    ? "\nBuyer join perspective verification FAILED"
    : "\nBuyer join perspective verification PASSED"
);
