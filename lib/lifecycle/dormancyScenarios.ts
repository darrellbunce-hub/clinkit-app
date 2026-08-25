/**
 * Pure dormancy evaluation helpers — isolated (B1) vs connected (B2).
 */

import { addDays, daysBetween } from "@/lib/lifecycle/config";
import {
  PROPERTY_LIFECYCLE_ACTION,
  PROPERTY_LIFECYCLE_SCENARIO,
  PROPERTY_OPERATIONAL_STATE,
  type LifecycleConfig,
  type PropertyLifecycleContext,
  type PropertyLifecycleRecommendation,
} from "@/lib/lifecycle/types";

function nowIso(): string {
  return new Date().toISOString();
}

function inactivityAnchor(context: PropertyLifecycleContext): string | null {
  return (
    context.lastOperationalActivityAt ??
    context.enteredStateAt ??
    null
  );
}

function isProtectedFromDormancy(context: PropertyLifecycleContext): boolean {
  return (
    context.manuallyReleased ||
    context.operationalState === PROPERTY_OPERATIONAL_STATE.released ||
    context.operationalState === PROPERTY_OPERATIONAL_STATE.anonymised ||
    context.operationalState === PROPERTY_OPERATIONAL_STATE.completedGrace ||
    context.operationalState === PROPERTY_OPERATIONAL_STATE.archived ||
    Boolean(context.chainCompletedAt) ||
    context.hasMeaningfulParticipation ||
    context.hasValidActiveInvitation
  );
}

function dormantContinuationPlan(
  scenario:
    | typeof PROPERTY_LIFECYCLE_SCENARIO.isolatedDormant
    | typeof PROPERTY_LIFECYCLE_SCENARIO.connectedDormant,
  reason: string,
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
      reason: "Archive dormant operational participation.",
      eligible: true,
      eligibleAt,
    },
    {
      scenario,
      action: PROPERTY_LIFECYCLE_ACTION.releaseProperty,
      reason: "Release dormant address for reuse.",
      eligible: true,
      eligibleAt,
    },
  ];
}

function isolatedReleasePlan(
  scenario: typeof PROPERTY_LIFECYCLE_SCENARIO.isolatedDormant,
  reason: string,
  eligibleAt: string
): PropertyLifecycleRecommendation[] {
  return [
    {
      scenario,
      action: PROPERTY_LIFECYCLE_ACTION.markDormant,
      reason,
      eligible: true,
      eligibleAt,
    },
    {
      scenario,
      action: PROPERTY_LIFECYCLE_ACTION.createAnalyticsSnapshot,
      reason: "Capture analytics before isolated dormant archival.",
      eligible: true,
      eligibleAt,
    },
    {
      scenario,
      action: PROPERTY_LIFECYCLE_ACTION.archiveOperational,
      reason: "Archive isolated dormant operational participation.",
      eligible: true,
      eligibleAt,
    },
    {
      scenario,
      action: PROPERTY_LIFECYCLE_ACTION.releaseProperty,
      reason: "Release isolated dormant address for reuse.",
      eligible: true,
      eligibleAt,
    },
  ];
}

/**
 * B1 — isolated / unconnected property with no meaningful transaction progress.
 */
export function evaluateIsolatedDormantScenario(
  context: PropertyLifecycleContext,
  config: LifecycleConfig,
  evaluatedAt: Date = new Date()
): PropertyLifecycleRecommendation[] {
  if (isProtectedFromDormancy(context)) {
    return [];
  }

  if (context.isChainConnected) {
    return [];
  }

  const anchor = inactivityAnchor(context);
  const inactiveDays = daysBetween(anchor, evaluatedAt);
  const meetsThreshold =
    inactiveDays !== null &&
    inactiveDays >= config.dormantInactivityDays;

  if (!meetsThreshold) {
    return [];
  }

  const eligibleAt = anchor
    ? addDays(anchor, config.dormantInactivityDays)
    : nowIso();

  if (context.operationalState === PROPERTY_OPERATIONAL_STATE.active) {
    return isolatedReleasePlan(
      PROPERTY_LIFECYCLE_SCENARIO.isolatedDormant,
      "Isolated property with no meaningful operational activity within the inactivity window.",
      eligibleAt
    );
  }

  if (context.operationalState === PROPERTY_OPERATIONAL_STATE.dormant) {
    return dormantContinuationPlan(
      PROPERTY_LIFECYCLE_SCENARIO.isolatedDormant,
      "Isolated property already marked dormant.",
      context.enteredStateAt ?? eligibleAt
    );
  }

  return [];
}

/**
 * B2 — connected transaction abandoned after warning + confirmation period.
 */
export function evaluateConnectedDormantScenario(
  context: PropertyLifecycleContext,
  config: LifecycleConfig,
  evaluatedAt: Date = new Date()
): PropertyLifecycleRecommendation[] {
  if (isProtectedFromDormancy(context)) {
    return [];
  }

  if (!context.isChainConnected) {
    return [];
  }

  const chainAnchor =
    context.chainLastOperationalActivityAt ?? inactivityAnchor(context);
  const inactiveDays = daysBetween(chainAnchor, evaluatedAt);
  const meetsConnectedThreshold =
    inactiveDays !== null &&
    inactiveDays >= config.connectedDormantDays;

  if (
    context.operationalState === PROPERTY_OPERATIONAL_STATE.active &&
    meetsConnectedThreshold
  ) {
    const eligibleAt = chainAnchor
      ? addDays(chainAnchor, config.connectedDormantDays)
      : nowIso();

    return [
      {
        scenario: PROPERTY_LIFECYCLE_SCENARIO.connectedDormant,
        action: PROPERTY_LIFECYCLE_ACTION.enterDormancyWarning,
        reason:
          "Connected transaction has no meaningful operational activity within the connected dormancy threshold.",
        eligible: true,
        eligibleAt,
      },
    ];
  }

  if (
    context.operationalState ===
    PROPERTY_OPERATIONAL_STATE.dormancyWarning
  ) {
    const deadline =
      context.dormancyConfirmationDeadlineAt ??
      (context.dormancyWarningAt
        ? addDays(
            context.dormancyWarningAt,
            config.dormancyConfirmationDays
          )
        : null);

    const confirmationExpired =
      deadline !== null && evaluatedAt >= new Date(deadline);

    if (!confirmationExpired) {
      return [];
    }

    const eligibleAt = deadline ?? nowIso();

    return [
      {
        scenario: PROPERTY_LIFECYCLE_SCENARIO.connectedDormant,
        action: PROPERTY_LIFECYCLE_ACTION.markDormant,
        reason:
          "Connected dormancy confirmation period expired without a still-active confirmation.",
        eligible: true,
        eligibleAt,
      },
      {
        scenario: PROPERTY_LIFECYCLE_SCENARIO.connectedDormant,
        action: PROPERTY_LIFECYCLE_ACTION.createAnalyticsSnapshot,
        reason: "Capture analytics before connected dormant archival.",
        eligible: true,
        eligibleAt,
      },
      {
        scenario: PROPERTY_LIFECYCLE_SCENARIO.connectedDormant,
        action: PROPERTY_LIFECYCLE_ACTION.archiveOperational,
        reason: "Archive connected abandoned operational participation.",
        eligible: true,
        eligibleAt,
      },
      {
        scenario: PROPERTY_LIFECYCLE_SCENARIO.connectedDormant,
        action: PROPERTY_LIFECYCLE_ACTION.releaseProperty,
        reason: "Release connected abandoned address for reuse.",
        eligible: true,
        eligibleAt,
      },
    ];
  }

  if (
    context.operationalState === PROPERTY_OPERATIONAL_STATE.dormant &&
    context.isChainConnected
  ) {
    return dormantContinuationPlan(
      PROPERTY_LIFECYCLE_SCENARIO.connectedDormant,
      "Connected property marked dormant after confirmation expiry.",
      context.enteredStateAt ?? nowIso()
    );
  }

  return [];
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
      scenario: context.isChainConnected
        ? PROPERTY_LIFECYCLE_SCENARIO.connectedDormant
        : PROPERTY_LIFECYCLE_SCENARIO.isolatedDormant,
      action: PROPERTY_LIFECYCLE_ACTION.releaseProperty,
      reason: "Release archived dormant property address for reuse.",
      eligible: true,
      eligibleAt: context.enteredStateAt,
    },
  ];
}
