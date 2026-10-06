export type OperationalSummaryRefreshRequestResult = {
  ok: boolean;
  processed: boolean;
  state: string | null;
};

const NOT_REQUESTED: OperationalSummaryRefreshRequestResult = {
  ok: false,
  processed: false,
  state: null,
};

/**
 * Asks the server to process this chain's queued or missing operational
 * summary now instead of waiting for the worker. Best effort: operational
 * writes already queue the chain, so a failure here never blocks a flow.
 */
export async function requestOperationalSummaryRefresh(
  chainId: number | null | undefined
): Promise<OperationalSummaryRefreshRequestResult> {
  if (
    typeof window === "undefined" ||
    !chainId ||
    !Number.isFinite(chainId)
  ) {
    return NOT_REQUESTED;
  }

  try {
    const response = await fetch("/api/operational-intelligence/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ chainId }),
    });

    const payload = (await response.json().catch(() => null)) as {
      ok?: boolean;
      processed?: boolean;
      state?: string;
    } | null;

    return {
      ok: response.ok && payload?.ok === true,
      processed: payload?.processed === true,
      state: payload?.state ?? null,
    };
  } catch {
    return NOT_REQUESTED;
  }
}
