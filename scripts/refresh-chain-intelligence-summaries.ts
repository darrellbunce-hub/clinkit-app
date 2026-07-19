/// <reference types="node" />
/**
 * Development-only bulk refresh of chain_operational_summary (and property summaries)
 * under timing_v1 / critical_path_v1.
 *
 * Usage:
 *   npx tsx scripts/refresh-chain-intelligence-summaries.ts              # preflight only
 *   npx tsx scripts/refresh-chain-intelligence-summaries.ts --execute    # run refresh
 *   npx tsx scripts/refresh-chain-intelligence-summaries.ts --execute --limit 10
 *
 * Does not expose secrets or PII — reports counts only.
 */
import { readFileSync } from "fs";
import { join } from "path";

import { CHAIN_INTELLIGENCE_CONFIG } from "../lib/chainIntelligence/config";
import { refreshOperationalSummaryForWorker } from "../lib/operationalSummary/refreshOperationalSummary";
import { createServiceRoleSupabaseClient } from "../lib/supabase/serviceRole";

/** Authoritative Development Supabase project ref (see docs/PRODUCTION_READINESS_CHECKLIST.md). */
const DEVELOPMENT_SUPABASE_PROJECT_REF = "bbbsxzxcjkmpqsfvmhbo";

const EXPECTED_CONFIDENCE_ALGORITHM_VERSION =
  CHAIN_INTELLIGENCE_CONFIG.confidenceAlgorithmVersion;
const EXPECTED_ETA_ALGORITHM_VERSION =
  CHAIN_INTELLIGENCE_CONFIG.etaAlgorithmVersion;

const PLACEHOLDER_SERVICE_ROLE_KEYS = new Set([
  "your-service-role-key",
  "your_service_role_key",
  "your-service_role_key",
]);

type PreflightReport = {
  environmentLoaded: boolean;
  supabaseTarget: string;
  serviceRoleKeyPresent: boolean;
  targetConfirmedAsDevelopment: boolean;
};

type SummarySnapshot = {
  totalSummaries: number;
  activeChainSummaries: number;
  completedChainSummaries: number;
  needsRefreshCount: number;
  bandCounts: Record<string, number>;
  confidenceAlgorithmVersions: Record<string, number>;
  etaAlgorithmVersions: Record<string, number>;
  unavailableCount: number;
};

function loadEnvLocal(): boolean {
  const envPath = join(process.cwd(), ".env.local");

  try {
    for (const line of readFileSync(envPath, "utf8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const separatorIndex = trimmed.indexOf("=");
      if (separatorIndex <= 0) continue;
      const key = trimmed.slice(0, separatorIndex).trim();
      let value = trimmed.slice(separatorIndex + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
    return true;
  } catch {
    return false;
  }
}

function resolveServiceRoleKey(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  let value = raw.trim();
  if (PLACEHOLDER_SERVICE_ROLE_KEYS.has(value.toLowerCase())) return undefined;
  const embeddedKey = value.match(/^your[_-]?service[_-]?role[_-]?key=(.+)$/i);
  if (embeddedKey) value = embeddedKey[1].trim();
  if (!value || PLACEHOLDER_SERVICE_ROLE_KEYS.has(value.toLowerCase())) {
    return undefined;
  }
  return value;
}

function extractSupabaseProjectRef(supabaseUrl: string): string | null {
  try {
    const hostname = new URL(supabaseUrl).hostname;
    const match = hostname.match(/^([a-z0-9]+)\.supabase\.co$/i);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

function sanitizeSupabaseTarget(supabaseUrl: string | undefined): string {
  const projectRef = supabaseUrl ? extractSupabaseProjectRef(supabaseUrl) : null;
  return projectRef ?? "unknown";
}

function buildPreflightReport(environmentLoaded: boolean): PreflightReport {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceRoleKey = resolveServiceRoleKey(
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
  const projectRef = url ? extractSupabaseProjectRef(url) : null;
  const targetConfirmedAsDevelopment =
    projectRef === DEVELOPMENT_SUPABASE_PROJECT_REF &&
    process.env.VERCEL_ENV !== "production";

  return {
    environmentLoaded,
    supabaseTarget: sanitizeSupabaseTarget(url),
    serviceRoleKeyPresent: Boolean(serviceRoleKey),
    targetConfirmedAsDevelopment,
  };
}

function printPreflightReport(report: PreflightReport): void {
  console.log(
    "Chain Intelligence summary refresh preflight (Development only):"
  );
  console.log(`  environment loaded: ${report.environmentLoaded ? "yes" : "no"}`);
  console.log(`  supabase target: ${report.supabaseTarget}`);
  console.log(
    `  service role key present: ${report.serviceRoleKeyPresent ? "yes" : "no"}`
  );
  console.log(
    `  target confirmed as Development: ${
      report.targetConfirmedAsDevelopment ? "yes" : "no"
    }`
  );
}

function assertPreflightReady(report: PreflightReport): void {
  if (!report.environmentLoaded) {
    throw new Error(
      "Refusing to run: .env.local could not be loaded from the project root."
    );
  }

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()) {
    throw new Error(
      "Refusing to run: NEXT_PUBLIC_SUPABASE_URL is missing from .env.local."
    );
  }

  if (!report.serviceRoleKeyPresent) {
    throw new Error(
      "Refusing to run: SUPABASE_SERVICE_ROLE_KEY is missing or placeholder in .env.local."
    );
  }

  if (!report.targetConfirmedAsDevelopment) {
    throw new Error(
      `Refusing to run: Supabase project "${report.supabaseTarget}" is not Development (` +
        `${DEVELOPMENT_SUPABASE_PROJECT_REF}).`
    );
  }

  if (process.env.VERCEL_ENV === "production") {
    throw new Error("Refusing to run: VERCEL_ENV=production.");
  }
}

function incrementCount(
  counts: Record<string, number>,
  key: string | null | undefined
): void {
  const normalized = key?.trim() || "(null)";
  counts[normalized] = (counts[normalized] ?? 0) + 1;
}

function summaryNeedsRefresh(row: {
  confidence_algorithm_version: string | null;
  eta_algorithm_version: string | null;
}): boolean {
  return (
    row.confidence_algorithm_version !==
      EXPECTED_CONFIDENCE_ALGORITHM_VERSION ||
    row.eta_algorithm_version !== EXPECTED_ETA_ALGORITHM_VERSION
  );
}

async function loadSummarySnapshot(): Promise<SummarySnapshot> {
  const supabase = createServiceRoleSupabaseClient();

  const { data: summaries, error: summariesError } = await supabase
    .from("chain_operational_summary")
    .select(
      "chain_id, confidence_band, confidence_unavailable, confidence_algorithm_version, eta_algorithm_version"
    );

  if (summariesError) {
    throw new Error(summariesError.message);
  }

  const chainIds = (summaries ?? []).map((row) => row.chain_id);
  const completedChainIds = new Set<number>();

  if (chainIds.length > 0) {
    const { data: chains, error: chainsError } = await supabase
      .from("chains")
      .select("id, completed_at")
      .in("id", chainIds);

    if (chainsError) {
      throw new Error(chainsError.message);
    }

    for (const chain of chains ?? []) {
      if (chain.completed_at) {
        completedChainIds.add(chain.id);
      }
    }
  }

  const bandCounts: Record<string, number> = {};
  const confidenceAlgorithmVersions: Record<string, number> = {};
  const etaAlgorithmVersions: Record<string, number> = {};
  let needsRefreshCount = 0;
  let unavailableCount = 0;
  let activeChainSummaries = 0;
  let completedChainSummaries = 0;

  for (const row of summaries ?? []) {
    if (completedChainIds.has(row.chain_id)) {
      completedChainSummaries += 1;
    } else {
      activeChainSummaries += 1;
    }

    incrementCount(bandCounts, row.confidence_band);
    incrementCount(
      confidenceAlgorithmVersions,
      row.confidence_algorithm_version
    );
    incrementCount(etaAlgorithmVersions, row.eta_algorithm_version);

    if (row.confidence_unavailable) {
      unavailableCount += 1;
    }

    if (summaryNeedsRefresh(row)) {
      needsRefreshCount += 1;
    }
  }

  return {
    totalSummaries: summaries?.length ?? 0,
    activeChainSummaries,
    completedChainSummaries,
    needsRefreshCount,
    bandCounts,
    confidenceAlgorithmVersions,
    etaAlgorithmVersions,
    unavailableCount,
  };
}

function printSnapshot(label: string, snapshot: SummarySnapshot): void {
  console.log(`\n${label}:`);
  console.log(`  total chain_operational_summary rows: ${snapshot.totalSummaries}`);
  console.log(`  active chains: ${snapshot.activeChainSummaries}`);
  console.log(`  completed chains: ${snapshot.completedChainSummaries}`);
  console.log(`  confidence_unavailable=true: ${snapshot.unavailableCount}`);
  console.log(`  rows needing timing_v1 refresh: ${snapshot.needsRefreshCount}`);
  console.log(`  expected confidence algorithm: ${EXPECTED_CONFIDENCE_ALGORITHM_VERSION}`);
  console.log(`  expected eta algorithm: ${EXPECTED_ETA_ALGORITHM_VERSION}`);
  console.log("  confidence_band counts:");
  for (const [band, count] of Object.entries(snapshot.bandCounts).sort()) {
    console.log(`    ${band}: ${count}`);
  }
  console.log("  confidence_algorithm_version counts:");
  for (const [version, count] of Object.entries(
    snapshot.confidenceAlgorithmVersions
  ).sort()) {
    console.log(`    ${version}: ${count}`);
  }
  console.log("  eta_algorithm_version counts:");
  for (const [version, count] of Object.entries(
    snapshot.etaAlgorithmVersions
  ).sort()) {
    console.log(`    ${version}: ${count}`);
  }
}

async function listChainIdsToRefresh(limit?: number): Promise<number[]> {
  const supabase = createServiceRoleSupabaseClient();

  const { data, error } = await supabase
    .from("chain_operational_summary")
    .select("chain_id")
    .order("chain_id", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  const chainIds = (data ?? []).map((row) => row.chain_id);

  if (limit != null && limit > 0) {
    return chainIds.slice(0, limit);
  }

  return chainIds;
}

async function runRefresh(limit?: number) {
  const chainIds = await listChainIdsToRefresh(limit);
  const supabase = createServiceRoleSupabaseClient();

  const stats = {
    targetChainCount: chainIds.length,
    processedCount: 0,
    successCount: 0,
    errorCount: 0,
    errors: [] as Array<{ chainId: number; error: string }>,
  };

  for (const chainId of chainIds) {
    const result = await refreshOperationalSummaryForWorker(
      supabase,
      chainId
    );

    stats.processedCount += 1;

    if (result.ok) {
      stats.successCount += 1;
    } else {
      stats.errorCount += 1;
      stats.errors.push({
        chainId,
        error: result.error ?? "unknown_error",
      });
    }

    if (
      stats.processedCount % 25 === 0 ||
      stats.processedCount === chainIds.length
    ) {
      console.log(
        `  progress: ${stats.processedCount}/${chainIds.length} chains processed`
      );
    }
  }

  console.log("\nChain Intelligence summary refresh report:");
  console.log(
    JSON.stringify(
      {
        targetChainCount: stats.targetChainCount,
        processedCount: stats.processedCount,
        successCount: stats.successCount,
        errorCount: stats.errorCount,
        errorSample: stats.errors.slice(0, 10),
      },
      null,
      2
    )
  );
}

function parseLimitArg(): number | undefined {
  const limitIndex = process.argv.indexOf("--limit");
  if (limitIndex === -1) {
    return undefined;
  }

  const raw = process.argv[limitIndex + 1];
  const parsed = Number(raw);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error("--limit requires a positive integer.");
  }

  return parsed;
}

async function main() {
  const execute = process.argv.includes("--execute");
  const limit = parseLimitArg();
  const environmentLoaded = loadEnvLocal();
  const resolvedServiceRoleKey = resolveServiceRoleKey(
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  if (resolvedServiceRoleKey) {
    process.env.SUPABASE_SERVICE_ROLE_KEY = resolvedServiceRoleKey;
  }

  const report = buildPreflightReport(environmentLoaded);
  printPreflightReport(report);
  assertPreflightReady(report);

  const before = await loadSummarySnapshot();
  printSnapshot("Current chain_operational_summary snapshot", before);

  const chainIds = await listChainIdsToRefresh(limit);

  console.log("\nDry-run plan:");
  console.log(`  chains selected for refresh: ${chainIds.length}`);
  console.log(
    `  refresh mode: ${
      execute ? "EXECUTE (will write summaries)" : "preflight only"
    }`
  );

  if (!execute) {
    console.log(
      "\nPreflight only. Re-run with --execute to refresh summaries."
    );
    console.log(
      "Optional: add --limit 10 to refresh a small batch first."
    );
    return;
  }

  await runRefresh(limit);

  const after = await loadSummarySnapshot();
  printSnapshot("Post-refresh chain_operational_summary snapshot", after);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
