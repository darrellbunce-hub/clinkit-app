import type { SupabaseClient } from "@supabase/supabase-js";

import { deriveChainSummary } from "@/lib/operationalSummary/deriveChainSummary";
import { derivePropertySummariesForChain } from "@/lib/operationalSummary/derivePropertySummary";
import type {
  ChainOperationalSummaryRecord,
  OperationalRefreshDataset,
  PropertyOperationalSummaryRecord,
} from "@/lib/operationalSummary/types";

/** Chains per dataset load / persist round trip. */
export const OPERATIONAL_REFRESH_CHUNK_SIZE = 25;

type LoadedOperationalRefreshDatasets = {
  loadedAt: string;
  datasets: OperationalRefreshDataset[];
};

export type OperationalRefreshFailure = {
  chainId: number;
  error: string;
};

export type ProcessOperationalRefreshResult = {
  requestedCount: number;
  persistedCount: number;
  skippedCount: number;
  failures: OperationalRefreshFailure[];
};

/** Service-role, set-based dataset load (load_operational_refresh_datasets). */
export async function loadOperationalRefreshDatasets(
  supabase: SupabaseClient,
  chainIds: number[]
): Promise<LoadedOperationalRefreshDatasets> {
  const { data, error } = await supabase.rpc(
    "load_operational_refresh_datasets",
    { p_chain_ids: chainIds }
  );

  if (error) {
    throw new Error(error.message);
  }

  const payload = (data ?? {}) as {
    loaded_at?: string;
    chains?: OperationalRefreshDataset[];
  };

  if (!payload.loaded_at) {
    throw new Error("load_operational_refresh_datasets returned no snapshot time");
  }

  return {
    loadedAt: payload.loaded_at,
    datasets: payload.chains ?? [],
  };
}

export function deriveOperationalSummaries(
  dataset: OperationalRefreshDataset,
  referenceDate: Date = new Date()
): {
  chainSummary: ChainOperationalSummaryRecord;
  propertySummaries: PropertyOperationalSummaryRecord[];
} {
  const chainSummary = deriveChainSummary(dataset, referenceDate);

  return {
    chainSummary,
    propertySummaries: derivePropertySummariesForChain({
      dataset,
      chainSummary,
      referenceDate,
    }),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function recordFailure(
  supabase: SupabaseClient,
  chainId: number,
  message: string
): Promise<void> {
  await supabase.rpc("record_chain_operational_refresh_failure", {
    p_chain_id: chainId,
    p_error: message,
  });
}

/**
 * Calculate and cache operational intelligence for the given chains with a
 * service-role client: one dataset load and one persist call per chunk.
 */
export async function processOperationalRefreshForChains(
  supabase: SupabaseClient,
  chainIds: number[],
  options?: { chunkSize?: number; referenceDate?: Date }
): Promise<ProcessOperationalRefreshResult> {
  const uniqueChainIds = [...new Set(chainIds)].filter(
    (chainId) => Number.isFinite(chainId) && chainId > 0
  );
  const chunkSize = Math.max(
    1,
    options?.chunkSize ?? OPERATIONAL_REFRESH_CHUNK_SIZE
  );

  const result: ProcessOperationalRefreshResult = {
    requestedCount: uniqueChainIds.length,
    persistedCount: 0,
    skippedCount: 0,
    failures: [],
  };

  for (let start = 0; start < uniqueChainIds.length; start += chunkSize) {
    const chunk = uniqueChainIds.slice(start, start + chunkSize);
    let loaded: LoadedOperationalRefreshDatasets;

    try {
      loaded = await loadOperationalRefreshDatasets(supabase, chunk);
    } catch (error) {
      const message = errorMessage(error);
      for (const chainId of chunk) {
        result.failures.push({ chainId, error: message });
        await recordFailure(supabase, chainId, message);
      }
      continue;
    }

    const referenceDate = options?.referenceDate ?? new Date();
    const items: Array<{
      chain_summary: ChainOperationalSummaryRecord;
      property_summaries: PropertyOperationalSummaryRecord[];
    }> = [];

    for (const dataset of loaded.datasets) {
      try {
        const derived = deriveOperationalSummaries(dataset, referenceDate);
        items.push({
          chain_summary: derived.chainSummary,
          property_summaries: derived.propertySummaries,
        });
      } catch (error) {
        const message = errorMessage(error);
        result.failures.push({ chainId: dataset.chain.id, error: message });
        await recordFailure(supabase, dataset.chain.id, message);
      }
    }

    result.skippedCount += chunk.length - loaded.datasets.length;

    if (items.length === 0) {
      continue;
    }

    const { data, error } = await supabase.rpc(
      "persist_chain_operational_refreshes",
      { p_items: items, p_snapshot_at: loaded.loadedAt }
    );

    if (error) {
      for (const item of items) {
        result.failures.push({
          chainId: item.chain_summary.chain_id,
          error: error.message,
        });
        await recordFailure(supabase, item.chain_summary.chain_id, error.message);
      }
      continue;
    }

    const persisted = (data ?? {}) as {
      persisted?: number;
      failures?: Array<{ chain_id: number; error: string }>;
    };

    result.persistedCount += persisted.persisted ?? 0;

    for (const failure of persisted.failures ?? []) {
      result.failures.push({
        chainId: Number(failure.chain_id),
        error: failure.error,
      });
    }
  }

  return result;
}
