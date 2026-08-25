import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * After a seller joins a purchase row, connect the host participant's sale hop
 * and relink sale → purchase → prior downstream (e.g. searching placeholder).
 */
export async function establishConnectedHopAfterSellerJoinsPurchase(
  supabase: SupabaseClient,
  purchasePropertyId: number
): Promise<void> {
  const { data, error } = await supabase.rpc(
    "establish_connected_hop",
    {
      p_purchase_property_id: purchasePropertyId,
    }
  );

  if (error) {
    console.error(error);
    return;
  }

  if (data && typeof data === "object" && "ok" in data && !data.ok) {
    console.error("establish_connected_hop failed", data);
  }
}
