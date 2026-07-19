import type { SupabaseClient } from "@supabase/supabase-js";

import {
  computeSuppressionFingerprints,
  GDPR_SUPPRESSION_HMAC_ALGORITHM,
} from "@/lib/gdpr/suppressionLedgerCore";
import type { GdprRpcResult } from "@/lib/gdpr/types";

export const GDPR_SUPPRESSION_HMAC_KEY_ENV = "GDPR_SUPPRESSION_HMAC_KEY";

export function getSuppressionHmacKey(): string {
  const key = process.env[GDPR_SUPPRESSION_HMAC_KEY_ENV]?.trim();
  if (!key) {
    throw new Error("suppression_hmac_key_missing");
  }
  return key;
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
