/**
 * Static checks for the activity visibility RLS fix.
 *
 *   supabase/migrations/20261005180000_activities_select_property_chain_viewer.sql
 *   scripts/secdef-user-rpc-allowlist.json
 *
 * Usage:
 *   npx tsx scripts/verify-activities-select-rls-migration.ts
 */
import { readFileSync } from "fs";
import { join } from "path";

const ROOT = join(import.meta.dirname, "..");
const MIGRATION =
  "supabase/migrations/20261005180000_activities_select_property_chain_viewer.sql";
const HELPER = "is_property_chain_operational_viewer";

type TestResult = { name: string; pass: boolean; detail?: string };
const results: TestResult[] = [];

function record(name: string, pass: boolean, detail?: string) {
  results.push({ name, pass, detail });
  console.log(pass ? `✓ ${name}` : `✗ ${name}${detail ? `: ${detail}` : ""}`);
}

function read(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), "utf8").replace(/\r\n/g, "\n");
}

function normalize(sql: string): string {
  return sql.replace(/--[^\n]*/g, "").replace(/\s+/g, " ").trim().toLowerCase();
}

const sql = normalize(read(MIGRATION));

const helperMatch = sql.match(
  new RegExp(`create or replace function public\\.${HELPER}\\( p_property_id bigint \\) (returns[\\s\\S]*?)\\$\\$([\\s\\S]*?)\\$\\$;`)
);
const helperHeader = helperMatch?.[1] ?? "";
const helperBody = helperMatch?.[2] ?? "";

record("Helper is defined with a single bigint argument", helperMatch != null);
record(
  "Helper returns boolean, stable SECURITY DEFINER, search_path = public",
  /returns boolean language sql stable security definer set search_path = public as/.test(helperHeader),
  helperHeader
);
record(
  "Helper body returns only an existence predicate for the calling user",
  /^select auth\.uid\(\) is not null and exists \( select 1 from public\.properties p where p\.id = p_property_id and public\.is_chain_operational_viewer\(p\.chain_id\) \);$/.test(
    helperBody.trim()
  ),
  helperBody.trim()
);
record(
  "Helper owned by postgres",
  sql.includes(`alter function public.${HELPER}(bigint) owner to postgres;`)
);
record(
  "Helper EXECUTE revoked from PUBLIC and anon, granted to authenticated and service_role only",
  sql.includes(`revoke all on function public.${HELPER}(bigint) from public, anon;`) &&
    sql.includes(`grant execute on function public.${HELPER}(bigint) to authenticated, service_role;`) &&
    !new RegExp(`grant execute on function public\\.${HELPER}\\(bigint\\) to [^;]*anon`).test(sql)
);

const policyMatch = sql.match(
  /create policy activities_select_chain_participant on public\.activities for select to authenticated using \(([\s\S]*?)\);/
);
const policy = policyMatch?.[1] ?? "";
record(
  "activities SELECT policy resolves property activity through the helper",
  policy.includes(`property_id is not null and public.${HELPER}(property_id)`),
  policy
);
record(
  "activities SELECT policy no longer joins properties under the caller's RLS",
  policyMatch != null && !/from public\.properties/.test(policy)
);
record(
  "Buyer Ready branch unchanged (chain_nodes → is_chain_operational_viewer)",
  policy.includes(
    "chain_node_id is not null and exists ( select 1 from public.chain_nodes cn where cn.id = activities.chain_node_id and public.is_chain_operational_viewer(cn.chain_id) )"
  )
);
record(
  "Policy is SELECT-only for authenticated (no INSERT/UPDATE/DELETE policy touched)",
  !/create policy [a-z_]+ on public\.activities for (insert|update|delete|all)/.test(sql) &&
    !/drop policy if exists activities_insert/.test(sql)
);

record(
  "properties policies, view and grants are not modified",
  !/(create|drop|alter) policy [a-z_]+ on public\.properties/.test(sql) &&
    !/(drop policy if exists [a-z_]+ on public\.properties)/.test(sql) &&
    !/create or replace view/.test(sql) &&
    !/grant [a-z, ]+ on (table )?public\.properties/.test(sql) &&
    !/alter table public\.properties/.test(sql)
);
record(
  "No data changes (no INSERT/UPDATE/DELETE statements)",
  !/(^|;) ?(insert into|update public\.|delete from)/.test(sql)
);
record(
  "Postflight asserts SECURITY DEFINER shape, ACLs, policy replacement and unchanged properties policies",
  sql.includes("helper must be a stable security definer boolean") &&
    sql.includes("public can execute the helper") &&
    sql.includes("anon can execute the helper") &&
    sql.includes("authenticated cannot execute the helper") &&
    sql.includes("activities select policy not replaced") &&
    sql.includes("properties policies changed") &&
    sql.includes("anon can read activities")
);

const allowlist = JSON.parse(read("scripts/secdef-user-rpc-allowlist.json")) as {
  allowlist: { name: string; args: string; reason: string }[];
};
const entry = allowlist.allowlist.find((item) => item.name === HELPER);
record(
  "Helper is allowlisted deliberately as an authenticated read-only predicate",
  entry?.args === "bigint" && entry.reason === "authenticated_readonly_predicate_helper",
  JSON.stringify(entry)
);

const failed = results.filter((result) => !result.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
if (failed.length > 0) {
  process.exit(1);
}
