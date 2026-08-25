import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  ErasureRequestSource,
  ErasureRequestStatus,
  GdprRpcResult,
} from "@/lib/gdpr/types";

export async function createGdprErasureRequest(params: {
  supabase: SupabaseClient;
  subjectUserId: string;
  requestSource?: ErasureRequestSource;
  createdBy?: string | null;
}): Promise<GdprRpcResult> {
  const { data, error } = await params.supabase.rpc("create_gdpr_erasure_request", {
    p_subject_user_id: params.subjectUserId,
    p_request_source: params.requestSource ?? "admin_manual",
    p_created_by: params.createdBy ?? null,
  });
  if (error) throw new Error(error.message);
  return data as GdprRpcResult;
}

export async function verifyGdprErasureIdentity(params: {
  supabase: SupabaseClient;
  requestId: string;
  verifiedBy?: string | null;
}): Promise<GdprRpcResult> {
  const { data, error } = await params.supabase.rpc("verify_gdpr_erasure_identity", {
    p_request_id: params.requestId,
    p_verified_by: params.verifiedBy ?? null,
  });
  if (error) throw new Error(error.message);
  return data as GdprRpcResult;
}

export async function assessGdprErasureScope(params: {
  supabase: SupabaseClient;
  requestId: string;
}): Promise<GdprRpcResult> {
  const { data, error } = await params.supabase.rpc("assess_gdpr_erasure_scope", {
    p_request_id: params.requestId,
  });
  if (error) throw new Error(error.message);
  return data as GdprRpcResult;
}

export async function approveGdprErasureRequest(params: {
  supabase: SupabaseClient;
  requestId: string;
  approvedBy?: string | null;
  actionIds?: string[] | null;
}): Promise<GdprRpcResult> {
  const { data, error } = await params.supabase.rpc("approve_gdpr_erasure_request", {
    p_request_id: params.requestId,
    p_approved_by: params.approvedBy ?? null,
    p_action_ids: params.actionIds ?? null,
  });
  if (error) throw new Error(error.message);
  return data as GdprRpcResult;
}

export async function rejectGdprErasureRequest(params: {
  supabase: SupabaseClient;
  requestId: string;
  reasonCode?: string;
}): Promise<GdprRpcResult> {
  const { data, error } = await params.supabase.rpc("reject_gdpr_erasure_request", {
    p_request_id: params.requestId,
    p_reason_code: params.reasonCode ?? "rejected_by_admin",
  });
  if (error) throw new Error(error.message);
  return data as GdprRpcResult;
}

export async function getGdprErasureRequestStatus(params: {
  supabase: SupabaseClient;
  requestId: string;
}): Promise<GdprRpcResult & { status?: ErasureRequestStatus }> {
  const { data, error } = await params.supabase.rpc("get_gdpr_erasure_request_status", {
    p_request_id: params.requestId,
  });
  if (error) throw new Error(error.message);
  return data as GdprRpcResult & { status?: ErasureRequestStatus };
}
