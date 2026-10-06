import type { SupabaseClient } from "@supabase/supabase-js";

import { createSearchingPlaceholderForSale } from "@/lib/searchingPlaceholder";
import { requestOperationalSummaryRefresh } from "@/lib/operationalSummary/requestOperationalSummaryRefresh";

export type FinalizeOperationalSaleCreationParams = {
  chainId: number;
  salePropertyId: number;
  userId: string;
  /** When true, skip onward placeholder (end of chain / no onward purchase). */
  endOfChain: boolean;
  refreshSummaries?: boolean;
};

export async function finalizeOperationalSaleCreation(
  supabase: SupabaseClient,
  params: FinalizeOperationalSaleCreationParams
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!params.endOfChain) {
    const attachResult =
      await createSearchingPlaceholderForSale(supabase, {
        salePropertyId: params.salePropertyId,
      });

    if (!attachResult.ok) {
      return attachResult;
    }
  }

  if (params.refreshSummaries) {
    // The property insert already queued the chain; this only speeds it up.
    await requestOperationalSummaryRefresh(params.chainId);
  }

  return { ok: true };
}
