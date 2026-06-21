import {
  canMutateBuyerReadyTarget,
  canMutatePropertyTarget,
} from "../lib/propertyPermissions";
import {
  CHAIN_TILE_LABEL,
  getChainTileDisplayTitle,
  resolveDashboardOperationalPropertyId,
  resolveOperationalPosition,
  resolveOperationalSalePropertyId,
  type OperationalBuyerReadyNode,
  type OperationalProperty,
} from "../lib/operationalPosition";

const USER_ID = "user-operational-test";
const CHAIN_ID = 42;

function participantProperty(
  overrides: Partial<OperationalProperty> &
    Pick<
      OperationalProperty,
      "id" | "relationship_type" | "chainPosition"
    >
): OperationalProperty {
  return {
    chainId: CHAIN_ID,
    stage: "property_listed",
    address: "10 Test Street",
    linked_property_id: null,
    members: [],
    currentUserRole: null,
    isOwnProperty: false,
    ...overrides,
  };
}

function assertEqual<T>(
  name: string,
  actual: T,
  expected: T
) {
  if (actual !== expected) {
    console.error("FAIL:", name);
    console.error("  expected:", expected);
    console.error("  actual:  ", actual);
    process.exitCode = 1;
  } else {
    console.log("PASS:", name);
  }
}

function assertTruthy(name: string, value: unknown) {
  if (!value) {
    console.error("FAIL:", name, "— expected truthy, got", value);
    process.exitCode = 1;
  } else {
    console.log("PASS:", name);
  }
}

function assertFalsy(name: string, value: unknown) {
  if (value) {
    console.error("FAIL:", name, "— expected falsy, got", value);
    process.exitCode = 1;
  } else {
    console.log("PASS:", name);
  }
}

/** Seller chain: upstream purchase (seller) → own sale → onward searching purchase */
const sellerChainProperties: OperationalProperty[] = [
  participantProperty({
    id: 1,
    relationship_type: "purchase",
    chainPosition: 1,
    currentUserRole: "seller",
    isOwnProperty: true,
    address: "999 Hidden Purchase",
  }),
  participantProperty({
    id: 2,
    relationship_type: "sale",
    chainPosition: 2,
    currentUserRole: "seller",
    isOwnProperty: true,
    address: "7777 Pickle Close",
  }),
  participantProperty({
    id: 3,
    relationship_type: "purchase",
    chainPosition: 3,
    stage: "searching",
    currentUserRole: "buyer",
    isOwnProperty: true,
    address: null,
  }),
];

/** Seller + connected downstream sale as buyer */
const sellerPlusPurchaseProperties: OperationalProperty[] = [
  participantProperty({
    id: 10,
    relationship_type: "sale",
    chainPosition: 1,
    currentUserRole: "seller",
    isOwnProperty: true,
    address: "357 Jenni Place",
  }),
  participantProperty({
    id: 11,
    relationship_type: "sale",
    chainPosition: 2,
    currentUserRole: "buyer",
    isOwnProperty: true,
    address: "888 Jo Lane",
  }),
  participantProperty({
    id: 12,
    relationship_type: "purchase",
    chainPosition: 3,
    stage: "searching",
    currentUserRole: "buyer",
    isOwnProperty: true,
    address: null,
  }),
];

const buyerReadyNode: OperationalBuyerReadyNode = {
  id: 501,
  chain_id: CHAIN_ID,
  user_id: USER_ID,
  node_type: "buyer_ready",
};

const emptyMembersRegressionProperties: OperationalProperty[] =
  sellerChainProperties.map((property) => ({
    ...property,
    members: [],
  }));

assertEqual(
  "resolveOperationalSalePropertyId — seller chain (empty members)",
  resolveOperationalSalePropertyId(
    CHAIN_ID,
    emptyMembersRegressionProperties
  ),
  2
);

assertEqual(
  "resolveDashboardOperationalPropertyId matches sale resolver",
  resolveDashboardOperationalPropertyId(
    sellerChainProperties
  ),
  resolveOperationalSalePropertyId(
    CHAIN_ID,
    sellerChainProperties
  )
);

const sellerPosition = resolveOperationalPosition(
  USER_ID,
  CHAIN_ID,
  sellerChainProperties,
  []
);

assertEqual(
  "resolveOperationalPosition — seller chain kind",
  sellerPosition.position?.kind,
  "sale"
);

assertEqual(
  "resolveOperationalPosition — seller chain propertyId",
  sellerPosition.position?.kind === "sale"
    ? sellerPosition.position.propertyId
    : null,
  2
);

assertEqual(
  "resolveOperationalSalePropertyId — seller + purchase chain",
  resolveOperationalSalePropertyId(
    CHAIN_ID,
    sellerPlusPurchaseProperties
  ),
  10
);

const sellerPlusPosition = resolveOperationalPosition(
  USER_ID,
  CHAIN_ID,
  sellerPlusPurchaseProperties,
  []
);

assertEqual(
  "resolveOperationalPosition — seller + purchase propertyId",
  sellerPlusPosition.position?.kind === "sale"
    ? sellerPlusPosition.position.propertyId
    : null,
  10
);

const buyerOnlyProperties: OperationalProperty[] = [
  participantProperty({
    id: 20,
    relationship_type: "purchase",
    stage: "searching",
    chainPosition: 1,
    currentUserRole: "buyer",
    isOwnProperty: true,
    address: null,
  }),
];

const buyerReadyPosition = resolveOperationalPosition(
  USER_ID,
  CHAIN_ID,
  buyerOnlyProperties,
  [buyerReadyNode]
);

assertEqual(
  "resolveOperationalPosition — buyer-ready chain",
  buyerReadyPosition.position?.kind,
  "buyer_ready"
);

assertEqual(
  "resolveOperationalPosition — buyer-ready nodeId",
  buyerReadyPosition.position?.kind === "buyer_ready"
    ? buyerReadyPosition.position.nodeId
    : null,
  501
);

assertFalsy(
  "resolveOperationalPosition — empty members without seller role",
  resolveOperationalPosition(
    USER_ID,
    CHAIN_ID,
    sellerChainProperties.map((property) => ({
      ...property,
      currentUserRole:
        property.currentUserRole === "seller"
          ? null
          : property.currentUserRole,
      isOwnProperty: false,
    })),
    []
  ).position
);

const operationalSale = sellerChainProperties.find(
  (property) => property.id === 2
)!;

const connectedPurchase = sellerChainProperties.find(
  (property) => property.id === 1
)!;

assertTruthy(
  "canMutatePropertyTarget — operational sale",
  canMutatePropertyTarget(
    operationalSale,
    USER_ID,
    sellerChainProperties,
    []
  )
);

assertFalsy(
  "canMutatePropertyTarget — connected purchase hop",
  canMutatePropertyTarget(
    connectedPurchase,
    USER_ID,
    sellerChainProperties,
    []
  )
);

assertTruthy(
  "canMutateBuyerReadyTarget — buyer-ready node",
  canMutateBuyerReadyTarget(
    buyerReadyNode.id,
    CHAIN_ID,
    USER_ID,
    buyerOnlyProperties,
    [buyerReadyNode]
  )
);

assertEqual(
  "getChainTileDisplayTitle — Your Sale on operational tile",
  getChainTileDisplayTitle(operationalSale, true),
  CHAIN_TILE_LABEL.yourSale
);

assertEqual(
  "getChainTileDisplayTitle — Connected Purchase on peer hop",
  getChainTileDisplayTitle(connectedPurchase, false),
  CHAIN_TILE_LABEL.connectedPurchase
);

assertEqual(
  "getChainTileDisplayTitle — own sale without operational flag still connected",
  getChainTileDisplayTitle(operationalSale, false),
  CHAIN_TILE_LABEL.connectedBuyer
);

/** Chain page tile simulation */
function chainTileLabel(
  property: OperationalProperty,
  properties: OperationalProperty[],
  nodes: OperationalBuyerReadyNode[]
): string {
  const { position } = resolveOperationalPosition(
    USER_ID,
    CHAIN_ID,
    properties,
    nodes
  );

  const isOperationalSale =
    position?.kind === "sale" &&
    position.propertyId === property.id;

  const isOperationalBuyerReady =
    position?.kind === "buyer_ready";

  return getChainTileDisplayTitle(
    property,
    isOperationalSale || isOperationalBuyerReady
  );
}

assertEqual(
  "Chain page rendering — operational sale tile",
  chainTileLabel(
    operationalSale,
    sellerChainProperties,
    []
  ),
  CHAIN_TILE_LABEL.yourSale
);

assertEqual(
  "Chain page rendering — connected purchase tile",
  chainTileLabel(
    connectedPurchase,
    sellerChainProperties,
    []
  ),
  CHAIN_TILE_LABEL.connectedPurchase
);

assertEqual(
  "Chain page rendering — searching onward tile",
  chainTileLabel(
    sellerChainProperties[2],
    sellerChainProperties,
    []
  ),
  CHAIN_TILE_LABEL.nextHomeSearch
);

assertTruthy(
  "Owner operational Buyer Ready — show prefix when buyer_ready position",
  buyerReadyPosition.position?.kind === "buyer_ready" &&
    buyerReadyNode.id ===
      (buyerReadyPosition.position?.kind === "buyer_ready"
        ? buyerReadyPosition.position.nodeId
        : null)
);

assertTruthy(
  "Seller view — no owner operational Buyer Ready prefix",
  resolveOperationalPosition(
    USER_ID,
    CHAIN_ID,
    sellerChainProperties,
    [{ ...buyerReadyNode, user_id: "other-buyer-user" }]
  ).position?.kind === "sale"
);

const ownerBuyerReadyLinkedPropertyId = 30;
const ownerConnectedSale = participantProperty({
  id: 30,
  relationship_type: "sale",
  chainPosition: 1,
  currentUserRole: "buyer",
  isOwnProperty: false,
  address: "Hidden sale",
});

assertEqual(
  "Owner linked purchase hop — Connected Purchase label",
  Number(ownerConnectedSale.id) ===
    Number(ownerBuyerReadyLinkedPropertyId)
    ? CHAIN_TILE_LABEL.connectedPurchase
    : getChainTileDisplayTitle(ownerConnectedSale, false),
  CHAIN_TILE_LABEL.connectedPurchase
);

if (process.exitCode) {
  process.exit(process.exitCode);
}

console.log("\nAll operational position checks passed.");
