import type { SupabaseClient } from "@supabase/supabase-js";

import {
  getLatestActivity,
  wholeDaysSinceTimestamp,
  type OperationalActivity,
} from "@/lib/activityIntelligence";

/**
 * Cached property activity clock from property_operational_summary (read
 * under its operational-viewer RLS). activity_clock_at is the latest genuine
 * activity, else the fallback clock; last_update_at is genuine activity only.
 */
export type CachedPropertyClock = {
  property_id: number;
  chain_id: number;
  activity_clock_at: string | null;
  last_update_at: string | null;
  computed_at: string;
};

const CACHED_PROPERTY_CLOCK_COLUMNS =
  "property_id, chain_id, activity_clock_at, last_update_at, computed_at";

export async function loadCachedPropertyClock(
  supabase: SupabaseClient,
  propertyId: number
): Promise<CachedPropertyClock | null> {
  const { data, error } = await supabase
    .from("property_operational_summary")
    .select(CACHED_PROPERTY_CLOCK_COLUMNS)
    .eq("property_id", propertyId)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return data as CachedPropertyClock;
}

/** Whole days on the cached staleness clock; null when no clock is cached. */
export function cachedPropertyClockDays(
  clock: CachedPropertyClock | null | undefined,
  referenceDate: Date = new Date()
): number | null {
  return wholeDaysSinceTimestamp(
    clock?.activity_clock_at ?? null,
    referenceDate
  );
}

/**
 * True when the cache is absent or older than the newest loaded activity,
 * i.e. the chain may still be queued for recalculation.
 */
export function isCachedPropertyClockBehind(
  clock: Pick<CachedPropertyClock, "computed_at"> | null,
  activities: OperationalActivity[] | null | undefined
): boolean {
  if (!clock) {
    return true;
  }

  const latestActivityMs = new Date(
    getLatestActivity(activities)?.timestamp ?? Number.NaN
  ).getTime();
  const computedAtMs = new Date(clock.computed_at).getTime();

  return (
    !Number.isNaN(latestActivityMs) &&
    !Number.isNaN(computedAtMs) &&
    latestActivityMs > computedAtMs
  );
}
