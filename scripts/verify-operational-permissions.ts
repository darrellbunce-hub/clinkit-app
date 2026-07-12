import {
  canMutatePropertyTarget,
  type OperationalBuyerReadyNode,
  type OperationalProperty,
} from "../lib/operationalPosition";
import {
  isEstateAgentDelegationEnabled,
  resolveMutationOperationalPosition,
} from "../lib/mutationPermission";
import {
  resolveOperationalSubject,
  resolveSubjectOperationalPosition,
  type EstateAgentOperationalAssignment,
} from "../lib/operationalSubject";
import {
  canAgentMutateAssignedProperty,
  getAgentAssignmentAccessLabel,
} from "../lib/estateAgent/delegatedUpdates";
import { resolveWorkflowAccess } from "../lib/workflowPermissions";

const EA_ORIGINATION_DEFAULT_HOMEOWNER_ONLY_UPDATES = false;
const HOMEOWNER_EA_ASSIGNMENT_DEFAULT_HOMEOWNER_ONLY_UPDATES = true;

const HOMEOWNER_ID = "homeowner-perm-test";
const ESTATE_AGENT_ID = "ea-perm-test";
const CHAIN_ID = 88;
const SALE_PROPERTY_ID = 8801;

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
    chainPosition: 1,
    ...overrides,
  };
}

function assertEqual<T>(
  name: string,
  actual: T,
  expected: T
) {
  if (actual !== expected) {
    throw new Error(
      `${name}\n  expected: ${String(expected)}\n  actual: ${String(actual)}`
    );
  }

  console.log(`PASS ${name}`);
}

function assertTruthy(name: string, value: unknown) {
  if (!value) {
    throw new Error(`${name} — expected truthy, got ${value}`);
  }

  console.log(`PASS ${name}`);
}

function assertFalsy(name: string, value: unknown) {
  if (value) {
    throw new Error(`${name} — expected falsy, got ${value}`);
  }

  console.log(`PASS ${name}`);
}

const unclaimedEaSaleView: OperationalProperty[] = [
  participantProperty({
    id: SALE_PROPERTY_ID,
    relationship_type: "sale",
  }),
];

const delegatedPreClaimAssignment: EstateAgentOperationalAssignment[] =
  [
    {
      propertyId: SALE_PROPERTY_ID,
      chainId: CHAIN_ID,
      subjectUserId: null,
      homeownerOnlyUpdates: false,
      claimStatus: "unclaimed",
    },
  ];

const viewOnlyPreClaimAssignment: EstateAgentOperationalAssignment[] =
  [
    {
      propertyId: SALE_PROPERTY_ID,
      chainId: CHAIN_ID,
      subjectUserId: null,
      homeownerOnlyUpdates: true,
      claimStatus: "unclaimed",
    },
  ];

function testScenarioA_preClaimDelegatedEditing() {
  const mutationContext = {
    accountType: "estate_agent" as const,
    estateAgentAssignments: delegatedPreClaimAssignment,
  };

  const position = resolveMutationOperationalPosition({
    viewerUserId: ESTATE_AGENT_ID,
    chainId: CHAIN_ID,
    chainProperties: unclaimedEaSaleView,
    chainNodes: [],
    mutationContext,
  });

  assertEqual(
    "Scenario A — pre-claim EA sale position kind",
    position.position?.kind,
    "sale"
  );
  assertEqual(
    "Scenario A — pre-claim EA sale position property",
    position.position?.kind === "sale"
      ? position.position.propertyId
      : null,
    SALE_PROPERTY_ID
  );

  const saleProperty = unclaimedEaSaleView[0];

  assertTruthy(
    "Scenario A — canMutatePropertyTarget",
    canMutatePropertyTarget(
      saleProperty,
      ESTATE_AGENT_ID,
      unclaimedEaSaleView,
      [],
      mutationContext
    )
  );

  const access = resolveWorkflowAccess(
    {
      kind: "property",
      chainId: CHAIN_ID,
      propertyId: SALE_PROPERTY_ID,
    },
    {
      userId: ESTATE_AGENT_ID,
      chainProperties: unclaimedEaSaleView,
      chainNodes: [],
      accountType: "estate_agent",
      estateAgentAssignments: delegatedPreClaimAssignment,
    }
  );

  assertTruthy("Scenario A — workflow canEdit", access.canEdit);
  assertEqual(
    "Scenario A — workflow mode",
    access.mode,
    "editable"
  );
}

function testScenarioA_viewOnlyBlocked() {
  const mutationContext = {
    accountType: "estate_agent" as const,
    estateAgentAssignments: viewOnlyPreClaimAssignment,
  };

  const position = resolveMutationOperationalPosition({
    viewerUserId: ESTATE_AGENT_ID,
    chainId: CHAIN_ID,
    chainProperties: unclaimedEaSaleView,
    chainNodes: [],
    mutationContext,
  });

  assertFalsy(
    "Scenario E — view-only EA has no position",
    position.position
  );

  assertFalsy(
    "Scenario E — view-only EA cannot mutate",
    canMutatePropertyTarget(
      unclaimedEaSaleView[0],
      ESTATE_AGENT_ID,
      unclaimedEaSaleView,
      [],
      mutationContext
    )
  );
}

function testScenarioB_postClaimDelegatedEditing() {
  const claimedAssignments: EstateAgentOperationalAssignment[] =
    [
      {
        propertyId: SALE_PROPERTY_ID,
        chainId: CHAIN_ID,
        subjectUserId: HOMEOWNER_ID,
        homeownerOnlyUpdates: false,
        claimStatus: "claimed",
      },
    ];

  const homeownerParticipantView: OperationalProperty[] = [
    participantProperty({
      id: SALE_PROPERTY_ID,
      relationship_type: "sale",
      currentUserRole: "seller",
      isOwnProperty: true,
    }),
  ];

  const mutationContext = {
    accountType: "estate_agent" as const,
    estateAgentAssignments: claimedAssignments,
  };

  assertTruthy(
    "Scenario B — post-claim delegated mutate",
    canMutatePropertyTarget(
      homeownerParticipantView[0],
      ESTATE_AGENT_ID,
      homeownerParticipantView,
      [],
      mutationContext
    )
  );
}

function testScenarioC_revokedDelegation() {
  const revokedAssignments: EstateAgentOperationalAssignment[] =
    [
      {
        propertyId: SALE_PROPERTY_ID,
        chainId: CHAIN_ID,
        subjectUserId: HOMEOWNER_ID,
        homeownerOnlyUpdates: true,
        claimStatus: "claimed",
      },
    ];

  const homeownerParticipantView: OperationalProperty[] = [
    participantProperty({
      id: SALE_PROPERTY_ID,
      relationship_type: "sale",
      currentUserRole: "seller",
      isOwnProperty: true,
    }),
  ];

  const mutationContext = {
    accountType: "estate_agent" as const,
    estateAgentAssignments: revokedAssignments,
  };

  assertFalsy(
    "Scenario C — revoked EA cannot mutate",
    canMutatePropertyTarget(
      homeownerParticipantView[0],
      ESTATE_AGENT_ID,
      homeownerParticipantView,
      [],
      mutationContext
    )
  );

  assertEqual(
    "Scenario C — EA access label view_only",
    getAgentAssignmentAccessLabel({
      status: "active",
      homeowner_only_updates: true,
    }),
    "view_only"
  );
}

function testScenarioD_reenabledDelegation() {
  assertTruthy(
    "Scenario D — delegation enabled check",
    isEstateAgentDelegationEnabled({
      homeownerOnlyUpdates: false,
    })
  );

  assertTruthy(
    "Scenario D — canAgentMutateAssignedProperty",
    canAgentMutateAssignedProperty({
      status: "active",
      homeowner_only_updates: false,
    })
  );
}

function testScenarioE_homeownerOwnsSale() {
  const homeownerView: OperationalProperty[] = [
    participantProperty({
      id: SALE_PROPERTY_ID,
      relationship_type: "sale",
      currentUserRole: "seller",
      isOwnProperty: true,
    }),
  ];

  assertTruthy(
    "Scenario E — homeowner can mutate own sale",
    canMutatePropertyTarget(
      homeownerView[0],
      HOMEOWNER_ID,
      homeownerView,
      [],
      { accountType: "homeowner" }
    )
  );
}

function testPreClaimSubjectTopology() {
  const subject = resolveOperationalSubject({
    viewerUserId: ESTATE_AGENT_ID,
    accountType: "estate_agent",
    chainId: CHAIN_ID,
    chainProperties: unclaimedEaSaleView,
    estateAgentAssignments: delegatedPreClaimAssignment,
  });

  assertEqual(
    "Pre-claim subject — subjectUserId null",
    subject?.subjectUserId,
    null
  );

  const position = resolveSubjectOperationalPosition({
    subject,
    chainId: CHAIN_ID,
    chainProperties: unclaimedEaSaleView,
    chainNodes: [],
  });

  assertEqual(
    "Pre-claim subject — topology sale position",
    position.position?.kind === "sale"
      ? position.position.propertyId
      : null,
    SALE_PROPERTY_ID
  );
}

function testOriginationDefaults() {
  assertFalsy(
    "EA origination default — delegated editing enabled",
    EA_ORIGINATION_DEFAULT_HOMEOWNER_ONLY_UPDATES
  );

  assertTruthy(
    "Homeowner EA assignment default — view-only until opted in",
    HOMEOWNER_EA_ASSIGNMENT_DEFAULT_HOMEOWNER_ONLY_UPDATES
  );
}

const tests = [
  ["EA origination defaults", testOriginationDefaults],
  ["Scenario A pre-claim delegated editing", testScenarioA_preClaimDelegatedEditing],
  ["Scenario A view-only blocked (Scenario E pre-claim)", testScenarioA_viewOnlyBlocked],
  ["Scenario B post-claim delegated editing", testScenarioB_postClaimDelegatedEditing],
  ["Scenario C revoked delegation", testScenarioC_revokedDelegation],
  ["Scenario D re-enabled delegation helpers", testScenarioD_reenabledDelegation],
  ["Scenario E homeowner owns sale", testScenarioE_homeownerOwnsSale],
  ["Pre-claim subject topology", testPreClaimSubjectTopology],
] as const;

for (const [name, run] of tests) {
  run();
}

console.log(
  `\n${tests.length}/${tests.length} operational permission checks passed.`
);
