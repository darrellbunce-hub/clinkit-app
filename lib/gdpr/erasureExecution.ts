import type { SupabaseClient } from "@supabase/supabase-js";

import {
  computeSuppressionFingerprints,
  GDPR_SUPPRESSION_HMAC_ALGORITHM,
} from "@/lib/gdpr/suppressionLedgerCore";
import { getSuppressionHmacKey } from "@/lib/gdpr/suppressionLedger";
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
  status:
    | "pending"
    | "manual_review"
    | "processing"
    | "completed"
    | "failed"
    | "not_required"
    | "not_applicable"
    | "retention_expiry";
  failureCode?: string | null;
  statusCode?: string | null;
  operatorUserId?: string | null;
}): Promise<GdprRpcResult> {
  const { data, error } = await params.supabase.rpc(
    "update_gdpr_erasure_processor_action",
    {
      p_request_id: params.requestId,
      p_processor: params.processor,
      p_status: params.status,
      p_failure_code: params.failureCode ?? null,
      p_status_code: params.statusCode ?? null,
      p_operator_user_id: params.operatorUserId ?? null,
    }
  );
  if (error) throw new Error(error.message);
  return data as GdprRpcResult;
}

export async function recordGdprErasureSuppressionLedger(params: {
  supabase: SupabaseClient;
  requestId: string;
  userId: string;
  email: string;
}): Promise<GdprRpcResult> {
  const fingerprints = computeSuppressionFingerprints(getSuppressionHmacKey(), {
    userId: params.userId,
    email: params.email,
  });

  const { data, error } = await params.supabase.rpc(
    "record_gdpr_erasure_suppression_ledger",
    {
      p_request_id: params.requestId,
      p_subject_user_id_hash: fingerprints.subjectUserIdFingerprint,
      p_email_identity_fingerprint: fingerprints.emailIdentityFingerprint,
      p_hash_algorithm: fingerprints.hashAlgorithm,
    }
  );

  if (error) {
    throw new Error(error.message);
  }

  return data as GdprRpcResult;
}

export async function matchGdprSuppressionLedgerIdentities(params: {
  supabase: SupabaseClient;
  userId: string;
  email: string;
}): Promise<{
  ok: boolean;
  matches: string[];
  hashAlgorithm: string;
}> {
  const fingerprints = computeSuppressionFingerprints(getSuppressionHmacKey(), {
    userId: params.userId,
    email: params.email,
  });

  const { data, error } = await params.supabase.rpc(
    "match_gdpr_suppression_ledger_identities",
    {
      p_subject_user_id_hash: fingerprints.subjectUserIdFingerprint,
      p_email_identity_fingerprint: fingerprints.emailIdentityFingerprint,
    }
  );

  if (error) {
    throw new Error(error.message);
  }

  const payload = data as {
    ok?: boolean;
    matches?: string[];
    hash_algorithm?: string;
  };

  return {
    ok: payload.ok === true,
    matches: payload.matches ?? [],
    hashAlgorithm: payload.hash_algorithm ?? GDPR_SUPPRESSION_HMAC_ALGORITHM,
  };
}

export async function recomputeGdprErasureCompletion(params: {
  supabase: SupabaseClient;
  requestId: string;
}): Promise<GdprRpcResult> {
  const { data, error } = await params.supabase.rpc("recompute_gdpr_erasure_completion", {
    p_request_id: params.requestId,
  });
  if (error) {
    throw new Error(error.message);
  }
  return data as GdprRpcResult;
}
