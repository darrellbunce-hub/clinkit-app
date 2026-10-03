import { NextResponse } from "next/server";

import { isAuthorizedLifecycleCronRequest } from "@/lib/lifecycle/cronAuth";
import { runPropertyLifecycleWorker } from "@/lib/lifecycle/worker";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/serviceRole";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Property lifecycle worker.
 *
 * Secured via Authorization: Bearer ${CRON_SECRET}. Disabled unless
 * LIFECYCLE_CRON_ENABLED is "true"; it has no vercel.json schedule until the
 * bounded placeholder lifecycle is approved for the target environment.
 */
export async function GET(request: Request) {
  const authorization = request.headers.get("authorization");

  if (!isAuthorizedLifecycleCronRequest(authorization)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (process.env.LIFECYCLE_CRON_ENABLED !== "true") {
    return NextResponse.json({ ok: true, disabled: true });
  }

  try {
    const supabase = createServiceRoleSupabaseClient();
    const result = await runPropertyLifecycleWorker(supabase);

    return NextResponse.json({
      ok: true,
      workerRunId: result.workerRunId,
      batchCount: result.batchCount,
      timeBudgetExhausted: result.timeBudgetExhausted,
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
