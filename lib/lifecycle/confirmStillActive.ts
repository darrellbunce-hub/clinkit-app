import type { SupabaseClient } from "@supabase/supabase-js";

import { STILL_ACTIVE_CONFIRMATION_CODE } from "@/lib/lifecycle/types";

type ConfirmStillActiveResult =
  | { ok: true; propertyId: number; operationalState: string }
  | { ok: false; error: string };

/**
 * Structured "My transaction is still active" confirmation.
 * Resets connected dormancy clock and counts as meaningful operational activity.
 */
export async function confirmTransactionStillActive(params: {
  supabase: SupabaseClient;
  propertyId: number;
}): Promise<ConfirmStillActiveResult> {
  const { data, error } = await params.supabase.rpc(
    "confirm_transaction_still_active",
    { p_property_id: params.propertyId }
  );

  if (error) {
    return { ok: false, error: error.message };
  }

  const payload = data as {
    ok?: boolean;
    error?: string;
    property_id?: number;
    operational_state?: string;
  } | null;

  if (!payload?.ok) {
    return { ok: false, error: payload?.error ?? "confirmation_failed" };
  }

  return {
    ok: true,
    propertyId: payload.property_id ?? params.propertyId,
    operationalState: payload.operational_state ?? "active",
  };
}

export { STILL_ACTIVE_CONFIRMATION_CODE };
