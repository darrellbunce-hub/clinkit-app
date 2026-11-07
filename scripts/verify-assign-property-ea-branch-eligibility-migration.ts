/**
 * Static checks for directory eligibility in Estate Agent appointment:
 *
 *   supabase/migrations/20261011090000_assign_property_ea_branch_directory_eligibility.sql
 *
 * assign_property_ea_branch must refuse a branch that is not in
 * ea_branch_directory (Rules 17.15 and 25.16) with the generic branch_not_found
 * failure before anything is revoked or inserted; the same branch keeps its
 * assignment and may be kept or restricted but not given delegated updates
 * while ineligible; everything else in the function is unchanged from
 * 20261005120000. Reads repository files only.
 *
 * Usage:
 *   npx tsx scripts/verify-assign-property-ea-branch-eligibility-migration.ts
 */
import { readdirSync, readFileSync } from "fs";
import { join } from "path";

const ROOT = join(import.meta.dirname, "..");
const MIGRATIONS_DIR = "supabase/migrations";
const FILE = "20261011090000_assign_property_ea_branch_directory_eligibility.sql";
const PREVIOUS_LATEST = "20261010120000_ea_branch_directory_search_eligibility.sql";
const M3 = "20261005120000_operational_authority_enforcement.sql";
const DIRECTORY = PREVIOUS_LATEST;
const SIGNATURE = "public.assign_property_ea_branch(bigint, uuid, boolean)";

const ELIGIBILITY_DECLARATION = "v_branch_selectable boolean;";
const ELIGIBILITY_LOOKUP =
  "v_branch_selectable := exists ( select 1 from public.ea_branch_directory d where d.branch_id = p_branch_id );";
const SAME_BRANCH_GUARD =
  "if not v_branch_selectable and coalesce(v_existing.homeowner_only_updates, true) and p_homeowner_only_updates is false then return jsonb_build_object('ok', false, 'error', 'branch_not_found'); end if;";
const NEW_BRANCH_GUARD =
  "if not v_branch_selectable then return jsonb_build_object('ok', false, 'error', 'branch_not_found'); end if;";

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

function functionSource(sql: string, name: string): { header: string; body: string } {
  const pattern = new RegExp(
    `(create\\s+(?:or\\s+replace\\s+)?function\\s+public\\.${name}\\s*\\([\\s\\S]*?)\\$(\\w*)\\$([\\s\\S]*?)\\$\\2\\$`,
    "i"
  );
  const match = sql.match(pattern);
  return { header: normalize(match?.[1] ?? ""), body: normalize(match?.[3] ?? "") };
}

function definesFunction(sql: string, name: string): boolean {
  return new RegExp(`create\\s+(?:or\\s+replace\\s+)?function\\s+public\\.${name}\\s*\\(`, "i").test(sql);
}

function errorCodes(body: string): string[] {
  return [...new Set([...body.matchAll(/'error', '([a-z_]+)'/g)].map((m) => m[1]))].sort();
}

function main() {
  const migrations = readdirSync(join(ROOT, MIGRATIONS_DIR))
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const raw = new Map(migrations.map((f) => [f, read(`${MIGRATIONS_DIR}/${f}`)]));
  const sqlOf = new Map(migrations.map((f) => [f, stripSqlComments(raw.get(f)!)]));
  const latestDefiner = (name: string) => migrations.filter((f) => definesFunction(sqlOf.get(f)!, name)).at(-1);

  // Ordering
  const index = migrations.indexOf(FILE);
  record("Ordering: migration file exists", index > -1);
  record(
    `Ordering: applies directly after ${PREVIOUS_LATEST}`,
    index > -1 && migrations[index - 1] === PREVIOUS_LATEST
  );
  const version = FILE.slice(0, 14);
  record("Ordering: version is unique", migrations.filter((f) => f.slice(0, 14) === version).length === 1);
  record(
    "Ordering: this file is the latest definition of assign_property_ea_branch",
    latestDefiner("assign_property_ea_branch") === FILE,
    latestDefiner("assign_property_ea_branch")
  );

  const sql = sqlOf.get(FILE) ?? "";
  const flat = normalize(sql);
  const current = functionSource(sql, "assign_property_ea_branch");
  const previous = functionSource(sqlOf.get(M3) ?? "", "assign_property_ea_branch");

  // Unchanged except for the eligibility additions
  record(
    "Function: header identical to 20261005120000 (signature, jsonb, plpgsql, SECURITY DEFINER, search_path = public)",
    current.header !== "" && current.header === previous.header,
    current.header
  );
  const withoutAdditions = normalize(
    current.body
      .replace(ELIGIBILITY_DECLARATION, "")
      .replace(ELIGIBILITY_LOOKUP, "")
      .replace(SAME_BRANCH_GUARD, "")
      .replace(NEW_BRANCH_GUARD, "")
  );
  record(
    "Function: body is the 20261005120000 body plus only the eligibility declaration, lookup and two guards",
    previous.body !== "" &&
      current.body.includes(ELIGIBILITY_DECLARATION) &&
      current.body.includes(ELIGIBILITY_LOOKUP) &&
      current.body.includes(SAME_BRANCH_GUARD) &&
      current.body.includes(NEW_BRANCH_GUARD) &&
      withoutAdditions === previous.body
  );
  record(
    "Function: no new failure codes (eligibility reuses branch_not_found)",
    JSON.stringify(errorCodes(current.body)) === JSON.stringify(errorCodes(previous.body)),
    `${errorCodes(previous.body).join(",")} -> ${errorCodes(current.body).join(",")}`
  );

  // Placement
  const at = (needle: string) => current.body.indexOf(needle);
  const authorised = at("if not public.is_property_seller_side_homeowner(p_property_id) then");
  const buyerSide = at("'branch_acts_for_buyer'");
  const lock = at("from public.property_ea_assignments where property_id = p_property_id and status = 'active' for update;");
  const lookup = at(ELIGIBILITY_LOOKUP);
  const sameBranch = at("if v_existing.id is not null and v_existing.branch_id = p_branch_id then");
  const sameBranchGuard = at(SAME_BRANCH_GUARD);
  const sameBranchUpdate = at("update public.property_ea_assignments set homeowner_only_updates = coalesce(");
  const newBranchGuard = at(NEW_BRANCH_GUARD);
  const revoke = at("revocation_reason = 'replaced'");
  const insert = at("insert into public.property_ea_assignments");
  record(
    "Placement: eligibility is looked up after authorisation, the buyer-side check and the assignment lock",
    authorised > -1 && buyerSide > authorised && lock > buyerSide && lookup > lock
  );
  record(
    "Placement: the same-branch guard runs before the same-branch update",
    sameBranch > lookup && sameBranchGuard > sameBranch && sameBranchUpdate > sameBranchGuard
  );
  record(
    "Placement: a new or replacing ineligible branch is refused before the existing assignment is revoked or a row inserted",
    newBranchGuard > sameBranchUpdate && revoke > newBranchGuard && insert > revoke
  );
  record(
    "Same branch: only enabling delegated updates (homeowner-only true -> false) is refused; null keeps the current value",
    current.body.includes("coalesce( p_homeowner_only_updates, v_existing.homeowner_only_updates )") &&
      SAME_BRANCH_GUARD.includes("p_homeowner_only_updates is false") &&
      SAME_BRANCH_GUARD.includes("coalesce(v_existing.homeowner_only_updates, true)")
  );

  // Eligibility source
  const directory = normalize(stripSqlComments(raw.get(DIRECTORY) ?? ""));
  record(
    "Eligibility: ea_branch_directory (20261010120000) applies fixture, reserved-domain and entitlement rules",
    directory.includes("create or replace view public.ea_branch_directory") &&
      directory.includes("from public.smoke_test_fixture_objects o") &&
      directory.includes("public.is_ea_branch_commercially_entitled(b.id)") &&
      directory.includes("with (security_invoker = false)")
  );
  record(
    "Eligibility: no later migration redefines ea_branch_directory",
    migrations
      .slice(migrations.indexOf(DIRECTORY) + 1)
      .every((f) => !/create\s+(or\s+replace\s+)?view\s+public\.ea_branch_directory/i.test(sqlOf.get(f)!))
  );

  // Scope
  const outsideDollarQuotes = sql
    .replace(/\$(\w*)\$[\s\S]*?\$\1\$/g, "$$$$")
    .replace(/'(?:[^']|'')*'/g, "''");
  const statements = outsideDollarQuotes
    .split(";")
    .map((s) => normalize(s))
    .filter((s) => s !== "");
  const unexpected = statements.filter(
    (s) =>
      s !== "do $$" &&
      !s.startsWith("create or replace function public.assign_property_ea_branch(") &&
      !s.startsWith("comment on function public.assign_property_ea_branch(")
  );
  record(
    "Scope: only assign_property_ea_branch is redefined and commented (grants and owner preserved, not restated)",
    unexpected.length === 0,
    unexpected.join(" | ")
  );
  record(
    "Scope: exactly one function definition",
    (sql.match(/create\s+(?:or\s+replace\s+)?function/gi) ?? []).length === 1
  );
  const outsideFunction = flat
    .replace(/create or replace function public\.assign_property_ea_branch\([\s\S]*?\$\$[\s\S]*?\$\$;/, "")
    .replace(/'(?:[^']|'')*'/g, "''");
  record(
    "Scope: no data, table, view, policy, trigger or grant changes",
    !/\b(insert\s+into|update\s+public\.|delete\s+from|truncate|alter\s+table|create\s+(or\s+replace\s+)?view|create\s+policy|alter\s+policy|drop\s+policy|create\s+trigger|drop\s+trigger|drop\s+function|grant\s+\w+|revoke\s+\w+|alter\s+function)\b/.test(
      outsideFunction
    )
  );
  record(
    "Scope: reconnection, EA property creation and set_property_ea_update_permission are untouched",
    !/reconnect_returning_ea_branch|_create_ea_operational_property_core|_ea_assign_originated_property|create\s+or\s+replace\s+function\s+public\.set_property_ea_update_permission/.test(
      sql
    )
  );

  // Preflight and postflight
  record(
    "Preflight: aborts unless the 20261005120000 body, definer, search_path, owner and grants are live",
    flat.includes("assign_property_ea_branch_directory_eligibility aborted: assign_property_ea_branch differs from 20261005120000") &&
      flat.includes("or v_src like '%ea_branch_directory%'") &&
      flat.includes("v_config is distinct from array['search_path=public']") &&
      flat.includes("v_owner is distinct from 'postgres'") &&
      flat.includes("assign_property_ea_branch_directory_eligibility aborted: assign_property_ea_branch grants differ from 20261005120000")
  );
  record(
    "Preflight: aborts unless ea_branch_directory is the 20261010120000 eligibility view",
    flat.includes("assign_property_ea_branch_directory_eligibility aborted: ea_branch_directory is not the 20261010120000 eligibility view") &&
      flat.includes("v_viewdef not like '%is_ea_branch_commercially_entitled%'") &&
      flat.includes("v_viewdef not like '%smoke_test_fixture_objects%'")
  );
  record(
    "Preflight/postflight: the function ACL is captured before and compared after",
    flat.includes("perform set_config('moveloop.assign_property_ea_branch_acl', v_acl, false);") &&
      flat.includes("v_acl is distinct from current_setting('moveloop.assign_property_ea_branch_acl', true)")
  );
  record(
    "Postflight: definer, search_path, owner, anon refusal and authenticated execute re-checked",
    flat.includes("assign_property_ea_branch_directory_eligibility postflight: signature, definer, search_path or owner changed") &&
      flat.includes("assign_property_ea_branch_directory_eligibility postflight: grants changed") &&
      flat.includes(`has_function_privilege('anon', '${SIGNATURE}', 'execute')`)
  );
  record(
    "Postflight: the eligibility lookup precedes the same-branch path, the revoke and the insert",
    flat.includes("v_check := strpos(v_src, 'from public.ea_branch_directory d');") &&
      flat.includes("not (v_check < v_same_branch and v_same_branch < v_revoke and v_revoke < v_insert)") &&
      flat.includes("assign_property_ea_branch_directory_eligibility postflight: eligibility check missing or not before revoke and insert")
  );

  // Application
  const assignments = read("lib/estateAgent/assignments.ts");
  const message = assignments.match(/case "branch_not_found":\s*return "([^"]+)";/)?.[1] ?? "";
  record(
    "App: branch_not_found is shown with the existing generic message (no billing or fixture detail)",
    message === "That estate agent branch could not be found." &&
      !/subscri|billing|entitle|trial|payment|fixture|test/i.test(message)
  );
  record(
    "App: the homeowner panel still appoints through assignPropertyToBranch and toggles through updatePropertyEaDelegation",
    /assignPropertyToBranch\(\s*supabase,/.test(read("components/estate-agents/PropertyEstateAgentAssignment.tsx")) &&
      /updatePropertyEaDelegation\(\s*supabase,\s*propertyId,\s*checked\s*\)/.test(
        read("components/estate-agents/PropertyEstateAgentAssignment.tsx")
      )
  );

  // Verifiers no longer depend on appointing an unentitled verifier branch
  const seeded = [
    "scripts/verify-participation-delink.ts",
    "scripts/verify-operational-intelligence-queue-development.ts",
    "scripts/verify-dashboard-genuine-last-update-development.ts",
    "scripts/verify-ea-reconnection-development.ts",
  ];
  const stillCalling = seeded.filter((f) => /assignPropertyToBranch\(|"assign_property_ea_branch"/.test(read(f)));
  record(
    "Verifiers: setup appointments of verifier branches are written by the service role, not the RPC",
    stillCalling.length === 0,
    stillCalling.join(", ")
  );
  const expectations: Array<[string, string[]]> = [
    ["scripts/verify-start-move-onward-purchase-link-development.ts", ["SM5 the owner cannot appoint an ineligible branch"]],
    ["scripts/verify-buyer-join-buyer-ready-development.ts", ["BJ11 homeowner cannot appoint the ineligible verifier EA"]],
    ["scripts/verify-awaiting-connection-development.ts", ["AW10 Person B cannot appoint ineligible EA B"]],
    [
      "scripts/verify-operational-authority-rls-development.ts",
      [
        "OA1 Person B cannot appoint ineligible EA B",
        "OA5 replacing EA A with ineligible EA B is refused",
        "OA5 re-appointing the same ineligible branch cannot enable its updates",
        "OA5 re-appointing the same ineligible branch with updates disabled still succeeds",
      ],
    ],
  ];
  const missing = expectations.flatMap(([f, names]) => names.filter((n) => !read(f).includes(n)).map((n) => `${f}: ${n}`));
  record(
    "Verifiers: RPC appointments of verifier branches now expect branch_not_found",
    missing.length === 0,
    missing.join(" | ")
  );

  const failed = results.filter((r) => !r.pass).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed.`);
  if (failed > 0) process.exit(1);
}

main();
