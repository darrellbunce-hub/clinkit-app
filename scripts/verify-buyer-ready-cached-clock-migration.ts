/**
 * Static checks for 20261008090000_buyer_ready_cached_activity_clock.sql.
 *
 * The migration only adds the Buyer Ready clock columns to
 * chain_operational_summary and re-creates the service-only persistence
 * function with those columns; every line of the previous definition is kept
 * and no policy, grant, view or other function changes.
 *
 * Usage:
 *   npx tsx scripts/verify-buyer-ready-cached-clock-migration.ts
 */
import { readFileSync } from "fs";
import { join } from "path";

const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

const migration = read("supabase/migrations/20261008090000_buyer_ready_cached_activity_clock.sql");
const previous = read("supabase/migrations/20261006120000_operational_intelligence_refresh_queue.sql");

let failures = 0;
let checks = 0;

function assert(name: string, condition: boolean, detail?: unknown) {
  checks += 1;
  if (!condition) {
    failures += 1;
    console.error("FAIL:", name, detail === undefined ? "" : JSON.stringify(detail, null, 2));
  } else {
    console.log("PASS:", name);
  }
}

function stripComments(sql: string): string {
  return sql
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

function functionBody(sql: string, name: string): string {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  if (start < 0) return "";
  const end = sql.indexOf("\n$$;", sql.indexOf("as $$", start));
  return sql.slice(start, end + 4);
}

const normalise = (line: string) => line.trim().replace(/[,;]$/, "");
const lines = (body: string) => body.split("\n").map(normalise).filter(Boolean);

const code = stripComments(migration);
const oldBody = functionBody(previous, "upsert_operational_summaries_service");
const newBody = functionBody(migration, "upsert_operational_summaries_service");

assert("Previous and new persistence functions are found", oldBody.length > 0 && newBody.length > 0);

// Every previous line is kept, in order.
const oldLines = lines(oldBody);
const newLines = lines(newBody);
const added: string[] = [];
let cursor = 0;
for (const line of newLines) {
  if (cursor < oldLines.length && line === oldLines[cursor]) {
    cursor += 1;
  } else {
    added.push(line);
  }
}
assert(
  "Every line of the previous upsert_operational_summaries_service is kept in order",
  cursor === oldLines.length,
  { missingFrom: oldLines[cursor] }
);

const EXPECTED_ADDED = [
  "v_buyer_ready_node_id bigint",
  "v_buyer_ready_node_id := nullif(p_chain_summary->>'buyer_ready_node_id', '')::bigint",
  "if v_buyer_ready_node_id is not null and not exists (",
  "select 1",
  "from public.chain_nodes n",
  "where n.id = v_buyer_ready_node_id",
  "and n.chain_id = v_chain_id",
  "and n.node_type = 'buyer_ready'",
  ") then",
  "raise exception",
  "'buyer ready node % does not belong to chain %'",
  "v_buyer_ready_node_id",
  "v_chain_id",
  "end if",
  "buyer_ready_node_id",
  "buyer_ready_activity_clock_at",
  "buyer_ready_activity_clock_source",
  "v_buyer_ready_node_id",
  "nullif(p_chain_summary->>'buyer_ready_activity_clock_at', '')::timestamptz",
  "nullif(p_chain_summary->>'buyer_ready_activity_clock_source', '')",
  "buyer_ready_node_id = excluded.buyer_ready_node_id",
  "buyer_ready_activity_clock_at = excluded.buyer_ready_activity_clock_at",
  "buyer_ready_activity_clock_source = excluded.buyer_ready_activity_clock_source",
];
const remaining = [...added];
for (const expected of EXPECTED_ADDED) {
  const index = remaining.indexOf(expected);
  if (index >= 0) remaining.splice(index, 1);
}
assert(
  "The only additions are the Buyer Ready clock columns and the node-belongs-to-chain check",
  remaining.length === 0 && added.length === EXPECTED_ADDED.length,
  { unexpected: remaining, addedCount: added.length }
);
assert(
  "Property summary persistence is unchanged (no Buyer Ready clock written to property rows)",
  !/property_operational_summary[\s\S]*buyer_ready_activity_clock/.test(
    newBody.slice(newBody.indexOf("insert into public.property_operational_summary"))
  )
);

assert(
  "The function keeps SECURITY DEFINER with a fixed search_path",
  /security definer\s+set search_path = public/.test(newBody)
);

// Columns.
for (const column of [
  "buyer_ready_node_id bigint",
  "buyer_ready_activity_clock_at timestamptz",
  "buyer_ready_activity_clock_source text",
]) {
  assert(
    `Adds chain_operational_summary.${column.split(" ")[0]}`,
    code.includes(`add column if not exists ${column}`)
  );
}
assert(
  "Only chain_operational_summary is altered",
  (code.match(/alter table/g) ?? []).length === 1 &&
    code.includes("alter table public.chain_operational_summary")
);

// Scope.
const createdFunctions = [...code.matchAll(/create or replace function public\.(\w+)\(/g)].map((m) => m[1]);
assert(
  "Only upsert_operational_summaries_service is re-created",
  createdFunctions.length === 1 && createdFunctions[0] === "upsert_operational_summaries_service",
  createdFunctions
);
assert(
  "No policy, RLS, view, trigger, function drop or ownership change",
  !/create policy|drop policy|alter policy|row level security|create (or replace )?view|drop view|create trigger|drop trigger|drop function|owner to|security_invoker/i.test(
    code
  )
);
const grantLines = code.split("\n").filter((line) => /^\s*(grant|revoke)\b/i.test(line));
assert(
  "Grants are the existing service-only grants, re-asserted unchanged",
  grantLines.length === 2 &&
    grantLines.some(
      (line) =>
        line.trim() ===
        "revoke all on function public.upsert_operational_summaries_service(jsonb, jsonb) from public, anon, authenticated;"
    ) &&
    grantLines.some(
      (line) =>
        line.trim() ===
        "grant execute on function public.upsert_operational_summaries_service(jsonb, jsonb) to service_role;"
    ) &&
    previous.includes(
      "revoke all on function public.upsert_operational_summaries_service(jsonb, jsonb) from public, anon, authenticated;"
    ) &&
    previous.includes(
      "grant execute on function public.upsert_operational_summaries_service(jsonb, jsonb) to service_role;"
    ),
  grantLines
);
assert(
  "No summary rows are written, updated or deleted by the migration itself",
  !/^\s*(update|delete from|insert into)\b/im.test(code.replace(newBody, ""))
);
assert(
  "Preflight requires 20261006120000 and postflight checks grants, RLS and the persisted column",
  code.includes("20261006120000 is not applied") &&
    code.includes("has_function_privilege('authenticated', 'public.upsert_operational_summaries_service(jsonb, jsonb)', 'execute')") &&
    code.includes("policyname = 'chain_operational_summary_select'") &&
    code.includes("has_table_privilege('anon', 'public.chain_operational_summary', 'select')") &&
    code.includes("has_table_privilege('authenticated', 'public.chain_node_operational_clock', 'select')")
);

// Application wiring and unchanged rules.
const deriveChain = read("lib/operationalSummary/deriveChainSummary.ts");
const constants = read("lib/operationalSummary/constants.ts");
const activity = read("lib/activityIntelligence.ts");
assert(
  "The worker stores the node clock loaded from chain_node_operational_clock (no new clock logic)",
  deriveChain.includes("buyer_ready_node_id: buyerReadyNode?.id ?? null") &&
    deriveChain.includes("buyerReadyNode?.activityClockAt ?? null") &&
    deriveChain.includes("buyerReadyNode?.activityClockSource ?? null") &&
    previous.includes("'activityClockAt', nclk.activity_clock_at") &&
    previous.includes("coalesce(genuine.last_activity_at, n.stage_entered_at, n.created_at) as activity_clock_at")
);
assert(
  "The summary version is not bumped (no Dashboard-wide pending state)",
  /OPERATIONAL_SUMMARY_VERSION = 3;/.test(constants)
);
assert(
  "The 14 and 21 day thresholds are unchanged",
  /STALE_DAYS_PAGE_ALERT = 14\b/.test(activity) && /STALE_DAYS_CONFIDENCE = 21\b/.test(activity)
);

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) {
  process.exitCode = 1;
}
