import type { LifecycleConfig } from "@/lib/lifecycle/types";

const DAY_MS = 86_400_000;

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

  const meaningfulActivityDays = readPositiveInt(
    process.env.LIFECYCLE_MEANINGFUL_ACTIVITY_DAYS,
    14
  );

  const evaluationBatchSize = readPositiveInt(
    process.env.LIFECYCLE_EVALUATION_BATCH_SIZE,
    100
  );

  return {
    completedGraceDays,
    dormantInactivityDays,
    meaningfulActivityDays,
    evaluationBatchSize,
    completedGraceMs: completedGraceDays * DAY_MS,
    dormantInactivityMs: dormantInactivityDays * DAY_MS,
    meaningfulActivityMs: meaningfulActivityDays * DAY_MS,
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
