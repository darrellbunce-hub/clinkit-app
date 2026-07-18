export type {
  PrivacyAdminActionResult,
  PrivacyAdminErrorCode,
  PrivacyAuditEventRow,
  PrivacyImpactAssessmentView,
  PrivacyProcessorActionRow,
  PrivacyRequestActionRow,
  PrivacyRequestDetail,
  PrivacyRequestListItem,
} from "@/lib/privacyAdmin/types";

export {
  createPrivacyErasureRequestAction,
  verifyPrivacyErasureIdentityAction,
  assessPrivacyErasureScopeAction,
  approvePrivacyErasureRequestAction,
  rejectPrivacyErasureRequestAction,
  executePrivacyErasureRequestAction,
  markPrivacyAuthDeletionEligibleAction,
  completePrivacyAuthDeletionAction,
  updatePrivacyProcessorActionStatus,
} from "@/lib/privacyAdmin/actions";

export {
  listPrivacyErasureRequests,
  getPrivacyErasureRequestDetail,
} from "@/lib/privacyAdmin/queries";

export { lookupSubjectUserIdByExactEmail } from "@/lib/privacyAdmin/subjectLookup";
export {
  buildImpactAssessmentFromReport,
  sanitizeStructuredDetail,
} from "@/lib/privacyAdmin/presentImpactReport";
