import {
  PARTICIPATION_DELINK_OPERATION,
  type ParticipationDelinkOperation,
} from "@/lib/ownership/participationDelinkTypes";

/** Homeowner self de-link reason codes (stored only — no free text). */
export const HOMEOWNER_SELF_DELINK_REASON = {
  noLongerMoving: "no_longer_moving",
  wrongProperty: "wrong_property",
  preferNotToUseKeynetic: "prefer_not_to_use_keynetic",
  other: "other",
} as const;

export type HomeownerSelfDelinkReasonCode =
  (typeof HOMEOWNER_SELF_DELINK_REASON)[keyof typeof HOMEOWNER_SELF_DELINK_REASON];

/** Homeowner remove EA reason codes. */
export const HOMEOWNER_REMOVE_EA_DELINK_REASON = {
  noLongerNeedAgent: "no_longer_need_agent",
  wrongBranchAssigned: "wrong_branch_assigned",
  other: "other",
} as const;

export type HomeownerRemoveEaDelinkReasonCode =
  (typeof HOMEOWNER_REMOVE_EA_DELINK_REASON)[keyof typeof HOMEOWNER_REMOVE_EA_DELINK_REASON];

/** Estate agent remove branch reason codes. */
export const EA_REMOVE_BRANCH_DELINK_REASON = {
  addedByMistake: "added_by_mistake",
  branchNoLongerInstructed: "branch_no_longer_instructed",
  duplicateProperty: "duplicate_property",
  other: "other",
} as const;

export type EaRemoveBranchDelinkReasonCode =
  (typeof EA_REMOVE_BRANCH_DELINK_REASON)[keyof typeof EA_REMOVE_BRANCH_DELINK_REASON];

/** Estate agent remove homeowner reason codes. */
export const EA_REMOVE_HOMEOWNER_DELINK_REASON = {
  wrongHomeownerInvited: "wrong_homeowner_invited",
  duplicateInvitation: "duplicate_invitation",
  invitationNoLongerRequired: "invitation_no_longer_required",
  other: "other",
} as const;

export type EaRemoveHomeownerDelinkReasonCode =
  (typeof EA_REMOVE_HOMEOWNER_DELINK_REASON)[keyof typeof EA_REMOVE_HOMEOWNER_DELINK_REASON];

export type ParticipationDelinkReasonCode =
  | HomeownerSelfDelinkReasonCode
  | HomeownerRemoveEaDelinkReasonCode
  | EaRemoveBranchDelinkReasonCode
  | EaRemoveHomeownerDelinkReasonCode;

export type ParticipationDelinkReasonOption = {
  code: ParticipationDelinkReasonCode;
  label: string;
};

const HOMEOWNER_SELF_REASON_OPTIONS: ParticipationDelinkReasonOption[] = [
  { code: HOMEOWNER_SELF_DELINK_REASON.noLongerMoving, label: "No longer moving" },
  { code: HOMEOWNER_SELF_DELINK_REASON.wrongProperty, label: "Wrong property" },
  {
    code: HOMEOWNER_SELF_DELINK_REASON.preferNotToUseKeynetic,
    label: "Prefer not to use Keynetic",
  },
  { code: HOMEOWNER_SELF_DELINK_REASON.other, label: "Other" },
];

const HOMEOWNER_REMOVE_EA_REASON_OPTIONS: ParticipationDelinkReasonOption[] = [
  {
    code: HOMEOWNER_REMOVE_EA_DELINK_REASON.noLongerNeedAgent,
    label: "No longer need an estate agent",
  },
  {
    code: HOMEOWNER_REMOVE_EA_DELINK_REASON.wrongBranchAssigned,
    label: "Wrong branch assigned",
  },
  { code: HOMEOWNER_REMOVE_EA_DELINK_REASON.other, label: "Other" },
];

const EA_REMOVE_BRANCH_REASON_OPTIONS: ParticipationDelinkReasonOption[] = [
  { code: EA_REMOVE_BRANCH_DELINK_REASON.addedByMistake, label: "Added by mistake" },
  {
    code: EA_REMOVE_BRANCH_DELINK_REASON.branchNoLongerInstructed,
    label: "Branch no longer instructed",
  },
  { code: EA_REMOVE_BRANCH_DELINK_REASON.duplicateProperty, label: "Duplicate property" },
  { code: EA_REMOVE_BRANCH_DELINK_REASON.other, label: "Other" },
];

const EA_REMOVE_HOMEOWNER_REASON_OPTIONS: ParticipationDelinkReasonOption[] = [
  {
    code: EA_REMOVE_HOMEOWNER_DELINK_REASON.wrongHomeownerInvited,
    label: "Wrong homeowner invited",
  },
  {
    code: EA_REMOVE_HOMEOWNER_DELINK_REASON.duplicateInvitation,
    label: "Duplicate invitation",
  },
  {
    code: EA_REMOVE_HOMEOWNER_DELINK_REASON.invitationNoLongerRequired,
    label: "Invitation no longer required",
  },
  { code: EA_REMOVE_HOMEOWNER_DELINK_REASON.other, label: "Other" },
];

export function getParticipationDelinkReasonOptions(
  operation: ParticipationDelinkOperation
): ParticipationDelinkReasonOption[] {
  switch (operation) {
    case PARTICIPATION_DELINK_OPERATION.homeownerSelf:
      return HOMEOWNER_SELF_REASON_OPTIONS;
    case PARTICIPATION_DELINK_OPERATION.homeownerRemoveEa:
      return HOMEOWNER_REMOVE_EA_REASON_OPTIONS;
    case PARTICIPATION_DELINK_OPERATION.estateAgentRemoveBranch:
      return EA_REMOVE_BRANCH_REASON_OPTIONS;
    case PARTICIPATION_DELINK_OPERATION.estateAgentRemoveHomeowner:
      return EA_REMOVE_HOMEOWNER_REASON_OPTIONS;
    default:
      return [];
  }
}

export function isParticipationDelinkReasonCodeValid(
  operation: ParticipationDelinkOperation,
  reasonCode: string
): boolean {
  return getParticipationDelinkReasonOptions(operation).some(
    (option) => option.code === reasonCode
  );
}

/** All codes allowed in property_delink_events.reason_code (analytics union). */
export const ALL_PARTICIPATION_DELINK_REASON_CODES = [
  ...Object.values(HOMEOWNER_SELF_DELINK_REASON),
  ...Object.values(HOMEOWNER_REMOVE_EA_DELINK_REASON),
  ...Object.values(EA_REMOVE_BRANCH_DELINK_REASON),
  ...Object.values(EA_REMOVE_HOMEOWNER_DELINK_REASON),
] as const;
