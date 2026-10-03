/**
 * Pure dormancy evaluation — bounded placeholder lifecycle.
 *
 * A row whose seller side is represented (homeowner or EA) is managed: it is
 * never warned, made dormant, archived or released through inactivity. Only an
 * unrepresented placeholder has a clock, measured from the latest of: the
 * moment its seller side became unrepresented, dependent-side activity, an
 * explicit still-active confirmation, and the rollout effective-from instant.
 *
 *   placeholder with dependants     warning after the connected window, then
 *                                   the confirmation window → dormant →
 *                                   snapshot → archive → release
 *   placeholder without dependants  dormant after the inactivity window →
 *                                   snapshot → archive → release
 *
 * Every database step re-checks representation, timing and dependants under a
 * row lock, so a plan evaluated before a reset, a confirmation or a new
 * representative is skipped.
 */

import { addDays } from "@/lib/lifecycle/config";
import {
  PROPERTY_LIFECYCLE_ACTION,
  PROPERTY_LIFECYCLE_SCENARIO,
  PROPERTY_OPERATIONAL_STATE,
  type LifecycleConfig,
  type PropertyLifecycleContext,
  type PropertyLifecycleRecommendation,
} from "@/lib/lifecycle/types";

type DormancyScenario =
  | typeof PROPERTY_LIFECYCLE_SCENARIO.isolatedDormant
  | typeof PROPERTY_LIFECYCLE_SCENARIO.connectedDormant;

function isProtectedFromDormancy(context: PropertyLifecycleContext): boolean {
  return (
    context.manuallyReleased ||
    context.operationalState === PROPERTY_OPERATIONAL_STATE.released ||
    context.operationalState === PROPERTY_OPERATIONAL_STATE.anonymised ||
    context.operationalState === PROPERTY_OPERATIONAL_STATE.completedGrace ||
    context.operationalState === PROPERTY_OPERATIONAL_STATE.archived ||
    Boolean(context.chainCompletedAt)
  );
}

/**
 * Seller side represented. Missing signals (pre-migration RPC) count as
 * managed so incomplete data never plans a dormancy step.
 */
export function isManagedForDormancy(
  context: PropertyLifecycleContext
): boolean {
  if (context.sellerSide !== undefined) {
    return context.sellerSide !== "none";
  }

  return context.isManaged ?? true;
}

/** Unrepresented placeholder with a running clock. */
export function isPlaceholderForDormancy(
  context: PropertyLifecycleContext
): boolean {
  return (
    !isManagedForDormancy(context) &&
    Boolean(context.sellerSideUnrepresentedSince)
  );
}

function latestInstant(values: Array<string | null | undefined>): string | null {
  let latest: number | null = null;

  for (const value of values) {
    if (!value) {
      continue;
    }

    const ms = new Date(value).getTime();

    if (!Number.isNaN(ms) && (latest === null || ms > latest)) {
      latest = ms;
    }
  }

  return latest === null ? null : new Date(latest).toISOString();
}

/**
 * Same anchor as the database (_property_placeholder_anchor). Null for a row
 * that is not a placeholder.
 */
export function placeholderDormancyAnchor(
  context: PropertyLifecycleContext,
  config: LifecycleConfig
): string | null {
  if (!isPlaceholderForDormancy(context)) {
    return null;
  }

  return latestInstant([
    context.sellerSideUnrepresentedSince,
    context.placeholderActivityAt,
    context.lastStillActiveConfirmedAt,
    context.dormancyEffectiveFrom ?? config.dormancyEffectiveFrom,
  ]);
}

function placeholderScenario(
  context: PropertyLifecycleContext
): DormancyScenario {
  return context.hasPlaceholderDependants
    ? PROPERTY_LIFECYCLE_SCENARIO.connectedDormant
    : PROPERTY_LIFECYCLE_SCENARIO.isolatedDormant;
}

function dormantContinuationPlan(
  scenario: DormancyScenario,
  eligibleAt: string
): PropertyLifecycleRecommendation[] {
  return [
    {
      scenario,
      action: PROPERTY_LIFECYCLE_ACTION.createAnalyticsSnapshot,
      reason: "Capture analytics before dormant archival.",
      eligible: true,
      eligibleAt,
    },
    {
      scenario,
      action: PROPERTY_LIFECYCLE_ACTION.archiveOperational,
      reason: "Archive dormant placeholder.",
      eligible: true,
      eligibleAt,
    },
    {
      scenario,
      action: PROPERTY_LIFECYCLE_ACTION.releaseProperty,
      reason: "Release dormant placeholder address for reuse.",
      eligible: true,
      eligibleAt,
    },
  ];
}

function expiredWarningPlan(
  context: PropertyLifecycleContext,
  config: LifecycleConfig,
  evaluatedAt: Date
): PropertyLifecycleRecommendation[] {
  const deadline = dormancyWarningDeadline(context, config);

  if (deadline === null || evaluatedAt < new Date(deadline)) {
    return [];
  }

  const scenario = PROPERTY_LIFECYCLE_SCENARIO.connectedDormant;

  return [
    {
      scenario,
      action: PROPERTY_LIFECYCLE_ACTION.expireDormancyWarning,
      reason:
        "Dormancy confirmation period expired without a still-active confirmation or dependent-side activity.",
      eligible: true,
      eligibleAt: deadline,
    },
    ...dormantContinuationPlan(scenario, deadline),
  ];
}

export function dormancyWarningDeadline(
  context: PropertyLifecycleContext,
  config: LifecycleConfig
): string | null {
  return (
    context.dormancyConfirmationDeadlineAt ??
    (context.dormancyWarningAt
      ? addDays(context.dormancyWarningAt, config.dormancyConfirmationDays)
      : null)
  );
}

/**
 * Placeholder dormancy: the only path by which an uncompleted row is warned,
 * made dormant, archived or released through inactivity.
 */
export function evaluatePlaceholderDormancyScenario(
  context: PropertyLifecycleContext,
  config: LifecycleConfig,
  evaluatedAt: Date = new Date()
): PropertyLifecycleRecommendation[] {
  if (isProtectedFromDormancy(context) || !isPlaceholderForDormancy(context)) {
    return [];
  }

  if (context.operationalState === PROPERTY_OPERATIONAL_STATE.dormancyWarning) {
    return expiredWarningPlan(context, config, evaluatedAt);
  }

  if (context.operationalState === PROPERTY_OPERATIONAL_STATE.dormant) {
    return dormantContinuationPlan(
      placeholderScenario(context),
      context.enteredStateAt ?? evaluatedAt.toISOString()
    );
  }

  if (context.operationalState !== PROPERTY_OPERATIONAL_STATE.active) {
    return [];
  }

  const anchor = placeholderDormancyAnchor(context, config);

  if (!anchor) {
    return [];
  }

  if (context.hasPlaceholderDependants) {
    const warningAt = addDays(anchor, config.connectedDormantDays);

    if (evaluatedAt < new Date(warningAt)) {
      return [];
    }

    return [
      {
        scenario: PROPERTY_LIFECYCLE_SCENARIO.connectedDormant,
        action: PROPERTY_LIFECYCLE_ACTION.enterDormancyWarning,
        reason:
          "Placeholder with dependants has had no seller side and no dependent-side activity within the connected window.",
        eligible: true,
        eligibleAt: warningAt,
      },
    ];
  }

  const dormantAt = addDays(anchor, config.dormantInactivityDays);

  if (evaluatedAt < new Date(dormantAt)) {
    return [];
  }

  const scenario = PROPERTY_LIFECYCLE_SCENARIO.isolatedDormant;

  return [
    {
      scenario,
      action: PROPERTY_LIFECYCLE_ACTION.markDormant,
      reason:
        "Placeholder without dependants has had no seller side within the inactivity window.",
      eligible: true,
      eligibleAt: dormantAt,
    },
    ...dormantContinuationPlan(scenario, dormantAt),
  ];
}

export function evaluateDormantReleaseFromArchived(
  context: PropertyLifecycleContext
): PropertyLifecycleRecommendation[] {
  if (context.operationalState !== PROPERTY_OPERATIONAL_STATE.archived) {
    return [];
  }

  if (context.chainCompletedAt) {
    return [];
  }

  return [
    {
      scenario: context.hasPlaceholderDependants
        ? PROPERTY_LIFECYCLE_SCENARIO.connectedDormant
        : PROPERTY_LIFECYCLE_SCENARIO.isolatedDormant,
      action: PROPERTY_LIFECYCLE_ACTION.releaseProperty,
      reason: "Release archived dormant property address for reuse.",
      eligible: true,
      eligibleAt: context.enteredStateAt,
    },
  ];
}
