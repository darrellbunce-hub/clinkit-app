import {
  PROPERTY_OPERATIONAL_STATE,
  type PropertyOperationalState,
} from "@/lib/lifecycle/types";

export const LIFECYCLE_DORMANCY_WARNING_QUERY = "dormancy-warning";

export const STILL_ACTIVE_ALREADY_ACTIVE_MESSAGE =
  "This transaction is currently active.";

export const STILL_ACTIVE_SUCCESS_MESSAGE =
  "Thanks — we've confirmed that your transaction is still active.";

export type StillActiveConfirmationView = {
  showDormancyPanel: boolean;
  showAlreadyActiveInfo: boolean;
  alreadyActiveInfoMessage: string;
  canConfirm: boolean;
};

export function isLifecycleDormancyWarningHint(
  lifecycleQuery: string | null | undefined
): boolean {
  return lifecycleQuery === LIFECYCLE_DORMANCY_WARNING_QUERY;
}

export function resolveStillActiveConfirmationView(params: {
  lifecycleHint: boolean;
  operationalState: PropertyOperationalState;
  isActiveOperationalHomeowner: boolean;
}): StillActiveConfirmationView {
  const { lifecycleHint, operationalState, isActiveOperationalHomeowner } =
    params;

  const showDormancyPanel =
    isActiveOperationalHomeowner &&
    operationalState === PROPERTY_OPERATIONAL_STATE.dormancyWarning;

  const showAlreadyActiveInfo =
    lifecycleHint &&
    isActiveOperationalHomeowner &&
    operationalState === PROPERTY_OPERATIONAL_STATE.active;

  return {
    showDormancyPanel,
    showAlreadyActiveInfo,
    alreadyActiveInfoMessage: STILL_ACTIVE_ALREADY_ACTIVE_MESSAGE,
    canConfirm: showDormancyPanel,
  };
}

export function formatDormancyConfirmationDeadline(
  deadlineAt: string | null | undefined
): string | null {
  if (!deadlineAt) {
    return null;
  }

  const date = new Date(deadlineAt);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}
