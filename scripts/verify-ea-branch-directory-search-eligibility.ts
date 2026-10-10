/**
 * Estate Agent branch directory search and eligibility — offline checks.
 *
 * Covers 20261010120000_ea_branch_directory_search_eligibility.sql and the
 * homeowner search client:
 *   - the directory view lists only eligible branches (Rule 17.15 fixture and
 *     test exclusion; Rule 25.16 per-branch entitlement) and keeps its shape
 *   - search runs on the server and matches terms before the row limit
 *   - the assigned-branch label comes from a scoped definer RPC
 *   - the client no longer loads 200 rows and filters in the browser
 *
 * Usage:
 *   npx tsx scripts/verify-ea-branch-directory-search-eligibility.ts
 */
import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";

const ROOT = join(__dirname, "..");
const MIGRATION = "20261010120000_ea_branch_directory_search_eligibility.sql";
const PREVIOUS = "20261010110000_link_start_move_onward_purchase.sql";

type TestResult = { name: string; pass: boolean; detail?: string };
const results: TestResult[] = [];

function record(name: string, pass: boolean, detail?: string) {
  results.push({ name, pass, detail });
  console.log(pass ? `✓ ${name}` : `✗ ${name}${detail ? `: ${detail}` : ""}`);
}

function read(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), "utf8");
}

function section(sql: string, start: string, end: string): string {
  const from = sql.indexOf(start);
  const to = sql.indexOf(end, from + start.length);
  return from >= 0 && to > from ? sql.slice(from, to) : "";
}

function withoutComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, "");
}

const migrationsDir = join(ROOT, "supabase", "migrations");
const migrationFiles = readdirSync(migrationsDir).filter((file) => file.endsWith(".sql")).sort();
const sql = read(`supabase/migrations/${MIGRATION}`);
const code = withoutComments(sql);

// --- Ordering ---
{
  const version = MIGRATION.split("_")[0];
  record(
    "ordering: migration follows the Start Move link migration and is the latest",
    migrationFiles.includes(PREVIOUS) &&
      migrationFiles.indexOf(MIGRATION) === migrationFiles.indexOf(PREVIOUS) + 1 &&
      migrationFiles[migrationFiles.length - 1] === MIGRATION
  );
  record(
    "ordering: version is unique",
    migrationFiles.filter((file) => file.split("_")[0] === version).length === 1
  );
}

// --- View ---
const view = section(code, "create or replace view public.ea_branch_directory", "comment on view public.ea_branch_directory");
{
  record("view: keeps security_invoker = false", /with \(security_invoker = false\)/.test(view));
  const columns = [
    "b.id as branch_id",
    "b.name as branch_name",
    "b.town_or_city",
    "b.postcode",
    "c.id as company_id",
    "c.name as company_name",
  ];
  const positions = columns.map((column) => view.indexOf(column));
  record(
    "view: same six columns in the same order",
    positions.every((position, index) => position > 0 && (index === 0 || position > positions[index - 1]))
  );
  record("view: no auth.uid() predicate (not viewer-dependent)", !/auth\.uid\(\)/.test(view));
  record(
    "view: excludes active fixture branches, companies and company creators",
    view.includes("f.status = 'active'") &&
      view.includes("o.object_type = 'ea_branch' and o.object_id = b.id::text") &&
      view.includes("o.object_type = 'ea_company' and o.object_id = c.id::text") &&
      view.includes("o.object_type = 'auth_user' and o.object_id = c.created_by_user_id::text")
  );
  record(
    "view: excludes reserved test domains on the company and its creator",
    /lower\(btrim\(c\.email_domain\)\)\s*!~/.test(view) &&
      /from auth\.users u\s+where u\.id = c\.created_by_user_id/.test(view) &&
      /split_part\(coalesce\(u\.email, ''\), '@', 2\)\)\s*~/.test(view)
  );
  record(
    "view: requires per-branch commercial entitlement",
    view.includes("public.is_ea_branch_commercially_entitled(b.id)")
  );
  record(
    "view grants: revoke all from public, anon and authenticated; grant SELECT to authenticated only",
    code.includes("revoke all on public.ea_branch_directory from public;") &&
      code.includes("revoke all on public.ea_branch_directory from anon;") &&
      code.includes("revoke all on public.ea_branch_directory from authenticated;") &&
      code.includes("grant select on public.ea_branch_directory to authenticated;") &&
      !/grant\s+(?!select)[a-z, ]+on public\.ea_branch_directory/i.test(code)
  );
}

// --- Reserved-domain pattern ---
{
  const match = view.match(/!~\s*'([^']+)'/);
  const pattern = match ? new RegExp(match[1]) : null;
  const creatorMatch = view.match(/\)\s*~\s*'([^']+)'/);
  record(
    "domains: company and creator checks use the same pattern",
    match != null && creatorMatch != null && match[1] === creatorMatch[1]
  );
  const excluded = [
    "verify.test",
    "a.b.test",
    "example",
    "agency.example",
    "x.invalid",
    "localhost",
    "example.com",
    "mail.example.org",
    "example.net",
  ];
  const included = [
    "moveloop.co.uk",
    "contest.co.uk",
    "testing.co.uk",
    "testagency.com",
    "myexample.com",
    "example.co.uk",
    "test.co.uk",
    "agency.testing",
  ];
  record(
    "domains: reserved test domains are excluded",
    pattern != null && excluded.every((domain) => pattern.test(domain)),
    excluded.filter((domain) => !pattern?.test(domain)).join(",")
  );
  record(
    "domains: ordinary domains containing 'test' or 'example' are not excluded",
    pattern != null && included.every((domain) => !pattern.test(domain)),
    included.filter((domain) => pattern?.test(domain)).join(",")
  );
}

// --- Search RPC ---
const search = section(
  code,
  "create or replace function public.search_ea_branch_directory(",
  "comment on function public.search_ea_branch_directory"
);
{
  record(
    "search: SECURITY INVOKER over the view, returning the view's rows",
    /returns setof public\.ea_branch_directory/.test(search) &&
      /security invoker/.test(search) &&
      !/security definer/.test(search) &&
      search.includes("from public.ea_branch_directory d") &&
      !/public\.ea_branches\b|public\.ea_companies\b/.test(search)
  );
  record(
    "search: query trimmed, 2–100 characters, at most 8 terms",
    search.includes("lower(btrim(coalesce(p_query, '')))") &&
      search.includes("char_length(i.query) between 2 and 100") &&
      search.includes("[1:8]")
  );
  record(
    "search: every term must match company, branch, town or postcode",
    search.includes("from unnest(s.terms) as term") &&
      search.includes("concat_ws(' ', d.company_name, d.branch_name, d.town_or_city, d.postcode)") &&
      /where not exists \(\s*select 1\s*from unnest/.test(search) &&
      search.includes(") = 0")
  );
  record(
    "search: terms are matched literally (strpos, no LIKE/regex on user input)",
    search.includes("strpos(") && !/\blike\b|\bilike\b|~\*?\s*term/i.test(search)
  );
  const whereIndex = search.indexOf("where not exists");
  const orderIndex = search.indexOf("order by d.company_name, d.branch_name, d.branch_id");
  const limitIndex = search.indexOf("limit greatest(1, least(coalesce(p_limit, 20), 50))");
  record(
    "search: filters before ordering and the clamped limit (1–50, default 20)",
    whereIndex > 0 && orderIndex > whereIndex && limitIndex > orderIndex
  );
  record(
    "search grants: authenticated and service_role only",
    code.includes("revoke all on function public.search_ea_branch_directory(text, integer) from public, anon;") &&
      code.includes(
        "grant execute on function public.search_ea_branch_directory(text, integer) to authenticated, service_role;"
      )
  );
}

// --- Label RPC ---
const label = section(
  code,
  "create or replace function public.get_property_ea_branch_entry(",
  "comment on function public.get_property_ea_branch_entry"
);
{
  record(
    "label: SECURITY DEFINER with search_path = public",
    /security definer/.test(label) && /set search_path = public/.test(label)
  );
  record(
    "label: active assignment of the requested property only",
    label.includes("a.property_id = p_property_id") && label.includes("a.status = 'active'") && /limit 1;/.test(label)
  );
  record(
    "label: same audience as the assignment select policy (property member or member of that branch)",
    label.includes("auth.uid() is not null") &&
      label.includes("public.is_property_member(a.property_id)") &&
      /bm\.branch_id = a\.branch_id\s+and bm\.user_id = auth\.uid\(\)/.test(label)
  );
  record(
    "label: returns only the six directory columns",
    /returns table \(\s*branch_id uuid,\s*branch_name text,\s*town_or_city text,\s*postcode text,\s*company_id uuid,\s*company_name text\s*\)/.test(
      label
    )
  );
  record(
    "label grants: authenticated and service_role only",
    code.includes("revoke all on function public.get_property_ea_branch_entry(bigint) from public, anon;") &&
      code.includes("grant execute on function public.get_property_ea_branch_entry(bigint) to authenticated, service_role;")
  );
}

// --- Scope ---
{
  record(
    "scope: no data writes",
    !/\b(insert into|delete from|truncate)\b/i.test(code) && !/\bupdate\s+public\./i.test(code)
  );
  record(
    "scope: no table, policy or trigger changes; assign_property_ea_branch untouched",
    !/\b(alter table|create table|drop table|create policy|drop policy|create trigger|drop trigger)\b/i.test(code) &&
      !code.includes("assign_property_ea_branch")
  );
  record(
    "preflight and postflight present",
    code.includes("ea_branch_directory_search_eligibility aborted") &&
      code.includes("ea_branch_directory_search_eligibility postflight")
  );
}

// --- Allowlist ---
{
  const allowlist = JSON.parse(read("scripts/secdef-user-rpc-allowlist.json")) as {
    allowlist: Array<{ name: string; args: string }>;
  };
  record(
    "allowlist: definer label RPC listed; invoker search RPC not listed",
    allowlist.allowlist.some((entry) => entry.name === "get_property_ea_branch_entry" && entry.args === "bigint") &&
      !allowlist.allowlist.some((entry) => entry.name === "search_ea_branch_directory")
  );
}

// --- Client ---
{
  const assignments = read("lib/estateAgent/assignments.ts");
  const component = read("components/estate-agents/PropertyEstateAgentAssignment.tsx");
  record(
    "client: no 200-row directory load or browser-side filter",
    !assignments.includes('from("ea_branch_directory")') &&
      !assignments.includes(".limit(200)") &&
      !assignments.includes("filterEaBranchDirectory") &&
      !assignments.includes("loadEaBranchDirectory")
  );
  record(
    "client: searchEaBranchDirectory calls search_ea_branch_directory with the query and limit",
    /supabase\.rpc\(\s*"search_ea_branch_directory",\s*\{\s*p_query: trimmedQuery,\s*p_limit: limit,?\s*\}/.test(
      assignments
    )
  );
  record(
    "client: assigned-branch label comes from get_property_ea_branch_entry",
    /supabase\.rpc\(\s*"get_property_ea_branch_entry",\s*\{ p_property_id: propertyId \}/.test(assignments)
  );
  record(
    "component: server search with debounce and stale-response guard",
    component.includes("searchEaBranchDirectory(") &&
      component.includes("setTimeout(") &&
      component.includes("clearTimeout(timer)") &&
      component.includes("cancelled = true") &&
      component.includes("searchState?.query === trimmedSearchQuery") &&
      !component.includes("loadEaBranchDirectory") &&
      !component.includes("filterEaBranchDirectory")
  );

  const sourceRoots = ["app", "components", "lib", "hooks"];
  const offenders: string[] = [];
  const walk = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.(ts|tsx)$/.test(entry.name)) {
        const text = readFileSync(path, "utf8");
        if (
          text.includes('from("ea_branch_directory")') ||
          text.includes("loadEaBranchDirectory") ||
          text.includes("filterEaBranchDirectory")
        ) {
          offenders.push(path.slice(ROOT.length + 1));
        }
      }
    }
  };
  for (const rootDir of sourceRoots) walk(join(ROOT, rootDir));
  record("client: no app code reads the directory view directly", offenders.length === 0, offenders.join(","));
}

const failed = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - failed}/${results.length} checks passed.`);
if (failed > 0) process.exit(1);
