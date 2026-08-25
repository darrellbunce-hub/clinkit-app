import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  ChainOperationalSummaryRecord,
  PropertyOperationalSummaryRecord,
} from "@/lib/operationalSummary/types";

export async function persistOperationalSummaries(
  supabase: SupabaseClient,
  params: {
    chainSummary: ChainOperationalSummaryRecord;
    propertySummaries: PropertyOperationalSummaryRecord[];
  }
): Promise<{ ok: boolean; error: string | null }> {
  const { error } = await supabase.rpc(
    "upsert_operational_summaries",
    {
      p_chain_summary: params.chainSummary,
      p_property_summaries:
        params.propertySummaries,
    }
  );

  if (error) {
    return {
      ok: false,
      error: error.message,
    };
  }

  return {
    ok: true,
    error: null,
  };
}
