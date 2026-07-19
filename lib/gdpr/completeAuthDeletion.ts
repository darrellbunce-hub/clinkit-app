import type { SupabaseClient } from "@supabase/supabase-js";

import {
  recordGdprErasureSuppressionLedger,
} from "@/lib/gdpr/suppressionLedger";
import {
  completeGdprErasureAuthDeletionRecord,
  markGdprErasureAuthDeletionEligible,
} from "@/lib/gdpr/erasureExecution";
import { getGdprErasureRequestStatus } from "@/lib/gdpr/erasureRequest";
import type { GdprRpcResult } from "@/lib/gdpr/types";

/**
 * Auth deletion LAST — requires eligible erasure request and service-role client.
 * Records keyed suppression fingerprints before Auth deletion while email is still available.
 */
export async function completeGdprAuthDeletion(params: {
  supabase: SupabaseClient;
  requestId: string;
}): Promise<GdprRpcResult> {
  const status = await getGdprErasureRequestStatus({
    supabase: params.supabase,
    requestId: params.requestId,
  });

  if (status.ok !== true) {
    return status;
  }

  if (
    status.status !== "awaiting_auth_deletion" &&
    status.status !== "partially_completed"
  ) {
    const eligible = await markGdprErasureAuthDeletionEligible({
      supabase: params.supabase,
      requestId: params.requestId,
    });
    if (eligible.ok !== true) {
      return eligible;
    }
  }

  const subjectUserId = status.subject_user_id as string | undefined;
  if (!subjectUserId) {
    return { ok: false, error: "subject_user_id_missing" };
  }

  const { data: authUser, error: authLookupError } =
    await params.supabase.auth.admin.getUserById(subjectUserId);

  if (authLookupError || !authUser.user?.email) {
    return {
      ok: false,
      error: "auth_identity_unavailable_for_suppression",
    };
  }

  const suppression = await recordGdprErasureSuppressionLedger({
    supabase: params.supabase,
    requestId: params.requestId,
    userId: subjectUserId,
    email: authUser.user.email,
  });

  if (suppression.ok !== true) {
    return suppression;
  }

  const { error: deleteError } = await params.supabase.auth.admin.deleteUser(
    subjectUserId
  );

  if (deleteError) {
    const message = deleteError.message ?? "auth_delete_failed";
    if (message.toLowerCase().includes("not found")) {
      return completeGdprErasureAuthDeletionRecord({
        supabase: params.supabase,
        requestId: params.requestId,
      });
    }

    return {
      ok: false,
      error: "auth_delete_failed",
      auth_error_message: message,
      auth_error_status:
        typeof (deleteError as { status?: number }).status === "number"
          ? (deleteError as { status?: number }).status
          : null,
    };
  }

  return completeGdprErasureAuthDeletionRecord({
    supabase: params.supabase,
    requestId: params.requestId,
  });
}
