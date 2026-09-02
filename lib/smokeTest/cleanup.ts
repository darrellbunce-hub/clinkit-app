import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  getSmokeTestFixture,
  listSmokeTestFixtureObjects,
} from "@/lib/smokeTest/registry";
import type {
  SmokeTestCleanupAction,
  SmokeTestCleanupPlan,
  SmokeTestFixtureObject,
  SmokeTestObjectType,
} from "@/lib/smokeTest/types";

/**
 * Cleanup dependency order derived from FKs:
 * assignments → invitations → members → nodes/activities → properties → chains
 * → branch members → branches → companies → profiles → auth users.
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
  "ea_branch_member",
  "ea_branch",
  "ea_company",
  "profile",
  "auth_user",
];

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

      if (objectType === "property" || objectType === "chain") {
        actions.push({
          action: "delete",
          object_type: objectType,
          object_id: row.object_id,
          reason: `Fixture-owned ${objectType}`,
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
  refusals.push(
    "founding_slots_never_restored_by_cleanup"
  );

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
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (action.action === "skip") {
    return { ok: true };
  }

  if (action.action === "revoke_assignment") {
    const { error } = await admin
      .from("property_ea_assignments")
      .update({
        status: "revoked",
        revoked_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", action.object_id)
      .neq("status", "revoked");

    if (error) {
      return { ok: false, error: error.message };
    }
    return { ok: true };
  }

  if (action.action === "delete_auth_user") {
    // Clear company creator FK first if company already deleted; otherwise
    // Auth delete can fail on ea_companies.created_by_user_id RESTRICT.
    const { error } = await admin.auth.admin.deleteUser(action.object_id);
    if (error) {
      return { ok: false, error: error.message };
    }
    return { ok: true };
  }

  const tableByType: Partial<Record<SmokeTestObjectType, string>> = {
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

  const table = tableByType[action.object_type];
  if (!table) {
    return { ok: false, error: `unsupported_delete_type:${action.object_type}` };
  }

  // Before deleting company, null creator if still set (Auth user may remain until later).
  if (action.object_type === "ea_company") {
    // created_by is NOT NULL — must delete Auth after company, or reassign.
    // Order deletes company before auth_user; company delete requires no RESTRICT children.
  }

  if (action.object_type === "ea_company") {
    // ea_companies.created_by_user_id references auth.users without ON DELETE.
    // Delete company before auth user (already ordered). If insert required NOT NULL,
    // company delete succeeds; auth delete later is fine.
  }

  const { error } = await admin.from(table).delete().eq("id", action.object_id);
  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

export async function cleanupSmokeTestFixture(
  admin: SupabaseClient,
  input: {
    fixtureId: string;
    dryRun: boolean;
    confirmFixtureId?: string;
    actorAdminUserId?: string | null;
  }
): Promise<
  | {
      ok: true;
      plan: SmokeTestCleanupPlan;
      executed: SmokeTestCleanupAction[];
      errors: string[];
    }
  | { ok: false; error: string; plan?: SmokeTestCleanupPlan }
> {
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

  const executed: SmokeTestCleanupAction[] = [];
  const errors: string[] = [];

  for (const action of plan.actions) {
    if (action.action === "skip") {
      executed.push(action);
      continue;
    }

    const result = await executeAction(admin, action);
    if (!result.ok) {
      errors.push(
        `${action.action}:${action.object_type}:${action.object_id}:${result.error}`
      );
      // Continue where possible; report all failures.
      continue;
    }
    executed.push(action);
  }

  if (errors.length === 0) {
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
      payload: { executed_count: executed.length },
    });

    return {
      ok: true,
      plan: { ...plan, dryRun: false },
      executed,
      errors: [],
    };
  }

  return {
    ok: false,
    error: "cleanup_partial_failure",
    plan: { ...plan, dryRun: false },
  };
}
