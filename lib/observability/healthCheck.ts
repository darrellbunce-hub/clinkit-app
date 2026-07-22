import { createClient } from "@supabase/supabase-js";

export type HealthStatus = "healthy" | "degraded" | "unhealthy";

export type HealthCheck = "app" | "database";

export type HealthCheckResult = {
  status: HealthStatus;
  checks: Record<HealthCheck, "ok" | "failed">;
  timestamp: string;
};

export type HealthCheckOptions = {
  includeDatabaseProbe?: boolean;
  now?: () => Date;
};

type CachedDatabaseProbe = {
  result: "ok" | "failed";
  expiresAt: number;
};

const DATABASE_PROBE_TTL_MS = 45_000;

let cachedDatabaseProbe: CachedDatabaseProbe | null = null;

function resolveTimestamp(now?: () => Date): string {
  return (now ?? (() => new Date()))().toISOString();
}

function isConnectivityFailure(message: string): boolean {
  const normalised = message.toLowerCase();

  return (
    normalised.includes("fetch failed") ||
    normalised.includes("network") ||
    normalised.includes("failed to fetch") ||
    normalised.includes("econnrefused") ||
    normalised.includes("enotfound") ||
    normalised.includes("timeout") ||
    normalised.includes("timed out") ||
    normalised.includes("invalid api key") ||
    normalised.includes("jwt") ||
    normalised.includes("apikey")
  );
}

export async function probeDatabaseReachability(): Promise<"ok" | "failed"> {
  const nowMs = Date.now();

  if (
    cachedDatabaseProbe &&
    cachedDatabaseProbe.expiresAt > nowMs
  ) {
    return cachedDatabaseProbe.result;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

  if (!url || !anonKey) {
    cachedDatabaseProbe = {
      result: "failed",
      expiresAt: nowMs + DATABASE_PROBE_TTL_MS,
    };
    return "failed";
  }

  const supabase = createClient(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    global: {
      headers: {
        "x-keynetic-health-probe": "1",
      },
    },
  });

  let result: "ok" | "failed" = "failed";

  try {
    const { error } = await supabase
      .from("chains")
      .select("id", { head: true, count: "exact" })
      .limit(0);

    if (!error) {
      result = "ok";
    } else if (isConnectivityFailure(error.message)) {
      result = "failed";
    } else {
      // Permission/RLS/empty responses still prove API + database reachability.
      result = "ok";
    }
  } catch {
    result = "failed";
  }

  cachedDatabaseProbe = {
    result,
    expiresAt: nowMs + DATABASE_PROBE_TTL_MS,
  };

  return result;
}

export function resetDatabaseProbeCacheForTests(): void {
  cachedDatabaseProbe = null;
}

export async function evaluateHealthStatus(
  options: HealthCheckOptions = {}
): Promise<HealthCheckResult> {
  const includeDatabaseProbe = options.includeDatabaseProbe ?? true;
  const checks: Record<HealthCheck, "ok" | "failed"> = {
    app: "ok",
    database: "ok",
  };

  if (includeDatabaseProbe) {
    checks.database = await probeDatabaseReachability();
  }

  let status: HealthStatus = "healthy";

  if (checks.app === "failed") {
    status = "unhealthy";
  } else if (checks.database === "failed") {
    status = "degraded";
  }

  return {
    status,
    checks,
    timestamp: resolveTimestamp(options.now),
  };
}

export function resolveHealthHttpStatus(status: HealthStatus): number {
  if (status === "unhealthy") {
    return 503;
  }

  return 200;
}
