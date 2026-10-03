import {
  applyOperationalSubjectLens,
  resolveOperationalSubject,
  resolveSubjectOperationalPosition,
  resolveSubjectOperationalSalePropertyId,
  type EstateAgentOperationalAssignment,
} from "../lib/operationalSubject";
import {
  CHAIN_TILE_LABEL,
  getChainTileDisplayTitle,
  type OperationalBuyerReadyNode,
  type OperationalProperty,
} from "../lib/operationalPosition";
import {
  findBuyerReadySummaryForAnchor,
  resolveUpstreamPurchaserState,
} from "../lib/resolveUpstreamPurchaser";
import type { ChainNodesChainSummary } from "../lib/chainNodesSummary";

const HOMEOWNER_ID = "homeowner-subject-test";
const ESTATE_AGENT_ID = "ea-subject-test";
const CHAIN_ID = 77;

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
    address: null,
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

const sellerChainProperties: OperationalProperty[] = [
  participantProperty({
    id: 701,
    relationship_type: "sale",
    chainPosition: 2,
    currentUserRole: "seller",
    isOwnProperty: true,
  }),
  participantProperty({
    id: 702,
    relationship_type: "purchase",
    chainPosition: 3,
    linked_property_id: 701,
    currentUserRole: "buyer",
    isOwnProperty: true,
  }),
];

const homeownerSubject = resolveOperationalSubject({
  viewerUserId: HOMEOWNER_ID,
  accountType: "homeowner",
  chainId: CHAIN_ID,
  chainProperties: sellerChainProperties,
});

assertEqual(
  "resolveOperationalSubject — homeowner subjectUserId",
  homeownerSubject?.subjectUserId,
  HOMEOWNER_ID
);
assertEqual(
  "resolveOperationalSubject — homeowner viewerRole",
  homeownerSubject?.viewerRole,
  "homeowner"
);

const homeownerPosition = resolveSubjectOperationalPosition({
  subject: homeownerSubject,
  chainId: CHAIN_ID,
  chainProperties: sellerChainProperties,
  chainNodes: [],
});

assertEqual(
  "homeowner topology — operational sale property",
  homeownerPosition.position?.kind === "sale"
    ? homeownerPosition.position.propertyId
    : null,
  701
);

const eaAssignments: EstateAgentOperationalAssignment[] = [
  {
    propertyId: 701,
    chainId: CHAIN_ID,
    subjectUserId: HOMEOWNER_ID,
    homeownerOnlyUpdates: true,
  },
];

const eaParticipantView: OperationalProperty[] = [
  participantProperty({
    id: 701,
    relationship_type: "sale",
    chainPosition: 2,
    address: "10 Seller Street",
  }),
  participantProperty({
    id: 702,
    relationship_type: "purchase",
    chainPosition: 3,
    linked_property_id: 701,
  }),
];

const eaSubject = resolveOperationalSubject({
  viewerUserId: ESTATE_AGENT_ID,
  accountType: "estate_agent",
  chainId: CHAIN_ID,
  chainProperties: eaParticipantView,
  estateAgentAssignments: eaAssignments,
});

assertEqual(
  "resolveOperationalSubject — EA subjectUserId",
  eaSubject?.subjectUserId,
  HOMEOWNER_ID
);
assertEqual(
  "resolveOperationalSubject — EA assignedPropertyId",
  eaSubject?.assignedPropertyId,
  701
);
assertEqual(
  "resolveOperationalSubject — EA viewerRole",
  eaSubject?.viewerRole,
  "estate_agent"
);

const eaScopedProperties = applyOperationalSubjectLens(
  eaParticipantView,
  eaSubject
);

assertEqual(
  "applyOperationalSubjectLens — assigned sale is seller hop",
  eaScopedProperties.find((property) => property.id === 701)
    ?.currentUserRole,
  "seller"
);
assertEqual(
  "applyOperationalSubjectLens — linked purchase is buyer hop",
  eaScopedProperties.find((property) => property.id === 702)
    ?.currentUserRole,
  "buyer"
);

const eaPosition = resolveSubjectOperationalPosition({
  subject: eaSubject,
  chainId: CHAIN_ID,
  chainProperties: eaParticipantView,
  chainNodes: [],
});

assertEqual(
  "EA delegated topology — operational sale property",
  eaPosition.position?.kind === "sale"
    ? eaPosition.position.propertyId
    : null,
  701
);

const saleOperationalPropertyId =
  resolveSubjectOperationalSalePropertyId({
    subject: eaSubject,
    chainId: CHAIN_ID,
    chainProperties: eaParticipantView,
    chainNodes: [],
  });

assertEqual(
  "EA delegated topology — sale anchor id",
  saleOperationalPropertyId,
  701
);

const buyerReadySummaries: ChainNodesChainSummary[] = [];

const upstreamPurchaser = resolveUpstreamPurchaserState({
  operationalSalePropertyId: saleOperationalPropertyId,
  chainProperties: eaParticipantView.map((property) => ({
    id: property.id,
    buyer_connected: property.id === 701 ? false : true,
  })),
  buyerReadyForAnchor: findBuyerReadySummaryForAnchor(
    buyerReadySummaries,
    saleOperationalPropertyId
  ),
});

assertEqual(
  "EA delegated topology — upstream awaiting buyer",
  upstreamPurchaser?.kind,
  "awaiting_buyer"
);

const eaSaleTitle = getChainTileDisplayTitle(
  eaScopedProperties.find(
    (property) => property.id === 701
  )!,
  true
);

assertEqual(
  "EA delegated topology — sale tile headline",
  eaSaleTitle,
  CHAIN_TILE_LABEL.yourSale
);

// An EA assignment on a purchase row is the seller's agent: the row is the
// subject's sale and the buyer's Buyer Ready node is never the EA's position.
const PURCHASE_SELLER_ID = "purchase-seller-subject-test";
const PURCHASE_BUYER_ID = "purchase-buyer-subject-test";

const buyerReadyNode: OperationalBuyerReadyNode = {
  id: 901,
  chain_id: CHAIN_ID,
  user_id: PURCHASE_BUYER_ID,
  node_type: "buyer_ready",
};

const purchaseRowEaView: OperationalProperty[] = [
  participantProperty({
    id: 801,
    relationship_type: "purchase",
    chainPosition: 1,
    address: "Buyer flat",
    linked_property_id: 802,
  }),
  participantProperty({
    id: 802,
    relationship_type: "purchase",
    chainPosition: 2,
    address: "Seller onward house",
  }),
];

for (const [label, subjectUserId] of [
  ["seller connected", PURCHASE_SELLER_ID],
  ["awaiting seller", null],
] as const) {
  const purchaseRowEaSubject = resolveOperationalSubject({
    viewerUserId: ESTATE_AGENT_ID,
    accountType: "estate_agent",
    chainId: CHAIN_ID,
    chainProperties: purchaseRowEaView,
    estateAgentAssignments: [
      {
        propertyId: 801,
        chainId: CHAIN_ID,
        subjectUserId,
        homeownerOnlyUpdates: true,
      },
    ],
  });

  const purchaseRowScoped = applyOperationalSubjectLens(
    purchaseRowEaView,
    purchaseRowEaSubject
  );

  assertEqual(
    `EA on purchase row (${label}) — assigned row is seller hop`,
    purchaseRowScoped.find((property) => property.id === 801)
      ?.currentUserRole,
    "seller"
  );
  assertEqual(
    `EA on purchase row (${label}) — onward purchase is buyer hop`,
    purchaseRowScoped.find((property) => property.id === 802)
      ?.currentUserRole,
    "buyer"
  );

  const purchaseRowPosition = resolveSubjectOperationalPosition({
    subject: purchaseRowEaSubject,
    chainId: CHAIN_ID,
    chainProperties: purchaseRowEaView,
    chainNodes: [buyerReadyNode],
  });

  assertEqual(
    `EA on purchase row (${label}) — position is the sale, not Buyer Ready`,
    purchaseRowPosition.position?.kind === "sale"
      ? purchaseRowPosition.position.propertyId
      : purchaseRowPosition.position?.kind ?? null,
    801
  );
  assertEqual(
    `EA on purchase row (${label}) — tile headline`,
    getChainTileDisplayTitle(
      purchaseRowScoped.find((property) => property.id === 801)!,
      true
    ),
    CHAIN_TILE_LABEL.yourSale
  );
}

if (process.exitCode && process.exitCode !== 0) {
  process.exit(process.exitCode);
}

console.log("All operational subject checks passed.");
