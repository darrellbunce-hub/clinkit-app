/// <reference types="node" />
/**
 * Conservative backfill for properties.stage_entered_at and chain_nodes.stage_entered_at.
 *
 * Development only. Run after migration:
 *   npx tsx scripts/backfill-stage-entered-at.ts              # preflight only
 *   npx tsx scripts/backfill-stage-entered-at.ts --execute      # run backfill
 *
 * Does not expose PII — reports counts only.
 */
import { readFileSync } from "fs";
import Module from "module";
import { join } from "path";

// Allow importing server-only modules from this Node script.
const moduleWithLoad = Module as typeof Module & {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown;
};
const originalLoad = moduleWithLoad._load.bind(Module);
moduleWithLoad._load = function patchedLoad(
  request: string,
  parent: unknown,
  isMain: boolean
) {
  if (request === "server-only") return {};
  return originalLoad(request, parent, isMain);
};

import { createServiceRoleSupabaseClient } from "../lib/supabase/serviceRole";
import { STAGES } from "../data/stages";
import { BUYER_READY_STAGES } from "../data/buyerReadyStages";
import { LEGACY_BUYER_READY_STAGE } from "../lib/chainIntelligence/catalog";

/** Authoritative Development Supabase project ref (see docs/PRODUCTION_READINESS_CHECKLIST.md). */
const DEVELOPMENT_SUPABASE_PROJECT_REF = "bbbsxzxcjkmpqsfvmhbo";

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
  console.log("Stage entered_at backfill preflight (Development only):");
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

function formatStageLabel(stageValue: string): string {
  const sale = STAGES.find((s) => s.value === stageValue);
  if (sale) return sale.label;

  const buyer = BUYER_READY_STAGES.find(
    (s) => s.value === stageValue
  );
  if (buyer) return buyer.label;

  if (stageValue === LEGACY_BUYER_READY_STAGE) {
    return "Mortgage Preparation";
  }

  return stageValue
    .replaceAll("_", " ")
    .replace(/\b\w/g, (l) => l.toUpperCase());
}

async function runBackfill() {
  const supabase = createServiceRoleSupabaseClient();

  const stats = {
    propertiesEligible: 0,
    propertiesBackfilled: 0,
    propertiesUnknown: 0,
    chainNodesEligible: 0,
    chainNodesBackfilled: 0,
    chainNodesUnknown: 0,
    legacyMortgagePreparation: 0,
  };

  const { data: properties } = await supabase
    .from("properties")
    .select("id, stage, stage_entered_at")
    .is("stage_entered_at", null);

  for (const property of properties ?? []) {
    stats.propertiesEligible += 1;

    const label = formatStageLabel(property.stage);
    const { data: activities } = await supabase
      .from("activities")
      .select("timestamp, update")
      .eq("property_id", property.id)
      .eq("update", label)
      .order("timestamp", { ascending: false })
      .limit(1);

    const match = activities?.[0];

    if (match?.timestamp) {
      await supabase
        .from("properties")
        .update({ stage_entered_at: match.timestamp })
        .eq("id", property.id);
      stats.propertiesBackfilled += 1;
    } else {
      stats.propertiesUnknown += 1;
    }
  }

  const { data: nodes } = await supabase
    .from("chain_nodes")
    .select("id, stage, stage_entered_at")
    .eq("node_type", "buyer_ready")
    .is("stage_entered_at", null);

  for (const node of nodes ?? []) {
    stats.chainNodesEligible += 1;

    if (node.stage === LEGACY_BUYER_READY_STAGE) {
      stats.legacyMortgagePreparation += 1;
    }

    const label = formatStageLabel(node.stage ?? "");
    const { data: activities } = await supabase
      .from("activities")
      .select("timestamp, update")
      .eq("chain_node_id", node.id)
      .eq("update", label)
      .order("timestamp", { ascending: false })
      .limit(1);

    const match = activities?.[0];

    if (match?.timestamp) {
      await supabase
        .from("chain_nodes")
        .update({ stage_entered_at: match.timestamp })
        .eq("id", node.id);
      stats.chainNodesBackfilled += 1;
    } else {
      stats.chainNodesUnknown += 1;
    }
  }

  console.log("Stage entered_at backfill report:");
  console.log(JSON.stringify(stats, null, 2));
}

async function main() {
  const execute = process.argv.includes("--execute");
  const environmentLoaded = loadEnvLocal();
  const resolvedServiceRoleKey = resolveServiceRoleKey(
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  if (resolvedServiceRoleKey) {
    process.env.SUPABASE_SERVICE_ROLE_KEY = resolvedServiceRoleKey;
  }

  const report = buildPreflightReport(environmentLoaded);
  printPreflightReport(report);

  if (!execute) {
    console.log(
      "\nPreflight only. Re-run with --execute to perform the backfill."
    );
    assertPreflightReady(report);
    return;
  }

  assertPreflightReady(report);
  await runBackfill();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
