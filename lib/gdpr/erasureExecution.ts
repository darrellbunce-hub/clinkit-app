import type { SupabaseClient } from "@supabase/supabase-js";

import type { ErasureExecutionResult, GdprRpcResult } from "@/lib/gdpr/types";

/**
 * Controlled database erasure executor. Requires approved erasure request.
 * Does not delete Supabase Auth — use completeGdprAuthDeletion separately.
 */
export async function executeGdprErasureRequest(params: {
  supabase: SupabaseClient;
  requestId: string;
}): Promise<ErasureExecutionResult> {
  const { data, error } = await params.supabase.rpc("execute_gdpr_erasure_request", {
    p_request_id: params.requestId,
  });
  if (error) throw new Error(error.message);
  return data as ErasureExecutionResult;
}

export async function markGdprErasureAuthDeletionEligible(params: {
  supabase: SupabaseClient;
  requestId: string;
}): Promise<GdprRpcResult> {
  const { data, error } = await params.supabase.rpc(
    "mark_gdpr_erasure_auth_deletion_eligible",
    { p_request_id: params.requestId }
  );
  if (error) throw new Error(error.message);
  return data as GdprRpcResult;
}

export async function completeGdprErasureAuthDeletionRecord(params: {
  supabase: SupabaseClient;
  requestId: string;
}): Promise<GdprRpcResult> {
  const { data, error } = await params.supabase.rpc("complete_gdpr_erasure_auth_deletion", {
    p_request_id: params.requestId,
  });
  if (error) throw new Error(error.message);
  return data as GdprRpcResult;
}

export async function updateGdprErasureProcessorAction(params: {
  supabase: SupabaseClient;
  requestId: string;
  processor: string;
  status: "pending" | "completed" | "failed" | "not_required" | "manual_review";
  failureCode?: string | null;
}): Promise<GdprRpcResult> {
  const { data, error } = await params.supabase.rpc(
    "update_gdpr_erasure_processor_action",
    {
      p_request_id: params.requestId,
      p_processor: params.processor,
      p_status: params.status,
      p_failure_code: params.failureCode ?? null,
    }
  );
  if (error) throw new Error(error.message);
  return data as GdprRpcResult;
}
