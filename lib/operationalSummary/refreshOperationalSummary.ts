import type { SupabaseClient } from "@supabase/supabase-js";

import { processOperationalRefreshForChains } from "@/lib/operationalSummary/processOperationalRefresh";
import type { RefreshOperationalSummaryResult } from "@/lib/operationalSummary/refreshOperationalSummaryResult";

export type { RefreshOperationalSummaryResult } from "@/lib/operationalSummary/refreshOperationalSummaryResult";

/** Service-role calculation and caching of one chain's operational summary. */
export async function refreshOperationalSummaryForWorker(
  supabase: SupabaseClient,
  chainId: number,
  options?: { referenceDate?: Date }
): Promise<RefreshOperationalSummaryResult> {
  try {
    const result = await processOperationalRefreshForChains(
      supabase,
      [chainId],
      { referenceDate: options?.referenceDate }
    );

    if (result.failures.length > 0) {
      return {
        ok: false,
        error: result.failures[0].error,
        step: "persist",
      };
    }

    if (result.persistedCount === 0) {
      return { ok: false, error: "Chain not found.", step: "load" };
    }

    return { ok: true, error: null };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      step: "load",
    };
  }
}
