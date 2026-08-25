import { NextResponse } from "next/server";

import {
  evaluateHealthStatus,
  resolveHealthHttpStatus,
} from "@/lib/observability/healthCheck";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Public health endpoint for external uptime monitoring.
 *
 * - Confirms the Next.js route is responding.
 * - Performs a lightweight, cached Supabase/database reachability probe.
 * - Does not mutate data, expose secrets, or return internal error details.
 *
 * Optional query:
 *   ?probe=app — skip the database probe; returns database:"skipped".
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const probe = searchParams.get("probe")?.trim().toLowerCase();
  const includeDatabaseProbe = probe !== "app";

  const result = await evaluateHealthStatus({
    includeDatabaseProbe,
  });

  return NextResponse.json(result, {
    status: resolveHealthHttpStatus(result.status),
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
