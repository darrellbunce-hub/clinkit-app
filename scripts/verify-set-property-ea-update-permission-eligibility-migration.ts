/**
 * Static checks for directory eligibility in the Estate Agent delegation toggle:
 *
 *   supabase/migrations/20261011100000_set_property_ea_update_permission_directory_eligibility.sql
 *
 * set_property_ea_update_permission must refuse to give delegated updates
 * (homeowner_only_updates true or null -> false) to an actively assigned branch
 * that is not in ea_branch_directory (Rules 17.15 and 25.16), with the generic
 * branch_not_found, after authorisation and before the update; restricting, or
 * keeping existing delegation, is unaffected; everything else is unchanged from
 * 20261005120000. Reads repository files only.
 *
 * Usage:
 *   npx tsx scripts/verify-set-property-ea-update-permission-eligibility-migration.ts
 */
import { readdirSync, readFileSync } from "fs";
import { join } from "path";

import { formatPropertyEaAssignmentError, formatPropertyEaDelegationError } from "../lib/estateAgent/assignments";

const ROOT = join(import.meta.dirname, "..");
const MIGRATIONS_DIR = "supabase/migrations";
const FILE = "20261011100000_set_property_ea_update_permission_directory_eligibility.sql";
const PREVIOUS_LATEST = "20261011090000_assign_property_ea_branch_directory_eligibility.sql";
const M3 = "20261005120000_operational_authority_enforcement.sql";
const DIRECTORY = "20261010120000_ea_branch_directory_search_eligibility.sql";
const SIGNATURE = "public.set_property_ea_update_permission(bigint, boolean)";

const LOCK =
  "perform 1 from public.property_ea_assignments pea where pea.property_id = p_property_id and pea.status = 'active' for update;";
const GUARD =
  "if p_homeowner_only_updates is false and exists ( select 1 from public.property_ea_assignments pea where pea.property_id = p_property_id and pea.status = 'active' and pea.homeowner_only_updates is distinct from false and not exists ( select 1 from public.ea_branch_directory d where d.branch_id = pea.branch_id ) ) then return jsonb_build_object('ok', false, 'error', 'branch_not_found'); end if;";

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
  record(`Ordering: applies directly after ${PREVIOUS_LATEST}`, index > -1 && migrations[index - 1] === PREVIOUS_LATEST);
  record("Ordering: version is unique", migrations.filter((f) => f.slice(0, 14) === FILE.slice(0, 14)).length === 1);
  record(
    "Ordering: this file is the latest definition of set_property_ea_update_permission",
    latestDefiner("set_property_ea_update_permission") === FILE,
    latestDefiner("set_property_ea_update_permission")
  );
  record(
    "Ordering: assign_property_ea_branch keeps its 20261011090000 definition",
    latestDefiner("assign_property_ea_branch") === PREVIOUS_LATEST,
    latestDefiner("assign_property_ea_branch")
  );

  const sql = sqlOf.get(FILE) ?? "";
  const flat = normalize(sql);
  const current = functionSource(sql, "set_property_ea_update_permission");
  const previous = functionSource(sqlOf.get(M3) ?? "", "set_property_ea_update_permission");

  // Unchanged except for the lock and guard
  record(
    "Function: header identical to 20261005120000 (signature, jsonb, plpgsql, SECURITY DEFINER, search_path = public)",
    current.header !== "" && current.header === previous.header,
    current.header
  );
  record(
    "Function: body is the 20261005120000 body plus only the assignment lock and the eligibility guard",
    previous.body !== "" &&
      current.body.includes(LOCK) &&
      current.body.includes(GUARD) &&
      normalize(current.body.replace(LOCK, "").replace(GUARD, "")) === previous.body
  );
  const added = errorCodes(current.body).filter((code) => !errorCodes(previous.body).includes(code));
  record(
    "Function: the only new failure is the generic branch_not_found already used by assign_property_ea_branch",
    JSON.stringify(added) === JSON.stringify(["branch_not_found"]) &&
      errorCodes(functionSource(sqlOf.get(PREVIOUS_LATEST) ?? "", "assign_property_ea_branch").body).includes("branch_not_found"),
    added.join(",")
  );

  // Placement and scope of the guard
  const at = (needle: string) => current.body.indexOf(needle);
  const authenticated = at("if auth.uid() is null then");
  const value = at("if p_homeowner_only_updates is null then");
  const authorised = at("if not public.is_property_seller_side_homeowner(p_property_id) then");
  const lock = at(LOCK);
  const guard = at(GUARD);
  const update = at("update public.property_ea_assignments set homeowner_only_updates = p_homeowner_only_updates");
  record(
    "Placement: authentication, value and seller-side checks keep their order and run before the guard",
    authenticated > -1 && value > authenticated && authorised > value && lock > authorised
  );
  record("Placement: the active assignment is locked before the guard reads it", guard > lock);
  record("Placement: the guard runs before the update", update > guard);
  record(
    "Guard: applies only when enabling delegated updates on an assignment that does not already have them",
    GUARD.startsWith("if p_homeowner_only_updates is false and exists") &&
      GUARD.includes("pea.homeowner_only_updates is distinct from false") &&
      GUARD.includes("pea.status = 'active'")
  );
  record(
    "Guard: eligibility is membership of ea_branch_directory for the assigned branch",
    GUARD.includes("not exists ( select 1 from public.ea_branch_directory d where d.branch_id = pea.branch_id )")
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
  const outsideDollarQuotes = sql.replace(/\$(\w*)\$[\s\S]*?\$\1\$/g, "$$$$").replace(/'(?:[^']|'')*'/g, "''");
  const unexpected = outsideDollarQuotes
    .split(";")
    .map((s) => normalize(s))
    .filter((s) => s !== "")
    .filter(
      (s) =>
        s !== "do $$" &&
        !s.startsWith("create or replace function public.set_property_ea_update_permission(") &&
        !s.startsWith("comment on function public.set_property_ea_update_permission(")
    );
  record(
    "Scope: only set_property_ea_update_permission is redefined and commented (grants and owner preserved, not restated)",
    unexpected.length === 0,
    unexpected.join(" | ")
  );
  record("Scope: exactly one function definition", (sql.match(/create\s+(?:or\s+replace\s+)?function/gi) ?? []).length === 1);
  const outsideFunction = flat
    .replace(/create or replace function public\.set_property_ea_update_permission\([\s\S]*?\$\$[\s\S]*?\$\$;/, "")
    .replace(/'(?:[^']|'')*'/g, "''");
  record(
    "Scope: no data, table, view, policy, trigger or grant changes",
    !/\b(insert\s+into|update\s+public\.|delete\s+from|truncate|alter\s+table|create\s+(or\s+replace\s+)?view|create\s+policy|alter\s+policy|drop\s+policy|create\s+trigger|drop\s+trigger|drop\s+function|grant\s+\w+|revoke\s+\w+|alter\s+function)\b/.test(
      outsideFunction
    )
  );
  record(
    "Scope: can_operate_property, assignment, reconnection and EA property creation are untouched",
    !/function\s+public\.(can_operate_property|assign_property_ea_branch|reconnect_returning_ea_branch|_create_ea_operational_property_core)\s*\(/i.test(sql)
  );

  // Preflight and postflight
  record(
    "Preflight: aborts unless the 20261005120000 body, definer, search_path, owner and grants are live",
    flat.includes("set_property_ea_update_permission_directory_eligibility aborted: set_property_ea_update_permission differs from 20261005120000") &&
      flat.includes("or v_src like '%ea_branch_directory%'") &&
      flat.includes("v_config is distinct from array['search_path=public']") &&
      flat.includes("v_owner is distinct from 'postgres'") &&
      flat.includes("set_property_ea_update_permission_directory_eligibility aborted: set_property_ea_update_permission grants differ from 20261005120000")
  );
  record(
    "Preflight: aborts unless 20261011090000 is applied and ea_branch_directory is the eligibility view",
    flat.includes("aborted: 20261011090000 (assign_property_ea_branch directory eligibility) is not applied") &&
      flat.includes("set_property_ea_update_permission_directory_eligibility aborted: ea_branch_directory is not the 20261010120000 eligibility view")
  );
  record(
    "Preflight/postflight: the function ACL is captured before and compared after",
    flat.includes("perform set_config('moveloop.set_property_ea_update_permission_acl', v_acl, false);") &&
      flat.includes("v_acl is distinct from current_setting('moveloop.set_property_ea_update_permission_acl', true)")
  );
  record(
    "Postflight: definer, search_path, owner, anon refusal and authenticated execute re-checked",
    flat.includes("set_property_ea_update_permission_directory_eligibility postflight: signature, definer, search_path or owner changed") &&
      flat.includes("set_property_ea_update_permission_directory_eligibility postflight: grants changed") &&
      flat.includes(`has_function_privilege('anon', '${SIGNATURE}', 'execute')`)
  );
  record(
    "Postflight: authorisation, lock, eligibility and update appear in that order",
    flat.includes("not (v_authorised < v_lock and v_lock < v_check and v_check < v_update)") &&
      flat.includes("postflight: eligibility check missing or not between authorisation and update")
  );

  // Application
  const assignments = read("lib/estateAgent/assignments.ts");
  const delegationMessage = formatPropertyEaDelegationError("branch_not_found");
  record(
    "App: a refused delegation toggle shows the neutral eligibility message (no billing or fixture detail)",
    delegationMessage ===
      "This Estate Agent branch is not currently eligible for delegated updates. If you think this is incorrect, check with your estate agent." &&
      !/subscri|billing|entitle|trial|payment|fixture|test|directory|smoke/i.test(delegationMessage)
  );
  const otherCodes = ["not_authorized", "no_active_assignment", "invalid_value", "not_authenticated", null, undefined];
  record(
    "App: every other delegation failure keeps its existing message",
    otherCodes.every((code) => formatPropertyEaDelegationError(code) === formatPropertyEaAssignmentError(code))
  );
  record(
    "App: appointment keeps the generic branch_not_found message (unknown and ineligible ids look the same)",
    formatPropertyEaAssignmentError("branch_not_found") === "That estate agent branch could not be found."
  );
  record(
    "App: only the delegation toggle uses the delegation message",
    /"set_property_ea_update_permission",[\s\S]*?\},\s*formatPropertyEaDelegationError\s*\)/.test(assignments) &&
      /"assign_property_ea_branch",[\s\S]*?\}\s*\);/.test(assignments) &&
      (assignments.match(/formatPropertyEaDelegationError\b/g) ?? []).length === 2
  );
  const panel = read("components/estate-agents/PropertyEstateAgentAssignment.tsx");
  record(
    "App: the delegation toggle calls set_property_ea_update_permission and reverts the switch on error",
    /"set_property_ea_update_permission"/.test(assignments) &&
      /updatePropertyEaDelegation\(\s*supabase,\s*propertyId,\s*checked\s*\)/.test(panel) &&
      /if \(result\.error\) \{\s*setErrorMessage\(result\.error\);\s*setHomeownerOnlyUpdates\(!checked\);/.test(panel)
  );

  // Verifiers that enabled delegation for their own (never eligible) branches
  const expectations: Array<[string, string[]]> = [
    [
      "scripts/verify-awaiting-connection-development.ts",
      [
        "AW4 the seller cannot give ineligible EA B delegated updates",
        "AW10 Person B cannot give ineligible EA B delegated updates",
        "AW10 Person B cannot re-enable delegated updates for ineligible EA B",
      ],
    ],
    [
      "scripts/verify-operational-authority-rls-development.ts",
      [
        "OA1 Person B cannot give ineligible EA B delegated updates",
        "OA1 Person B cannot re-enable delegated updates for ineligible EA B",
        "OA2.2 homeowner cannot give the ineligible EA delegated updates",
      ],
    ],
    [
      "scripts/verify-ea-branch-directory-eligibility-development.ts",
      ["DV5 the delegation toggle cannot give the unlisted branch delegated updates"],
    ],
    [
      "scripts/verify-ea-branch-directory-eligibility-local.ts",
      [
        "L6 the delegation toggle enables and restricts updates for a listed branch",
        "L6 the delegation toggle cannot give the ended branch delegated updates",
      ],
    ],
  ];
  const missing = expectations.flatMap(([f, names]) => names.filter((n) => !read(f).includes(n)).map((n) => `${f}: ${n}`));
  record("Verifiers: enabling delegation for an ineligible verifier branch now expects branch_not_found", missing.length === 0, missing.join(" | "));
  const enabling = [
    "scripts/verify-awaiting-connection-development.ts",
    "scripts/verify-operational-authority-rls-development.ts",
  ].filter((f) => /allowEaUpdatesAsFixture\(ctx, \w+\)/.test(read(f)) === false);
  record(
    "Verifiers: delegation for verifier branches is written by the service role where a scenario needs it",
    enabling.length === 0,
    enabling.join(", ")
  );

  const failed = results.filter((r) => !r.pass).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed.`);
  if (failed > 0) process.exit(1);
}

main();
