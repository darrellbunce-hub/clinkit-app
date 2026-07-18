import type { SupabaseClient } from "@supabase/supabase-js";

import type { ErasureImpactReport } from "@/lib/gdpr/types";

/**
 * Invokes the read-only GDPR erasure impact report RPC.
 * Requires service-role Supabase client.
 */
export async function generateErasureImpactReport(params: {
  supabase: SupabaseClient;
  userId: string;
}): Promise<ErasureImpactReport> {
  const { data, error } = await params.supabase.rpc(
    "generate_erasure_impact_report",
    { p_user_id: params.userId }
  );

  if (error) {
    throw new Error(error.message);
  }

  return data as ErasureImpactReport;
}
