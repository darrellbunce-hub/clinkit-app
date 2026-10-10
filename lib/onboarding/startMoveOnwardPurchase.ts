import type { SupabaseClient } from "@supabase/supabase-js";

export const LINK_START_MOVE_ONWARD_PURCHASE_RPC =
  "link_start_move_onward_purchase";

export type LinkStartMoveOnwardPurchaseResult =
  | { ok: true; idempotent: boolean }
  | { ok: false; error: string };

type LinkRpcRow = {
  ok?: boolean;
  error?: string;
  idempotent?: boolean;
};

/**
 * Links the Start Move sale to the onward purchase created with it, so the
 * pair forms one chain segment (sale.linked_property_id = purchase.id).
 */
export async function linkStartMoveOnwardPurchase(
  supabase: SupabaseClient,
  params: {
    salePropertyId: number;
    purchasePropertyId: number;
  }
): Promise<LinkStartMoveOnwardPurchaseResult> {
  const { data, error } = await supabase.rpc(
    LINK_START_MOVE_ONWARD_PURCHASE_RPC,
    {
      p_sale_property_id: params.salePropertyId,
      p_purchase_property_id: params.purchasePropertyId,
    }
  );

  if (error) {
    return { ok: false, error: error.message };
  }

  const row = (data ?? {}) as LinkRpcRow;

  if (!row.ok) {
    return { ok: false, error: row.error ?? "link_failed" };
  }

  return { ok: true, idempotent: row.idempotent === true };
}
