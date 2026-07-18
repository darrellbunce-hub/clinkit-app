import type { ErasureImpactReportSuccess, ErasureRequestStatus } from "@/lib/gdpr/types";

export type PrivacyAdminErrorCode =
  | "unauthenticated"
  | "forbidden"
  | "mfa_required"
  | "invalid_input"
  | "subject_not_found"
  | "request_not_found"
  | "invalid_status"
  | "backend_error";

export type PrivacyAdminActionResult<T = Record<string, unknown>> =
  | ({ ok: true } & T)
  | { ok: false; error: PrivacyAdminErrorCode; message?: string };

export type PrivacyRequestListItem = {
  id: string;
  status: ErasureRequestStatus;
  requestedAt: string;
  identityVerified: boolean;
  scopeAssessed: boolean;
  manualReviewRequired: boolean;
  hasOutstandingManualActions: boolean;
  hasOutstandingProcessors: boolean;
  completionState: "open" | "completed" | "rejected" | "failed";
};

export type PrivacyRequestActionRow = {
  id: string;
  actionType: string;
  targetType: string;
  status: string;
  reasonCode: string;
  requiresManualReview: boolean;
  propertyId: number | null;
};

export type PrivacyProcessorActionRow = {
  processor: string;
  actionType: string;
  status: string;
  required: boolean;
};

export type PrivacyAuditEventRow = {
  id: string;
  eventType: string;
  createdAt: string;
  detail: Record<string, unknown>;
};

export type PrivacyImpactAssessmentView = {
  generatedAt: string | null;
  account: {
    accountExists: boolean;
    accountType: string | null;
    emailVerified: boolean;
  };
  propertyRelationships: {
    totalProperties: number;
    soleParticipantCount: number;
    sharedDependencyCount: number;
    propertySummaries: Array<{
      propertyId: number;
      chainId: number | null;
      roles: string[];
      addressTreatment: string;
      sharedDependencyScore: number;
      affectsOtherParticipants: boolean;
    }>;
  };
  communications: {
    emailEventsCount: number;
    resendReviewRequired: boolean;
  };
  estateAgentRelationships: Record<string, unknown>;
  analytics: {
    linkedSnapshots: number;
    reidentificationReviewRequired: boolean;
  };
  unknownUnstructured: {
    jsonbReviewRequired: boolean;
    activityReviewRequired: boolean;
    riskFlags: string[];
  };
  riskFlags: string[];
  proposedPlan: {
    automaticDatabaseActions: PrivacyRequestActionRow[];
    manualReviewRequired: PrivacyRequestActionRow[];
    externalProcessorActions: PrivacyProcessorActionRow[];
    authDeletionLast: PrivacyRequestActionRow[];
  };
  executionReadiness: {
    readyForAutoExecution: boolean;
    requiresManualReview: boolean;
    blockingReasons: string[];
  };
};

export type PrivacyRequestDetail = {
  request: {
    id: string;
    status: ErasureRequestStatus;
    requestSource: string;
    requestedAt: string;
    identityVerifiedAt: string | null;
    scopeAssessedAt: string | null;
    approvedAt: string | null;
    databaseProcessingCompletedAt: string | null;
    authDeletionCompletedAt: string | null;
    completedAt: string | null;
    rejectedAt: string | null;
    manualReviewRequired: boolean;
    legalReviewRequired: boolean;
    subjectUserId: string;
  };
  statusSummary: Record<string, unknown> | null;
  actions: PrivacyRequestActionRow[];
  processors: PrivacyProcessorActionRow[];
  auditEvents: PrivacyAuditEventRow[];
  impactAssessment: PrivacyImpactAssessmentView | null;
  capabilities: {
    canVerifyIdentity: boolean;
    canAssessScope: boolean;
    canApprove: boolean;
    canReject: boolean;
    canExecute: boolean;
    canMarkAuthEligible: boolean;
    canDeleteAuth: boolean;
    canUpdateProcessors: boolean;
    isReadOnly: boolean;
  };
  nextRequiredSteps: string[];
};

export type PrivacyImpactReportSource = ErasureImpactReportSuccess;
