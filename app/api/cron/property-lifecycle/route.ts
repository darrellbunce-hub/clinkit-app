import { NextResponse } from "next/server";

import { isAuthorizedLifecycleCronRequest } from "@/lib/lifecycle/cronAuth";
import { runPropertyLifecycleWorkerBatch } from "@/lib/lifecycle/worker";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/serviceRole";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Scheduled property lifecycle worker.
 *
 * Secured via Authorization: Bearer ${CRON_SECRET}.
 * Configure in vercel.json and set CRON_SECRET in Vercel env.
 */
export async function GET(request: Request) {
  const authorization = request.headers.get("authorization");

  if (!isAuthorizedLifecycleCronRequest(authorization)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const supabase = createServiceRoleSupabaseClient();
    const result = await runPropertyLifecycleWorkerBatch(supabase);

    return NextResponse.json({
      ok: true,
      workerRunId: result.workerRunId,
      candidateCount: result.candidateCount,
      processedCount: result.processedCount,
      appliedCount: result.appliedCount,
      skippedCount: result.skippedCount,
      errorCount: result.errorCount,
    });
  } catch (error) {
    console.error("[lifecycle-worker] batch failed:", error);

    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "lifecycle_worker_failed",
      },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  return GET(request);
}
