import { NextResponse } from "next/server";

import { requirePrivilegedPlatformAdminSession } from "@/lib/auth/platformAdmin";
import { createSyntheticSmokeTestFixture } from "@/lib/smokeTest/createSyntheticFixture";
import { createSmokeTestFixture } from "@/lib/smokeTest/registry";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/serviceRole";

export const runtime = "nodejs";

/**
 * Platform-admin (AAL2) only.
 * Creates an empty fixture registry row, or a full synthetic fixture.
 * Never available to ordinary EA clients.
 */
export async function POST(request: Request) {
  const auth = await requirePrivilegedPlatformAdminSession();
  if (!auth.ok) {
    const status =
      auth.error === "unauthenticated"
        ? 401
        : auth.error === "forbidden"
          ? 403
          : 401;
    return NextResponse.json({ ok: false, error: auth.error }, { status });
  }

  let body: {
    mode?: "registry_only" | "synthetic";
    label?: string;
    notes?: string;
  };

  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid_json" },
      { status: 400 }
    );
  }

  // Reject any attempt to pass client-side test flags through this or confuse with onboarding.
  const forbidden = ["is_test", "isTest", "testAccount", "account_type"];
  for (const key of forbidden) {
    if (key in (body as Record<string, unknown>)) {
      return NextResponse.json(
        { ok: false, error: "forbidden_client_test_flag" },
        { status: 400 }
      );
    }
  }

  const label = body.label?.trim();
  if (!label || label.length < 2) {
    return NextResponse.json(
      { ok: false, error: "label_required" },
      { status: 400 }
    );
  }

  const admin = createServiceRoleSupabaseClient();
  const mode = body.mode ?? "registry_only";

  if (mode === "synthetic") {
    const result = await createSyntheticSmokeTestFixture(admin, {
      label,
      actorAdminUserId: auth.session.userId,
    });
    if (!result.ok) {
      return NextResponse.json(result, { status: 500 });
    }
    return NextResponse.json(result);
  }

  const result = await createSmokeTestFixture(admin, {
    label,
    notes: body.notes ?? null,
    createdByAdminUserId: auth.session.userId,
  });

  if (!result.ok) {
    return NextResponse.json(result, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    fixtureId: result.fixture.id,
    fixture: result.fixture,
  });
}

export async function GET() {
  const auth = await requirePrivilegedPlatformAdminSession();
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.error === "unauthenticated" ? 401 : 403 }
    );
  }

  const admin = createServiceRoleSupabaseClient();
  const { data, error } = await admin
    .from("smoke_test_fixtures")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, fixtures: data ?? [] });
}
