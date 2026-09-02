/**
 * Production smoke-test fixture types.
 * Markers live only in smoke_test_* tables — never on client-writable EA onboarding payloads.
 */

export const SMOKE_TEST_OBJECT_TYPES = [
  "auth_user",
  "profile",
  "ea_company",
  "ea_branch",
  "ea_branch_member",
  "ea_branch_invitation",
  "property",
  "chain",
  "property_member",
  "chain_node",
  "property_ea_assignment",
  "activity",
] as const;

export type SmokeTestObjectType =
  (typeof SMOKE_TEST_OBJECT_TYPES)[number];

export const SMOKE_TEST_OWNERSHIPS = ["owned", "linked"] as const;
export type SmokeTestOwnership = (typeof SMOKE_TEST_OWNERSHIPS)[number];

export type SmokeTestFixtureStatus = "active" | "cleaned";

export type SmokeTestFixtureObject = {
  id: string;
  fixture_id: string;
  object_type: SmokeTestObjectType;
  object_id: string;
  ownership: SmokeTestOwnership;
  created_at: string;
};

export type SmokeTestFixture = {
  id: string;
  label: string;
  status: SmokeTestFixtureStatus;
  notes: string | null;
  created_by_admin_user_id: string | null;
  created_at: string;
  cleaned_at: string | null;
  cleaned_by_admin_user_id: string | null;
};

export type SmokeTestCleanupAction =
  | {
      action: "revoke_assignment";
      object_type: "property_ea_assignment";
      object_id: string;
      reason: string;
    }
  | {
      action: "delete";
      object_type: SmokeTestObjectType;
      object_id: string;
      reason: string;
    }
  | {
      action: "delete_auth_user";
      object_type: "auth_user";
      object_id: string;
      reason: string;
    }
  | {
      action: "skip";
      object_type: SmokeTestObjectType;
      object_id: string;
      reason: string;
    };

export type SmokeTestCleanupPlan = {
  fixtureId: string;
  dryRun: boolean;
  actions: SmokeTestCleanupAction[];
  refusals: string[];
};
