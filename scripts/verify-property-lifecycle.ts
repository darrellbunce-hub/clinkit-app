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

  const completedContext = createDefaultLifecycleContext(101, {
    chainId: 1,
    chainCompletedAt: new Date(Date.now() - 40 * 86_400_000).toISOString(),
    memberCount: 2,
    hasAcceptedClaim: true,
    hasConnectedCounterparty: true,
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

  const dormantContext = createDefaultLifecycleContext(202, {
    operationalState: PROPERTY_OPERATIONAL_STATE.active,
    memberCount: 1,
    hasConnectedCounterparty: false,
    hasPendingInvitation: false,
    hasAcceptedClaim: false,
    claimStatus: "unclaimed",
    lastActivityAt: new Date(Date.now() - 100 * 86_400_000).toISOString(),
    enteredStateAt: new Date(Date.now() - 100 * 86_400_000).toISOString(),
  });

  const dormantEval = evaluatePropertyLifecycleFromContext(dormantContext);
  assert(
    dormantEval.plannedActions.includes(PROPERTY_LIFECYCLE_ACTION.markDormant),
    "Inactive unconnected property should be marked dormant"
  );
  assert(
    dormantEval.plannedActions.includes(
      PROPERTY_LIFECYCLE_ACTION.releaseProperty
    ),
    "Dormant property should plan release for Scenario C"
  );

  assert(
    canTransitionOperationalState(
      PROPERTY_OPERATIONAL_STATE.active,
      PROPERTY_OPERATIONAL_STATE.completedGrace
    ),
    "active → completed_grace allowed"
  );
  assert(
    !canTransitionOperationalState(
      PROPERTY_OPERATIONAL_STATE.anonymised,
      PROPERTY_OPERATIONAL_STATE.active
    ),
    "anonymised → active blocked"
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
        snapshotKeys: Object.keys(snapshot),
      },
      null,
      2
    )
  );
}

main();
