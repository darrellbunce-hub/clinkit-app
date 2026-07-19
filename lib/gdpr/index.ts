export type {
  ErasureAddressTreatment,
  ErasureExecutionResult,
  ErasureImpactReport,
  ErasureImpactReportError,
  ErasureImpactReportSuccess,
  ErasurePropertyRelationship,
  ErasureProposedAction,
  ErasureRequestSource,
  ErasureRequestStatus,
  GdprRpcResult,
} from "@/lib/gdpr/types";

export { generateErasureImpactReport } from "@/lib/gdpr/erasureImpactReport";
export { completeGdprAuthDeletion } from "@/lib/gdpr/completeAuthDeletion";
export {
  executeGdprErasureRequest,
  completeGdprErasureAuthDeletionRecord,
  markGdprErasureAuthDeletionEligible,
  updateGdprErasureProcessorAction,
  recordGdprErasureSuppressionLedger,
  matchGdprSuppressionLedgerIdentities,
  recomputeGdprErasureCompletion,
} from "@/lib/gdpr/erasureExecution";
export {
  GDPR_SUPPRESSION_HMAC_KEY_ENV,
  getSuppressionHmacKey,
} from "@/lib/gdpr/suppressionLedger";
export {
  computeSuppressionFingerprints,
  deriveRequestCompletionStatus,
  isProcessorStatusBlocking,
  isProcessorStatusSatisfied,
  normalizeEmailForSuppression,
} from "@/lib/gdpr/suppressionLedgerCore";
export {
  approveGdprErasureRequest,
  assessGdprErasureScope,
  createGdprErasureRequest,
  getGdprErasureRequestStatus,
  rejectGdprErasureRequest,
  verifyGdprErasureIdentity,
} from "@/lib/gdpr/erasureRequest";

