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
      /**
       * Owned member whose owned parent branch is also in the plan.
       * Do not delete explicitly (would trip the one-owner invariant);
       * expect CASCADE from the branch delete instead.
       */
      action: "expect_cascade";
      object_type: "ea_branch_member";
      object_id: string;
      parent_object_type: "ea_branch";
      parent_object_id: string;
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

/** Per-action cleanup outcome for API + audit. */
export type SmokeTestCleanupOutcome =
  | "deleted"
  | "already_absent"
  | "cascaded"
  | "skipped"
  | "revoked"
  | "already_revoked"
  | "refused"
  | "failed";

export type SmokeTestCleanupActionResult = {
  action: SmokeTestCleanupAction["action"];
  object_type: SmokeTestObjectType;
  object_id: string;
  outcome: SmokeTestCleanupOutcome;
  error?: string;
  detail?: string;
  parent_object_type?: SmokeTestObjectType;
  parent_object_id?: string;
};

export type SmokeTestCleanupSuccess = {
  ok: true;
  plan: SmokeTestCleanupPlan;
  results: SmokeTestCleanupActionResult[];
  /** Actions that did not fail (compat). */
  executed: SmokeTestCleanupAction[];
  errors: string[];
};

export type SmokeTestCleanupFailure = {
  ok: false;
  error: string;
  plan?: SmokeTestCleanupPlan;
  results?: SmokeTestCleanupActionResult[];
  executed?: SmokeTestCleanupAction[];
  errors?: string[];
  consistency_errors?: string[];
};

export type SmokeTestCleanupResult =
  | SmokeTestCleanupSuccess
  | SmokeTestCleanupFailure;
