import { NextResponse } from "next/server";

import { processOperationalRefreshForChains } from "@/lib/operationalSummary/processOperationalRefresh";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/serviceRole";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RefreshRequestBody = {
  chainId?: number;
};

type CachedIntelligenceState = {
  summary_state?: string;
  next_recalculation_at?: string | null;
} | null;

function isRefreshPending(cached: NonNullable<CachedIntelligenceState>): boolean {
  if (cached.summary_state !== "fresh") {
    return true;
  }

  const nextRecalculationMs = cached.next_recalculation_at
    ? new Date(cached.next_recalculation_at).getTime()
    : Number.NaN;

  return !Number.isNaN(nextRecalculationMs) && nextRecalculationMs <= Date.now();
}

/**
 * Processes one chain's queued, missing or due operational summary for an
 * operational viewer of that chain. Fresh summaries are left alone.
 */
export async function POST(request: Request) {
  let body: RefreshRequestBody;

  try {
    body = (await request.json()) as RefreshRequestBody;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_request" }, { status: 400 });
  }

  const chainId = Number(body.chainId);

  if (!Number.isInteger(chainId) || chainId <= 0) {
    return NextResponse.json({ ok: false, error: "invalid_request" }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const { data: cachedData, error: cachedError } = await supabase.rpc(
    "get_chain_operational_intelligence",
    { p_chain_id: chainId }
  );

  if (cachedError) {
    return NextResponse.json({ ok: false, error: "lookup_failed" }, { status: 500 });
  }

  const cached = cachedData as CachedIntelligenceState;

  if (!cached) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }

  if (!isRefreshPending(cached)) {
    return NextResponse.json({ ok: true, processed: false, state: cached.summary_state });
  }

  try {
    const result = await processOperationalRefreshForChains(
      createServiceRoleSupabaseClient(),
      [chainId]
    );

    return NextResponse.json({
      ok: result.failures.length === 0,
      processed: result.persistedCount > 0,
      state: result.persistedCount > 0 ? "fresh" : cached.summary_state,
    });
  } catch (error) {
    console.error("[operational-intelligence-refresh] failed:", error);
    return NextResponse.json({ ok: false, error: "refresh_failed" }, { status: 500 });
  }
}
