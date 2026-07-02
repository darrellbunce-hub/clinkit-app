import {
  filterClaimableProperties,
  hasClaimableProperties,
} from "../lib/propertyClaim/discoverClaimableProperties";
import {
  getInvitationLifecycleStatus,
  getInvitationStatusBadgeLabel,
  isInvitationExpiredPriority,
} from "../lib/propertyClaim/invitationPresentation";
import type { AgentBranchPropertySummary } from "../lib/estateAgent/assignmentTypes";
import {
  getClaimStatusBadgeLabel,
  getClaimStatusBadgeVariant,
} from "../lib/propertyClaim/presentation";
import {
  resolveClaimStatusFromEmail,
  type ClaimablePropertySummary,
  type PropertyClaimStatus,
} from "../lib/propertyClaim/types";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

function testClaimStatusFromEmail() {
  assert(
    resolveClaimStatusFromEmail(null) === "unclaimed",
    "missing email should be unclaimed"
  );

  assert(
    resolveClaimStatusFromEmail("owner@example.com") ===
      "claim_invited",
    "email should set claim_invited"
  );
}

function testClaimBadgeLabels() {
  const statuses: PropertyClaimStatus[] = [
    "unclaimed",
    "claim_invited",
    "claimed",
  ];

  for (const status of statuses) {
    assert(
      getClaimStatusBadgeLabel(status).length > 0,
      `badge label for ${status}`
    );
    assert(
      getClaimStatusBadgeVariant(status).length > 0,
      `badge variant for ${status}`
    );
  }

  assert(
    !getClaimStatusBadgeLabel("unclaimed").includes("@"),
    "badge labels must not expose email addresses"
  );
}

function testClaimDiscoveryHelpers() {
  const properties: ClaimablePropertySummary[] = [
    {
      property_id: 101,
      address: "10 Example Street",
      postcode: "AB1 2CD",
      branch_name: "North Branch",
      in_chain: true,
      claim_status: "claim_invited",
    },
    {
      property_id: 202,
      address: "20 Other Road",
      postcode: "EF3 4GH",
      branch_name: "South Branch",
      in_chain: false,
      claim_status: "unclaimed",
    },
  ];

  assert(
    hasClaimableProperties(properties),
    "should detect claimable properties"
  );
  assert(
    !hasClaimableProperties([]),
    "empty list is not claimable"
  );
  assert(
    filterClaimableProperties(properties, 101).length ===
      1,
    "property filter should return one match"
  );
  assert(
    filterClaimableProperties(properties, 999).length ===
      0,
    "unknown property filter should return none"
  );
}

function testInvitationLifecyclePresentation() {
  const expiredSummary = {
    origin_type: "estate_agent",
    claim_status: "claim_invited",
    invitation_lifecycle_status:
      "invitation_expired",
  } as AgentBranchPropertySummary;

  assert(
    getInvitationLifecycleStatus(expiredSummary) ===
      "invitation_expired",
    "expired lifecycle status"
  );
  assert(
    getInvitationStatusBadgeLabel(
      "invitation_expired"
    ) === "Invitation Expired",
    "expired badge label"
  );
  assert(
    isInvitationExpiredPriority(expiredSummary),
    "expired should be action priority"
  );
}

const tests = [
  ["claim status from email", testClaimStatusFromEmail],
  ["claim badge labels", testClaimBadgeLabels],
  ["claim discovery helpers", testClaimDiscoveryHelpers],
  [
    "invitation lifecycle presentation",
    testInvitationLifecyclePresentation,
  ],
] as const;

for (const [name, run] of tests) {
  run();
  console.log(`PASS ${name}`);
}

console.log(`\n${tests.length}/${tests.length} property claim checks passed.`);
