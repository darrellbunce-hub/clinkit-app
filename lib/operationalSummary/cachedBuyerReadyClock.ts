import type { SupabaseClient } from "@supabase/supabase-js";

import { wholeDaysSinceTimestamp } from "@/lib/activityIntelligence";

/**
 * Cached Buyer Ready node clock from chain_operational_summary (read under its
 * operational-viewer RLS). buyer_ready_activity_clock_at is the latest genuine
 * node activity, else the node's stage entry, else its creation; it is a
 * staleness clock, never a Last updated time.
 */
export type CachedBuyerReadyClock = {
  chain_id: number;
  buyer_ready_node_id: number | null;
  buyer_ready_activity_clock_at: string | null;
  buyer_ready_activity_clock_source: string | null;
  computed_at: string;
};

const CACHED_BUYER_READY_CLOCK_COLUMNS =
  "chain_id, buyer_ready_node_id, buyer_ready_activity_clock_at, buyer_ready_activity_clock_source, computed_at";

export async function loadCachedBuyerReadyClock(
  supabase: SupabaseClient,
  chainId: number
): Promise<CachedBuyerReadyClock | null> {
  const { data, error } = await supabase
    .from("chain_operational_summary")
    .select(CACHED_BUYER_READY_CLOCK_COLUMNS)
    .eq("chain_id", chainId)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return data as CachedBuyerReadyClock;
}

/** The cached clock only when it was computed for this Buyer Ready node. */
export function cachedBuyerReadyClockForNode(
  clock: CachedBuyerReadyClock | null | undefined,
  nodeId: number | null | undefined
): CachedBuyerReadyClock | null {
  if (
    !clock ||
    nodeId == null ||
    clock.buyer_ready_node_id == null ||
    Number(clock.buyer_ready_node_id) !== Number(nodeId)
  ) {
    return null;
  }

  return clock;
}

/** Whole days on the cached Buyer Ready clock; null when no clock is cached. */
export function cachedBuyerReadyClockDays(
  clock: CachedBuyerReadyClock | null | undefined,
  referenceDate: Date = new Date()
): number | null {
  return wholeDaysSinceTimestamp(
    clock?.buyer_ready_activity_clock_at ?? null,
    referenceDate
  );
}
