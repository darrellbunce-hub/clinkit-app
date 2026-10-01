import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

export const DATA_RETENTION_BATCH_LIMIT = 200;

export type RetentionBatchResult = {
  ok: boolean;
  scanned: number;
  redacted: number;
  deleted: number;
  error?: string;
  detail?: Record<string, unknown>;
};

function asBatchResult(data: unknown): RetentionBatchResult {
  const row = (data ?? {}) as Record<string, unknown>;
  return {
    ok: row.ok === true,
    scanned: Number(row.scanned ?? 0),
    redacted: Number(row.redacted ?? 0),
    deleted: Number(row.deleted ?? 0),
    detail: row as Record<string, unknown>,
  };
}

export async function retainEmailEventsBatch(
  supabase: SupabaseClient,
  limit = DATA_RETENTION_BATCH_LIMIT
): Promise<RetentionBatchResult> {
  const { data, error } = await supabase.rpc("retain_email_events_batch", {
    p_limit: limit,
  });
  if (error) {
    return {
      ok: false,
      scanned: 0,
      redacted: 0,
      deleted: 0,
      error: error.message,
    };
  }
  return asBatchResult(data);
}

export async function retainBillingEmailDispatchesBatch(
  supabase: SupabaseClient,
  limit = DATA_RETENTION_BATCH_LIMIT
): Promise<RetentionBatchResult> {
  const { data, error } = await supabase.rpc(
    "retain_billing_email_dispatches_batch",
    { p_limit: limit }
  );
  if (error) {
    return {
      ok: false,
      scanned: 0,
      redacted: 0,
      deleted: 0,
      error: error.message,
    };
  }
  return asBatchResult(data);
}

export async function retainInvitationPiiBatch(
  supabase: SupabaseClient,
  limit = DATA_RETENTION_BATCH_LIMIT
): Promise<RetentionBatchResult> {
  const { data, error } = await supabase.rpc("retain_invitation_pii_batch", {
    p_limit: limit,
  });
  if (error) {
    return {
      ok: false,
      scanned: 0,
      redacted: 0,
      deleted: 0,
      error: error.message,
    };
  }
  return asBatchResult(data);
}

export type DataRetentionRunResult = {
  ok: boolean;
  runId: string | null;
  status: "succeeded" | "failed" | "partial";
  scanned: number;
  redacted: number;
  deleted: number;
  errorCount: number;
  batches: {
    emailEvents: RetentionBatchResult;
    billingDispatches: RetentionBatchResult;
    invitations: RetentionBatchResult;
  };
};

/**
 * Orchestrates tightly scoped retention RPCs and records a durable job run.
 * Selection/mutation happens only inside service_role SQL — no caller IDs.
 */
export async function runDataRetentionBatch(
  supabase: SupabaseClient,
  options?: { batchLimit?: number }
): Promise<DataRetentionRunResult> {
  const limit = options?.batchLimit ?? DATA_RETENTION_BATCH_LIMIT;

  const { data: runId, error: beginError } = await supabase.rpc(
    "begin_maintenance_job_run",
    {
      p_job_type: "data_retention",
      p_detail: { batch_limit: limit },
    }
  );

  if (beginError) {
    throw new Error(`begin_maintenance_job_run failed: ${beginError.message}`);
  }

  const jobRunId = (runId as string | null) ?? null;

  const emailEvents = await retainEmailEventsBatch(supabase, limit);
  const billingDispatches = await retainBillingEmailDispatchesBatch(
    supabase,
    limit
  );
  const invitations = await retainInvitationPiiBatch(supabase, limit);

  const scanned =
    emailEvents.scanned + billingDispatches.scanned + invitations.scanned;
  const redacted =
    emailEvents.redacted + billingDispatches.redacted + invitations.redacted;
  const deleted =
    emailEvents.deleted + billingDispatches.deleted + invitations.deleted;

  const errors = [emailEvents, billingDispatches, invitations].filter(
    (batch) => !batch.ok
  );
  const errorCount = errors.length;
  const status =
    errorCount === 0 ? "succeeded" : errorCount === 3 ? "failed" : "partial";

  if (jobRunId) {
    await supabase.rpc("complete_maintenance_job_run", {
      p_run_id: jobRunId,
      p_status: status,
      p_records_scanned: scanned,
      p_records_redacted: redacted,
      p_records_deleted: deleted,
      p_error_count: errorCount,
      p_detail: {
        email_events: emailEvents.detail ?? emailEvents,
        billing_dispatches: billingDispatches.detail ?? billingDispatches,
        invitations: invitations.detail ?? invitations,
      },
      p_error_summary:
        errors.length > 0
          ? errors.map((e) => e.error ?? "batch_failed").join("; ")
          : null,
    });
  }

  return {
    ok: errorCount === 0,
    runId: jobRunId,
    status,
    scanned,
    redacted,
    deleted,
    errorCount,
    batches: {
      emailEvents,
      billingDispatches,
      invitations,
    },
  };
}
