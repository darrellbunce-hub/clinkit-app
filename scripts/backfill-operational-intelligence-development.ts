/**
 * Development-only backfill of operational intelligence summaries through the
 * worker path (list_chain_operational_refresh_work → load → derive → persist).
 * No direct writes to summary tables.
 *
 * Usage:
 *   npx tsx scripts/backfill-operational-intelligence-development.ts            # plan only
 *   npx tsx scripts/backfill-operational-intelligence-development.ts --execute  # run
 *   npx tsx scripts/backfill-operational-intelligence-development.ts --execute --batch 50 --max-batches 4
 *   npx tsx scripts/backfill-operational-intelligence-development.ts --execute --requeue-all  # recalculate every summary
 *
 * Reports counts only (no PII).
 */
import { readFileSync } from "fs";
import { join } from "path";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { runChainIntelligenceWorkerBatch } from "../lib/chainIntelligence/worker";

const DEVELOPMENT_SUPABASE_PROJECT_REF = "bbbsxzxcjkmpqsfvmhbo";

function loadEnvLocal(): void {
  try {
    for (const line of readFileSync(join(process.cwd(), ".env.local"), "utf8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const at = trimmed.indexOf("=");
      if (at <= 0) continue;
      let value = trimmed.slice(at + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[trimmed.slice(0, at).trim()] = value;
    }
  } catch {
    // optional
  }
}

function numberArg(name: string, fallback: number): number {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  const parsed = Number(process.argv[index + 1]);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} requires a positive integer.`);
  }
  return parsed;
}

type Snapshot = {
  chainSummaries: number;
  chainSummariesV3: number;
  propertySummaries: number;
  queueRows: number;
  workByReason: Record<string, number>;
  workTotal: number;
};

function exactCount(table: string, result: { count: number | null; error: { message: string } | null }): number {
  if (result.error) throw new Error(`${table}: ${result.error.message}`);
  return result.count ?? 0;
}

async function snapshot(admin: SupabaseClient): Promise<Snapshot & { summaryChainIds: Set<number> }> {
  const { data: work, error: workError } = await admin.rpc(
    "list_chain_operational_refresh_work",
    { p_limit: 500 }
  );
  if (workError) throw new Error(workError.message);

  const workByReason: Record<string, number> = {};
  for (const row of (work ?? []) as Array<{ reason: string }>) {
    const key = row.reason.split(":")[0];
    workByReason[key] = (workByReason[key] ?? 0) + 1;
  }

  const summaryChainIds = new Set<number>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin
      .from("chain_operational_summary")
      .select("chain_id")
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) summaryChainIds.add(Number(row.chain_id));
    if ((data ?? []).length < 1000) break;
  }

  return {
    chainSummaries: summaryChainIds.size,
    chainSummariesV3: exactCount(
      "chain_operational_summary",
      await admin
        .from("chain_operational_summary")
        .select("chain_id", { count: "exact", head: true })
        .gte("summary_version", 3)
    ),
    propertySummaries: exactCount(
      "property_operational_summary",
      await admin
        .from("property_operational_summary")
        .select("property_id", { count: "exact", head: true })
    ),
    queueRows: exactCount(
      "chain_operational_refresh_queue",
      await admin
        .from("chain_operational_refresh_queue")
        .select("chain_id", { count: "exact", head: true })
    ),
    workByReason,
    workTotal: (work ?? []).length,
    summaryChainIds,
  };
}

function printSnapshot(label: string, s: Snapshot) {
  console.log(`\n${label}:`);
  console.log(`  chain summaries: ${s.chainSummaries} (v3: ${s.chainSummariesV3})`);
  console.log(`  property summaries: ${s.propertySummaries}`);
  console.log(`  queue rows: ${s.queueRows}`);
  console.log(`  work list (limit 500): ${s.workTotal} ${JSON.stringify(s.workByReason)}`);
}

async function main() {
  loadEnvLocal();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceRoleKey) {
    throw new Error("Supabase URL and service role key are required.");
  }
  const projectRef = url.match(/^https:\/\/([a-z0-9]+)\.supabase\.co/i)?.[1] ?? null;
  if (projectRef !== DEVELOPMENT_SUPABASE_PROJECT_REF || process.env.VERCEL_ENV === "production") {
    throw new Error(`Refusing to run: Supabase project "${projectRef ?? "unknown"}" is not Development.`);
  }

  const execute = process.argv.includes("--execute");
  const batchLimit = numberArg("--batch", 50);
  const maxBatches = numberArg("--max-batches", 40);

  const admin = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.log("=== Operational intelligence backfill (Development only) ===");
  console.log(`target: ${projectRef}; batch: ${batchLimit}; max batches: ${maxBatches}`);

  const before = await snapshot(admin);
  printSnapshot("Before", before);

  if (!execute) {
    console.log("\nPlan only. Re-run with --execute.");
    return;
  }

  if (process.argv.includes("--requeue-all")) {
    const chainIds = [...before.summaryChainIds];
    for (let start = 0; start < chainIds.length; start += 500) {
      const { error } = await admin.rpc("_enqueue_chain_operational_refresh", {
        p_chain_ids: chainIds.slice(start, start + 500),
        p_reason: "development_backfill",
      });
      if (error) throw new Error(`requeue failed: ${error.message}`);
    }
    console.log(`\nRequeued ${chainIds.length} chains with a summary.`);
  }

  const result = await runChainIntelligenceWorkerBatch(admin, {
    batchLimit,
    maxBatches,
  });

  const after = await snapshot(admin);
  printSnapshot("After", after);

  let created = 0;
  for (const chainId of after.summaryChainIds) {
    if (!before.summaryChainIds.has(chainId)) created += 1;
  }

  const errorSample = result.errors.slice(0, 10).map((e) => ({
    chainId: e.chainId,
    error: e.error.slice(0, 160),
  }));

  console.log("\nWorker result:");
  console.log(
    JSON.stringify(
      {
        batches: result.batches,
        candidates: result.candidateCount,
        candidatesByReason: result.candidatesByReason,
        persisted: result.successCount,
        created,
        refreshed: result.successCount - created,
        failures: result.errorCount,
        errorSample,
        purgedQueueRows: result.purgedQueueRows,
        remainingWork: after.workTotal,
        durationMs: result.durationMs,
        msPerChain:
          result.candidateCount > 0
            ? Math.round(result.durationMs / result.candidateCount)
            : null,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
