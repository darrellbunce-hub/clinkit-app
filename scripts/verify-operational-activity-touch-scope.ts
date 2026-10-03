/**
 * Static regression checks: operational activity touches stay on the row
 * where the activity happened (20261005130000).
 *
 *   - activity on Property A writes A and its chains row only (no fake
 *     activity on B / C in the same chain), and nothing for system notices
 *   - genuine activity still reaches the row, the chains row and the
 *     placeholder clocks that depend on it
 *   - dashboard "Last updated" is derived from activity rows, not the touch
 *   - lifecycle decisions use the per-row placeholder clock, not the touch
 *   - chain intelligence stays precomputed: the touch path calls no summary or
 *     recalculation code and no trigger re-fires on the touched column
 *
 * Usage:
 *   npx tsx scripts/verify-operational-activity-touch-scope.ts
 */
import { readdirSync, readFileSync } from "fs";
import { join } from "path";

const ROOT = join(import.meta.dirname, "..");
const MIGRATION = "supabase/migrations/20261005130000_lifecycle_bounded_dormancy.sql";

type Result = { name: string; pass: boolean; detail?: string };
const results: Result[] = [];

function record(name: string, pass: boolean, detail?: string) {
  results.push({ name, pass, detail });
  console.log(pass ? `✓ ${name}` : `✗ ${name}${detail ? `: ${detail}` : ""}`);
}

function read(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), "utf8").replace(/\r\n/g, "\n");
}

function normalize(sql: string): string {
  return sql.replace(/\s+/g, " ").trim().toLowerCase();
}

function stripSqlComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, "");
}

function extractFunctions(sql: string): Map<string, string> {
  const functions = new Map<string, string>();
  const pattern =
    /create\s+(?:or\s+replace\s+)?function\s+public\.([a-z0-9_]+)\s*\(([\s\S]*?)\)\s*(returns[\s\S]*?|language[\s\S]*?)\$(\w*)\$([\s\S]*?)\$\4\$/gi;
  for (const match of sql.matchAll(pattern)) {
    functions.set(match[1].toLowerCase(), normalize(match[5]));
  }
  return functions;
}

function main() {
  const sql = stripSqlComments(read(MIGRATION));
  const flat = normalize(sql);
  const fns = extractFunctions(sql);
  const body = (name: string) => fns.get(name) ?? "";

  // ---------------------------------------------------------------------------
  // Write scope
  // ---------------------------------------------------------------------------
  const touch = body("touch_property_operational_activity");
  record(
    "Touch: redefined here; writes only the property row by primary key (no-op when already touched in this transaction)",
    touch.includes(
      "update public.properties set last_operational_activity_at = now() where id = p_property_id and last_operational_activity_at is distinct from now();"
    ) && (touch.match(/update public\.properties/g) ?? []).length === 1
  );
  record(
    "Touch: no chain-peer write (no update keyed on chain_id); the chain goes through the chains-row helper",
    !/where\s+chain_id\s*=/.test(touch) &&
      !touch.includes("update public.chains") &&
      touch.includes("perform public._touch_chain_operational_activity( (select p.chain_id from public.properties p where p.id = p_property_id) );")
  );
  record(
    "Touch: no loops and no other reads (one primary-key lookup for the chain id)",
    !/\bloop\b|\bfor\s+\w+\s+in\b/.test(touch) && (touch.match(/\bfrom public\./g) ?? []).length === 1
  );
  const chainTouch = body("_touch_chain_operational_activity");
  record(
    "Chain touch: the chains row only; no-op on a repeat in the same transaction",
    chainTouch.includes(
      "update public.chains set last_operational_activity_at = now() where id = p_chain_id and last_operational_activity_at is distinct from now();"
    ) && !chainTouch.includes("public.properties")
  );
  record(
    "Touch: service_role only (was executable by PUBLIC); off the user RPC allowlist; in the service-role targets",
    /revoke all on function public\.touch_property_operational_activity\(bigint, boolean\) from public, anon, authenticated;/.test(flat) &&
      /grant execute on function public\.touch_property_operational_activity\(bigint, boolean\) to service_role;/.test(flat) &&
      !/grant execute on function public\.touch_property_operational_activity\(bigint, boolean\) to [^;]*(anon|authenticated)/.test(flat) &&
      !read("scripts/secdef-user-rpc-allowlist.json").includes('"touch_property_operational_activity"') &&
      read("scripts/secdef-service-role-only-targets.json").includes('"touch_property_operational_activity"')
  );
  record(
    "Postflight refuses a body that still writes chain peers, and client execute on the touch",
    flat.includes("p.prosrc ~* 'where\\s+chain_id\\s*='") &&
      flat.includes("has_function_privilege('anon', 'public.touch_property_operational_activity(bigint, boolean)', 'execute')")
  );

  // ---------------------------------------------------------------------------
  // Genuine vs system activity
  // ---------------------------------------------------------------------------
  const activityTrigger = body("_trg_touch_operational_activity_from_activity");
  const guard = activityTrigger.indexOf("if new.updated_by is not distinct from 'system' then return new; end if;");
  record(
    "System notices (delink / unlink broadcasts to every chain row) touch nothing and restart nothing",
    guard > -1 &&
      guard < activityTrigger.indexOf("touch_property_operational_activity(") &&
      guard < activityTrigger.indexOf("_touch_chain_operational_activity(") &&
      guard < activityTrigger.indexOf("_record_placeholder_dependent_activity(")
  );
  record(
    "Genuine activity touches its own row + chains row, and restarts only that row and the purchase its sale links to",
    activityTrigger.includes("perform public.touch_property_operational_activity(new.property_id, true);") &&
      activityTrigger.includes("'placeholder_activity'") &&
      activityTrigger.includes("'linked_sale_activity'") &&
      !activityTrigger.includes("where p.chain_id") &&
      !activityTrigger.includes("chain_id = v_chain_id and")
  );
  const propertyTrigger = body("_trg_touch_operational_activity_from_property");
  record(
    "Property trigger: fires the touch only on progress columns; the touched column never re-fires it",
    propertyTrigger.includes("new.stage is distinct from old.stage") &&
      !propertyTrigger.includes("last_operational_activity_at")
  );

  const migrationsDir = join(ROOT, "supabase/migrations");
  const allMigrations = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql"));
  const columnTriggers = allMigrations.filter((f) =>
    /update\s+of\s+[^;]*last_operational_activity_at/i.test(stripSqlComments(read(`supabase/migrations/${f}`)))
  );
  record(
    "No trigger anywhere fires on last_operational_activity_at (no invalidation / recalculation chain)",
    columnTriggers.length === 0,
    columnTriggers.join(", ")
  );
  record(
    "Touch path calls no summary or chain-intelligence recalculation",
    ![touch, chainTouch, activityTrigger, propertyTrigger].some((b) =>
      /operational_summar|chain_operational_summar|recalculat|chain_intelligence|next_recalculation_at/.test(b)
    )
  );

  // ---------------------------------------------------------------------------
  // Readers
  // ---------------------------------------------------------------------------
  const lifecycleDecisionFiles = [
    "lib/lifecycle/dormancyScenarios.ts",
    "lib/lifecycle/schedule.ts",
    "lib/lifecycle/worker.ts",
  ];
  record(
    "Lifecycle decisions use the placeholder clock, never the touched timestamps",
    lifecycleDecisionFiles.every((f) => {
      const src = read(f);
      return !/lastOperationalActivityAt|chainLastOperationalActivityAt|daysSinceLastOperationalActivity|daysSinceChainOperationalActivity/.test(src);
    }) && read("lib/lifecycle/dormancyScenarios.ts").includes("placeholderActivityAt")
  );
  record(
    "Dashboard Last updated comes from genuine activity rows (view, 20261005170000), not the touch",
    read("supabase/migrations/20261005170000_dashboard_genuine_last_update.sql").includes(
      "public.is_genuine_property_activity(a.update, a.updated_by)"
    ) &&
      !read("lib/operationalSummary/derivePropertySummary.ts").includes("last_operational_activity_at") &&
      !read("supabase/migrations/20261005150000_dashboard_last_update_at.sql").includes("last_operational_activity_at") &&
      !read("supabase/migrations/20261005170000_dashboard_genuine_last_update.sql").includes("last_operational_activity_at")
  );
  record(
    "Chain-level reads prefer the chains row (peer timestamps were never needed for them)",
    normalize(read("supabase/migrations/20260714190000_property_lifecycle_automation.sql")).includes(
      "select coalesce( ( select c.last_operational_activity_at from public.chains c where c.id = p_chain_id ), ( select max(p.last_operational_activity_at)"
    )
  );

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  if (failed.length > 0) process.exit(1);
}

main();
