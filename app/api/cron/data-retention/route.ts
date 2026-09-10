import { NextResponse } from "next/server";

import { isAuthorizedLifecycleCronRequest } from "@/lib/lifecycle/cronAuth";
import { runDataRetentionBatch } from "@/lib/retention/dataRetention";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/serviceRole";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Scheduled data-retention worker (email metadata, billing dispatch PII,
 * invitation PII). Separate from property-lifecycle cron.
 *
 * Secured via Authorization: Bearer ${CRON_SECRET}.
 * No caller-controlled record IDs or deletion scope.
 */
export async function GET(request: Request) {
  const authorization = request.headers.get("authorization");

  if (!isAuthorizedLifecycleCronRequest(authorization)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const supabase = createServiceRoleSupabaseClient();
    const result = await runDataRetentionBatch(supabase);

    return NextResponse.json({
      ok: result.ok,
      runId: result.runId,
      status: result.status,
      scanned: result.scanned,
      redacted: result.redacted,
      deleted: result.deleted,
      errorCount: result.errorCount,
      batches: {
        emailEvents: {
          ok: result.batches.emailEvents.ok,
          scanned: result.batches.emailEvents.scanned,
          redacted: result.batches.emailEvents.redacted,
          deleted: result.batches.emailEvents.deleted,
        },
        billingDispatches: {
          ok: result.batches.billingDispatches.ok,
          scanned: result.batches.billingDispatches.scanned,
          redacted: result.batches.billingDispatches.redacted,
          deleted: result.batches.billingDispatches.deleted,
        },
        invitations: {
          ok: result.batches.invitations.ok,
          scanned: result.batches.invitations.scanned,
          redacted: result.batches.invitations.redacted,
          deleted: result.batches.invitations.deleted,
        },
      },
    });
  } catch (error) {
    console.error("[data-retention] batch failed:", error);

    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error ? error.message : "data_retention_failed",
      },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  return GET(request);
}
