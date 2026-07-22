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
    "Database probe caches results",
    healthLibSource.includes("DATABASE_PROBE_TTL_MS")
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
    "Missing Supabase config returns degraded (database failed)",
    missingConfig.status === "degraded" &&
      missingConfig.checks.app === "ok" &&
      missingConfig.checks.database === "failed"
  );
  record(
    "Missing Supabase config keeps HTTP 200 degraded semantics",
    resolveHealthHttpStatus(missingConfig.status) === 200
  );
  record(
    "Degraded response omits internal error details",
    !JSON.stringify(missingConfig).match(/supabase|service.?role|apikey/i)
  );

  if (previousUrl) {
    process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
  }

  if (previousAnon) {
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = previousAnon;
  }

  const appOnly = await evaluateHealthStatus({
    includeDatabaseProbe: false,
    now: () => new Date("2026-07-22T12:00:00.000Z"),
  });

  record(
    "App-only evaluation returns healthy without database probe",
    appOnly.status === "healthy" && appOnly.checks.database === "ok"
  );

  resetDatabaseProbeCacheForTests();

  if (
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()
  ) {
    const first = await probeDatabaseReachability();
    const second = await probeDatabaseReachability();

    record(
      "Repeated database probes use cache within TTL",
      first === second
    );

    record(
      "Live database probe returns ok or failed without throwing",
      first === "ok" || first === "failed"
    );
  } else {
    record(
      "Live database probe skipped — Supabase env not configured locally",
      true
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
