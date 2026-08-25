import {
  buildLifecyclePlan,
  evaluateAllLifecycleScenarios,
} from "@/lib/lifecycle/scenarios";
import { getLifecycleConfig } from "@/lib/lifecycle/config";
import {
  PROPERTY_OPERATIONAL_STATE,
  type PropertyLifecycleContext,
  type PropertyLifecycleEvaluation,
} from "@/lib/lifecycle/types";

/**
 * Pure lifecycle evaluation — no side effects.
 * Used by the service layer and verification scripts.
 */
export function evaluatePropertyLifecycleFromContext(
  context: PropertyLifecycleContext,
  evaluatedAt: Date = new Date()
): PropertyLifecycleEvaluation {
  const config = getLifecycleConfig();
  const recommendations = evaluateAllLifecycleScenarios(
    context,
    config,
    evaluatedAt
  );
  const plannedActions = buildLifecyclePlan(recommendations, evaluatedAt);

  return {
    propertyId: context.propertyId,
    operationalState: context.operationalState,
    context,
    recommendations,
    plannedActions,
    evaluatedAt: evaluatedAt.toISOString(),
  };
}

/** Default context when no lifecycle row exists yet. */
export function createDefaultLifecycleContext(
  propertyId: number,
  partial: Partial<PropertyLifecycleContext> = {}
): PropertyLifecycleContext {
  return {
    propertyId,
    chainId: null,
    operationalState: PROPERTY_OPERATIONAL_STATE.active,
    claimStatus: null,
    originType: null,
    relationshipType: null,
    buyerConnected: false,
    sellerConnected: false,
    hasConnectedCounterparty: false,
    isChainConnected: false,
    memberCount: 0,
    chainCompletedAt: null,
    lastActivityAt: null,
    lastPropertyUpdateAt: null,
    lastOperationalActivityAt: null,
    chainLastOperationalActivityAt: null,
    hasAcceptedClaim: false,
    hasValidActiveInvitation: false,
    hasExpiredInvitationOnly: false,
    graceEndsAt: null,
    enteredStateAt: null,
    dormancyWarningAt: null,
    dormancyConfirmationDeadlineAt: null,
    daysSinceLastOperationalActivity: null,
    daysSinceChainOperationalActivity: null,
    daysSinceChainCompleted: null,
    hasActiveOperationalIdentity: false,
    hasMeaningfulParticipation: false,
    hasAnalyticsSnapshot: false,
    manuallyReleased: false,
    addressReserved: true,
    chainReleaseSafe: true,
    ...partial,
  };
}
