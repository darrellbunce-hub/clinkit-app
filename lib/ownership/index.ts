import "server-only";

export {
  OPERATIONAL_IDENTITY_GRANT_VIA,
  OPERATIONAL_IDENTITY_STATUS,
  DELEGATE_PERMISSION,
  DELEGATE_STATUS,
  COUNTERPARTY_STATUS,
  DELINK_ACTOR_TYPE,
  OWNERSHIP_VIOLATION_PATH,
  OWNERSHIP_VIOLATION_REGISTRY,
  type OperationalIdentityGrantVia,
  type OperationalIdentityStatus,
  type OperationalHomeownerRole,
  type PropertyOperationalIdentity,
  type PropertyDelegate,
  type PropertyCounterpartyParticipant,
  type PropertyDelinkEvent,
  type PropertyAuthority,
  type DelinkActorType,
  type OwnershipViolationDefinition,
} from "@/lib/ownership/types";

export {
  counterpartyRoleForRelationship,
  detectMultipleOperationalHomeowners,
  isOwnerClassMembershipRole,
  operationalHomeownerRoleForRelationship,
} from "@/lib/ownership/roles";

export {
  resolvePropertyAuthority,
  type ResolvePropertyAuthorityInput,
} from "@/lib/ownership/resolvePropertyAuthority";

export {
  DELINK_RPC,
  buildEstateAgentDelinkPlan,
  buildHomeownerDelinkPlan,
  createDelinkEventDraft,
  type DelinkPlan,
  type DelinkPlanStep,
  type EstateAgentDelinkRequest,
  type HomeownerDelinkRequest,
} from "@/lib/ownership/delink";

export {
  establishOperationalHomeowner,
  grantCounterpartyParticipation,
  invitePropertyDelegate,
  acceptPropertyDelegate,
} from "@/lib/ownership/grants";

export {
  executeParticipationDelink,
  getParticipationDelinkOptions,
  PARTICIPATION_DELINK_OPERATION,
  PARTICIPATION_DELINK_PERMISSION_MATRIX,
  getParticipationDelinkReasonOptions,
  type ParticipationDelinkReasonCode,
  type ParticipationDelinkReasonOption,
} from "@/lib/ownership/participationDelink";
