import { randomUUID } from "crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { CHAIN_INTELLIGENCE_CONFIG } from "@/lib/chainIntelligence/config";
import { processOperationalRefreshForChains } from "@/lib/operationalSummary/processOperationalRefresh";

export type ChainIntelligenceWorkerBatchResult = {
  workerRunId: string;
  candidateCount: number;
  processedCount: number;
  successCount: number;
  errorCount: number;
  errors: Array<{ chainId: number; error: string }>;
  candidatesByReason: Record<string, number>;
  purgedQueueRows: number;
  batches: number;
  durationMs: number;
};

type WorkRow = { chain_id: number; reason: string; priority: number };

export type ChainIntelligenceWorkerOptions = {
  /** Chains per work-list fetch. */
  batchLimit?: number;
  /** Maximum work-list fetches in one run. */
  maxBatches?: number;
  /** Stop fetching new batches after this long. */
  timeBudgetMs?: number;
  referenceDate?: Date;
};

function reasonKey(reason: string): string {
  return reason.split(":")[0] || reason;
}

/**
 * Processes missing, queued and time-due chain summaries in priority order
 * (list_chain_operational_refresh_work) until no work remains, the batch cap
 * is reached or the time budget is spent.
 */
export async function runChainIntelligenceWorkerBatch(
  supabase: SupabaseClient,
  options?: ChainIntelligenceWorkerOptions
): Promise<ChainIntelligenceWorkerBatchResult> {
  const startedAt = Date.now();
  const workerRunId = randomUUID();
  const batchLimit =
    options?.batchLimit ??
    CHAIN_INTELLIGENCE_CONFIG.recalculation.dailyDueListLimit;
  const maxBatches = Math.max(1, options?.maxBatches ?? 1);
  const timeBudgetMs = options?.timeBudgetMs ?? Number.POSITIVE_INFINITY;

  const { data: purged, error: purgeError } = await supabase.rpc(
    "purge_chain_operational_refresh_queue"
  );

  if (purgeError) {
    throw new Error(purgeError.message);
  }

  const candidatesByReason: Record<string, number> = {};
  const errors: Array<{ chainId: number; error: string }> = [];
  const seen = new Set<number>();
  let candidateCount = 0;
  let successCount = 0;
  let batches = 0;

  while (
    batches < maxBatches &&
    Date.now() - startedAt < timeBudgetMs
  ) {
    const { data: work, error: listError } = await supabase.rpc(
      "list_chain_operational_refresh_work",
      { p_limit: batchLimit }
    );

    if (listError) {
      throw new Error(listError.message);
    }

    const rows = ((work ?? []) as WorkRow[]).filter(
      (row) => !seen.has(row.chain_id)
    );

    if (rows.length === 0) {
      break;
    }

    batches += 1;

    for (const row of rows) {
      seen.add(row.chain_id);
      const key = reasonKey(row.reason);
      candidatesByReason[key] = (candidatesByReason[key] ?? 0) + 1;
    }

    candidateCount += rows.length;

    const result = await processOperationalRefreshForChains(
      supabase,
      rows.map((row) => row.chain_id),
      { referenceDate: options?.referenceDate }
    );

    successCount += result.persistedCount;
    errors.push(...result.failures);

    if (rows.length < batchLimit) {
      break;
    }
  }

  return {
    workerRunId,
    candidateCount,
    processedCount: candidateCount,
    successCount,
    errorCount: errors.length,
    errors,
    candidatesByReason,
    purgedQueueRows: Number(purged ?? 0),
    batches,
    durationMs: Date.now() - startedAt,
  };
}
