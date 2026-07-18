"use server";

import { revalidatePath } from "next/cache";

import {
  approveGdprErasureRequest,
  assessGdprErasureScope,
  completeGdprAuthDeletion,
  createGdprErasureRequest,
  executeGdprErasureRequest,
  markGdprErasureAuthDeletionEligible,
  rejectGdprErasureRequest,
  updateGdprErasureProcessorAction,
  verifyGdprErasureIdentity,
} from "@/lib/gdpr";
import { requirePrivacyAdminContext } from "@/lib/privacyAdmin/auth";
import { lookupSubjectUserIdByExactEmail } from "@/lib/privacyAdmin/subjectLookup";
import type { PrivacyAdminActionResult } from "@/lib/privacyAdmin/types";
import { consumeRateLimit } from "@/lib/cache/rateLimit";

const PRIVACY_ADMIN_BASE = "/admin/privacy";

function revalidatePrivacyAdmin(requestId?: string) {
  revalidatePath(PRIVACY_ADMIN_BASE);
  if (requestId) {
    revalidatePath(`${PRIVACY_ADMIN_BASE}/${requestId}`);
  }
}

function mapBackendError<T = Record<string, never>>(error?: string): PrivacyAdminActionResult<T> {
  if (error === "request_not_found") {
    return { ok: false, error: "request_not_found" };
  }
  if (
    error === "invalid_status" ||
    error === "invalid_status_transition" ||
    error === "invalid_status_for_execution" ||
    error === "approval_incomplete" ||
    error === "reject_not_allowed"
  ) {
    return { ok: false, error: "invalid_status", message: error };
  }
  if (error === "ERASURE_SCOPE_CHANGED_REASSESSMENT_REQUIRED") {
    return {
      ok: false,
      error: "invalid_status",
      message: "scope_changed_reassessment_required",
    };
  }
  return { ok: false, error: "backend_error", message: error ?? "unknown_error" };
}

export async function createPrivacyErasureRequestAction(input: {
  subjectEmail: string;
  requestSource?: "admin_manual" | "privacy_email" | "support_ticket";
}): Promise<PrivacyAdminActionResult<{ requestId: string }>> {
  const ctx = await requirePrivacyAdminContext();
  if (!ctx.ok) {
    return ctx;
  }

  const rate = await consumeRateLimit(
    "privacy-admin-subject-lookup",
    ctx.adminUserId,
    { limit: 20, windowSeconds: 60 },
    { failOpen: false }
  );

  if (!rate.allowed) {
    return { ok: false, error: "backend_error", message: "rate_limited" };
  }

  const lookup = await lookupSubjectUserIdByExactEmail({
    service: ctx.service,
    email: input.subjectEmail,
  });

  if (!lookup.ok) {
    return lookup;
  }

  if (lookup.subjectUserId === null) {
    return { ok: false, error: "subject_not_found" };
  }

  const created = await createGdprErasureRequest({
    supabase: ctx.service,
    subjectUserId: lookup.subjectUserId,
    requestSource: input.requestSource ?? "admin_manual",
    createdBy: ctx.adminUserId,
  });

  if (created.ok !== true || !created.request_id) {
    return mapBackendError(created.error);
  }

  revalidatePrivacyAdmin(created.request_id);
  return { ok: true, requestId: created.request_id };
}

export async function verifyPrivacyErasureIdentityAction(
  requestId: string
): Promise<PrivacyAdminActionResult<{ status: string }>> {
  const ctx = await requirePrivacyAdminContext();
  if (!ctx.ok) {
    return ctx;
  }

  const result = await verifyGdprErasureIdentity({
    supabase: ctx.service,
    requestId,
    verifiedBy: ctx.adminUserId,
  });

  if (result.ok !== true) {
    return mapBackendError(result.error);
  }

  revalidatePrivacyAdmin(requestId);
  return { ok: true, status: String(result.status ?? "identity_verified") };
}

export async function assessPrivacyErasureScopeAction(
  requestId: string
): Promise<PrivacyAdminActionResult<{ status: string }>> {
  const ctx = await requirePrivacyAdminContext();
  if (!ctx.ok) {
    return ctx;
  }

  const result = await assessGdprErasureScope({
    supabase: ctx.service,
    requestId,
  });

  if (result.ok !== true) {
    return mapBackendError(result.error);
  }

  revalidatePrivacyAdmin(requestId);
  return { ok: true, status: String(result.status ?? "awaiting_approval") };
}

export async function approvePrivacyErasureRequestAction(
  requestId: string
): Promise<PrivacyAdminActionResult<{ status: string }>> {
  const ctx = await requirePrivacyAdminContext();
  if (!ctx.ok) {
    return ctx;
  }

  const result = await approveGdprErasureRequest({
    supabase: ctx.service,
    requestId,
    approvedBy: ctx.adminUserId,
  });

  if (result.ok !== true) {
    return mapBackendError(result.error);
  }

  revalidatePrivacyAdmin(requestId);
  return { ok: true, status: String(result.status ?? "approved") };
}

export async function rejectPrivacyErasureRequestAction(input: {
  requestId: string;
  reasonCode?: string;
}): Promise<PrivacyAdminActionResult<{ status: string }>> {
  const ctx = await requirePrivacyAdminContext();
  if (!ctx.ok) {
    return ctx;
  }

  const result = await rejectGdprErasureRequest({
    supabase: ctx.service,
    requestId: input.requestId,
    reasonCode: input.reasonCode ?? "rejected_by_admin",
  });

  if (result.ok !== true) {
    return mapBackendError(result.error);
  }

  revalidatePrivacyAdmin(input.requestId);
  return { ok: true, status: String(result.status ?? "rejected") };
}

export async function executePrivacyErasureRequestAction(
  requestId: string
): Promise<PrivacyAdminActionResult<{ status: string }>> {
  const ctx = await requirePrivacyAdminContext();
  if (!ctx.ok) {
    return ctx;
  }

  const result = await executeGdprErasureRequest({
    supabase: ctx.service,
    requestId,
  });

  if (result.ok !== true) {
    return mapBackendError(result.error);
  }

  revalidatePrivacyAdmin(requestId);
  return { ok: true, status: String(result.status ?? "processing") };
}

export async function markPrivacyAuthDeletionEligibleAction(
  requestId: string
): Promise<PrivacyAdminActionResult<{ status: string }>> {
  const ctx = await requirePrivacyAdminContext();
  if (!ctx.ok) {
    return ctx;
  }

  const result = await markGdprErasureAuthDeletionEligible({
    supabase: ctx.service,
    requestId,
  });

  if (result.ok !== true) {
    return mapBackendError(result.error);
  }

  revalidatePrivacyAdmin(requestId);
  return { ok: true, status: String(result.status ?? "awaiting_auth_deletion") };
}

export async function completePrivacyAuthDeletionAction(
  requestId: string
): Promise<
  PrivacyAdminActionResult<{
    status: string;
  }>
> {
  const ctx = await requirePrivacyAdminContext();
  if (!ctx.ok) {
    return ctx;
  }

  const result = await completeGdprAuthDeletion({
    supabase: ctx.service,
    requestId,
  });

  if (result.ok !== true) {
    return {
      ok: false,
      error: "backend_error",
      message:
        result.error === "auth_delete_failed"
          ? "auth_delete_failed"
          : String(result.error ?? "auth_delete_failed"),
    };
  }

  revalidatePrivacyAdmin(requestId);
  return { ok: true, status: String(result.status ?? "completed") };
}

export async function updatePrivacyProcessorActionStatus(input: {
  requestId: string;
  processor: string;
  status: "pending" | "completed" | "failed" | "not_required" | "manual_review";
}): Promise<PrivacyAdminActionResult<{ status: string }>> {
  const ctx = await requirePrivacyAdminContext();
  if (!ctx.ok) {
    return ctx;
  }

  const result = await updateGdprErasureProcessorAction({
    supabase: ctx.service,
    requestId: input.requestId,
    processor: input.processor,
    status: input.status,
  });

  if (result.ok !== true) {
    return mapBackendError(result.error);
  }

  revalidatePrivacyAdmin(input.requestId);
  return { ok: true, status: input.status };
}
