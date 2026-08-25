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
import type { RefreshOperationalSummaryResult } from "@/lib/operationalSummary/refreshOperationalSummaryResult";

export type { RefreshOperationalSummaryResult } from "@/lib/operationalSummary/refreshOperationalSummaryResult";

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
): Promise<RefreshOperationalSummaryResult> {
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
        errorCode: error.code ?? null,
        step: "persist",
      };
    }

    return { ok: true, error: null };
  }

  const persistResult = await persistOperationalSummaries(supabase, {
    chainSummary: params.chainSummary,
    propertySummaries: params.propertySummaries,
  });

  if (!persistResult.ok) {
    return {
      ok: false,
      error: persistResult.error,
      step: "persist",
    };
  }

  return { ok: true, error: null };
}

export async function refreshOperationalSummary(
  supabase: Parameters<typeof persistOperationalSummaries>[0],
  params: RefreshOperationalSummaryParams
): Promise<RefreshOperationalSummaryResult> {
  const loadResult = params.dataset
    ? { ok: true as const, dataset: params.dataset }
    : await loadOperationalRefreshDataset(
        supabase,
        params.chainId
      );

  if (!loadResult.ok) {
    return {
      ok: false,
      error: loadResult.message,
      errorCode: loadResult.code,
      step: loadResult.step,
    };
  }

  const normalizedDataset = buildOperationalRefreshDataset({
    chain: loadResult.dataset.chain,
    properties: loadResult.dataset.properties,
    chainNodes: loadResult.dataset.chainNodes,
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
): Promise<RefreshOperationalSummaryResult> {
  return refreshOperationalSummary(supabase, {
    chainId,
  });
}

export async function refreshOperationalSummaryForWorker(
  supabase: Parameters<typeof persistOperationalSummaries>[0],
  chainId: number
): Promise<RefreshOperationalSummaryResult> {
  const dataset = await loadOperationalRefreshDatasetForWorker(
    supabase,
    chainId
  );

  if (!dataset) {
    return {
      ok: false,
      error: "Could not load worker refresh dataset.",
      step: "chains",
    };
  }

  return refreshOperationalSummary(supabase, {
    chainId,
    dataset,
    useServiceRolePersist: true,
  });
}
