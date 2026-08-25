import type { SupabaseClient } from "@supabase/supabase-js";

import {
  PROPERTY_OPERATIONAL_STATE,
  type PropertyLifecycleStateRow,
  type PropertyOperationalState,
} from "@/lib/lifecycle/types";

export type PropertyLifecycleStateSnapshot = Pick<
  PropertyLifecycleStateRow,
  | "operational_state"
  | "dormancy_warning_at"
  | "dormancy_confirmation_deadline_at"
  | "dormancy_warning_notified_at"
  | "last_still_active_confirmed_at"
>;

export async function loadPropertyLifecycleState(params: {
  supabase: SupabaseClient;
  propertyId: number;
}): Promise<PropertyLifecycleStateSnapshot | null> {
  const { data, error } = await params.supabase
    .from("property_lifecycle_states")
    .select(
      "operational_state, dormancy_warning_at, dormancy_confirmation_deadline_at, dormancy_warning_notified_at, last_still_active_confirmed_at"
    )
    .eq("property_id", params.propertyId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data) {
    return null;
  }

  return data as PropertyLifecycleStateSnapshot;
}

export function resolveEffectiveOperationalState(
  snapshot: PropertyLifecycleStateSnapshot | null
): PropertyOperationalState {
  return snapshot?.operational_state ?? PROPERTY_OPERATIONAL_STATE.active;
}

export async function isActiveOperationalHomeowner(params: {
  supabase: SupabaseClient;
  propertyId: number;
  userId: string;
}): Promise<boolean> {
  const { data, error } = await params.supabase
    .from("property_operational_identities")
    .select("property_id")
    .eq("property_id", params.propertyId)
    .eq("homeowner_user_id", params.userId)
    .eq("status", "active")
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return Boolean(data);
}
