import type { SupabaseClient } from "@supabase/supabase-js";

import { createSearchingPlaceholderForSale } from "@/lib/searchingPlaceholder";
import { refreshOperationalSummary } from "@/lib/operationalSummary/refreshOperationalSummary";

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
  if (params.endOfChain) {
    if (params.refreshSummaries) {
      const refreshResult =
        await refreshOperationalSummary(supabase, {
          chainId: params.chainId,
        });

      if (!refreshResult.ok) {
        return {
          ok: false,
          error:
            refreshResult.error ??
            "summary_refresh_failed",
        };
      }
    }

    return { ok: true };
  }

  const attachResult =
    await createSearchingPlaceholderForSale(supabase, {
      salePropertyId: params.salePropertyId,
    });

  if (!attachResult.ok) {
    return attachResult;
  }

  if (params.refreshSummaries) {
    const refreshResult =
      await refreshOperationalSummary(supabase, {
        chainId: params.chainId,
      });

    if (!refreshResult.ok) {
      return {
        ok: false,
        error:
          refreshResult.error ??
          "summary_refresh_failed",
      };
    }
  }

  return { ok: true };
}
