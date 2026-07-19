import {
  generateErasureImpactReport,
  getGdprErasureRequestStatus,
} from "@/lib/gdpr";
import type { ErasureRequestStatus } from "@/lib/gdpr/types";
import { assertPrivacyAdminContextForRead } from "@/lib/privacyAdmin/auth";
import { buildCompletionChecklist } from "@/lib/privacyAdmin/presentCompletionChecklist";
import { sanitizeAuditEventDetail } from "@/lib/privacyAdmin/presentAuditEvent";
import {
  buildImpactAssessmentFromReport,
  mapActionRow,
} from "@/lib/privacyAdmin/presentImpactReport";
import type {
  PrivacyAuditEventRow,
  PrivacyProcessorActionRow,
  PrivacyRequestActionRow,
  PrivacyRequestDetail,
  PrivacyRequestListItem,
} from "@/lib/privacyAdmin/types";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/serviceRole";

const TERMINAL_STATUSES = new Set<ErasureRequestStatus>([
  "completed",
  "rejected",
  "failed",
]);

function deriveCompletionState(
  status: ErasureRequestStatus
): PrivacyRequestListItem["completionState"] {
  if (status === "completed") return "completed";
  if (status === "rejected") return "rejected";
  if (status === "failed") return "failed";
  return "open";
}

function mapProcessorRows(
  processors: Array<Record<string, unknown>> | null | undefined
): PrivacyProcessorActionRow[] {
  return (processors ?? []).map((processor) => ({
    processor: String(processor.processor ?? "unknown"),
    actionType: String(processor.action_type ?? "unknown"),
    status: String(processor.status ?? "unknown"),
    statusCode: processor.status_code ? String(processor.status_code) : null,
    required: processor.required === true,
  }));
}

function deriveNextRequiredSteps(params: {
  status: ErasureRequestStatus;
  actions: PrivacyRequestActionRow[];
  processors: PrivacyProcessorActionRow[];
  databaseProcessingCompletedAt: string | null;
  authDeletionCompletedAt: string | null;
}): string[] {
  const steps: string[] = [];

  if (
    params.databaseProcessingCompletedAt &&
    !params.authDeletionCompletedAt &&
    params.actions.some(
      (action) =>
        action.actionType === "DELETE_AUTH_IDENTITY_LAST" &&
        ["approved", "pending_manual", "skipped_idempotent"].includes(action.status)
    )
  ) {
    steps.push("AUTH_DELETION_PENDING");
  }

  if (
    params.processors.some(
      (processor) =>
        processor.required &&
        processor.processor !== "supabase_auth" &&
        ["pending", "manual_review", "processing", "failed"].includes(processor.status)
    )
  ) {
    steps.push("EXTERNAL_PROCESSOR_PENDING");
  }

  if (
    params.status === "manual_review_required" ||
    params.actions.some((action) =>
      ["pending_manual", "blocked", "manual_review_required"].includes(action.status)
    )
  ) {
    steps.push("MANUAL_REVIEW_REQUIRED");
  }

  return steps;
}

function deriveCapabilities(params: {
  status: ErasureRequestStatus;
  nextSteps: string[];
  databaseProcessingCompletedAt: string | null;
  authDeletionCompletedAt: string | null;
}): PrivacyRequestDetail["capabilities"] {
  const { status, nextSteps, databaseProcessingCompletedAt, authDeletionCompletedAt } =
    params;
  const isReadOnly = TERMINAL_STATUSES.has(status);

  return {
    canVerifyIdentity: !isReadOnly && status === "requested",
    canAssessScope:
      !isReadOnly &&
      (status === "identity_verified" ||
        status === "scope_assessed" ||
        status === "awaiting_approval"),
    canApprove: !isReadOnly && status === "awaiting_approval",
    canReject: !isReadOnly && status !== "processing" && !TERMINAL_STATUSES.has(status),
    canExecute: !isReadOnly && status === "approved",
    canMarkAuthEligible:
      !isReadOnly &&
      !authDeletionCompletedAt &&
      databaseProcessingCompletedAt != null &&
      ["awaiting_auth_deletion", "partially_completed", "awaiting_external_processors"].includes(
        status
      ),
    canDeleteAuth:
      !isReadOnly &&
      !authDeletionCompletedAt &&
      databaseProcessingCompletedAt != null &&
      nextSteps.includes("AUTH_DELETION_PENDING") &&
      ["awaiting_auth_deletion", "partially_completed"].includes(status),
    canUpdateProcessors: !isReadOnly && !TERMINAL_STATUSES.has(status),
    isReadOnly,
  };
}

export async function listPrivacyErasureRequests(): Promise<PrivacyRequestListItem[]> {
  const gate = await assertPrivacyAdminContextForRead();
  if (!gate.ok) {
    throw new Error(gate.error);
  }

  const service = createServiceRoleSupabaseClient();

  const { data: requests, error } = await service
    .from("gdpr_erasure_requests")
    .select(
      "id, status, requested_at, identity_verified_at, scope_assessed_at, manual_review_required"
    )
    .order("requested_at", { ascending: false })
    .limit(100);

  if (error) {
    throw new Error(error.message);
  }

  const items: PrivacyRequestListItem[] = [];

  for (const request of requests ?? []) {
    const status = await getGdprErasureRequestStatus({
      supabase: service,
      requestId: request.id,
    });

    const actionSummary = (status.action_summary ?? {}) as Record<string, number>;
    const processors = mapProcessorRows(
      status.processor_summary as Array<Record<string, unknown>> | undefined
    );

    items.push({
      id: request.id,
      status: request.status as ErasureRequestStatus,
      requestedAt: request.requested_at,
      identityVerified: request.identity_verified_at != null,
      scopeAssessed: request.scope_assessed_at != null,
      manualReviewRequired: request.manual_review_required === true,
      hasOutstandingManualActions: Object.entries(actionSummary).some(
        ([actionStatus, count]) =>
          count > 0 &&
          ["draft", "pending_manual", "blocked", "manual_review_required"].includes(
            actionStatus
          )
      ),
      hasOutstandingProcessors: processors.some(
        (processor) =>
          processor.required &&
          ["pending", "manual_review", "processing", "failed"].includes(processor.status)
      ),
      completionState: deriveCompletionState(request.status as ErasureRequestStatus),
    });
  }

  return items;
}

export async function getPrivacyErasureRequestDetail(
  requestId: string
): Promise<PrivacyRequestDetail | null> {
  const gate = await assertPrivacyAdminContextForRead();
  if (!gate.ok) {
    throw new Error(gate.error);
  }

  const service = createServiceRoleSupabaseClient();

  const { data: request, error } = await service
    .from("gdpr_erasure_requests")
    .select("*")
    .eq("id", requestId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!request) {
    return null;
  }

  const status = await getGdprErasureRequestStatus({
    supabase: service,
    requestId,
  });

  const { data: actionRows } = await service
    .from("gdpr_erasure_actions")
    .select(
      "id, action_type, target_type, status, reason_code, requires_manual_review, target_reference"
    )
    .eq("erasure_request_id", requestId)
    .order("created_at", { ascending: true });

  const { data: auditRows } = await service
    .from("gdpr_erasure_audit_events")
    .select("id, event_type, event_detail, created_at")
    .eq("erasure_request_id", requestId)
    .order("created_at", { ascending: false })
    .limit(100);

  const actions = (actionRows ?? []).map((row) => mapActionRow(row));
  const processors = mapProcessorRows(
    status.processor_summary as Array<Record<string, unknown>> | undefined
  );

  const impactReport = await generateErasureImpactReport({
    supabase: service,
    userId: request.subject_user_id,
  });

  const nextRequiredSteps = deriveNextRequiredSteps({
    status: request.status as ErasureRequestStatus,
    actions,
    processors,
    databaseProcessingCompletedAt: request.database_processing_completed_at,
    authDeletionCompletedAt: request.auth_deletion_completed_at,
  });

  const capabilities = deriveCapabilities({
    status: request.status as ErasureRequestStatus,
    nextSteps: nextRequiredSteps,
    databaseProcessingCompletedAt: request.database_processing_completed_at,
    authDeletionCompletedAt: request.auth_deletion_completed_at,
  });

  const auditEvents: PrivacyAuditEventRow[] = (auditRows ?? []).map((event) => ({
    id: event.id,
    eventType: event.event_type,
    createdAt: event.created_at,
    detail: sanitizeAuditEventDetail(
      event.event_detail as Record<string, unknown> | null | undefined
    ),
  }));

  const suppressionRecorded =
    status.ok === true && status.suppression_recorded === true;

  const completionChecklist = buildCompletionChecklist({
    databaseProcessingCompletedAt: request.database_processing_completed_at,
    suppressionRecorded,
    authDeletionCompletedAt: request.auth_deletion_completed_at,
    requestStatus: request.status,
    processors,
  });

  return {
    request: {
      id: request.id,
      status: request.status as ErasureRequestStatus,
      requestSource: request.request_source,
      requestedAt: request.requested_at,
      identityVerifiedAt: request.identity_verified_at,
      scopeAssessedAt: request.scope_assessed_at,
      approvedAt: request.approved_at,
      databaseProcessingCompletedAt: request.database_processing_completed_at,
      authDeletionCompletedAt: request.auth_deletion_completed_at,
      completedAt: request.completed_at,
      rejectedAt: request.rejected_at,
      manualReviewRequired: request.manual_review_required,
      legalReviewRequired: request.legal_review_required,
      subjectUserId: request.subject_user_id,
    },
    statusSummary: status.ok === true ? (status as Record<string, unknown>) : null,
    actions,
    processors,
    auditEvents,
    impactAssessment: buildImpactAssessmentFromReport(impactReport, {
      actions,
      processors,
    }),
    capabilities,
    nextRequiredSteps,
    completionChecklist,
    suppressionRecorded,
  };
}
