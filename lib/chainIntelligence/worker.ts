import { randomUUID } from "crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { CHAIN_INTELLIGENCE_CONFIG } from "@/lib/chainIntelligence/config";
import { refreshOperationalSummaryForWorker } from "@/lib/operationalSummary/refreshOperationalSummary";

export type ChainIntelligenceWorkerBatchResult = {
  workerRunId: string;
  candidateCount: number;
  processedCount: number;
  successCount: number;
  errorCount: number;
  errors: Array<{ chainId: number; error: string }>;
};

export async function runChainIntelligenceWorkerBatch(
  supabase: SupabaseClient
): Promise<ChainIntelligenceWorkerBatchResult> {
  const workerRunId = randomUUID();
  const limit =
    CHAIN_INTELLIGENCE_CONFIG.recalculation.dailyDueListLimit;

  const { data: candidates, error: listError } =
    await supabase.rpc(
      "list_chain_intelligence_refresh_candidates",
      { p_limit: limit }
    );

  if (listError) {
    throw new Error(listError.message);
  }

  const chainIds = (candidates ?? []).map(
    (row: { chain_id: number }) => row.chain_id
  );

  let successCount = 0;
  let errorCount = 0;
  const errors: Array<{ chainId: number; error: string }> =
    [];

  for (const chainId of chainIds) {
    const result = await refreshOperationalSummaryForWorker(
      supabase,
      chainId
    );

    if (result.ok) {
      successCount += 1;
    } else {
      errorCount += 1;
      errors.push({
        chainId,
        error: result.error ?? "unknown_error",
      });
    }
  }

  return {
    workerRunId,
    candidateCount: chainIds.length,
    processedCount: chainIds.length,
    successCount,
    errorCount,
    errors,
  };
}
