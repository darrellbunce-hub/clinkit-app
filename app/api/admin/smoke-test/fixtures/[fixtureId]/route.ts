import { NextResponse } from "next/server";

import { requirePrivilegedPlatformAdminSession } from "@/lib/auth/platformAdmin";
import {
  getSmokeTestFixture,
  listSmokeTestFixtureObjects,
  registerEaOrgForSmokeFixture,
  registerSmokeTestFixtureObject,
} from "@/lib/smokeTest/registry";
import type {
  SmokeTestObjectType,
  SmokeTestOwnership,
} from "@/lib/smokeTest/types";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/serviceRole";

export const runtime = "nodejs";

type RegisterBody =
  | {
      mode: "object";
      objectType: SmokeTestObjectType;
      objectId: string | number;
      ownership: SmokeTestOwnership;
    }
  | {
      mode: "ea_org_for_user";
      authUserId: string;
    }
  | {
      mode: "owned_property_and_chain";
      propertyId: number;
      chainId: number;
    };

/**
 * Inventory a fixture, or register objects after a genuine smoke journey.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ fixtureId: string }> }
) {
  const auth = await requirePrivilegedPlatformAdminSession();
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.error === "unauthenticated" ? 401 : 403 }
    );
  }

  const { fixtureId } = await context.params;
  const admin = createServiceRoleSupabaseClient();
  const fixture = await getSmokeTestFixture(admin, fixtureId);
  if (!fixture) {
    return NextResponse.json(
      { ok: false, error: "fixture_not_found" },
      { status: 404 }
    );
  }

  const objects = await listSmokeTestFixtureObjects(admin, fixtureId);
  return NextResponse.json({ ok: true, fixture, objects });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ fixtureId: string }> }
) {
  const auth = await requirePrivilegedPlatformAdminSession();
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.error === "unauthenticated" ? 401 : 403 }
    );
  }

  const { fixtureId } = await context.params;
  let body: RegisterBody;
  try {
    body = (await request.json()) as RegisterBody;
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid_json" },
      { status: 400 }
    );
  }

  const admin = createServiceRoleSupabaseClient();

  if (body.mode === "ea_org_for_user") {
    const result = await registerEaOrgForSmokeFixture(admin, {
      fixtureId,
      authUserId: body.authUserId,
      actorAdminUserId: auth.session.userId,
    });
    return NextResponse.json(
      result,
      { status: result.ok ? 200 : 400 }
    );
  }

  if (body.mode === "owned_property_and_chain") {
    for (const [objectType, objectId] of [
      ["property", body.propertyId],
      ["chain", body.chainId],
    ] as const) {
      const result = await registerSmokeTestFixtureObject(admin, {
        fixtureId,
        objectType,
        objectId,
        ownership: "owned",
        actorAdminUserId: auth.session.userId,
      });
      if (!result.ok) {
        return NextResponse.json(result, { status: 400 });
      }
    }
    return NextResponse.json({ ok: true });
  }

  if (body.mode === "object") {
    const result = await registerSmokeTestFixtureObject(admin, {
      fixtureId,
      objectType: body.objectType,
      objectId: body.objectId,
      ownership: body.ownership,
      actorAdminUserId: auth.session.userId,
    });
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  }

  return NextResponse.json({ ok: false, error: "invalid_mode" }, { status: 400 });
}
