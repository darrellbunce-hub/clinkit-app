import type {
  DelinkActorType,
  PropertyDelinkEvent,
} from "@/lib/ownership/types";

/** RPC names for approved de-link workflows — delegate to unified participation service. */
export const DELINK_RPC = {
  unified: "execute_participation_delink",
  options: "get_participation_delink_options",
  homeowner: "delink_homeowner_from_property",
  estateAgent: "delink_estate_agent_from_property",
} as const;

export type HomeownerDelinkRequest = {
  propertyId: number;
  reasonCode: string;
};

export type EstateAgentDelinkRequest = {
  propertyId: number;
  branchId: string;
  reasonCode: string;
};

export type DelinkPlanStep =
  | "verify_authority"
  | "record_delink_event"
  | "revoke_delegates"
  | "revoke_counterparty"
  | "revoke_operational_identity"
  | "revoke_property_members"
  | "reset_claim_metadata"
  | "revoke_ea_assignment"
  | "transition_lifecycle_released"
  | "insert_chain_activity"
  | "notify_participants";

export type DelinkPlan = {
  actorType: DelinkActorType;
  propertyId: number;
  chainId: number | null;
  steps: DelinkPlanStep[];
};

/**
 * Declarative de-link plan — executed by Phase 2 transaction-scoped RPC.
 * Homeowner de-link releases property; EA de-link releases branch association only.
 */
export function buildHomeownerDelinkPlan(params: {
  propertyId: number;
  chainId: number | null;
}): DelinkPlan {
  return {
    actorType: "homeowner",
    propertyId: params.propertyId,
    chainId: params.chainId,
    steps: [
      "verify_authority",
      "record_delink_event",
      "revoke_delegates",
      "revoke_counterparty",
      "revoke_operational_identity",
      "revoke_property_members",
      "reset_claim_metadata",
      "revoke_ea_assignment",
      "transition_lifecycle_released",
      "insert_chain_activity",
      "notify_participants",
    ],
  };
}

export function buildEstateAgentDelinkPlan(params: {
  propertyId: number;
  chainId: number | null;
  homeownerStillPresent: boolean;
}): DelinkPlan {
  const steps: DelinkPlanStep[] = [
    "verify_authority",
    "record_delink_event",
    "revoke_ea_assignment",
    "insert_chain_activity",
    "notify_participants",
  ];

  if (!params.homeownerStillPresent) {
    steps.push("transition_lifecycle_released");
  }

  return {
    actorType: "estate_agent",
    propertyId: params.propertyId,
    chainId: params.chainId,
    steps,
  };
}

export type DelinkEventDraft = Omit<PropertyDelinkEvent, "id" | "createdAt">;

export function createDelinkEventDraft(params: {
  propertyId: number;
  chainId: number | null;
  actorUserId: string;
  actorType: DelinkActorType;
  reasonCode: string;
  metadata?: Record<string, unknown>;
}): DelinkEventDraft {
  return {
    propertyId: params.propertyId,
    chainId: params.chainId,
    actorUserId: params.actorUserId,
    actorType: params.actorType,
    reasonCode: params.reasonCode,
    metadata: params.metadata ?? {},
  };
}
