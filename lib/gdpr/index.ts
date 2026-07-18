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
} from "@/lib/gdpr/erasureExecution";
export {
  approveGdprErasureRequest,
  assessGdprErasureScope,
  createGdprErasureRequest,
  getGdprErasureRequestStatus,
  rejectGdprErasureRequest,
  verifyGdprErasureIdentity,
} from "@/lib/gdpr/erasureRequest";
