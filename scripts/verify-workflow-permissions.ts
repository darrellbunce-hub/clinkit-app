import {
  findBuyerReadyNodeForChain,
  resolveWorkflowAccess,
  WORKFLOW_EA_DELEGATED_BANNER_MESSAGE,
  WORKFLOW_READ_ONLY_BANNER_MESSAGE,
} from "../lib/workflowPermissions";
import type {
  OperationalBuyerReadyNode,
  OperationalProperty,
} from "../lib/operationalPosition";
import type { EstateAgentOperationalAssignment } from "../lib/operationalSubject";
import { resolveActivityUpdaterRole } from "../lib/mutationPermission";

const OWNER_ID = "owner-user";
const SELLER_ID = "seller-user";
const CHAIN_ID = 42;

function participantProperty(
  overrides: Partial<OperationalProperty> &
    Pick<
      OperationalProperty,
      "id" | "relationship_type"
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

const buyerReadyNode: OperationalBuyerReadyNode = {
  id: 501,
  chain_id: CHAIN_ID,
  user_id: OWNER_ID,
  node_type: "buyer_ready",
};

const sellerChainProperties: OperationalProperty[] = [
  participantProperty({
    id: 1,
    relationship_type: "purchase",
    currentUserRole: "seller",
    isOwnProperty: true,
  }),
  participantProperty({
    id: 2,
    relationship_type: "sale",
    currentUserRole: "seller",
    isOwnProperty: true,
  }),
];

const buyerOnlyProperties: OperationalProperty[] = [
  participantProperty({
    id: 20,
    relationship_type: "purchase",
    stage: "searching",
    currentUserRole: "buyer",
    isOwnProperty: true,
    address: null,
  }),
];

const ownerAccess = resolveWorkflowAccess(
  {
    kind: "buyer_ready",
    chainId: CHAIN_ID,
    nodeId: buyerReadyNode.id,
  },
  {
    userId: OWNER_ID,
    chainProperties: buyerOnlyProperties,
    chainNodes: [buyerReadyNode],
  }
);

assertEqual(
  "Buyer Ready owner — canView",
  ownerAccess.canView,
  true
);
assertEqual(
  "Buyer Ready owner — canEdit",
  ownerAccess.canEdit,
  true
);
assertEqual(
  "Buyer Ready owner — mode",
  ownerAccess.mode,
  "editable"
);
assertEqual(
  "Buyer Ready owner — viewerRole",
  ownerAccess.viewerRole,
  "owner"
);
assertEqual(
  "Buyer Ready owner — no banner",
  ownerAccess.bannerMessage,
  null
);

const sellerAccess = resolveWorkflowAccess(
  {
    kind: "buyer_ready",
    chainId: CHAIN_ID,
    nodeId: buyerReadyNode.id,
  },
  {
    userId: SELLER_ID,
    chainProperties: sellerChainProperties,
    chainNodes: [buyerReadyNode],
  }
);

assertEqual(
  "Seller peer — canView",
  sellerAccess.canView,
  true
);
assertEqual(
  "Seller peer — cannot edit",
  sellerAccess.canEdit,
  false
);
assertEqual(
  "Seller peer — read_only mode",
  sellerAccess.mode,
  "read_only"
);
assertEqual(
  "Seller peer — chain_participant role",
  sellerAccess.viewerRole,
  "chain_participant"
);
assertEqual(
  "Seller peer — read-only banner",
  sellerAccess.bannerMessage,
  WORKFLOW_READ_ONLY_BANNER_MESSAGE
);

const deniedAccess = resolveWorkflowAccess(
  {
    kind: "buyer_ready",
    chainId: CHAIN_ID,
    nodeId: 999,
  },
  {
    userId: SELLER_ID,
    chainProperties: sellerChainProperties,
    chainNodes: [buyerReadyNode],
  }
);

assertEqual(
  "Missing node — denied",
  deniedAccess.mode,
  "denied"
);
assertEqual(
  "Missing node — cannot view",
  deniedAccess.canView,
  false
);

assertEqual(
  "findBuyerReadyNodeForChain",
  findBuyerReadyNodeForChain(CHAIN_ID, [buyerReadyNode])?.id,
  501
);

const eaAccess = resolveWorkflowAccess(
  {
    kind: "buyer_ready",
    chainId: CHAIN_ID,
    nodeId: buyerReadyNode.id,
  },
  {
    userId: "ea-user",
    chainProperties: sellerChainProperties,
    chainNodes: [buyerReadyNode],
    accountType: "estate_agent",
    estateAgentAssignments: [
      {
        propertyId: 2,
        chainId: CHAIN_ID,
        subjectUserId: SELLER_ID,
        homeownerOnlyUpdates: true,
      },
    ],
  }
);

assertEqual(
  "Estate agent — read-only buyer ready",
  eaAccess.viewerRole,
  "estate_agent"
);
assertEqual(
  "Estate agent — cannot edit when delegation off",
  eaAccess.canEdit,
  false
);

const eaParticipantBuyerView: OperationalProperty[] = [
  participantProperty({
    id: 20,
    relationship_type: "purchase",
    stage: "searching",
    address: "Buyer flat",
    currentUserRole: null,
    isOwnProperty: false,
  }),
];

const eaDelegatedAssignments: EstateAgentOperationalAssignment[] = [
  {
    propertyId: 20,
    chainId: CHAIN_ID,
    subjectUserId: OWNER_ID,
    homeownerOnlyUpdates: false,
  },
];

const eaDelegatedAccess = resolveWorkflowAccess(
  {
    kind: "buyer_ready",
    chainId: CHAIN_ID,
    nodeId: buyerReadyNode.id,
  },
  {
    userId: "ea-user",
    chainProperties: eaParticipantBuyerView,
    chainNodes: [buyerReadyNode],
    accountType: "estate_agent",
    estateAgentAssignments: eaDelegatedAssignments,
  }
);

assertEqual(
  "Estate agent delegated — canEdit buyer ready",
  eaDelegatedAccess.canEdit,
  true
);
assertEqual(
  "Estate agent delegated — viewerRole stays estate_agent",
  eaDelegatedAccess.viewerRole,
  "estate_agent"
);
assertEqual(
  "Estate agent delegated — editable mode",
  eaDelegatedAccess.mode,
  "editable"
);
assertEqual(
  "Estate agent delegated — banner message",
  eaDelegatedAccess.bannerMessage,
  WORKFLOW_EA_DELEGATED_BANNER_MESSAGE
);

const eaSaleParticipantView: OperationalProperty[] = [
  participantProperty({
    id: 701,
    relationship_type: "sale",
    address: "10 Seller Street",
    currentUserRole: null,
    isOwnProperty: false,
  }),
  participantProperty({
    id: 702,
    relationship_type: "purchase",
    linked_property_id: 701,
    currentUserRole: null,
    isOwnProperty: false,
  }),
];

const eaSaleAssignments: EstateAgentOperationalAssignment[] = [
  {
    propertyId: 701,
    chainId: CHAIN_ID,
    subjectUserId: OWNER_ID,
    homeownerOnlyUpdates: false,
  },
];

const eaSaleAccess = resolveWorkflowAccess(
  {
    kind: "property",
    chainId: CHAIN_ID,
    propertyId: 701,
  },
  {
    userId: "ea-user",
    chainProperties: eaSaleParticipantView,
    chainNodes: [],
    accountType: "estate_agent",
    estateAgentAssignments: eaSaleAssignments,
  }
);

assertEqual(
  "Estate agent delegated — canEdit operational sale",
  eaSaleAccess.canEdit,
  true
);

assertEqual(
  "Activity updater role — estate agent",
  resolveActivityUpdaterRole("estate_agent"),
  "estate_agent"
);
assertEqual(
  "Activity updater role — homeowner",
  resolveActivityUpdaterRole("homeowner"),
  "homeowner"
);

if (process.exitCode) {
  process.exit(process.exitCode);
}

console.log("\nAll workflow permission checks passed.");
