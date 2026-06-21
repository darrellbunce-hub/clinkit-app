import type { SupabaseClient } from "@supabase/supabase-js";

/** Matches start-move buyer_ready defaults. */
const BUYER_READY_DEFAULT_STAGE = "mortgage_preparation";

export type EnsureBuyerReadyOnJoinResult =
  | { ok: true; created: boolean; nodeId?: number }
  | { ok: false; error: unknown };

/**
 * Creates a buyer_ready chain_nodes row when a purchaser joins with nothing to sell.
 * Idempotent: skips insert when a matching node already exists.
 */
export async function ensureBuyerReadyOnJoin(
  supabase: SupabaseClient,
  params: {
    chainId: number;
    purchasePropertyId: number;
    userId: string;
  }
): Promise<EnsureBuyerReadyOnJoinResult> {
  const { data: existingForProperty, error: lookupError } =
    await supabase
      .from("chain_nodes")
      .select("id")
      .eq("chain_id", params.chainId)
      .eq("node_type", "buyer_ready")
      .eq("linked_property_id", params.purchasePropertyId)
      .maybeSingle();

  if (lookupError) {
    return { ok: false, error: lookupError };
  }

  if (existingForProperty) {
    return { ok: true, created: false };
  }

  const { data: existingForUser, error: userLookupError } =
    await supabase
      .from("chain_nodes")
      .select("id")
      .eq("chain_id", params.chainId)
      .eq("node_type", "buyer_ready")
      .eq("user_id", params.userId)
      .maybeSingle();

  if (userLookupError) {
    return { ok: false, error: userLookupError };
  }

  if (existingForUser) {
    return { ok: true, created: false };
  }

  const { data: inserted, error: insertError } =
    await supabase
      .from("chain_nodes")
      .insert({
        chain_id: params.chainId,
        linked_property_id: params.purchasePropertyId,
        node_type: "buyer_ready",
        user_id: params.userId,
        position: 0,
        stage: BUYER_READY_DEFAULT_STAGE,
        status: "healthy",
        progress: 10,
      })
      .select("id")
      .single();

  if (insertError || !inserted) {
    return {
      ok: false,
      error: insertError ?? new Error("buyer_ready insert failed"),
    };
  }

  return {
    ok: true,
    created: true,
    nodeId: inserted.id,
  };
}
