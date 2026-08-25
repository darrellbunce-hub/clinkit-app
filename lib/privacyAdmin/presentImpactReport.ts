import type {
  ErasureImpactReport,
  ErasureImpactReportSuccess,
  ErasureProposedAction,
} from "@/lib/gdpr/types";
import type {
  PrivacyImpactAssessmentView,
  PrivacyProcessorActionRow,
  PrivacyRequestActionRow,
} from "@/lib/privacyAdmin/types";

const PII_KEY_PATTERN =
  /email|address|token|payload|invite|postcode|phone|name|secret|password/i;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function sanitizeStructuredDetail(
  value: unknown,
  depth = 0
): Record<string, unknown> | unknown[] | string | number | boolean | null {
  if (depth > 4) {
    return null;
  }

  if (value === null || typeof value === "boolean" || typeof value === "number") {
    return value;
  }

  if (typeof value === "string") {
    if (PII_KEY_PATTERN.test(value)) {
      return "[redacted]";
    }
    return value.length > 120 ? "[structured_value]" : value;
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, 20)
      .map((entry) => sanitizeStructuredDetail(entry, depth + 1));
  }

  if (!isPlainObject(value)) {
    return null;
  }

  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (PII_KEY_PATTERN.test(key)) {
      continue;
    }
    output[key] = sanitizeStructuredDetail(entry, depth + 1);
  }
  return output;
}

function mapActionRow(row: {
  id?: string;
  action_type?: string;
  target_type?: string;
  status?: string;
  reason_code?: string;
  requires_manual_review?: boolean;
  target_reference?: Record<string, unknown> | null;
}): PrivacyRequestActionRow {
  const propertyIdRaw = row.target_reference?.property_id;
  const propertyId =
    typeof propertyIdRaw === "number"
      ? propertyIdRaw
      : typeof propertyIdRaw === "string"
        ? Number(propertyIdRaw)
        : null;

  return {
    id: row.id ?? "",
    actionType: row.action_type ?? "unknown",
    targetType: row.target_type ?? "unknown",
    status: row.status ?? "unknown",
    reasonCode: row.reason_code ?? "unknown",
    requiresManualReview: row.requires_manual_review === true,
    propertyId: Number.isFinite(propertyId) ? propertyId : null,
  };
}

function groupProposedActions(
  actions: PrivacyRequestActionRow[]
): PrivacyImpactAssessmentView["proposedPlan"] {
  return {
    automaticDatabaseActions: actions.filter(
      (action) =>
        !action.requiresManualReview &&
        action.actionType !== "DELETE_AUTH_IDENTITY_LAST"
    ),
    manualReviewRequired: actions.filter(
      (action) =>
        action.requiresManualReview &&
        action.actionType !== "DELETE_AUTH_IDENTITY_LAST"
    ),
    externalProcessorActions: [],
    authDeletionLast: actions.filter(
      (action) => action.actionType === "DELETE_AUTH_IDENTITY_LAST"
    ),
  };
}

export function buildImpactAssessmentView(params: {
  report: ErasureImpactReportSuccess;
  actions?: PrivacyRequestActionRow[];
  processors?: PrivacyProcessorActionRow[];
}): PrivacyImpactAssessmentView {
  const report = params.report;
  const propertyRelationships = report.property_relationships ?? [];
  const soleParticipantCount =
    report.shared_transaction_dependencies?.sole_participant_property_count ?? 0;
  const sharedDependencyCount = propertyRelationships.filter(
    (property) => property.affects_other_participants || property.shared_dependency_score > 0
  ).length;

  const emailEventsCount =
    typeof report.email_correlated_records?.email_events === "number"
      ? report.email_correlated_records.email_events
      : typeof report.communications?.email_events_count === "number"
        ? report.communications.email_events_count
        : 0;

  const analyticsRecord = report.analytics ?? {};
  const linkedSnapshots =
    typeof analyticsRecord.linked_snapshot_count === "number"
      ? analyticsRecord.linked_snapshot_count
      : typeof analyticsRecord.snapshot_count === "number"
        ? analyticsRecord.snapshot_count
        : 0;

  const jsonbReviewRequired = Boolean(
    report.jsonb_unknown_pii?.requires_manual_review ??
      report.risk_flags?.includes("UNSTRUCTURED_METADATA_REVIEW_REQUIRED")
  );
  const activityReviewRequired = Boolean(
    report.audit_and_history?.requires_manual_review ??
      report.risk_flags?.includes("FREE_TEXT_PII_REVIEW_REQUIRED")
  );

  const actionRows =
    params.actions ??
    (report.proposed_actions ?? []).map((action: ErasureProposedAction, index) =>
      mapActionRow({
        id: `proposed-${index}`,
        action_type: action.category,
        target_type: action.target_type,
        status: "draft",
        reason_code: action.reason_code,
        requires_manual_review: action.requires_manual_review,
      })
    );

  const proposedPlan = groupProposedActions(actionRows);
  proposedPlan.externalProcessorActions = params.processors ?? [];

  return {
    generatedAt: report.generated_at ?? null,
    account: {
      accountExists: report.subject.user_exists,
      accountType: report.subject.account_type,
      emailVerified: report.subject.email_verified,
    },
    propertyRelationships: {
      totalProperties: propertyRelationships.length,
      soleParticipantCount,
      sharedDependencyCount,
      propertySummaries: propertyRelationships.map((property) => ({
        propertyId: property.property_id,
        chainId: property.chain_id,
        roles: property.roles,
        addressTreatment: property.address_treatment,
        sharedDependencyScore: property.shared_dependency_score,
        affectsOtherParticipants: property.affects_other_participants,
      })),
    },
    communications: {
      emailEventsCount,
      resendReviewRequired:
        report.external_processor_actions?.RESEND_ERASURE_REVIEW_REQUIRED === true,
    },
    estateAgentRelationships: sanitizeStructuredDetail(
      report.estate_agent_relationships
    ) as Record<string, unknown>,
    analytics: {
      linkedSnapshots,
      reidentificationReviewRequired: Boolean(
        analyticsRecord.reidentification_review_required ??
          report.risk_flags?.includes("ANALYTICS_REIDENTIFICATION_REVIEW_REQUIRED")
      ),
    },
    unknownUnstructured: {
      jsonbReviewRequired,
      activityReviewRequired,
      riskFlags: report.risk_flags ?? [],
    },
    riskFlags: report.risk_flags ?? [],
    proposedPlan,
    executionReadiness: {
      readyForAutoExecution: report.execution_readiness.ready_for_auto_execution,
      requiresManualReview: report.execution_readiness.requires_manual_review,
      blockingReasons: report.execution_readiness.blocking_reasons ?? [],
    },
  };
}

export function buildImpactAssessmentFromReport(
  report: ErasureImpactReport,
  extras?: {
    actions?: PrivacyRequestActionRow[];
    processors?: PrivacyProcessorActionRow[];
  }
): PrivacyImpactAssessmentView | null {
  if (report.ok !== true) {
    return null;
  }

  return buildImpactAssessmentView({
    report,
    actions: extras?.actions,
    processors: extras?.processors,
  });
}

export { mapActionRow };
