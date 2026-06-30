import {
  getClaimStatusBadgeLabel,
  getClaimStatusBadgeVariant,
} from "../lib/propertyClaim/presentation";
import {
  resolveClaimStatusFromEmail,
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

const tests = [
  ["claim status from email", testClaimStatusFromEmail],
  ["claim badge labels", testClaimBadgeLabels],
] as const;

for (const [name, run] of tests) {
  run();
  console.log(`PASS ${name}`);
}

console.log(`\n${tests.length}/${tests.length} property claim checks passed.`);
