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

/**
 * inWarning / canConfirm come from get_property_lifecycle_status, which only
 * reports a warning to a user who can confirm it. Following a warning link
 * when the row is no longer in warning (already confirmed, activity resumed,
 * or a seller connected) shows the "currently active" notice.
 */
export function resolveStillActiveConfirmationView(params: {
  lifecycleHint: boolean;
  inWarning: boolean;
  canConfirmStillActive: boolean;
}): StillActiveConfirmationView {
  const { lifecycleHint, inWarning, canConfirmStillActive } = params;

  const showDormancyPanel = inWarning && canConfirmStillActive;

  const showAlreadyActiveInfo = lifecycleHint && !inWarning;

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
