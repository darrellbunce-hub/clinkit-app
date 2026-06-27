import {
  evaluateProtectedRouteAccess,
} from "../lib/auth/routeGuards";
import {
  buildCurrentUserContext,
} from "../lib/currentUserContext";
import {
  isHomeownerOnlyRoute,
  isSharedOperationalRoute,
} from "../lib/auth/routes";
import {
  resolveWorkflowAccess,
  WORKFLOW_READ_ONLY_BANNER_MESSAGE,
} from "../lib/workflowPermissions";
import type {
  OperationalBuyerReadyNode,
  OperationalProperty,
} from "../lib/operationalPosition";

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

const homeownerContext = buildCurrentUserContext(
  { id: "homeowner-user" } as never,
  {
    account_type: "homeowner",
    contact_name: null,
    onboarding_completed_at: "2026-01-01",
    email_domain: null,
  }
);

const estateAgentContext = buildCurrentUserContext(
  { id: "ea-user" } as never,
  {
    account_type: "estate_agent",
    contact_name: null,
    onboarding_completed_at: "2026-01-01",
    email_domain: null,
  }
);

assertTruthy(
  "Shared operational — chain route",
  isSharedOperationalRoute("/chain/42")
);
assertTruthy(
  "Homeowner only — dashboard route",
  isHomeownerOnlyRoute("/dashboard")
);

const eaChainAccess = evaluateProtectedRouteAccess(
  estateAgentContext,
  new URL("http://localhost/chain/42"),
  "/chain/42"
);

assertTruthy(
  "Estate agent allowed on shared chain route",
  eaChainAccess.allowed
);

const eaDashboardAccess = evaluateProtectedRouteAccess(
  estateAgentContext,
  new URL("http://localhost/dashboard"),
  "/dashboard"
);

assertEqual(
  "Estate agent blocked from homeowner dashboard",
  eaDashboardAccess.allowed,
  false
);

const homeownerDashboardAccess =
  evaluateProtectedRouteAccess(
    homeownerContext,
    new URL("http://localhost/dashboard"),
    "/dashboard"
  );

assertTruthy(
  "Homeowner allowed on dashboard",
  homeownerDashboardAccess.allowed
);

const chainProperties: OperationalProperty[] = [
  {
    id: 10,
    chainId: 42,
    stage: "property_listed",
    address: "Assigned Property",
    relationship_type: "sale",
    linked_property_id: null,
    members: [],
    isOwnProperty: false,
  },
  {
    id: 11,
    chainId: 42,
    stage: "under_offer",
    address: null,
    relationship_type: "purchase",
    linked_property_id: null,
    members: [],
    isOwnProperty: false,
  },
];

const buyerReadyNode: OperationalBuyerReadyNode = {
  id: 501,
  chain_id: 42,
  user_id: "buyer-user",
  node_type: "buyer_ready",
};

const eaBuyerReadyAccess = resolveWorkflowAccess(
  {
    kind: "buyer_ready",
    chainId: 42,
    nodeId: 501,
  },
  {
    userId: "ea-user",
    chainProperties,
    chainNodes: [buyerReadyNode],
    accountType: "estate_agent",
  }
);

assertEqual(
  "Estate agent buyer ready — read only",
  eaBuyerReadyAccess.mode,
  "read_only"
);
assertEqual(
  "Estate agent buyer ready — viewer role",
  eaBuyerReadyAccess.viewerRole,
  "estate_agent"
);
assertEqual(
  "Estate agent buyer ready — banner",
  eaBuyerReadyAccess.bannerMessage,
  WORKFLOW_READ_ONLY_BANNER_MESSAGE
);

const eaPropertyAccess = resolveWorkflowAccess(
  {
    kind: "property",
    chainId: 42,
    propertyId: 10,
  },
  {
    userId: "ea-user",
    chainProperties,
    chainNodes: [buyerReadyNode],
    accountType: "estate_agent",
  }
);

assertEqual(
  "Estate agent property workflow — cannot edit",
  eaPropertyAccess.canEdit,
  false
);
assertEqual(
  "Estate agent property workflow — can view",
  eaPropertyAccess.canView,
  true
);

if (process.exitCode) {
  process.exit(process.exitCode);
}

console.log("\nAll shared operational route checks passed.");
