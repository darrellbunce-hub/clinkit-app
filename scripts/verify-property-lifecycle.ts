/**
 * Verifies property lifecycle evaluators (pure TypeScript).
 *
 * Usage:
 *   npx tsx scripts/verify-property-lifecycle.ts
 */
import { getLifecycleConfig } from "../lib/lifecycle/config";
import {
  createDefaultLifecycleContext,
  evaluatePropertyLifecycleFromContext,
} from "../lib/lifecycle/evaluate";
import { buildAnonymisedAnalyticsSnapshot } from "../lib/lifecycle/analyticsSnapshot";
import {
  canTransitionOperationalState,
  targetStateForAction,
} from "../lib/lifecycle/transitions";
import {
  PROPERTY_LIFECYCLE_ACTION,
  PROPERTY_OPERATIONAL_STATE,
} from "../lib/lifecycle/types";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

function main() {
  const config = getLifecycleConfig();
  assert(config.completedGraceDays === 30, "Default grace days should be 30");
  assert(config.dormantInactivityDays === 90, "Default dormant days should be 90");
  assert(config.connectedDormantDays === 150, "Default connected dormant days should be 150");
  assert(
    config.dormancyConfirmationDays === 30,
    "Default dormancy confirmation days should be 30"
  );

  const completedContext = createDefaultLifecycleContext(101, {
    chainId: 1,
    chainCompletedAt: new Date(Date.now() - 40 * 86_400_000).toISOString(),
    memberCount: 2,
    hasAcceptedClaim: true,
    hasConnectedCounterparty: true,
    isChainConnected: true,
    relationshipType: "sale",
    originType: "homeowner",
    enteredStateAt: new Date(Date.now() - 120 * 86_400_000).toISOString(),
  });

  const completedEval = evaluatePropertyLifecycleFromContext(completedContext);
  assert(
    completedEval.plannedActions.includes(
      PROPERTY_LIFECYCLE_ACTION.enterCompletedGrace
    ),
    "Completed chain should recommend entering grace"
  );
  assert(
    completedEval.plannedActions.includes(
      PROPERTY_LIFECYCLE_ACTION.archiveOperational
    ),
    "Elapsed grace should plan archival"
  );

  // Dormancy applies only to unrepresented placeholders, measured from the
  // effective-from floor, so these cases use a fixed evaluation instant.
  const evaluatedAt = new Date("2027-06-01T00:00:00.000Z");
  const before = (days: number) =>
    new Date(evaluatedAt.getTime() - days * 86_400_000).toISOString();
  const noDormancy = (actions: string[]) =>
    !actions.some((action) =>
      [
        PROPERTY_LIFECYCLE_ACTION.enterDormancyWarning,
        PROPERTY_LIFECYCLE_ACTION.markDormant,
        PROPERTY_LIFECYCLE_ACTION.releaseProperty,
      ].includes(action as never)
    );

  const legacyInactive = evaluatePropertyLifecycleFromContext(
    createDefaultLifecycleContext(201, {
      operationalState: PROPERTY_OPERATIONAL_STATE.active,
      memberCount: 1,
      isChainConnected: false,
      hasValidActiveInvitation: false,
      hasAcceptedClaim: false,
      claimStatus: "unclaimed",
      lastOperationalActivityAt: before(100),
      enteredStateAt: before(100),
    }),
    evaluatedAt
  );
  assert(
    noDormancy(legacyInactive.plannedActions),
    "Inactivity alone (no seller-side signals) never plans dormancy"
  );

  const dormantContext = createDefaultLifecycleContext(202, {
    operationalState: PROPERTY_OPERATIONAL_STATE.active,
    chainId: 1,
    relationshipType: "purchase",
    sellerSide: "none",
    buyerSide: "homeowner",
    isManaged: false,
    sellerSideUnrepresentedSince: before(100),
    hasPlaceholderDependants: false,
    enteredStateAt: before(100),
  });

  const dormantEval = evaluatePropertyLifecycleFromContext(
    dormantContext,
    evaluatedAt
  );
  assert(
    dormantEval.plannedActions.includes(PROPERTY_LIFECYCLE_ACTION.markDormant),
    "Placeholder without dependants unrepresented 90+ days should be marked dormant"
  );
  assert(
    dormantEval.plannedActions.includes(
      PROPERTY_LIFECYCLE_ACTION.releaseProperty
    ),
    "Dormant placeholder should plan release"
  );

  const managedStale = evaluatePropertyLifecycleFromContext(
    createDefaultLifecycleContext(204, {
      operationalState: PROPERTY_OPERATIONAL_STATE.active,
      isChainConnected: true,
      relationshipType: "sale",
      sellerSide: "homeowner",
      buyerSide: "none",
      isManaged: true,
      chainLastOperationalActivityAt: before(160),
      lastOperationalActivityAt: before(160),
    }),
    evaluatedAt
  );
  assert(
    noDormancy(managedStale.plannedActions),
    "Managed transaction never enters dormancy warning, however stale"
  );

  const connectedWarningEval = evaluatePropertyLifecycleFromContext(
    createDefaultLifecycleContext(203, {
      operationalState: PROPERTY_OPERATIONAL_STATE.active,
      chainId: 1,
      isChainConnected: true,
      relationshipType: "purchase",
      sellerSide: "none",
      buyerSide: "homeowner",
      isManaged: false,
      sellerSideUnrepresentedSince: before(160),
      hasPlaceholderDependants: true,
      enteredStateAt: before(160),
    }),
    evaluatedAt
  );
  assert(
    connectedWarningEval.plannedActions.includes(
      PROPERTY_LIFECYCLE_ACTION.enterDormancyWarning
    ),
    "Placeholder with dependants unrepresented 150+ days should enter dormancy warning"
  );

  assert(
    canTransitionOperationalState(
      PROPERTY_OPERATIONAL_STATE.active,
      PROPERTY_OPERATIONAL_STATE.dormancyWarning
    ),
    "active → dormancy_warning allowed"
  );
  assert(
    canTransitionOperationalState(
      PROPERTY_OPERATIONAL_STATE.dormancyWarning,
      PROPERTY_OPERATIONAL_STATE.active
    ),
    "dormancy_warning → active allowed (confirmation reset)"
  );
  assert(
    !canTransitionOperationalState(
      PROPERTY_OPERATIONAL_STATE.anonymised,
      PROPERTY_OPERATIONAL_STATE.active
    ),
    "anonymised → active blocked"
  );

  assert(
    targetStateForAction(PROPERTY_LIFECYCLE_ACTION.enterDormancyWarning) ===
      PROPERTY_OPERATIONAL_STATE.dormancyWarning,
    "enter_dormancy_warning maps to dormancy_warning state"
  );

  assert(
    targetStateForAction(PROPERTY_LIFECYCLE_ACTION.releaseProperty) ===
      PROPERTY_OPERATIONAL_STATE.released,
    "release action maps to released state"
  );

  const snapshot = buildAnonymisedAnalyticsSnapshot({
    context: completedContext,
    postcode: "SW1A 1AA",
    regionCode: "UK-LONDON",
    activityCount: 12,
  });

  assert(snapshot.propertyRef.length > 0, "Snapshot should have anonymised ref");
  assert(snapshot.postcodeDistrict === "SW1A 1", "Postcode district extracted");
  assert(
    !("invite_email" in snapshot.metrics),
    "Snapshot must not contain invite email fields"
  );

  console.log("=== PROPERTY LIFECYCLE VERIFICATION PASSED ===");
  console.log(
    JSON.stringify(
      {
        config,
        completedPlan: completedEval.plannedActions,
        dormantPlan: dormantEval.plannedActions,
        connectedWarningPlan: connectedWarningEval.plannedActions,
        snapshotKeys: Object.keys(snapshot),
      },
      null,
      2
    )
  );
}

main();
