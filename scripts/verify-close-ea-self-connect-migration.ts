/**
 * Static checks for closing Estate Agent self-attachment to a purchase awaiting
 * its seller:
 *
 *   supabase/migrations/20261010090000_close_ea_self_connect_awaiting_property.sql
 *
 * connect_ea_to_awaiting_property must refuse every call generically and be
 * unable to write an assignment; the app must no longer call it; the approved
 * route (seller joins with join_chain_property, then appoints with
 * assign_property_ea_branch) must be unchanged. Reads repository files only.
 *
 * Usage:
 *   npx tsx scripts/verify-close-ea-self-connect-migration.ts
 */
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";

const ROOT = join(import.meta.dirname, "..");
const MIGRATIONS_DIR = "supabase/migrations";
const FILE = "20261010090000_close_ea_self_connect_awaiting_property.sql";
const PREVIOUS_LATEST = "20261008090000_buyer_ready_cached_activity_clock.sql";
const RP = "20261005140000_reservation_placeholders_awaiting_seller.sql";
const M2 = "20261005110000_seller_side_authority_and_awaiting_connection.sql";
const M3 = "20261005120000_operational_authority_enforcement.sql";
const SIGNATURE = "public.connect_ea_to_awaiting_property(text, text, text, uuid)";
const APP_DIRS = ["app", "lib", "components", "hooks", "emails"];

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
  return sql.replace(/\s+/g, " ").trim().toLowerCase();
}

function stripSqlComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, "");
}

function functionBody(sql: string, name: string): string {
  const pattern = new RegExp(
    `create\\s+(?:or\\s+replace\\s+)?function\\s+public\\.${name}\\s*\\([\\s\\S]*?\\$(\\w*)\\$([\\s\\S]*?)\\$\\1\\$`,
    "i"
  );
  return normalize(sql.match(pattern)?.[2] ?? "");
}

function definesFunction(sql: string, name: string): boolean {
  return new RegExp(`create\\s+(?:or\\s+replace\\s+)?function\\s+public\\.${name}\\s*\\(`, "i").test(sql);
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(entry)) out.push(full);
  }
  return out;
}

function main() {
  const migrations = readdirSync(join(ROOT, MIGRATIONS_DIR))
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const sqlOf = new Map(migrations.map((f) => [f, stripSqlComments(read(`${MIGRATIONS_DIR}/${f}`))]));
  const latestDefiner = (name: string) => migrations.filter((f) => definesFunction(sqlOf.get(f)!, name)).at(-1);

  // Ordering
  const index = migrations.indexOf(FILE);
  record("Ordering: migration file exists", index > -1);
  record(
    `Ordering: applies after ${PREVIOUS_LATEST}`,
    index > migrations.indexOf(PREVIOUS_LATEST) && migrations.indexOf(PREVIOUS_LATEST) > -1
  );
  const version = FILE.slice(0, 14);
  const sameVersion = migrations.filter((f) => f.slice(0, 14) === version);
  record("Ordering: version is unique", sameVersion.length === 1, sameVersion.join(", "));
  record(
    "Ordering: this file is the latest definition of connect_ea_to_awaiting_property",
    latestDefiner("connect_ea_to_awaiting_property") === FILE,
    latestDefiner("connect_ea_to_awaiting_property")
  );

  const sql = sqlOf.get(FILE) ?? "";
  const flat = normalize(sql);

  // Function: generic refusal, nothing read or written
  const body = functionBody(sql, "connect_ea_to_awaiting_property");
  record(
    "Function: body only returns the generic join_details_not_matched failure",
    body === "begin return jsonb_build_object('ok', false, 'error', 'join_details_not_matched'); end;",
    body
  );
  record(
    "Function: body cannot touch property_ea_assignments or any table",
    body !== "" &&
      !body.includes("property_ea_assignments") &&
      !/\b(insert|update|delete|perform|select|execute|call)\b/.test(body)
  );
  record(
    "Function: signature, jsonb result, plpgsql, SECURITY DEFINER and search_path preserved",
    flat.includes(
      "create or replace function public.connect_ea_to_awaiting_property( p_access_code text, p_address text, p_postcode text, p_branch_id uuid ) returns jsonb language plpgsql security definer set search_path = public as $$"
    )
  );

  // Grants identical to the definition being replaced
  const revoke = `revoke all on function ${SIGNATURE} from public, anon;`;
  const grant = `grant execute on function ${SIGNATURE} to authenticated, service_role;`;
  const rpFlat = normalize(sqlOf.get(RP) ?? "");
  record("Grants: same revoke and grant as 20261005140000", rpFlat.includes(revoke) && rpFlat.includes(grant));
  record("Grants: restated (authenticated + service_role, not anon)", flat.includes(revoke) && flat.includes(grant));

  // Scope: one function, no data or other object changes
  const outsideDollarQuotes = sql
    .replace(/\$(\w*)\$[\s\S]*?\$\1\$/g, "$$$$")
    .replace(/'(?:[^']|'')*'/g, "''");
  const statements = outsideDollarQuotes
    .split(";")
    .map((s) => normalize(s))
    .filter((s) => s !== "");
  const allowedStatement = (s: string) =>
    s === "do $$" ||
    s.startsWith("create or replace function public.connect_ea_to_awaiting_property(") ||
    s.startsWith("comment on function public.connect_ea_to_awaiting_property(") ||
    s.startsWith("revoke all on function public.connect_ea_to_awaiting_property(") ||
    s.startsWith("grant execute on function public.connect_ea_to_awaiting_property(");
  const unexpected = statements.filter((s) => !allowedStatement(s));
  record(
    "Scope: only connect_ea_to_awaiting_property is redefined, commented and granted",
    unexpected.length === 0,
    unexpected.join(" | ")
  );
  record(
    "Scope: exactly one function definition",
    (sql.match(/create\s+(?:or\s+replace\s+)?function/gi) ?? []).length === 1
  );
  record(
    "Scope: no table, policy, trigger or data statements",
    !/\b(insert\s+into|update\s+public\.|delete\s+from|truncate|alter\s+table|create\s+policy|alter\s+policy|drop\s+policy|create\s+trigger|drop\s+trigger|drop\s+function)\b/.test(
      flat.replace(/do \$\$[\s\S]*?\$\$;/g, "")
    )
  );

  // Preflight and postflight
  record(
    "Preflight: aborts unless the 20261005140000 definition (assignment insert, buyer-side check) is live",
    flat.includes("close_ea_self_connect_awaiting_property aborted: connect_ea_to_awaiting_property differs from 20261005140000") &&
      flat.includes("insert into public.property_ea_assignments%") &&
      flat.includes("close_ea_self_connect_awaiting_property aborted: connect_ea_to_awaiting_property does not return jsonb")
  );
  record(
    "Postflight: no assignment reference or statements in the live body, definer kept, grants kept",
    flat.includes("v_src like '%property_ea_assignments%'") &&
      flat.includes("close_ea_self_connect_awaiting_property postflight: connect_ea_to_awaiting_property not replaced") &&
      flat.includes("close_ea_self_connect_awaiting_property postflight: connect_ea_to_awaiting_property signature changed") &&
      flat.includes("close_ea_self_connect_awaiting_property postflight: connect_ea_to_awaiting_property is anon-executable") &&
      flat.includes("close_ea_self_connect_awaiting_property postflight: connect_ea_to_awaiting_property grants changed")
  );

  // Application: no remaining callers
  const appFiles = APP_DIRS.filter((d) => existsSync(join(ROOT, d))).flatMap((d) => walk(join(ROOT, d)));
  const callers = appFiles
    .filter((f) => /connect_ea_to_awaiting_property|connectEaToAwaitingProperty/.test(readFileSync(f, "utf8")))
    .map((f) => relative(ROOT, f));
  record("App: no caller of connect_ea_to_awaiting_property remains", callers.length === 0, callers.join(", "));

  const originate = read("app/agent/originate/page.tsx");
  record(
    "App: Join mode still joins through joinEaOperationalChain",
    originate.includes("joinEaOperationalChain(")
  );
  record(
    "App: property_already_exists stops with a message directing the user to the seller or support",
    /result\.error === "property_already_exists"\)\s*\{[\s\S]{0,400}?setErrorMessage\([\s\S]{0,400}?contact support/.test(
      originate
    )
  );

  // Approved route intact
  record(
    "Approved route: join_chain_property (20261005110000) grants participation through the counterparty core",
    latestDefiner("join_chain_property") === M2 &&
      functionBody(sqlOf.get(M2)!, "join_chain_property").includes("public._grant_counterparty_participation_core(")
  );
  record(
    "Approved route: the counterparty core (20261005120000) grants the seller role on a purchase",
    latestDefiner("_grant_counterparty_participation_core") === M3 &&
      functionBody(sqlOf.get(M3)!, "_grant_counterparty_participation_core").includes(
        "when v_property.relationship_type = 'purchase' then 'seller'"
      )
  );
  record(
    "Approved route: seller-side helpers (20261005110000) unchanged",
    latestDefiner("_property_seller_side_user_id") === M2 &&
      latestDefiner("is_property_seller_side_homeowner") === M2
  );
  record(
    "Approved route: assign_property_ea_branch (20261005120000) requires the seller-side homeowner",
    latestDefiner("assign_property_ea_branch") === M3 &&
      functionBody(sqlOf.get(M3)!, "assign_property_ea_branch").includes(
        "if not public.is_property_seller_side_homeowner(p_property_id) then"
      )
  );
  record(
    "Approved route: this migration does not reference the approved-route functions",
    !/join_chain_property|assign_property_ea_branch|_grant_counterparty_participation_core|seller_side/.test(
      normalize(sql.replace(/'(?:[^']|'')*'/g, "''"))
    )
  );

  const failed = results.filter((r) => !r.pass).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed.`);
  if (failed > 0) process.exit(1);
}

main();
