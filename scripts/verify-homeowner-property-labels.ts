import {
  getHomeownerPropertyLabel,
  getChainTileDisplayTitle,
  getParticipantPropertyLabel,
  resolveDashboardOperationalPropertyId,
  CHAIN_TILE_LABEL,
} from "../lib/operationalPosition";

type LabelRow = {
  id: number;
  relationship_type: string;
  stage: string;
  address: string | null;
  currentUserRole: string;
  chainPosition: number;
};

function assert(name: string, actual: string, expected: string) {
  if (actual !== expected) {
    console.error("FAIL:", name);
    console.error("  expected:", expected);
    console.error("  actual:  ", actual);
    process.exitCode = 1;
  } else {
    console.log("PASS:", name);
  }
}

function assertNotAddress(
  name: string,
  label: string,
  forbidden: string
) {
  if (label.includes(forbidden)) {
    console.error("FAIL:", name, "— leaked address:", forbidden);
    process.exitCode = 1;
  } else {
    console.log("PASS:", name);
  }
}

function labelChainRows(
  rows: LabelRow[],
  operationalPropertyId: number | null
): string[] {
  return rows.map((row) =>
    getParticipantPropertyLabel(row, operationalPropertyId)
  );
}

function assertChainLabels(
  name: string,
  rows: LabelRow[],
  expected: string[]
) {
  const operationalPropertyId =
    resolveDashboardOperationalPropertyId(rows);
  const labels = labelChainRows(rows, operationalPropertyId);

  if (
    labels.length !== expected.length ||
    labels.some((label, index) => label !== expected[index])
  ) {
    console.error("FAIL:", name);
    console.error("  expected:", expected);
    console.error("  actual:  ", labels);
    console.error(
      "  operationalPropertyId:",
      operationalPropertyId
    );
    process.exitCode = 1;
  } else {
    console.log("PASS:", name);
  }
}

const sellerChainRows: LabelRow[] = [
  {
    id: 1,
    relationship_type: "purchase",
    stage: "offer_accepted",
    address: "999 Hidden Purchase",
    currentUserRole: "seller",
    chainPosition: 1,
  },
  {
    id: 2,
    relationship_type: "sale",
    stage: "property_listed",
    address: "7777 Pickle Close",
    currentUserRole: "seller",
    chainPosition: 2,
  },
  {
    id: 3,
    relationship_type: "purchase",
    stage: "searching",
    address: null,
    currentUserRole: "buyer",
    chainPosition: 3,
  },
];

assertChainLabels("Seller chain row labels", sellerChainRows, [
  CHAIN_TILE_LABEL.connectedPurchase,
  "7777 Pickle Close",
  CHAIN_TILE_LABEL.nextHomeSearch,
]);

const sellerPlusPurchaseRows: LabelRow[] = [
  {
    id: 10,
    relationship_type: "sale",
    stage: "property_listed",
    address: "357 Jenni Place",
    currentUserRole: "seller",
    chainPosition: 1,
  },
  {
    id: 11,
    relationship_type: "sale",
    stage: "offer_accepted",
    address: "888 Jo Lane",
    currentUserRole: "buyer",
    chainPosition: 2,
  },
  {
    id: 12,
    relationship_type: "purchase",
    stage: "searching",
    address: null,
    currentUserRole: "buyer",
    chainPosition: 3,
  },
];

assertChainLabels(
  "Seller + purchase row labels",
  sellerPlusPurchaseRows,
  [
    "357 Jenni Place",
    CHAIN_TILE_LABEL.connectedBuyer,
    CHAIN_TILE_LABEL.nextHomeSearch,
  ]
);

const bottomBuyerRows: LabelRow[] = [
  {
    id: 20,
    relationship_type: "purchase",
    stage: "searching",
    address: null,
    currentUserRole: "buyer",
    chainPosition: 1,
  },
  {
    id: 21,
    relationship_type: "purchase",
    stage: "offer_accepted",
    address: "4569 Coen Road",
    currentUserRole: "seller",
    chainPosition: 2,
  },
];

assertChainLabels("Bottom-of-chain buyer row labels", bottomBuyerRows, [
  CHAIN_TILE_LABEL.nextHomeSearch,
  CHAIN_TILE_LABEL.connectedPurchase,
]);

assert(
  "resolveDashboardOperationalPropertyId — seller chain",
  String(resolveDashboardOperationalPropertyId(sellerChainRows)),
  "2"
);

assert(
  "resolveDashboardOperationalPropertyId — bottom buyer",
  String(resolveDashboardOperationalPropertyId(bottomBuyerRows)),
  "null"
);

assertNotAddress(
  "Seller chain — no peer purchase address",
  getParticipantPropertyLabel(
    sellerChainRows[0],
    resolveDashboardOperationalPropertyId(sellerChainRows)
  ),
  "999 Hidden Purchase"
);

assertNotAddress(
  "Seller + purchase — no upstream sale address",
  getParticipantPropertyLabel(
    sellerPlusPurchaseRows[1],
    resolveDashboardOperationalPropertyId(sellerPlusPurchaseRows)
  ),
  "888 Jo Lane"
);

assert(
  "Chain tile — connected sale",
  getChainTileDisplayTitle(
    {
      relationship_type: "sale",
      stage: "offer_accepted",
      address: "888 Jo Lane",
      currentUserRole: "buyer",
      chainPosition: 1,
    },
    false
  ),
  CHAIN_TILE_LABEL.connectedBuyer
);

assertNotAddress(
  "Chain tile — no address on connected hop",
  getChainTileDisplayTitle(
    {
      relationship_type: "sale",
      stage: "offer_accepted",
      address: "888 Jo Lane",
      currentUserRole: "buyer",
      chainPosition: 1,
    },
    false
  ),
  "888 Jo Lane"
);

assert(
  "Dashboard and chain share getHomeownerPropertyLabel path",
  getParticipantPropertyLabel(
    sellerPlusPurchaseRows[1],
    resolveDashboardOperationalPropertyId(sellerPlusPurchaseRows)
  ),
  getHomeownerPropertyLabel(sellerPlusPurchaseRows[1], {
    surface: "dashboard",
    operationalPropertyId:
      resolveDashboardOperationalPropertyId(sellerPlusPurchaseRows),
  })
);

if (process.exitCode) {
  process.exit(process.exitCode);
}

console.log("\nAll homeowner label checks passed.");
