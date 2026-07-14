import "server-only";

export {
  PROPERTY_LIFECYCLE_ACTION,
  PROPERTY_LIFECYCLE_SCENARIO,
  PROPERTY_OPERATIONAL_STATE,
  type LifecycleConfig,
  type PropertyAnalyticsSnapshotPayload,
  type PropertyLifecycleContext,
  type PropertyLifecycleEvaluation,
  type PropertyLifecycleRecommendation,
  type PropertyLifecycleTransitionRecord,
  type PropertyOperationalState,
} from "@/lib/lifecycle/types";

export {
  addDays,
  daysBetween,
  getLifecycleConfig,
} from "@/lib/lifecycle/config";

export {
  buildAnonymisedAnalyticsSnapshot,
  extractPostcodeDistrict,
} from "@/lib/lifecycle/analyticsSnapshot";

export {
  buildLifecyclePlan,
  evaluateAllLifecycleScenarios,
  evaluateAnalyticsScenario,
  evaluateCompletedGraceScenario,
  evaluateDormantScenario,
} from "@/lib/lifecycle/scenarios";

export {
  canTransitionOperationalState,
  assertTransitionAllowed,
  scenarioForState,
  targetStateForAction,
} from "@/lib/lifecycle/transitions";

export {
  createDefaultLifecycleContext,
  evaluatePropertyLifecycleFromContext,
} from "@/lib/lifecycle/evaluate";

export {
  PropertyLifecycleService,
} from "@/lib/lifecycle/service";
