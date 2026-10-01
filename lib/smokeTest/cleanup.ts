import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  getSmokeTestFixture,
  listSmokeTestFixtureObjects,
} from "@/lib/smokeTest/registry";
import type {
  SmokeTestCleanupAction,
  SmokeTestCleanupActionResult,
  SmokeTestCleanupOutcome,
  SmokeTestCleanupPlan,
  SmokeTestCleanupResult,
  SmokeTestFixtureObject,
  SmokeTestObjectType,
} from "@/lib/smokeTest/types";

/**
 * Cleanup dependency order derived from FKs:
 * assignments → invitations → nodes/activities → property members → properties → chains
 * → branches (CASCADE members) → remaining branch members → companies → profiles → auth users.
 *
 * Owned ea_branch_member rows whose owned parent branch is also in the plan use
 * expect_cascade (never an explicit delete while the branch exists) so we do not
 * trip ea_branch_owner_invariant_violation.
 *
 * Only ownership=owned may be deleted. ownership=linked assignments are revoked only.
 */
const DELETE_ORDER: SmokeTestObjectType[] = [
  "property_ea_assignment",
  "ea_branch_invitation",
  "activity",
  "chain_node",
  "property_member",
  "property",
  "chain",
  "ea_branch",
  "ea_branch_member",
  "ea_company",
  "profile",
  "auth_user",
];

const TABLE_BY_TYPE: Partial<Record<SmokeTestObjectType, string>> = {
  property_ea_assignment: "property_ea_assignments",
  ea_branch_invitation: "ea_branch_invitations",
  activity: "activities",
  chain_node: "chain_nodes",
  property_member: "property_members",
  property: "properties",
  chain: "chains",
  ea_branch_member: "ea_branch_members",
  ea_branch: "ea_branches",
  ea_company: "ea_companies",
  profile: "profiles",
};

function groupByType(
  objects: SmokeTestFixtureObject[]
): Map<SmokeTestObjectType, SmokeTestFixtureObject[]> {
  const map = new Map<SmokeTestObjectType, SmokeTestFixtureObject[]>();
  for (const object of objects) {
    const list = map.get(object.object_type) ?? [];
    list.push(object);
    map.set(object.object_type, list);
  }
  return map;
}

function resultFrom(
  action: SmokeTestCleanupAction,
  outcome: SmokeTestCleanupOutcome,
  extra?: { error?: string; detail?: string }
): SmokeTestCleanupActionResult {
  const base: SmokeTestCleanupActionResult = {
    action: action.action,
    object_type: action.object_type,
    object_id: action.object_id,
    outcome,
    ...extra,
  };
  if (action.action === "expect_cascade") {
    base.parent_object_type = action.parent_object_type;
    base.parent_object_id = action.parent_object_id;
  }
  return base;
}

function formatError(result: SmokeTestCleanupActionResult): string {
  const err = result.error ?? result.outcome;
  return `${result.action}:${result.object_type}:${result.object_id}:${err}`;
}

/**
 * Classify GoTrue / Supabase Auth "user already gone" without treating
 * arbitrary Auth failures as success.
 *
 * Intentionally narrow: bare HTTP 404 / generic "not_found" alone are NOT enough.
 * Require an explicit user-not-found code or a message that mentions the user.
 */
export function isAuthUserNotFoundError(error: {
  message?: string;
  status?: number;
  code?: string;
  name?: string;
}): boolean {
  const code = (error.code ?? "").toLowerCase();
  if (code === "user_not_found" || code.endsWith("/user_not_found")) {
    return true;
  }

  const message = (error.message ?? "").toLowerCase().trim();
  if (!message) {
    return false;
  }

  // Known GoTrue phrasing — must mention the user, not bare "not found".
  if (message.includes("user not found")) {
    return true;
  }
  if (message.includes("user") && message.includes("does not exist")) {
    return true;
  }

  return false;
}

async function rowExists(
  admin: SupabaseClient,
  table: string,
  objectId: string
): Promise<{ exists: boolean; error?: string }> {
  const { data, error } = await admin
    .from(table)
    .select("id")
    .eq("id", objectId)
    .maybeSingle();

  if (error) {
    return { exists: false, error: error.message };
  }
  return { exists: Boolean(data) };
}

async function authUserExists(
  admin: SupabaseClient,
  userId: string
): Promise<{ exists: boolean; error?: string }> {
  const { data, error } = await admin.auth.admin.getUserById(userId);
  if (error) {
    if (isAuthUserNotFoundError(error)) {
      return { exists: false };
    }
    return { exists: false, error: error.message };
  }
  return { exists: Boolean(data?.user) };
}

async function ownedObjectStillPresent(
  admin: SupabaseClient,
  objectType: SmokeTestObjectType,
  objectId: string
): Promise<{ present: boolean; error?: string }> {
  if (objectType === "auth_user") {
    const check = await authUserExists(admin, objectId);
    return { present: check.exists, error: check.error };
  }

  const table = TABLE_BY_TYPE[objectType];
  if (!table) {
    return { present: false, error: `unsupported_type:${objectType}` };
  }

  const check = await rowExists(admin, table, objectId);
  return { present: check.exists, error: check.error };
}

export async function planSmokeTestFixtureCleanup(
  admin: SupabaseClient,
  fixtureId: string
): Promise<SmokeTestCleanupPlan> {
  const fixture = await getSmokeTestFixture(admin, fixtureId);
  const refusals: string[] = [];
  const actions: SmokeTestCleanupAction[] = [];

  if (!fixture) {
    return {
      fixtureId,
      dryRun: true,
      actions: [],
      refusals: ["fixture_not_found"],
    };
  }

  if (fixture.status !== "active") {
    return {
      fixtureId,
      dryRun: true,
      actions: [],
      refusals: ["fixture_already_cleaned"],
    };
  }

  const objects = await listSmokeTestFixtureObjects(admin, fixtureId);
  if (objects.length === 0) {
    refusals.push("fixture_has_no_registered_objects");
  }

  // Refuse heuristic cleanup — every destructive action requires a registry row.
  const byType = groupByType(objects);
  const ownedBranchIds = new Set(
    (byType.get("ea_branch") ?? [])
      .filter((row) => row.ownership === "owned")
      .map((row) => row.object_id)
  );

  for (const objectType of DELETE_ORDER) {
    const rows = byType.get(objectType) ?? [];
    for (const row of rows) {
      if (objectType === "property_ea_assignment") {
        if (row.ownership === "linked") {
          actions.push({
            action: "revoke_assignment",
            object_type: "property_ea_assignment",
            object_id: row.object_id,
            reason:
              "Assignment is linked to a non-owned (possibly real) property — revoke only",
          });
        } else {
          actions.push({
            action: "delete",
            object_type: "property_ea_assignment",
            object_id: row.object_id,
            reason: "Fixture-owned assignment",
          });
        }
        continue;
      }

      if (row.ownership !== "owned") {
        actions.push({
          action: "skip",
          object_type: objectType,
          object_id: row.object_id,
          reason: "Linked object — not deleted by fixture cleanup",
        });
        continue;
      }

      if (objectType === "auth_user") {
        actions.push({
          action: "delete_auth_user",
          object_type: "auth_user",
          object_id: row.object_id,
          reason: "Fixture-owned Auth user",
        });
        continue;
      }

      if (objectType === "ea_branch_member") {
        const { data: member, error: memberError } = await admin
          .from("ea_branch_members")
          .select("id, branch_id")
          .eq("id", row.object_id)
          .maybeSingle();

        if (memberError) {
          // Fall back to explicit delete; execute will surface the error.
          actions.push({
            action: "delete",
            object_type: "ea_branch_member",
            object_id: row.object_id,
            reason: `Fixture-owned ea_branch_member (branch lookup failed: ${memberError.message})`,
          });
          continue;
        }

        const branchId =
          member && typeof member.branch_id === "string"
            ? member.branch_id
            : null;

        if (branchId && ownedBranchIds.has(branchId)) {
          actions.push({
            action: "expect_cascade",
            object_type: "ea_branch_member",
            object_id: row.object_id,
            parent_object_type: "ea_branch",
            parent_object_id: branchId,
            reason:
              "Owned member of an owned branch — removed by branch CASCADE, not explicit delete (preserves owner invariant)",
          });
          continue;
        }

        // Member already absent (resumable) or parent branch not owned in this fixture.
        actions.push({
          action: "delete",
          object_type: "ea_branch_member",
          object_id: row.object_id,
          reason: branchId
            ? "Fixture-owned ea_branch_member (parent branch not owned in this fixture)"
            : "Fixture-owned ea_branch_member (already absent or branch unknown)",
        });
        continue;
      }

      actions.push({
        action: "delete",
        object_type: objectType,
        object_id: row.object_id,
        reason: `Fixture-owned ${objectType}`,
      });
    }
  }

  // Founding safety: never restore confirmed slots; ignore ledger entirely.
  refusals.push("founding_slots_never_restored_by_cleanup");

  return {
    fixtureId,
    dryRun: true,
    actions,
    refusals,
  };
}

async function executeAction(
  admin: SupabaseClient,
  action: SmokeTestCleanupAction
): Promise<SmokeTestCleanupActionResult> {
  if (action.action === "skip") {
    return resultFrom(action, "skipped", {
      detail: "Linked object — not hard-deleted",
    });
  }

  if (action.action === "revoke_assignment") {
    const { data, error } = await admin
      .from("property_ea_assignments")
      .update({
        status: "revoked",
        revoked_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", action.object_id)
      .neq("status", "revoked")
      .select("id");

    if (error) {
      return resultFrom(action, "failed", { error: error.message });
    }

    if (data && data.length > 0) {
      return resultFrom(action, "revoked");
    }

    const exists = await rowExists(
      admin,
      "property_ea_assignments",
      action.object_id
    );
    if (exists.error) {
      return resultFrom(action, "failed", { error: exists.error });
    }
    if (!exists.exists) {
      return resultFrom(action, "already_absent", {
        detail: "Linked assignment row already absent",
      });
    }
    return resultFrom(action, "already_revoked");
  }

  if (action.action === "expect_cascade") {
    const exists = await rowExists(
      admin,
      "ea_branch_members",
      action.object_id
    );
    if (exists.error) {
      return resultFrom(action, "failed", { error: exists.error });
    }
    if (!exists.exists) {
      return resultFrom(action, "cascaded", {
        detail: `Expected CASCADE from ea_branch ${action.parent_object_id}`,
      });
    }

    // Parent branch delete may have failed; do not force-delete the sole owner
    // while the branch still exists — report failure for consistency.
    const branchStillThere = await rowExists(
      admin,
      "ea_branches",
      action.parent_object_id
    );
    if (branchStillThere.error) {
      return resultFrom(action, "failed", { error: branchStillThere.error });
    }
    if (branchStillThere.exists) {
      return resultFrom(action, "failed", {
        error:
          "cascade_incomplete: owned branch still present; refusing explicit member delete to preserve owner invariant",
      });
    }

    // Branch gone but member lingered (unexpected) — safe to delete now.
    const { data, error } = await admin
      .from("ea_branch_members")
      .delete()
      .eq("id", action.object_id)
      .select("id");
    if (error) {
      return resultFrom(action, "failed", { error: error.message });
    }
    if (data && data.length > 0) {
      return resultFrom(action, "deleted", {
        detail: "Removed after parent branch absence",
      });
    }
    return resultFrom(action, "cascaded");
  }

  if (action.action === "delete_auth_user") {
    const { error } = await admin.auth.admin.deleteUser(action.object_id);
    if (error) {
      if (isAuthUserNotFoundError(error)) {
        return resultFrom(action, "already_absent", {
          detail: "Auth user already absent",
        });
      }
      return resultFrom(action, "failed", { error: error.message });
    }
    return resultFrom(action, "deleted");
  }

  const table = TABLE_BY_TYPE[action.object_type];
  if (!table) {
    return resultFrom(action, "failed", {
      error: `unsupported_delete_type:${action.object_type}`,
    });
  }

  const { data, error } = await admin
    .from(table)
    .delete()
    .eq("id", action.object_id)
    .select("id");

  if (error) {
    return resultFrom(action, "failed", { error: error.message });
  }

  if (data && data.length > 0) {
    return resultFrom(action, "deleted");
  }

  return resultFrom(action, "already_absent", {
    detail: "Owned row already absent",
  });
}

async function verifyOwnedObjectsAbsent(
  admin: SupabaseClient,
  objects: SmokeTestFixtureObject[],
  results: SmokeTestCleanupActionResult[]
): Promise<string[]> {
  const consistencyErrors: string[] = [];
  const resultByKey = new Map(
    results.map((r) => [`${r.object_type}:${r.object_id}`, r] as const)
  );

  for (const object of objects) {
    if (object.ownership === "linked") {
      const result = resultByKey.get(
        `${object.object_type}:${object.object_id}`
      );
      if (!result) {
        consistencyErrors.push(
          `linked_missing_result:${object.object_type}:${object.object_id}`
        );
        continue;
      }
      if (result.outcome === "failed") {
        consistencyErrors.push(
          `linked_failed:${object.object_type}:${object.object_id}:${result.error ?? "failed"}`
        );
      }
      // Linked objects may still exist after skip/revoke — that is expected.
      continue;
    }

    // owned
    const check = await ownedObjectStillPresent(
      admin,
      object.object_type,
      object.object_id
    );
    if (check.error) {
      consistencyErrors.push(
        `verify_error:${object.object_type}:${object.object_id}:${check.error}`
      );
      continue;
    }
    if (check.present) {
      consistencyErrors.push(
        `owned_still_present:${object.object_type}:${object.object_id}`
      );
    }
  }

  return consistencyErrors;
}

function auditPayloadFromResults(results: SmokeTestCleanupActionResult[]) {
  return {
    results: results.map((r) => ({
      action: r.action,
      object_type: r.object_type,
      object_id: r.object_id,
      outcome: r.outcome,
      error: r.error ?? null,
      detail: r.detail ?? null,
      parent_object_type: r.parent_object_type ?? null,
      parent_object_id: r.parent_object_id ?? null,
    })),
  };
}

export async function cleanupSmokeTestFixture(
  admin: SupabaseClient,
  input: {
    fixtureId: string;
    dryRun: boolean;
    confirmFixtureId?: string;
    actorAdminUserId?: string | null;
  }
): Promise<SmokeTestCleanupResult> {
  const plan = await planSmokeTestFixtureCleanup(admin, input.fixtureId);

  if (plan.refusals.includes("fixture_not_found")) {
    return { ok: false, error: "fixture_not_found", plan };
  }
  if (plan.refusals.includes("fixture_already_cleaned")) {
    return { ok: false, error: "fixture_already_cleaned", plan };
  }

  await admin.from("smoke_test_fixture_audit_events").insert({
    fixture_id: input.fixtureId,
    event_type: input.dryRun ? "cleanup_dry_run" : "cleanup_execute",
    actor_admin_user_id: input.actorAdminUserId ?? null,
    dry_run: input.dryRun,
    payload: { actions: plan.actions, refusals: plan.refusals },
  });

  if (input.dryRun) {
    return {
      ok: true,
      plan: { ...plan, dryRun: true },
      results: [],
      executed: [],
      errors: [],
    };
  }

  if (input.confirmFixtureId !== input.fixtureId) {
    return {
      ok: false,
      error: "confirm_fixture_id_mismatch",
      plan,
    };
  }

  const results: SmokeTestCleanupActionResult[] = [];
  const executed: SmokeTestCleanupAction[] = [];
  const errors: string[] = [];

  for (const action of plan.actions) {
    const result = await executeAction(admin, action);
    results.push(result);
    if (result.outcome === "failed") {
      errors.push(formatError(result));
      continue;
    }
    executed.push(action);
  }

  const objects = await listSmokeTestFixtureObjects(admin, input.fixtureId);
  const consistencyErrors =
    errors.length === 0
      ? await verifyOwnedObjectsAbsent(admin, objects, results)
      : [];

  await admin.from("smoke_test_fixture_audit_events").insert({
    fixture_id: input.fixtureId,
    event_type: "cleanup_execution_result",
    actor_admin_user_id: input.actorAdminUserId ?? null,
    dry_run: false,
    payload: {
      ...auditPayloadFromResults(results),
      errors,
      consistency_errors: consistencyErrors,
    },
  });

  if (errors.length > 0 || consistencyErrors.length > 0) {
    return {
      ok: false,
      error: "cleanup_partial_failure",
      plan: { ...plan, dryRun: false },
      results,
      executed,
      errors,
      consistency_errors: consistencyErrors,
    };
  }

  await admin
    .from("smoke_test_fixtures")
    .update({
      status: "cleaned",
      cleaned_at: new Date().toISOString(),
      cleaned_by_admin_user_id: input.actorAdminUserId ?? null,
    })
    .eq("id", input.fixtureId);

  await admin.from("smoke_test_fixture_audit_events").insert({
    fixture_id: input.fixtureId,
    event_type: "fixture_cleaned",
    actor_admin_user_id: input.actorAdminUserId ?? null,
    dry_run: false,
    payload: {
      executed_count: executed.length,
      results_count: results.length,
    },
  });

  return {
    ok: true,
    plan: { ...plan, dryRun: false },
    results,
    executed,
    errors: [],
  };
}
