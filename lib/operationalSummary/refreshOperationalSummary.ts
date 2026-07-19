import { deriveChainSummary } from "@/lib/operationalSummary/deriveChainSummary";
import {
  derivePropertySummariesForChain,
} from "@/lib/operationalSummary/derivePropertySummary";
import {
  buildOperationalRefreshDataset,
  loadOperationalRefreshDataset,
  loadOperationalRefreshDatasetForWorker,
} from "@/lib/operationalSummary/loadOperationalRefreshDataset";
import { persistOperationalSummaries } from "@/lib/operationalSummary/persistOperationalSummaries";
import type { OperationalRefreshDataset } from "@/lib/operationalSummary/types";

export type RefreshOperationalSummaryParams = {
  chainId: number;
  dataset?: OperationalRefreshDataset;
  useServiceRolePersist?: boolean;
};

async function persistSummaries(
  supabase: Parameters<typeof persistOperationalSummaries>[0],
  params: {
    chainSummary: ReturnType<typeof deriveChainSummary>;
    propertySummaries: ReturnType<
      typeof derivePropertySummariesForChain
    >;
    useServiceRolePersist?: boolean;
  }
) {
  if (params.useServiceRolePersist) {
    const { error } = await supabase.rpc(
      "upsert_operational_summaries_service",
      {
        p_chain_summary: params.chainSummary,
        p_property_summaries: params.propertySummaries,
      }
    );

    if (error) {
      return {
        ok: false,
        error: error.message,
      };
    }

    return { ok: true, error: null };
  }

  return persistOperationalSummaries(supabase, {
    chainSummary: params.chainSummary,
    propertySummaries: params.propertySummaries,
  });
}

export async function refreshOperationalSummary(
  supabase: Parameters<typeof persistOperationalSummaries>[0],
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

  const normalizedDataset = buildOperationalRefreshDataset({
    chain: dataset.chain,
    properties: dataset.properties,
    chainNodes: dataset.chainNodes,
  });

  const chainSummary = deriveChainSummary(normalizedDataset);

  const propertySummaries = derivePropertySummariesForChain({
    dataset: normalizedDataset,
    chainSummary,
  });

  return persistSummaries(supabase, {
    chainSummary,
    propertySummaries,
    useServiceRolePersist: params.useServiceRolePersist,
  });
}

export async function refreshOperationalSummaryForProperty(
  supabase: Parameters<typeof persistOperationalSummaries>[0],
  propertyId: number,
  chainId: number
): Promise<{ ok: boolean; error: string | null }> {
  return refreshOperationalSummary(supabase, {
    chainId,
  });
}

export async function refreshOperationalSummaryForWorker(
  supabase: Parameters<typeof persistOperationalSummaries>[0],
  chainId: number
): Promise<{ ok: boolean; error: string | null }> {
  const dataset = await loadOperationalRefreshDatasetForWorker(
    supabase,
    chainId
  );

  if (!dataset) {
    return {
      ok: false,
      error: "Could not load worker refresh dataset.",
    };
  }

  return refreshOperationalSummary(supabase, {
    chainId,
    dataset,
    useServiceRolePersist: true,
  });
}
