/**
 * Offline checks for
 *   supabase/migrations/20261005160000_drop_properties_address_match_key_idx.sql
 *
 * properties_address_match_key_idx (20261005120000) indexed two
 * service_role-only helpers, so authenticated writes to properties failed.
 *
 * Usage:
 *   npx tsx scripts/verify-drop-address-match-key-idx-migration.ts
 */
import { readdirSync, readFileSync } from "fs";
import { join } from "path";

const ROOT = join(import.meta.dirname, "..");
const MIGRATIONS = join(ROOT, "supabase", "migrations");
const FILE = "20261005160000_drop_properties_address_match_key_idx.sql";
const LATER_MIGRATIONS = [
  "20261005170000_dashboard_genuine_last_update.sql",
  "20261005180000_activities_select_property_chain_viewer.sql",
  "20261006120000_operational_intelligence_refresh_queue.sql",
];

type TestResult = { name: string; pass: boolean; detail?: string };
const results: TestResult[] = [];

function record(name: string, pass: boolean, detail?: string) {
  results.push({ name, pass, detail });
  console.log(pass ? `✓ ${name}` : `✗ ${name}${detail ? `: ${detail}` : ""}`);
}

function normalize(sql: string): string {
  return sql.replace(/--[^\n]*/g, "").replace(/\s+/g, " ").trim().toLowerCase();
}

function main() {
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
  const sql = normalize(readFileSync(join(MIGRATIONS, FILE), "utf8"));
  const creator = normalize(
    readFileSync(join(MIGRATIONS, "20261005120000_operational_authority_enforcement.sql"), "utf8")
  );
  const helpers = normalize(
    readFileSync(join(MIGRATIONS, "20261005100000_address_reservation_classifier.sql"), "utf8")
  );

  record(
    "Ordered after 20261005150000; followed only by known later migrations",
    files.indexOf(FILE) > files.indexOf("20261005150000_dashboard_last_update_at.sql") &&
      files
        .slice(files.indexOf(FILE) + 1)
        .every((file) => LATER_MIGRATIONS.includes(file))
  );
  record(
    "The index it drops is the one 20261005120000 creates on the service_role-only helpers",
    creator.includes("create index if not exists properties_address_match_key_idx on public.properties") &&
      helpers.includes("revoke all on function public._postcode_match_key(text) from public, anon, authenticated;") &&
      helpers.includes("revoke all on function public._address_match_key(text) from public, anon, authenticated;")
  );
  record(
    "Drops the index idempotently",
    sql.includes("drop index if exists public.properties_address_match_key_idx;")
  );
  record(
    "Changes nothing else: no grants, revokes, functions, triggers, tables or data",
    !/\b(grant|revoke|create or replace|create table|create trigger|create index|alter table|insert into|update public|delete from)\b/.test(
      sql
    )
  );
  record(
    "No later migration recreates the index",
    files
      .filter((f) => f > FILE)
      .every((f) => !normalize(readFileSync(join(MIGRATIONS, f), "utf8")).includes("properties_address_match_key_idx"))
  );
  record(
    "Postflight: index absent",
    sql.includes("if to_regclass('public.properties_address_match_key_idx') is not null then raise exception")
  );
  record(
    "Postflight: no index / constraint / default / policy on a user-writable table depends on a function authenticated cannot execute",
    ["'pg_class'::regclass", "'pg_constraint'::regclass", "'pg_attrdef'::regclass", "'pg_policy'::regclass"].every(
      (c) => sql.includes(c)
    ) &&
      sql.includes("not has_function_privilege('authenticated', p.oid, 'execute')") &&
      sql.includes("has_table_privilege('authenticated', t.oid, 'insert')") &&
      sql.includes("has_table_privilege('authenticated', t.oid, 'update')") &&
      sql.includes("if v_offender is not null then raise exception")
  );

  const failed = results.filter((r) => !r.pass).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed.`);
  if (failed > 0) process.exit(1);
}

main();
