import { NextResponse } from "next/server";

import { runChainIntelligenceWorkerBatch } from "@/lib/chainIntelligence/worker";
import { isAuthorizedLifecycleCronRequest } from "@/lib/lifecycle/cronAuth";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/serviceRole";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Chain Intelligence worker (vercel.json): missing, queued and time-due
 * operational summaries.
 *
 * Secured via Authorization: Bearer ${CRON_SECRET}.
 */
export async function GET(request: Request) {
  const authorization = request.headers.get("authorization");

  if (!isAuthorizedLifecycleCronRequest(authorization)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const supabase = createServiceRoleSupabaseClient();
    const result = await runChainIntelligenceWorkerBatch(supabase, {
      maxBatches: 10,
      timeBudgetMs: 240_000,
    });

    return NextResponse.json({
      ok: true,
      ...result,
    });
  } catch (error) {
    console.error("[chain-intelligence-worker] batch failed:", error);

    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "chain_intelligence_worker_failed",
      },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  return GET(request);
}
