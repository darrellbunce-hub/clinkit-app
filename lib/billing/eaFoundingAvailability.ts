import "server-only";

import { unstable_cache } from "next/cache";

import {
  EA_FOUNDING_PUBLIC_AVAILABILITY_TTL_SECONDS,
  EA_FOUNDING_RESERVATION_SECONDS,
  mapFoundingAvailabilityPayload,
  type EaFoundingAvailability,
} from "@/lib/billing/eaFoundingAvailabilityShared";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/serviceRole";

export {
  describeFoundingPublicDisplay,
  EA_FOUNDING_PUBLIC_AVAILABILITY_TTL_SECONDS,
  EA_FOUNDING_RESERVATION_SECONDS,
  type EaFoundingAvailability,
  type EaFoundingPublicDisplay,
} from "@/lib/billing/eaFoundingAvailabilityShared";

/**
 * Live authoritative founding availability (bypasses public cache).
 * Prefer reserve_ea_founding_slot for Checkout pricing decisions.
 */
export async function getEaFoundingAvailabilityLive(): Promise<EaFoundingAvailability> {
  const admin = createServiceRoleSupabaseClient();
  const { data, error } = await admin.rpc("get_ea_founding_availability");
  if (error || !data || data.ok !== true) {
    throw new Error(
      error?.message ?? "founding_availability_unavailable"
    );
  }
  return mapFoundingAvailabilityPayload(data as Record<string, unknown>);
}

/**
 * Cached public display helper. MUST NOT be used to select Stripe prices.
 */
export const getEaFoundingAvailabilityPublicCached = unstable_cache(
  async (): Promise<EaFoundingAvailability> => getEaFoundingAvailabilityLive(),
  ["ea-founding-availability-public"],
  { revalidate: EA_FOUNDING_PUBLIC_AVAILABILITY_TTL_SECONDS }
);
