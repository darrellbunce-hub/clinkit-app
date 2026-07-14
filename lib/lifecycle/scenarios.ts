import { addDays, daysBetween } from "@/lib/lifecycle/config";
import {
  PROPERTY_LIFECYCLE_ACTION,
  PROPERTY_LIFECYCLE_SCENARIO,
  PROPERTY_OPERATIONAL_STATE,
  type PropertyLifecycleContext,
  type PropertyLifecycleRecommendation,
  type LifecycleConfig,
} from "@/lib/lifecycle/types";

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Scenario A — completed transaction entering or exiting grace.
 */
export function evaluateCompletedGraceScenario(
  context: PropertyLifecycleContext,
  config: LifecycleConfig,
  evaluatedAt: Date = new Date()
): PropertyLifecycleRecommendation[] {
  const recommendations: PropertyLifecycleRecommendation[] = [];

  if (
    context.chainCompletedAt &&
    context.operationalState === PROPERTY_OPERATIONAL_STATE.active
  ) {
    const graceEndsAt = addDays(
      context.chainCompletedAt,
      config.completedGraceDays
    );

    recommendations.push({
      scenario: PROPERTY_LIFECYCLE_SCENARIO.completedGrace,
      action: PROPERTY_LIFECYCLE_ACTION.enterCompletedGrace,
      reason:
        "Chain completion confirmed; property should enter post-completion grace.",
      eligible: true,
      eligibleAt: context.chainCompletedAt,
    });

    recommendations.push({
      scenario: PROPERTY_LIFECYCLE_SCENARIO.completedGrace,
      action: PROPERTY_LIFECYCLE_ACTION.createAnalyticsSnapshot,
      reason:
        "Capture anonymised analytics before operational cleanup after grace.",
      eligible: evaluatedAt >= new Date(graceEndsAt),
      eligibleAt: graceEndsAt,
    });

    recommendations.push({
      scenario: PROPERTY_LIFECYCLE_SCENARIO.completedGrace,
      action: PROPERTY_LIFECYCLE_ACTION.archiveOperational,
      reason:
        "Grace period elapsed; remove operational memberships and permissions.",
      eligible: evaluatedAt >= new Date(graceEndsAt),
      eligibleAt: graceEndsAt,
    });
  }

  if (context.operationalState === PROPERTY_OPERATIONAL_STATE.completedGrace) {
    const graceAnchor =
      context.graceEndsAt ??
      (context.chainCompletedAt
        ? addDays(context.chainCompletedAt, config.completedGraceDays)
        : null);

    recommendations.push({
      scenario: PROPERTY_LIFECYCLE_SCENARIO.completedGrace,
      action: PROPERTY_LIFECYCLE_ACTION.createAnalyticsSnapshot,
      reason: "Analytics snapshot required before archival.",
      eligible: graceAnchor ? evaluatedAt >= new Date(graceAnchor) : false,
      eligibleAt: graceAnchor,
    });

    recommendations.push({
      scenario: PROPERTY_LIFECYCLE_SCENARIO.completedGrace,
      action: PROPERTY_LIFECYCLE_ACTION.archiveOperational,
      reason: "Grace period complete; archive operational state.",
      eligible: graceAnchor ? evaluatedAt >= new Date(graceAnchor) : false,
      eligibleAt: graceAnchor,
    });

    recommendations.push({
      scenario: PROPERTY_LIFECYCLE_SCENARIO.completedGrace,
      action: PROPERTY_LIFECYCLE_ACTION.releaseProperty,
      reason: "Release address for future claims after archival.",
      eligible: graceAnchor ? evaluatedAt >= new Date(graceAnchor) : false,
      eligibleAt: graceAnchor,
    });
  }

  return recommendations;
}

/**
 * Scenario B — dormant transaction with no meaningful progress.
 */
export function evaluateDormantScenario(
  context: PropertyLifecycleContext,
  config: LifecycleConfig,
  evaluatedAt: Date = new Date()
): PropertyLifecycleRecommendation[] {
  const recommendations: PropertyLifecycleRecommendation[] = [];

  if (
    context.operationalState === PROPERTY_OPERATIONAL_STATE.archived ||
    context.operationalState === PROPERTY_OPERATIONAL_STATE.released ||
    context.operationalState === PROPERTY_OPERATIONAL_STATE.anonymised ||
    context.operationalState === PROPERTY_OPERATIONAL_STATE.completedGrace
  ) {
    return recommendations;
  }

  const inactivityAnchor =
    context.lastActivityAt ??
    context.lastPropertyUpdateAt ??
    context.enteredStateAt;

  const inactiveDays = daysBetween(inactivityAnchor, evaluatedAt);
  const meetsInactivityThreshold =
    inactiveDays !== null && inactiveDays >= config.dormantInactivityDays;

  const noConnectedCounterparty = !context.hasConnectedCounterparty;
  const noAcceptedClaimProgress =
    !context.hasAcceptedClaim && context.claimStatus !== "claimed";
  const noPendingInvitation = !context.hasPendingInvitation;
  const chainNotCompleted = !context.chainCompletedAt;

  const isDormantCandidate =
    noConnectedCounterparty &&
    noPendingInvitation &&
    chainNotCompleted &&
    (noAcceptedClaimProgress || inactiveDays !== null) &&
    meetsInactivityThreshold;

  if (isDormantCandidate) {
    const eligibleAt = inactivityAnchor
      ? addDays(inactivityAnchor, config.dormantInactivityDays)
      : nowIso();

    recommendations.push({
      scenario: PROPERTY_LIFECYCLE_SCENARIO.dormant,
      action: PROPERTY_LIFECYCLE_ACTION.markDormant,
      reason:
        "No connected counterparty, invitations, or meaningful activity within the inactivity window.",
      eligible: true,
      eligibleAt,
    });

    recommendations.push({
      scenario: PROPERTY_LIFECYCLE_SCENARIO.dormant,
      action: PROPERTY_LIFECYCLE_ACTION.createAnalyticsSnapshot,
      reason: "Capture anonymised dormant-transaction metrics before archival.",
      eligible: true,
      eligibleAt,
    });

    recommendations.push({
      scenario: PROPERTY_LIFECYCLE_SCENARIO.dormant,
      action: PROPERTY_LIFECYCLE_ACTION.archiveOperational,
      reason: "Archive dormant operational state and unlink users.",
      eligible: true,
      eligibleAt,
    });

    recommendations.push({
      scenario: PROPERTY_LIFECYCLE_SCENARIO.dormant,
      action: PROPERTY_LIFECYCLE_ACTION.releaseProperty,
      reason: "Release property address for future claims (Scenario C).",
      eligible: true,
      eligibleAt,
    });
  }

  if (context.operationalState === PROPERTY_OPERATIONAL_STATE.dormant) {
    recommendations.push({
      scenario: PROPERTY_LIFECYCLE_SCENARIO.dormant,
      action: PROPERTY_LIFECYCLE_ACTION.archiveOperational,
      reason: "Property marked dormant; execute operational archival.",
      eligible: true,
      eligibleAt: context.enteredStateAt,
    });

    recommendations.push({
      scenario: PROPERTY_LIFECYCLE_SCENARIO.dormant,
      action: PROPERTY_LIFECYCLE_ACTION.releaseProperty,
      reason: "Release dormant property for future owner claim.",
      eligible: true,
      eligibleAt: context.enteredStateAt,
    });
  }

  return recommendations;
}

/**
 * Scenario D — analytics retention after archival/release.
 */
export function evaluateAnalyticsScenario(
  context: PropertyLifecycleContext
): PropertyLifecycleRecommendation[] {
  if (
    context.operationalState !== PROPERTY_OPERATIONAL_STATE.archived &&
    context.operationalState !== PROPERTY_OPERATIONAL_STATE.released
  ) {
    return [];
  }

  return [
    {
      scenario: PROPERTY_LIFECYCLE_SCENARIO.analytics,
      action: PROPERTY_LIFECYCLE_ACTION.createAnalyticsSnapshot,
      reason:
        "Persist anonymised transaction metrics before final anonymisation.",
      eligible: true,
      eligibleAt: nowIso(),
    },
    {
      scenario: PROPERTY_LIFECYCLE_SCENARIO.analytics,
      action: PROPERTY_LIFECYCLE_ACTION.anonymiseHistorical,
      reason:
        "Strip remaining operational PII while retaining analytics snapshots.",
      eligible: context.operationalState === PROPERTY_OPERATIONAL_STATE.released,
      eligibleAt: nowIso(),
    },
  ];
}

export function evaluateAllLifecycleScenarios(
  context: PropertyLifecycleContext,
  config: LifecycleConfig,
  evaluatedAt: Date = new Date()
): PropertyLifecycleRecommendation[] {
  return [
    ...evaluateCompletedGraceScenario(context, config, evaluatedAt),
    ...evaluateDormantScenario(context, config, evaluatedAt),
    ...evaluateAnalyticsScenario(context),
  ];
}

export function buildLifecyclePlan(
  recommendations: PropertyLifecycleRecommendation[],
  evaluatedAt: Date = new Date()
): PropertyLifecycleRecommendation["action"][] {
  const eligible = recommendations.filter((recommendation) => {
    if (!recommendation.eligible) {
      return false;
    }

    if (!recommendation.eligibleAt) {
      return true;
    }

    return evaluatedAt >= new Date(recommendation.eligibleAt);
  });

  const actionOrder: PropertyLifecycleRecommendation["action"][] = [
    PROPERTY_LIFECYCLE_ACTION.enterCompletedGrace,
    PROPERTY_LIFECYCLE_ACTION.markDormant,
    PROPERTY_LIFECYCLE_ACTION.createAnalyticsSnapshot,
    PROPERTY_LIFECYCLE_ACTION.archiveOperational,
    PROPERTY_LIFECYCLE_ACTION.releaseProperty,
    PROPERTY_LIFECYCLE_ACTION.anonymiseHistorical,
  ];

  const planned = new Set<PropertyLifecycleRecommendation["action"]>();

  for (const action of actionOrder) {
    if (eligible.some((recommendation) => recommendation.action === action)) {
      planned.add(action);
    }
  }

  return [...planned];
}
