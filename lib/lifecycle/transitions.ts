import {
  PROPERTY_LIFECYCLE_SCENARIO,
  PROPERTY_OPERATIONAL_STATE,
  type PropertyLifecycleScenario,
  type PropertyOperationalState,
} from "@/lib/lifecycle/types";

const ALLOWED_TRANSITIONS: Record<
  PropertyOperationalState,
  PropertyOperationalState[]
> = {
  [PROPERTY_OPERATIONAL_STATE.active]: [
    PROPERTY_OPERATIONAL_STATE.completedGrace,
    PROPERTY_OPERATIONAL_STATE.dormancyWarning,
    PROPERTY_OPERATIONAL_STATE.dormant,
  ],
  [PROPERTY_OPERATIONAL_STATE.completedGrace]: [
    PROPERTY_OPERATIONAL_STATE.archived,
    PROPERTY_OPERATIONAL_STATE.active,
  ],
  [PROPERTY_OPERATIONAL_STATE.dormancyWarning]: [
    PROPERTY_OPERATIONAL_STATE.active,
    PROPERTY_OPERATIONAL_STATE.dormant,
  ],
  [PROPERTY_OPERATIONAL_STATE.dormant]: [
    PROPERTY_OPERATIONAL_STATE.archived,
    PROPERTY_OPERATIONAL_STATE.active,
  ],
  [PROPERTY_OPERATIONAL_STATE.archived]: [
    PROPERTY_OPERATIONAL_STATE.released,
    PROPERTY_OPERATIONAL_STATE.anonymised,
  ],
  [PROPERTY_OPERATIONAL_STATE.released]: [
    PROPERTY_OPERATIONAL_STATE.anonymised,
    PROPERTY_OPERATIONAL_STATE.active,
  ],
  [PROPERTY_OPERATIONAL_STATE.anonymised]: [],
};

export function canTransitionOperationalState(
  fromState: PropertyOperationalState,
  toState: PropertyOperationalState
): boolean {
  if (fromState === toState) {
    return true;
  }

  return ALLOWED_TRANSITIONS[fromState]?.includes(toState) ?? false;
}

export function assertTransitionAllowed(
  fromState: PropertyOperationalState,
  toState: PropertyOperationalState
): void {
  if (!canTransitionOperationalState(fromState, toState)) {
    throw new Error(
      `Lifecycle transition not allowed: ${fromState} → ${toState}`
    );
  }
}

/** Maps lifecycle actions to target operational states. */
export function targetStateForAction(
  action: string
): PropertyOperationalState | null {
  switch (action) {
    case "enter_completed_grace":
      return PROPERTY_OPERATIONAL_STATE.completedGrace;
    case "enter_dormancy_warning":
      return PROPERTY_OPERATIONAL_STATE.dormancyWarning;
    case "mark_dormant":
      return PROPERTY_OPERATIONAL_STATE.dormant;
    case "archive_operational":
      return PROPERTY_OPERATIONAL_STATE.archived;
    case "release_property":
      return PROPERTY_OPERATIONAL_STATE.released;
    case "anonymise_historical":
      return PROPERTY_OPERATIONAL_STATE.anonymised;
    default:
      return null;
  }
}

export function scenarioForState(
  state: PropertyOperationalState
): PropertyLifecycleScenario | null {
  switch (state) {
    case PROPERTY_OPERATIONAL_STATE.completedGrace:
      return PROPERTY_LIFECYCLE_SCENARIO.completedGrace;
    case PROPERTY_OPERATIONAL_STATE.dormancyWarning:
      return PROPERTY_LIFECYCLE_SCENARIO.connectedDormant;
    case PROPERTY_OPERATIONAL_STATE.dormant:
      return PROPERTY_LIFECYCLE_SCENARIO.isolatedDormant;
    case PROPERTY_OPERATIONAL_STATE.released:
      return PROPERTY_LIFECYCLE_SCENARIO.futureClaim;
    case PROPERTY_OPERATIONAL_STATE.anonymised:
      return PROPERTY_LIFECYCLE_SCENARIO.analytics;
    default:
      return null;
  }
}
