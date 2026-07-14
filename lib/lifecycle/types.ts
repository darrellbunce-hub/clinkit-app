/**
 * Operational lifecycle states for a property.
 *
 * Distinct from chain completion lifecycle (`chains.completion_lifecycle_status`).
 */
export const PROPERTY_OPERATIONAL_STATE = {
  active: "active",
  completedGrace: "completed_grace",
  dormant: "dormant",
  archived: "archived",
  released: "released",
  anonymised: "anonymised",
} as const;

export type PropertyOperationalState =
  (typeof PROPERTY_OPERATIONAL_STATE)[keyof typeof PROPERTY_OPERATIONAL_STATE];

export const PROPERTY_LIFECYCLE_SCENARIO = {
  completedGrace: "completed_grace",
  dormant: "dormant",
  futureClaim: "future_claim",
  analytics: "analytics",
} as const;

export type PropertyLifecycleScenario =
  (typeof PROPERTY_LIFECYCLE_SCENARIO)[keyof typeof PROPERTY_LIFECYCLE_SCENARIO];

/**
 * Actions the lifecycle engine may recommend or apply.
 * Phase 1 evaluates only — apply is Phase 2.
 */
export const PROPERTY_LIFECYCLE_ACTION = {
  none: "none",
  enterCompletedGrace: "enter_completed_grace",
  markDormant: "mark_dormant",
  createAnalyticsSnapshot: "create_analytics_snapshot",
  archiveOperational: "archive_operational",
  releaseProperty: "release_property",
  anonymiseHistorical: "anonymise_historical",
} as const;

export type PropertyLifecycleAction =
  (typeof PROPERTY_LIFECYCLE_ACTION)[keyof typeof PROPERTY_LIFECYCLE_ACTION];

export type PropertyLifecycleTransitionTrigger =
  | "evaluation"
  | "chain_completion"
  | "worker"
  | "manual"
  | "system";

/** Operational signals gathered for lifecycle evaluation. */
export type PropertyLifecycleContext = {
  propertyId: number;
  chainId: number | null;
  operationalState: PropertyOperationalState;
  claimStatus: string | null;
  originType: string | null;
  relationshipType: string | null;
  buyerConnected: boolean;
  sellerConnected: boolean;
  hasConnectedCounterparty: boolean;
  memberCount: number;
  chainCompletedAt: string | null;
  lastActivityAt: string | null;
  lastPropertyUpdateAt: string | null;
  hasAcceptedClaim: boolean;
  hasPendingInvitation: boolean;
  graceEndsAt: string | null;
  enteredStateAt: string | null;
  daysSinceLastActivity: number | null;
  daysSinceChainCompleted: number | null;
};

export type PropertyLifecycleRecommendation = {
  scenario: PropertyLifecycleScenario;
  action: PropertyLifecycleAction;
  reason: string;
  eligible: boolean;
  /** ISO timestamp when the action becomes eligible (grace/inactivity). */
  eligibleAt: string | null;
};

export type PropertyLifecycleEvaluation = {
  propertyId: number;
  operationalState: PropertyOperationalState;
  context: PropertyLifecycleContext;
  recommendations: PropertyLifecycleRecommendation[];
  /** Ordered plan for Phase 2 apply — empty when nothing to do. */
  plannedActions: PropertyLifecycleAction[];
  evaluatedAt: string;
};

export type PropertyLifecycleTransitionRecord = {
  propertyId: number;
  fromState: PropertyOperationalState;
  toState: PropertyOperationalState;
  trigger: PropertyLifecycleTransitionTrigger;
  scenario: PropertyLifecycleScenario | null;
  reason: string;
  metadata?: Record<string, unknown>;
};

/** Anonymised analytics payload — no PII, no raw address. */
export type PropertyAnalyticsSnapshotPayload = {
  snapshotVersion: number;
  propertyRef: string;
  chainRef: string | null;
  regionCode: string | null;
  postcodeDistrict: string | null;
  relationshipType: string | null;
  originType: string | null;
  finalOperationalState: PropertyOperationalState;
  chainCompletedAt: string | null;
  operationalDurationDays: number | null;
  activityCount: number;
  memberCountAtSnapshot: number;
  hadConnectedCounterparty: boolean;
  metrics: Record<string, number | string | boolean | null>;
};

export type PropertyLifecycleStateRow = {
  property_id: number;
  operational_state: PropertyOperationalState;
  lifecycle_reason: string | null;
  entered_state_at: string;
  grace_ends_at: string | null;
  archive_eligible_at: string | null;
  last_evaluated_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type PropertyLifecycleSignalsRpcResult = {
  ok: boolean;
  error?: string;
  context?: PropertyLifecycleContext;
};

export type PropertyLifecycleEvaluationRpcResult = {
  ok: boolean;
  error?: string;
  evaluation?: PropertyLifecycleEvaluation;
};

/** Configuration shape for lifecycle retention policy. */
export type LifecycleConfig = {
  completedGraceDays: number;
  dormantInactivityDays: number;
  meaningfulActivityDays: number;
  evaluationBatchSize: number;
  completedGraceMs: number;
  dormantInactivityMs: number;
  meaningfulActivityMs: number;
};
