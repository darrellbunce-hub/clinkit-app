import { NextResponse } from "next/server";

import { requirePrivilegedPlatformAdminSession } from "@/lib/auth/platformAdmin";
import { cleanupSmokeTestFixture } from "@/lib/smokeTest/cleanup";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/serviceRole";

export const runtime = "nodejs";

/**
 * Dry-run (default) or execute fixture cleanup.
 * Destructive execute requires confirmFixtureId === fixtureId.
 */
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
  let body: {
    dryRun?: boolean;
    confirmFixtureId?: string;
  };

  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }

  const dryRun = body.dryRun !== false;
  const admin = createServiceRoleSupabaseClient();

  const result = await cleanupSmokeTestFixture(admin, {
    fixtureId,
    dryRun,
    confirmFixtureId: body.confirmFixtureId,
    actorAdminUserId: auth.session.userId,
  });

  if (!result.ok) {
    return NextResponse.json(result, {
      status: result.error === "confirm_fixture_id_mismatch" ? 400 : 400,
    });
  }

  return NextResponse.json(result);
}
