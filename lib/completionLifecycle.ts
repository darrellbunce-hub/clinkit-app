export const COMPLETION_DATE_AGREED_STAGE =
  "completion_date_agreed" as const;

export const PROPERTY_CONTRACTS_EXCHANGED_STAGE =
  "contracts_exchanged" as const;

export const BUYER_READY_CONTRACTS_EXCHANGED_STAGE =
  "exchange_contracts" as const;

export const COMPLETION_LIFECYCLE_STATUS = {
  scheduled: "scheduled",
  awaitingConfirmation: "awaiting_confirmation",
  completed: "completed",
} as const;

export type CompletionLifecycleStatus =
  (typeof COMPLETION_LIFECYCLE_STATUS)[keyof typeof COMPLETION_LIFECYCLE_STATUS];

export const CHAIN_COMPLETION_EVENT_TYPE = {
  completionDateRecorded: "completion_date_recorded",
  completionDateChanged: "completion_date_changed",
  completionDateUpdateAcknowledged:
    "completion_date_update_acknowledged",
  completionConfirmed: "completion_confirmed",
  completionLifecycleReset: "completion_lifecycle_reset",
} as const;

export type ChainCompletionEventType =
  (typeof CHAIN_COMPLETION_EVENT_TYPE)[keyof typeof CHAIN_COMPLETION_EVENT_TYPE];

export const COMPLETION_DATE_AGREED_REQUIRES_CONTRACTS_EXCHANGED_MESSAGE =
  "Completion Date Agreed cannot be recorded until Contracts Exchanged has been completed.";

export const COMPLETION_STAGE_GATE_ERROR_CODE =
  "completion_date_agreed_requires_contracts_exchanged";

export type CompletionStageValidationResult =
  | { ok: true }
  | {
      ok: false;
      code: typeof COMPLETION_STAGE_GATE_ERROR_CODE;
      message: string;
    };

export type ChainCompletionLifecycleRow = {
  id: number;
  completion_lifecycle_status: CompletionLifecycleStatus | null;
  completion_scheduled_date: string | null;
  completion_date_recorded_at: string | null;
  completion_date_recorded_by_user_id: string | null;
  completion_date_updated_at: string | null;
  completion_date_updated_by_user_id: string | null;
  completion_confirmed_at: string | null;
  completion_confirmed_by_user_id: string | null;
  completion_confirmed_by_role:
    | "estate_agent"
    | "participant"
    | null;
  completed_at: string | null;
};

export type ChainCompletionEventRow = {
  id: number;
  chain_id: number;
  event_type: ChainCompletionEventType;
  occurred_at: string;
  actor_user_id: string | null;
  actor_role: string | null;
  scheduled_date: string | null;
  previous_scheduled_date: string | null;
  payload: Record<string, unknown> | null;
};

export function validatePropertyStageTransition(
  currentStage: string,
  newStage: string
): CompletionStageValidationResult {
  if (newStage === currentStage) {
    return { ok: true };
  }

  if (
    newStage === COMPLETION_DATE_AGREED_STAGE &&
    currentStage !== PROPERTY_CONTRACTS_EXCHANGED_STAGE
  ) {
    return {
      ok: false,
      code: COMPLETION_STAGE_GATE_ERROR_CODE,
      message:
        COMPLETION_DATE_AGREED_REQUIRES_CONTRACTS_EXCHANGED_MESSAGE,
    };
  }

  return { ok: true };
}

export function validateBuyerReadyStageTransition(
  currentStage: string,
  newStage: string
): CompletionStageValidationResult {
  if (newStage === currentStage) {
    return { ok: true };
  }

  if (
    newStage === COMPLETION_DATE_AGREED_STAGE &&
    currentStage !== BUYER_READY_CONTRACTS_EXCHANGED_STAGE
  ) {
    return {
      ok: false,
      code: COMPLETION_STAGE_GATE_ERROR_CODE,
      message:
        COMPLETION_DATE_AGREED_REQUIRES_CONTRACTS_EXCHANGED_MESSAGE,
    };
  }

  return { ok: true };
}

export function isCompletionStageGateError(
  error: unknown
): error is { message: string; code?: string } {
  if (!error || typeof error !== "object") {
    return false;
  }

  const message =
    "message" in error &&
    typeof error.message === "string"
      ? error.message
      : "";

  return (
    message.includes(
      COMPLETION_STAGE_GATE_ERROR_CODE
    ) ||
    message.includes(
      COMPLETION_DATE_AGREED_REQUIRES_CONTRACTS_EXCHANGED_MESSAGE
    )
  );
}

export function getCompletionStageGateMessage(
  error: unknown
): string {
  if (isCompletionStageGateError(error)) {
    return COMPLETION_DATE_AGREED_REQUIRES_CONTRACTS_EXCHANGED_MESSAGE;
  }

  return "Could not update workflow stage.";
}

export const COMPLETION_SCHEDULING_GUIDANCE =
  "Only enter a completion date once it has been formally agreed between all parties through their solicitors.";

export const COMPLETION_SCHEDULING_SUPPORTING_TEXT =
  "This is not a target or estimate — only a confirmed agreed date.";

export const COMPLETION_SCHEDULED_BANNER_FOOTER =
  "This date should only be entered once formally agreed by all parties through their solicitors.";

export const COMPLETION_SCHEDULED_STATUS_LABEL =
  "Awaiting agreed completion date";

export const COMPLETION_SCHEDULED_OPERATIONAL_INTRO =
  "This transaction is scheduled to complete on:";

export function isChainInScheduledCompletionMode(params: {
  completionLifecycleStatus: string | null | undefined;
  completionScheduledDate: string | null | undefined;
}): boolean {
  return (
    params.completionLifecycleStatus ===
      COMPLETION_LIFECYCLE_STATUS.scheduled &&
    !!params.completionScheduledDate
  );
}

export function isChainInCompletedCompletionMode(params: {
  completionLifecycleStatus: string | null | undefined;
  completionScheduledDate: string | null | undefined;
}): boolean {
  return (
    params.completionLifecycleStatus ===
      COMPLETION_LIFECYCLE_STATUS.completed &&
    !!params.completionScheduledDate
  );
}

export type CompletionBannerPhase =
  | "scheduled"
  | "today"
  | "passed";

export function getCompletionBannerPhase(
  scheduledDate: string
): CompletionBannerPhase {
  const countdown =
    computeCompletionCountdown(scheduledDate);

  if (countdown.daysRemaining < 0) {
    return "passed";
  }

  if (countdown.daysRemaining === 0) {
    return "today";
  }

  return "scheduled";
}

export function getCompletionBannerTitle(
  phase: CompletionBannerPhase
): string {
  switch (phase) {
    case "today":
      return "🏁 Completion Today";
    case "passed":
      return "🏁 Completion Date Passed";
    default:
      return "🏁 Completion Scheduled";
  }
}

export function getCompletionBannerPrompt(
  phase: CompletionBannerPhase
): string | null {
  switch (phase) {
    case "today":
      return "Completion expected today.";
    case "passed":
      return "Please confirm whether completion has taken place.";
    default:
      return null;
  }
}

export function formatCompletionConfirmedAt(
  confirmedAt: string
): string {
  const parsedDate = new Date(confirmedAt);

  return parsedDate.toLocaleString(
    "en-GB",
    {
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }
  );
}

export const COMPLETION_CONFIRMATION_MODAL_TITLE =
  "Has completion taken place?";

export const COMPLETION_CONFIRMATION_MODAL_NOTICE =
  "This should only be confirmed once the transaction has legally completed.";

export const COMPLETION_CONFIRMATION_DENIED_MESSAGE =
  "Only an operational participant can confirm completion once the agreed date has passed.";

export const CHAIN_COMPLETED_BANNER_FOOTER =
  "This chain has been completed.";

export const TRANSACTION_COMPLETED_INTRO =
  "This transaction completed on:";

export const TRANSACTION_COMPLETED_FOOTER =
  "No further updates are required.";

export type CompletionCountdown = {
  daysRemaining: number;
  countdownLabel: string;
  daysRemainingLabel: string;
  statusLabel: string;
};

function startOfLocalDay(date: Date): Date {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate()
  );
}

export function computeCompletionCountdown(
  scheduledDate: string,
  referenceDate: Date = new Date()
): CompletionCountdown {
  const scheduled = new Date(
    `${scheduledDate}T12:00:00`
  );
  const today = startOfLocalDay(referenceDate);
  const target = startOfLocalDay(scheduled);
  const daysRemaining = Math.round(
    (target.getTime() - today.getTime()) /
      86_400_000
  );

  let countdownLabel: string;
  let daysRemainingLabel: string;

  if (daysRemaining < 0) {
    countdownLabel = "Completion date passed";
    daysRemainingLabel = "Completion date passed";
  } else if (daysRemaining === 0) {
    countdownLabel = "Completion today";
    daysRemainingLabel = "Completion today";
  } else if (daysRemaining === 1) {
    countdownLabel = "Completion tomorrow";
    daysRemainingLabel = "1 day remaining";
  } else {
    countdownLabel = `Completion in ${daysRemaining} days`;
    daysRemainingLabel = `${daysRemaining} days remaining`;
  }

  return {
    daysRemaining,
    countdownLabel,
    daysRemainingLabel,
    statusLabel: COMPLETION_SCHEDULED_STATUS_LABEL,
  };
}

export const COMPLETION_SCHEDULED_CHAIN_HEALTH_MESSAGE =
  "Chain is executing toward the agreed completion date.";

export const COMPLETION_SCHEDULED_CONFIDENCE_NOTE =
  "Confidence reflects chain progress at scheduling. Inactivity no longer reduces confidence while completion is scheduled.";

export const COMPLETION_DATE_ALREADY_RECORDED_MESSAGE =
  "A completion date has already been recorded for this chain.";

type OperationalStageSource = {
  id: number;
  stage?: string | null;
};

export function hasOperationalPositionReachedContractsExchanged(
  operationalPosition: {
    kind: "buyer_ready" | "sale";
    nodeId?: number;
    propertyId?: number;
  } | null,
  chainProperties: OperationalStageSource[],
  chainNodes: OperationalStageSource[]
): boolean {
  if (!operationalPosition) {
    return false;
  }

  if (operationalPosition.kind === "buyer_ready") {
    const node = chainNodes.find(
      (candidate) =>
        candidate.id === operationalPosition.nodeId
    );

    return (
      node?.stage ===
        BUYER_READY_CONTRACTS_EXCHANGED_STAGE ||
      node?.stage === COMPLETION_DATE_AGREED_STAGE
    );
  }

  const property = chainProperties.find(
    (candidate) =>
      candidate.id === operationalPosition.propertyId
  );

  return (
    property?.stage ===
      PROPERTY_CONTRACTS_EXCHANGED_STAGE ||
    property?.stage === COMPLETION_DATE_AGREED_STAGE
  );
}

export function formatCompletionScheduledDate(
  scheduledDate: string
): string {
  const parsedDate = new Date(
    `${scheduledDate}T12:00:00`
  );

  return parsedDate.toLocaleDateString(
    "en-GB",
    {
      day: "numeric",
      month: "long",
      year: "numeric",
    }
  );
}

export function isValidCompletionScheduledDateInput(
  scheduledDate: string
): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(scheduledDate)) {
    return false;
  }

  const parsedDate = new Date(
    `${scheduledDate}T12:00:00`
  );

  return !Number.isNaN(parsedDate.getTime());
}

export const COMPLETION_DATE_REQUIRED_INTRO =
  "A completion date has not yet been recorded for this chain.";

export const COMPLETION_SCHEDULED_OPERATIONAL_FOOTER =
  "This date was recorded for the chain and is visible to all participants.";

type OperationalStageTarget = {
  id: number;
  stage?: string | null;
};

export function getOperationalPositionStage(
  operationalPosition: {
    kind: "buyer_ready" | "sale";
    nodeId?: number;
    propertyId?: number;
  },
  chainProperties: OperationalStageTarget[],
  chainNodes: OperationalStageTarget[]
): string | null {
  if (operationalPosition.kind === "buyer_ready") {
    return (
      chainNodes.find(
        (candidate) =>
          candidate.id === operationalPosition.nodeId
      )?.stage ?? null
    );
  }

  return (
    chainProperties.find(
      (candidate) =>
        candidate.id === operationalPosition.propertyId
    )?.stage ?? null
  );
}

export function isOperationalPositionAtCompletionDateAgreed(
  operationalPosition: {
    kind: "buyer_ready" | "sale";
    nodeId?: number;
    propertyId?: number;
  } | null,
  chainProperties: OperationalStageTarget[],
  chainNodes: OperationalStageTarget[]
): boolean {
  if (!operationalPosition) {
    return false;
  }

  return (
    getOperationalPositionStage(
      operationalPosition,
      chainProperties,
      chainNodes
    ) === COMPLETION_DATE_AGREED_STAGE
  );
}

export const COMPLETION_AMENDMENT_REASONS = [
  {
    code: "solicitor_revised_date",
    label: "Solicitors agreed a revised completion date",
  },
  {
    code: "chain_dependency_adjustment",
    label: "Chain dependency required date adjustment",
  },
  {
    code: "mortgage_or_lender_timing",
    label: "Mortgage or lender timing required date adjustment",
  },
  {
    code: "removals_or_logistics_timing",
    label:
      "Removal or logistics availability required date adjustment",
  },
  {
    code: "developer_or_new_build_timing",
    label: "Developer or new-build timing required date adjustment",
  },
  {
    code: "incorrect_date_entered",
    label: "Completion date entered incorrectly",
  },
  {
    code: "administrative_correction",
    label: "Administrative correction",
  },
] as const;

export type CompletionAmendmentReasonCode =
  (typeof COMPLETION_AMENDMENT_REASONS)[number]["code"];

export function isCompletionAmendmentReasonCode(
  value: string
): value is CompletionAmendmentReasonCode {
  return COMPLETION_AMENDMENT_REASONS.some(
    (reason) => reason.code === value
  );
}

export function getCompletionAmendmentReasonLabel(
  code: CompletionAmendmentReasonCode
): string {
  return (
    COMPLETION_AMENDMENT_REASONS.find(
      (reason) => reason.code === code
    )?.label ?? code
  );
}

export const COMPLETION_AMENDMENT_CONFIRMATION_INTRO =
  "You are changing the agreed completion date for the entire chain.";

export const COMPLETION_AMENDMENT_SOLICITOR_NOTICE =
  "This should only be used when a revised date has been formally agreed through solicitors.";

export function formatCompletionAmendmentActivityUpdate(
  previousDate: string,
  newDate: string,
  reasonCode: CompletionAmendmentReasonCode
): string {
  return [
    "Completion date updated",
    "",
    `${formatCompletionScheduledDate(previousDate)} → ${formatCompletionScheduledDate(newDate)}`,
    "",
    "Reason:",
    getCompletionAmendmentReasonLabel(reasonCode),
  ].join("\n");
}
