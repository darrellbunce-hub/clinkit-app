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

const buyerReadyNode: OperationalBuyerReadyNode = {
  id: 901,
  chain_id: CHAIN_ID,
  user_id: HOMEOWNER_ID,
  node_type: "buyer_ready",
};

const buyerReadyOnlyEaView: OperationalProperty[] = [
  participantProperty({
    id: 801,
    relationship_type: "purchase",
    chainPosition: 1,
    address: "Buyer flat",
  }),
];

const buyerReadyEaSubject = resolveOperationalSubject({
  viewerUserId: ESTATE_AGENT_ID,
  accountType: "estate_agent",
  chainId: CHAIN_ID,
  chainProperties: buyerReadyOnlyEaView,
  estateAgentAssignments: [
    {
      propertyId: 801,
      chainId: CHAIN_ID,
      subjectUserId: HOMEOWNER_ID,
      homeownerOnlyUpdates: true,
    },
  ],
});

const buyerReadyEaPosition = resolveSubjectOperationalPosition({
  subject: buyerReadyEaSubject,
  chainId: CHAIN_ID,
  chainProperties: buyerReadyOnlyEaView,
  chainNodes: [buyerReadyNode],
});

assertEqual(
  "EA delegated topology — buyer ready owner position",
  buyerReadyEaPosition.position?.kind,
  "buyer_ready"
);
assertEqual(
  "EA delegated topology — buyer ready node id",
  buyerReadyEaPosition.position?.kind === "buyer_ready"
    ? buyerReadyEaPosition.position.nodeId
    : null,
  901
);

if (process.exitCode && process.exitCode !== 0) {
  process.exit(process.exitCode);
}

console.log("All operational subject checks passed.");
