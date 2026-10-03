import type { LifecycleConfig } from "@/lib/lifecycle/types";

const DAY_MS = 86_400_000;

export const DEFAULT_LIFECYCLE_DORMANCY_EFFECTIVE_FROM = "2026-10-05T00:00:00.000Z";

function readIsoInstant(envValue: string | undefined, fallback: string): string {
  if (!envValue) {
    return fallback;
  }

  const parsed = new Date(envValue.trim());

  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
}

function readPositiveInt(
  envValue: string | undefined,
  fallback: number
): number {
  if (!envValue) {
    return fallback;
  }

  const parsed = Number.parseInt(envValue, 10);

  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }

  return parsed;
}

/**
 * Lifecycle retention configuration.
 *
 * All periods are expressed in days and sourced from environment variables
 * so production policy can change without code deploys.
 */
export function getLifecycleConfig(): LifecycleConfig {
  const completedGraceDays = readPositiveInt(
    process.env.LIFECYCLE_COMPLETED_GRACE_DAYS,
    30
  );

  const dormantInactivityDays = readPositiveInt(
    process.env.LIFECYCLE_DORMANT_INACTIVITY_DAYS,
    90
  );

  const connectedDormantDays = readPositiveInt(
    process.env.LIFECYCLE_CONNECTED_DORMANT_DAYS,
    150
  );

  const dormancyConfirmationDays = readPositiveInt(
    process.env.LIFECYCLE_DORMANCY_CONFIRMATION_DAYS,
    30
  );

  const evaluationBatchSize = readPositiveInt(
    process.env.LIFECYCLE_EVALUATION_BATCH_SIZE,
    100
  );

  const workerLeaseSeconds = readPositiveInt(
    process.env.LIFECYCLE_WORKER_LEASE_SECONDS,
    300
  );

  const workerTimeBudgetSeconds = readPositiveInt(
    process.env.LIFECYCLE_WORKER_TIME_BUDGET_SECONDS,
    240
  );

  const workerRetryDelaySeconds = readPositiveInt(
    process.env.LIFECYCLE_WORKER_RETRY_DELAY_SECONDS,
    3600
  );

  // Must match the database setting app.lifecycle_dormancy_effective_from.
  const dormancyEffectiveFrom = readIsoInstant(
    process.env.LIFECYCLE_DORMANCY_EFFECTIVE_FROM,
    DEFAULT_LIFECYCLE_DORMANCY_EFFECTIVE_FROM
  );

  return {
    completedGraceDays,
    dormantInactivityDays,
    connectedDormantDays,
    dormancyConfirmationDays,
    evaluationBatchSize,
    workerLeaseSeconds,
    workerTimeBudgetMs: workerTimeBudgetSeconds * 1000,
    workerRetryDelayMs: workerRetryDelaySeconds * 1000,
    dormancyEffectiveFrom,
    completedGraceMs: completedGraceDays * DAY_MS,
    dormantInactivityMs: dormantInactivityDays * DAY_MS,
    connectedDormantMs: connectedDormantDays * DAY_MS,
    dormancyConfirmationMs: dormancyConfirmationDays * DAY_MS,
  };
}

/** Adds days to an ISO timestamp. */
export function addDays(isoTimestamp: string, days: number): string {
  return new Date(
    new Date(isoTimestamp).getTime() + days * DAY_MS
  ).toISOString();
}

/** Whole days between two timestamps (floor). */
export function daysBetween(
  fromIso: string | null,
  toDate: Date = new Date()
): number | null {
  if (!fromIso) {
    return null;
  }

  const fromMs = new Date(fromIso).getTime();

  if (Number.isNaN(fromMs)) {
    return null;
  }

  return Math.floor((toDate.getTime() - fromMs) / DAY_MS);
}
