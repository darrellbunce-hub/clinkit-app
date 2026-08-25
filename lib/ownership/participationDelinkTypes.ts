/**
 * Participation de-link — unified service types and permission matrix.
 * See docs/PARTICIPATION_DELINK.md
 */

export const PARTICIPATION_DELINK_OPERATION = {
  homeownerSelf: "homeowner_self",
  homeownerRemoveEa: "homeowner_remove_ea",
  estateAgentRemoveBranch: "estate_agent_remove_branch",
  estateAgentRemoveHomeowner: "estate_agent_remove_homeowner",
} as const;

export type ParticipationDelinkOperation =
  (typeof PARTICIPATION_DELINK_OPERATION)[keyof typeof PARTICIPATION_DELINK_OPERATION];

import type { ParticipationDelinkReasonCode } from "@/lib/ownership/participationDelinkReasonCodes";

export type ParticipationDelinkOption = {
  operation: ParticipationDelinkOperation;
  label: string;
  requiresConfirmation: boolean;
  branchId: string | null;
  invitationPending?: boolean;
  reasonCodes: ParticipationDelinkReasonCode[];
};

export type ParticipationDelinkSignals = {
  invitationPending: boolean;
  meaningfulParticipation: boolean;
  isOperationalHomeowner: boolean;
};

export type ParticipationDelinkOptionsResult =
  | {
      ok: true;
      propertyId: number;
      options: ParticipationDelinkOption[];
      signals: ParticipationDelinkSignals;
    }
  | { ok: false; error: string };

export type ParticipationDelinkExecuteResult =
  | {
      ok: true;
      propertyId: number;
      operation: ParticipationDelinkOperation;
      reasonCode: ParticipationDelinkReasonCode;
      branchId?: string;
      lifecycleState?: string;
      invitationReset?: boolean;
    }
  | { ok: false; error: string };

/** Permission matrix — who may invoke each operation (enforced in DB). */
export const PARTICIPATION_DELINK_PERMISSION_MATRIX: Record<
  ParticipationDelinkOperation,
  {
    actor: "homeowner" | "estate_agent";
    summary: string;
    lifecycleImpact: string;
    retainsHistory: boolean;
  }
> = {
  [PARTICIPATION_DELINK_OPERATION.homeownerSelf]: {
    actor: "homeowner",
    summary: "Operational homeowner releases their property participation.",
    lifecycleImpact: "Transitions property lifecycle to released.",
    retainsHistory: true,
  },
  [PARTICIPATION_DELINK_OPERATION.homeownerRemoveEa]: {
    actor: "homeowner",
    summary: "Homeowner revokes the active estate agent branch assignment.",
    lifecycleImpact: "No lifecycle change; homeowner identity retained.",
    retainsHistory: true,
  },
  [PARTICIPATION_DELINK_OPERATION.estateAgentRemoveBranch]: {
    actor: "estate_agent",
    summary: "Assigned branch releases operational management.",
    lifecycleImpact: "No lifecycle change unless no homeowner remains.",
    retainsHistory: true,
  },
  [PARTICIPATION_DELINK_OPERATION.estateAgentRemoveHomeowner]: {
    actor: "estate_agent",
    summary:
      "Withdraw homeowner association when invitation is pending or participation is not yet meaningful.",
    lifecycleImpact: "Resets claim to re-invitable; does not release property lifecycle.",
    retainsHistory: true,
  },
};

export const PARTICIPATION_DELINK_ERROR_MESSAGES: Record<string, string> = {
  not_authenticated: "You must be signed in.",
  property_not_found: "Property not found.",
  invalid_operation: "This de-link operation is not supported.",
  not_operational_homeowner: "Only the operational homeowner can perform this action.",
  no_active_ea_assignment: "No active estate agent is assigned to this property.",
  branch_mismatch: "The selected branch does not match the active assignment.",
  not_assigned_ea: "Your branch is not assigned to this property.",
  branch_required: "A branch assignment is required.",
  not_ea_originated: "This action only applies to estate-agent-originated properties.",
  homeowner_actively_participating:
    "This homeowner has meaningfully participated and cannot be removed from an established transaction.",
  no_homeowner_to_remove: "There is no homeowner association to remove.",
  unsupported_operation: "This de-link operation could not be completed.",
  invalid_reason_code: "Please select a valid reason.",
};

export function mapParticipationDelinkError(errorCode: string | undefined): string {
  if (!errorCode) {
    return "Could not complete the de-link operation.";
  }

  return (
    PARTICIPATION_DELINK_ERROR_MESSAGES[errorCode] ??
    `De-link failed: ${errorCode}`
  );
}
