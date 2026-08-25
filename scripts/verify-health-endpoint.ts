/**
 * Health endpoint verification — logic, privacy, and static route checks.
 *
 * Usage:
 *   npx tsx scripts/verify-health-endpoint.ts
 */
import { readFileSync } from "fs";
import { join } from "path";

import {
  evaluateHealthStatus,
  getDatabaseProbeNetworkCallCountForTests,
  probeDatabaseReachability,
  resetDatabaseProbeCacheForTests,
  resolveHealthHttpStatus,
} from "../lib/observability/healthCheck";

type Result = { name: string; pass: boolean; detail?: string };
const results: Result[] = [];

function record(name: string, pass: boolean, detail?: string) {
  results.push({ name, pass, detail });
  console.log(pass ? `✓ ${name}` : `✗ ${name}${detail ? `: ${detail}` : ""}`);
}

async function main() {
  const routeSource = readFileSync(
    join(process.cwd(), "app/api/health/route.ts"),
    "utf8"
  );

  record(
    "Health route uses GET only",
    routeSource.includes("export async function GET")
  );
  record(
    "Health route does not mutate data",
    !routeSource.match(/\b(insert|update|delete|upsert|rpc)\b/i)
  );
  record(
    "Health route sets no-store cache control",
    routeSource.includes('"Cache-Control": "no-store"')
  );
  record(
    "Health route supports app-only probe query",
    routeSource.includes('probe !== "app"')
  );
  record(
    "Health route does not expose environment variables",
    !routeSource.includes("process.env") ||
      !routeSource.match(/NextResponse\.json\([\s\S]*process\.env/)
  );
  record(
    "Health route does not expose stack traces",
    !routeSource.includes("stack")
  );

  const healthLibSource = readFileSync(
    join(process.cwd(), "lib/observability/healthCheck.ts"),
    "utf8"
  );

  record(
    "Database probe uses HEAD-style select without row payload",
    healthLibSource.includes('head: true') &&
      healthLibSource.includes('count: "exact"')
  );
  record(
    "Database probe caches probe results separately from app-only responses",
    healthLibSource.includes("DATABASE_PROBE_TTL_MS") &&
      healthLibSource.includes('"skipped"')
  );
  record(
    "Database probe does not use service-role key",
    !healthLibSource.includes("SUPABASE_SERVICE_ROLE_KEY")
  );
  record(
    "Database probe does not expose raw DB errors publicly",
    !healthLibSource.includes("error.message") ||
      healthLibSource.includes("isConnectivityFailure(error.message)")
  );

  resetDatabaseProbeCacheForTests();

  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const previousAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  const missingConfig = await evaluateHealthStatus({
    includeDatabaseProbe: true,
    now: () => new Date("2026-07-22T12:00:00.000Z"),
  });

  record(
    "Full probe with missing Supabase config returns degraded (database failed)",
    missingConfig.status === "degraded" &&
      missingConfig.checks.app === "ok" &&
      missingConfig.checks.database === "failed"
  );
  record(
    "Full probe without Supabase config avoids network call",
    getDatabaseProbeNetworkCallCountForTests() === 0
  );
  record(
    "Missing Supabase config keeps HTTP 200 degraded semantics",
    resolveHealthHttpStatus(missingConfig.status) === 200
  );
  record(
    "Degraded response omits internal error details",
    !JSON.stringify(missingConfig).match(/supabase|service.?role|apikey/i)
  );

  resetDatabaseProbeCacheForTests();

  const appOnlyMissingConfig = await evaluateHealthStatus({
    includeDatabaseProbe: false,
    now: () => new Date("2026-07-22T12:00:00.000Z"),
  });

  record(
    "App-only probe returns database skipped",
    appOnlyMissingConfig.checks.database === "skipped"
  );
  record(
    "App-only probe does not claim database ok",
    appOnlyMissingConfig.checks.database !== "ok"
  );
  record(
    "App-only probe remains healthy when database is not checked",
    appOnlyMissingConfig.status === "healthy" &&
      appOnlyMissingConfig.checks.app === "ok"
  );
  record(
    "App-only probe does not execute database health logic",
    getDatabaseProbeNetworkCallCountForTests() === 0
  );

  if (previousUrl) {
    process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
  }

  if (previousAnon) {
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = previousAnon;
  }

  resetDatabaseProbeCacheForTests();

  if (
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()
  ) {
    const fullProbe = await evaluateHealthStatus({
      includeDatabaseProbe: true,
      now: () => new Date("2026-07-22T12:00:00.000Z"),
    });
    const fullProbeCalls = getDatabaseProbeNetworkCallCountForTests();

    record(
      "Full probe executes database health logic",
      fullProbeCalls === 1 &&
        (fullProbe.checks.database === "ok" ||
          fullProbe.checks.database === "failed")
    );

    const cachedFullProbe = await evaluateHealthStatus({
      includeDatabaseProbe: true,
      now: () => new Date("2026-07-22T12:00:01.000Z"),
    });

    record(
      "Repeated full probes reuse database probe cache within TTL",
      getDatabaseProbeNetworkCallCountForTests() === fullProbeCalls &&
        cachedFullProbe.checks.database === fullProbe.checks.database
    );

    const appOnlyAfterFull = await evaluateHealthStatus({
      includeDatabaseProbe: false,
      now: () => new Date("2026-07-22T12:00:02.000Z"),
    });

    record(
      "App-only probe after full probe does not claim database ok",
      appOnlyAfterFull.checks.database === "skipped"
    );
    record(
      "App-only probe after full probe does not add database network calls",
      getDatabaseProbeNetworkCallCountForTests() === fullProbeCalls
    );
    record(
      "App-only response cannot reuse cached full-health database ok semantics",
      appOnlyAfterFull.checks.database !== fullProbe.checks.database ||
        fullProbe.checks.database === "skipped"
    );
  } else {
    record(
      "Live database probe checks skipped — Supabase env not configured locally",
      true
    );
  }

  resetDatabaseProbeCacheForTests();

  const first = await probeDatabaseReachability();
  const second = await probeDatabaseReachability();

  if (
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()
  ) {
    record(
      "Database probe cache reduces repeated network calls within TTL",
      getDatabaseProbeNetworkCallCountForTests() === 1 &&
        first === second
    );
  }

  record(
    "Unhealthy status maps to HTTP 503",
    resolveHealthHttpStatus("unhealthy") === 503
  );

  const failed = results.filter((entry) => !entry.pass);

  if (failed.length > 0) {
    console.error(`\nHealth endpoint verification FAILED (${failed.length})`);
    process.exit(1);
  }

  console.log("\nHealth endpoint verification PASSED");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
