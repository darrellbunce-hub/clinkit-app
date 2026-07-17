import { addDays } from "@/lib/lifecycle/config";
import {
  evaluateConnectedDormantScenario,
  evaluateDormantReleaseFromArchived,
  evaluateIsolatedDormantScenario,
} from "@/lib/lifecycle/dormancyScenarios";
import {
  PROPERTY_LIFECYCLE_ACTION,
  PROPERTY_LIFECYCLE_SCENARIO,
  PROPERTY_OPERATIONAL_STATE,
  type PropertyLifecycleContext,
  type PropertyLifecycleRecommendation,
  type LifecycleConfig,
} from "@/lib/lifecycle/types";

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
    context.manuallyReleased ||
    context.operationalState === PROPERTY_OPERATIONAL_STATE.released ||
    context.operationalState === PROPERTY_OPERATIONAL_STATE.anonymised
  ) {
    return recommendations;
  }

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

    recommendations.push({
      scenario: PROPERTY_LIFECYCLE_SCENARIO.completedGrace,
      action: PROPERTY_LIFECYCLE_ACTION.releaseProperty,
      reason:
        "Grace period elapsed; release address after archival in worker pass.",
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
      eligible:
        graceAnchor
          ? evaluatedAt >= new Date(graceAnchor) && !context.hasAnalyticsSnapshot
          : false,
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

  if (context.operationalState === PROPERTY_OPERATIONAL_STATE.archived) {
    const graceAnchor =
      context.graceEndsAt ??
      (context.chainCompletedAt
        ? addDays(context.chainCompletedAt, config.completedGraceDays)
        : null);

    if (context.chainCompletedAt) {
      recommendations.push({
        scenario: PROPERTY_LIFECYCLE_SCENARIO.completedGrace,
        action: PROPERTY_LIFECYCLE_ACTION.releaseProperty,
        reason: "Archived after completion grace; release address for reuse.",
        eligible: graceAnchor
          ? evaluatedAt >= new Date(graceAnchor)
          : true,
        eligibleAt: graceAnchor,
      });
    } else {
      recommendations.push(
        ...evaluateDormantReleaseFromArchived(context)
      );
    }
  }

  return recommendations;
}

/** @deprecated Use evaluateIsolatedDormantScenario or evaluateConnectedDormantScenario */
export function evaluateDormantScenario(
  context: PropertyLifecycleContext,
  config: LifecycleConfig,
  evaluatedAt: Date = new Date()
): PropertyLifecycleRecommendation[] {
  return [
    ...evaluateIsolatedDormantScenario(context, config, evaluatedAt),
    ...evaluateConnectedDormantScenario(context, config, evaluatedAt),
  ];
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

  const recommendations: PropertyLifecycleRecommendation[] = [];

  if (!context.hasAnalyticsSnapshot) {
    recommendations.push({
      scenario: PROPERTY_LIFECYCLE_SCENARIO.analytics,
      action: PROPERTY_LIFECYCLE_ACTION.createAnalyticsSnapshot,
      reason:
        "Persist anonymised transaction metrics before final anonymisation.",
      eligible: true,
      eligibleAt: new Date().toISOString(),
    });
  }

  if (context.operationalState === PROPERTY_OPERATIONAL_STATE.released) {
    recommendations.push({
      scenario: PROPERTY_LIFECYCLE_SCENARIO.analytics,
      action: PROPERTY_LIFECYCLE_ACTION.anonymiseHistorical,
      reason:
        "Strip remaining operational PII while retaining analytics snapshots. Property-level only — not GDPR RTBF.",
      eligible: context.hasAnalyticsSnapshot,
      eligibleAt: new Date().toISOString(),
    });
  }

  return recommendations;
}

export function evaluateAllLifecycleScenarios(
  context: PropertyLifecycleContext,
  config: LifecycleConfig,
  evaluatedAt: Date = new Date()
): PropertyLifecycleRecommendation[] {
  return [
    ...evaluateCompletedGraceScenario(context, config, evaluatedAt),
    ...evaluateIsolatedDormantScenario(context, config, evaluatedAt),
    ...evaluateConnectedDormantScenario(context, config, evaluatedAt),
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
    PROPERTY_LIFECYCLE_ACTION.enterDormancyWarning,
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
