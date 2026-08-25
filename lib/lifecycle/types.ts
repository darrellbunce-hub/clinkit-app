/**
 * Operational lifecycle states for a property.
 *
 * Distinct from chain completion lifecycle (`chains.completion_lifecycle_status`).
 *
 * Note: `anonymised` is property-level lifecycle anonymisation only.
 * It does NOT fulfil UK GDPR Right to Erasure across all personal data stores.
 */
export const PROPERTY_OPERATIONAL_STATE = {
  active: "active",
  completedGrace: "completed_grace",
  dormancyWarning: "dormancy_warning",
  dormant: "dormant",
  archived: "archived",
  released: "released",
  anonymised: "anonymised",
} as const;

export type PropertyOperationalState =
  (typeof PROPERTY_OPERATIONAL_STATE)[keyof typeof PROPERTY_OPERATIONAL_STATE];

export const PROPERTY_LIFECYCLE_SCENARIO = {
  completedGrace: "completed_grace",
  isolatedDormant: "isolated_dormant",
  connectedDormant: "connected_dormant",
  futureClaim: "future_claim",
  analytics: "analytics",
  /** @deprecated Use isolatedDormant or connectedDormant */
  dormant: "dormant",
} as const;

export type PropertyLifecycleScenario =
  (typeof PROPERTY_LIFECYCLE_SCENARIO)[keyof typeof PROPERTY_LIFECYCLE_SCENARIO];

export const PROPERTY_LIFECYCLE_ACTION = {
  none: "none",
  enterCompletedGrace: "enter_completed_grace",
  enterDormancyWarning: "enter_dormancy_warning",
  markDormant: "mark_dormant",
  createAnalyticsSnapshot: "create_analytics_snapshot",
  archiveOperational: "archive_operational",
  releaseProperty: "release_property",
  /** Property-level lifecycle anonymisation — not full GDPR RTBF. */
  anonymiseHistorical: "anonymise_historical",
} as const;

export type PropertyLifecycleAction =
  (typeof PROPERTY_LIFECYCLE_ACTION)[keyof typeof PROPERTY_LIFECYCLE_ACTION];

export const STILL_ACTIVE_CONFIRMATION_CODE = "still_active" as const;

export type PropertyLifecycleTransitionTrigger =
  | "evaluation"
  | "chain_completion"
  | "worker"
  | "manual"
  | "system"
  | "still_active_confirmation";

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
  isChainConnected: boolean;
  memberCount: number;
  chainCompletedAt: string | null;
  lastActivityAt: string | null;
  lastPropertyUpdateAt: string | null;
  lastOperationalActivityAt: string | null;
  chainLastOperationalActivityAt: string | null;
  hasAcceptedClaim: boolean;
  /** Non-expired, non-revoked, unused invitation. */
  hasValidActiveInvitation: boolean;
  hasExpiredInvitationOnly: boolean;
  graceEndsAt: string | null;
  enteredStateAt: string | null;
  dormancyWarningAt: string | null;
  dormancyConfirmationDeadlineAt: string | null;
  daysSinceLastOperationalActivity: number | null;
  daysSinceChainOperationalActivity: number | null;
  daysSinceChainCompleted: number | null;
  hasActiveOperationalIdentity: boolean;
  /** Durable transaction progress — identity age alone does NOT qualify. */
  hasMeaningfulParticipation: boolean;
  hasAnalyticsSnapshot: boolean;
  manuallyReleased: boolean;
  addressReserved: boolean;
  chainReleaseSafe: boolean;
};

export type PropertyLifecycleRecommendation = {
  scenario: PropertyLifecycleScenario;
  action: PropertyLifecycleAction;
  reason: string;
  eligible: boolean;
  eligibleAt: string | null;
};

export type PropertyLifecycleEvaluation = {
  propertyId: number;
  operationalState: PropertyOperationalState;
  context: PropertyLifecycleContext;
  recommendations: PropertyLifecycleRecommendation[];
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
  dormancy_warning_at: string | null;
  dormancy_confirmation_deadline_at: string | null;
  dormancy_warning_notified_at: string | null;
  last_still_active_confirmed_at: string | null;
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
  connectedDormantDays: number;
  dormancyConfirmationDays: number;
  evaluationBatchSize: number;
  workerLeaseSeconds: number;
  completedGraceMs: number;
  dormantInactivityMs: number;
  connectedDormantMs: number;
  dormancyConfirmationMs: number;
};
