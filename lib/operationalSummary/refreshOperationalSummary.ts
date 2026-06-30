import type { SupabaseClient } from "@supabase/supabase-js";

import { deriveChainSummary } from "@/lib/operationalSummary/deriveChainSummary";
import {
  derivePropertySummariesForChain,
} from "@/lib/operationalSummary/derivePropertySummary";
import {
  buildOperationalRefreshDataset,
  loadOperationalRefreshDataset,
} from "@/lib/operationalSummary/loadOperationalRefreshDataset";
import { persistOperationalSummaries } from "@/lib/operationalSummary/persistOperationalSummaries";
import type { OperationalRefreshDataset } from "@/lib/operationalSummary/types";

export type RefreshOperationalSummaryParams = {
  chainId: number;
  dataset?: OperationalRefreshDataset;
};

export async function refreshOperationalSummary(
  supabase: SupabaseClient,
  params: RefreshOperationalSummaryParams
): Promise<{ ok: boolean; error: string | null }> {
  const dataset =
    params.dataset ??
    (await loadOperationalRefreshDataset(
      supabase,
      params.chainId
    ));

  if (!dataset) {
    return {
      ok: false,
      error: "Could not load operational refresh dataset.",
    };
  }

  const normalizedDataset =
    buildOperationalRefreshDataset({
      chain: dataset.chain,
      properties: dataset.properties,
      chainNodes: dataset.chainNodes,
    });

  const chainSummary = deriveChainSummary(
    normalizedDataset
  );

  const propertySummaries =
    derivePropertySummariesForChain({
      dataset: normalizedDataset,
      chainSummary,
    });

  return persistOperationalSummaries(supabase, {
    chainSummary,
    propertySummaries,
  });
}

export async function refreshOperationalSummaryForProperty(
  supabase: SupabaseClient,
  propertyId: number,
  chainId: number
): Promise<{ ok: boolean; error: string | null }> {
  return refreshOperationalSummary(supabase, {
    chainId,
  });
}
