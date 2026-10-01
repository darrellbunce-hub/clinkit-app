import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  SMOKE_TEST_OBJECT_TYPES,
  type SmokeTestFixture,
  type SmokeTestFixtureObject,
  type SmokeTestObjectType,
  type SmokeTestOwnership,
} from "@/lib/smokeTest/types";

function isObjectType(value: string): value is SmokeTestObjectType {
  return (SMOKE_TEST_OBJECT_TYPES as readonly string[]).includes(value);
}

export async function createSmokeTestFixture(
  admin: SupabaseClient,
  input: {
    label: string;
    notes?: string | null;
    createdByAdminUserId?: string | null;
  }
): Promise<{ ok: true; fixture: SmokeTestFixture } | { ok: false; error: string }> {
  const label = input.label.trim();
  if (label.length < 2) {
    return { ok: false, error: "label_required" };
  }

  const { data, error } = await admin
    .from("smoke_test_fixtures")
    .insert({
      label,
      notes: input.notes?.trim() || null,
      created_by_admin_user_id: input.createdByAdminUserId ?? null,
      status: "active",
    })
    .select("*")
    .single();

  if (error || !data) {
    return { ok: false, error: error?.message ?? "fixture_create_failed" };
  }

  await admin.from("smoke_test_fixture_audit_events").insert({
    fixture_id: data.id,
    event_type: "fixture_created",
    actor_admin_user_id: input.createdByAdminUserId ?? null,
    dry_run: false,
    payload: { label },
  });

  return { ok: true, fixture: data as SmokeTestFixture };
}

export async function getSmokeTestFixture(
  admin: SupabaseClient,
  fixtureId: string
): Promise<SmokeTestFixture | null> {
  const { data } = await admin
    .from("smoke_test_fixtures")
    .select("*")
    .eq("id", fixtureId)
    .maybeSingle();

  return (data as SmokeTestFixture | null) ?? null;
}

export async function listSmokeTestFixtureObjects(
  admin: SupabaseClient,
  fixtureId: string
): Promise<SmokeTestFixtureObject[]> {
  const { data } = await admin
    .from("smoke_test_fixture_objects")
    .select("*")
    .eq("fixture_id", fixtureId)
    .order("created_at", { ascending: true });

  return (data ?? []) as SmokeTestFixtureObject[];
}

export async function registerSmokeTestFixtureObject(
  admin: SupabaseClient,
  input: {
    fixtureId: string;
    objectType: SmokeTestObjectType;
    objectId: string | number;
    ownership: SmokeTestOwnership;
    actorAdminUserId?: string | null;
  }
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isObjectType(input.objectType)) {
    return { ok: false, error: "invalid_object_type" };
  }

  const fixture = await getSmokeTestFixture(admin, input.fixtureId);
  if (!fixture) {
    return { ok: false, error: "fixture_not_found" };
  }
  if (fixture.status !== "active") {
    return { ok: false, error: "fixture_not_active" };
  }

  const objectId = String(input.objectId).trim();
  if (!objectId) {
    return { ok: false, error: "object_id_required" };
  }

  const { error } = await admin.from("smoke_test_fixture_objects").upsert(
    {
      fixture_id: input.fixtureId,
      object_type: input.objectType,
      object_id: objectId,
      ownership: input.ownership,
    },
    { onConflict: "fixture_id,object_type,object_id" }
  );

  if (error) {
    return { ok: false, error: error.message };
  }

  await admin.from("smoke_test_fixture_audit_events").insert({
    fixture_id: input.fixtureId,
    event_type: "object_registered",
    actor_admin_user_id: input.actorAdminUserId ?? null,
    dry_run: false,
    payload: {
      object_type: input.objectType,
      object_id: objectId,
      ownership: input.ownership,
    },
  });

  return { ok: true };
}

/**
 * After a genuine EA smoke journey, attach discovered org records for a user.
 * Never invents markers from email/domain — requires explicit auth user id.
 */
export async function registerEaOrgForSmokeFixture(
  admin: SupabaseClient,
  input: {
    fixtureId: string;
    authUserId: string;
    actorAdminUserId?: string | null;
  }
): Promise<
  | {
      ok: true;
      registered: Array<{
        objectType: SmokeTestObjectType;
        objectId: string;
        ownership: SmokeTestOwnership;
      }>;
    }
  | { ok: false; error: string }
> {
  const registered: Array<{
    objectType: SmokeTestObjectType;
    objectId: string;
    ownership: SmokeTestOwnership;
  }> = [];

  const register = async (
    objectType: SmokeTestObjectType,
    objectId: string,
    ownership: SmokeTestOwnership
  ) => {
    const result = await registerSmokeTestFixtureObject(admin, {
      fixtureId: input.fixtureId,
      objectType,
      objectId,
      ownership,
      actorAdminUserId: input.actorAdminUserId,
    });
    if (!result.ok) {
      throw new Error(result.error);
    }
    registered.push({ objectType, objectId, ownership });
  };

  try {
    await register("auth_user", input.authUserId, "owned");
    await register("profile", input.authUserId, "owned");

    const { data: memberships } = await admin
      .from("ea_branch_members")
      .select("id, branch_id")
      .eq("user_id", input.authUserId);

    for (const membership of memberships ?? []) {
      await register("ea_branch_member", membership.id, "owned");
      await register("ea_branch", membership.branch_id, "owned");

      const { data: branch } = await admin
        .from("ea_branches")
        .select("company_id")
        .eq("id", membership.branch_id)
        .maybeSingle();

      if (branch?.company_id) {
        await register("ea_company", branch.company_id, "owned");
      }
    }

    return { ok: true, registered };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "register_failed",
    };
  }
}

export async function isSmokeTestEaBranch(
  admin: SupabaseClient,
  branchId: string
): Promise<boolean> {
  const { data, error } = await admin.rpc("is_smoke_test_ea_branch", {
    p_branch_id: branchId,
  });

  if (error) {
    // Migration not applied yet — fail closed for Checkout (block founding),
    // but callers that need directory rely on the view.
    if (
      error.message.includes("is_smoke_test_ea_branch") ||
      error.message.includes("smoke_test")
    ) {
      return false;
    }
    throw error;
  }

  return data === true;
}
