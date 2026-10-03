/**
 * Next lifecycle evaluation for one row (property_lifecycle_states
 * .next_evaluation_at). Pure; the worker writes the result through
 * schedule_property_lifecycle_evaluation after evaluating the row.
 *
 * Managed rows in uncompleted chains are not scheduled; database triggers
 * schedule them again when the seller side becomes unrepresented or the chain
 * completes. Overdue work is retried a day later so a refused step (for
 * example an unsafe release) never makes a row due on every run.
 */

import { addDays } from "@/lib/lifecycle/config";
import {
  dormancyWarningDeadline,
  isPlaceholderForDormancy,
  placeholderDormancyAnchor,
} from "@/lib/lifecycle/dormancyScenarios";
import {
  PROPERTY_OPERATIONAL_STATE,
  type LifecycleConfig,
  type PropertyLifecycleContext,
} from "@/lib/lifecycle/types";

const RETRY_DAYS = 1;

function futureOrRetry(
  candidates: Array<string | null>,
  evaluatedAt: Date
): string {
  const future = candidates
    .filter((value): value is string => Boolean(value))
    .map((value) => new Date(value))
    .filter((date) => !Number.isNaN(date.getTime()) && date > evaluatedAt)
    .sort((left, right) => left.getTime() - right.getTime());

  return future.length > 0
    ? future[0].toISOString()
    : addDays(evaluatedAt.toISOString(), RETRY_DAYS);
}

export function computeNextLifecycleEvaluationAt(
  context: PropertyLifecycleContext,
  config: LifecycleConfig,
  evaluatedAt: Date = new Date()
): string | null {
  const state = context.operationalState;

  if (state === PROPERTY_OPERATIONAL_STATE.anonymised) {
    return null;
  }

  if (state === PROPERTY_OPERATIONAL_STATE.released) {
    return context.hasAnalyticsSnapshot
      ? null
      : futureOrRetry([], evaluatedAt);
  }

  if (state === PROPERTY_OPERATIONAL_STATE.completedGrace) {
    const graceEndsAt =
      context.graceEndsAt ??
      (context.chainCompletedAt
        ? addDays(context.chainCompletedAt, config.completedGraceDays)
        : null);

    return futureOrRetry([graceEndsAt], evaluatedAt);
  }

  if (state === PROPERTY_OPERATIONAL_STATE.archived) {
    return futureOrRetry([], evaluatedAt);
  }

  if (context.chainCompletedAt) {
    return futureOrRetry([], evaluatedAt);
  }

  if (!isPlaceholderForDormancy(context)) {
    return null;
  }

  if (state === PROPERTY_OPERATIONAL_STATE.dormancyWarning) {
    return futureOrRetry(
      [dormancyWarningDeadline(context, config)],
      evaluatedAt
    );
  }

  if (state === PROPERTY_OPERATIONAL_STATE.dormant) {
    return futureOrRetry([], evaluatedAt);
  }

  const anchor = placeholderDormancyAnchor(context, config);

  if (!anchor) {
    return futureOrRetry([], evaluatedAt);
  }

  // Dependants can disappear without touching this row, so the shorter window
  // is checked first even when the row has dependants.
  return futureOrRetry(
    [
      addDays(anchor, config.dormantInactivityDays),
      addDays(anchor, config.connectedDormantDays),
    ],
    evaluatedAt
  );
}
