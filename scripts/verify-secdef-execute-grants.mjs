/**
 * CI / catalog regression: SECURITY DEFINER EXECUTE grants.
 *
 * Fails when:
 * 1. A remediation target still has anon/authenticated/public EXECUTE or lacks service_role.
 * 2. A SECURITY DEFINER function is executable by anon/authenticated and is not on the
 *    user-facing allowlist (scripts/secdef-user-rpc-allowlist.json).
 * 3. An underscore-prefixed function is executable by anon/authenticated (no allowlist
 *    exceptions currently; internals must be service_role-only).
 * 4. A function whose comment documents service-role-only / worker-only intent still
 *    grants EXECUTE to anon or authenticated.
 *
 * Usage (linked project; read-only):
 *   node scripts/verify-secdef-execute-grants.mjs
 *
 * Does not modify the database.
 */

import { spawnSync } from "child_process";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { resolve } from "path";
import { tmpdir } from "os";
import { join } from "path";

const allowlistPath = resolve("scripts/secdef-user-rpc-allowlist.json");
const targetsPath = resolve("scripts/secdef-service-role-only-targets.json");

function fail(message) {
  console.error(message);
  process.exit(1);
}

function loadJson(path) {
  if (!existsSync(path)) fail(`Missing ${path}`);
  return JSON.parse(readFileSync(path, "utf8"));
}

function runLinkedSql(sqlText) {
  const tmp = join(tmpdir(), `secdef-verify-${Date.now()}.sql`);
  writeFileSync(tmp, sqlText, "utf8");
  try {
    const result = spawnSync(
      "npx",
      ["supabase", "db", "query", "--linked", "-f", tmp, "-o", "json"],
      {
        encoding: "utf8",
        shell: true,
        maxBuffer: 20 * 1024 * 1024,
      }
    );
    if (result.status !== 0) {
      fail(result.stderr || result.stdout || "supabase db query failed");
    }
    const raw = `${result.stdout || ""}${result.stderr || ""}`;
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start < 0 || end < 0) {
      fail("Could not parse JSON from supabase db query output");
    }
    return JSON.parse(raw.slice(start, end + 1));
  } finally {
    try {
      unlinkSync(tmp);
    } catch {
      // ignore
    }
  }
}

function buildRemediationSql(entries) {
  const values = entries
    .map((entry) => {
      const schema = entry.schema || "public";
      const args = (entry.args ?? "").trim();
      const compactArgs = args
        ? args
            .split(",")
            .map((part) => part.trim())
            .join(",")
        : "";
      const regproc = `${schema}.${entry.name}(${compactArgs})`.replace(
        /'/g,
        "''"
      );
      return `    ('${regproc}')`;
    })
    .join(",\n");

  return `
with targets(regproc_text) as (
  values
${values}
),
resolved as (
  select t.regproc_text as function, to_regprocedure(t.regproc_text) as oid
  from targets t
)
select
  r.function,
  case
    when r.oid is null then 'FAIL_MISSING'
    when has_function_privilege('anon', r.oid, 'EXECUTE') then 'FAIL'
    when has_function_privilege('authenticated', r.oid, 'EXECUTE') then 'FAIL'
    when has_function_privilege('public', r.oid, 'EXECUTE') then 'FAIL'
    when not has_function_privilege('service_role', r.oid, 'EXECUTE') then 'FAIL'
    else 'PASS'
  end as status
from resolved r
order by r.function;
`;
}

function typeArgsFromIdentity(identityArgs) {
  if (!identityArgs || !String(identityArgs).trim()) return "";
  return String(identityArgs)
    .split(",")
    .map((part) => part.trim().replace(/^[a-z_][a-z0-9_]*\s+/i, ""))
    .join(", ");
}

function allowKey(name, args) {
  return `${name}|${args}`;
}

const allowlistDoc = loadJson(allowlistPath);
const targetsDoc = loadJson(targetsPath);
const allowKeys = new Set(
  (allowlistDoc.allowlist || []).map((entry) =>
    allowKey(entry.name, entry.args ?? "")
  )
);
const targetNames = new Set((targetsDoc.targets || []).map((t) => t.name));

console.log("SECURITY DEFINER EXECUTE grant regression verifier");
console.log("==================================================");
console.log(`Allowlist entries: ${allowKeys.size}`);
console.log(`Remediation targets: ${(targetsDoc.targets || []).length}`);
console.log("");

// ---------------------------------------------------------------------------
// 1) Remediation target ACL check (derived from authoritative JSON catalogue)
// ---------------------------------------------------------------------------
const remediationTargets = targetsDoc.targets || [];
const remediationPayload = runLinkedSql(buildRemediationSql(remediationTargets));
const remediationRows = remediationPayload.rows || [];
let remediationFailures = 0;

console.log("1) Remediation targets");
if (remediationRows.length !== remediationTargets.length) {
  remediationFailures += 1;
  console.log(
    `  FAIL  catalogue/row count mismatch: expected ${remediationTargets.length}, got ${remediationRows.length}`
  );
}
for (const row of remediationRows) {
  const status = String(row.status ?? "FAIL");
  if (status !== "PASS") {
    remediationFailures += 1;
    console.log(`  FAIL  ${row.function}  status=${status}`);
  }
}
if (remediationFailures === 0) {
  console.log(`  PASS  ${remediationRows.length} targets locked`);
} else {
  console.log(`  ${remediationFailures} remediation target failure(s)`);
}
console.log("");

// ---------------------------------------------------------------------------
// 2-4) Live catalog scan
// ---------------------------------------------------------------------------
const catalogSql = `
select jsonb_agg(jsonb_build_object(
  'name', p.proname,
  'args', pg_get_function_identity_arguments(p.oid),
  'security_definer', p.prosecdef,
  'anon', has_function_privilege('anon', p.oid, 'EXECUTE'),
  'authenticated', has_function_privilege('authenticated', p.oid, 'EXECUTE'),
  'service_role', has_function_privilege('service_role', p.oid, 'EXECUTE'),
  'public', has_function_privilege('public', p.oid, 'EXECUTE'),
  'comment', coalesce(obj_description(p.oid, 'pg_proc'), '')
) order by p.proname, pg_get_function_identity_arguments(p.oid)) as funcs
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and (
    p.prosecdef = true
    or left(p.proname, 1) = '_'
    or coalesce(obj_description(p.oid, 'pg_proc'), '') ~* '(service[_ ]role|worker only|not callable by authenticated|EXECUTE granted to service_role)'
  );
`;

const catalogPayload = runLinkedSql(catalogSql);
const funcs = catalogPayload.rows?.[0]?.funcs || [];

let allowlistFailures = [];
let underscoreFailures = [];
let serviceCommentFailures = [];

for (const fn of funcs) {
  const args = typeArgsFromIdentity(fn.args || "");
  const key = allowKey(fn.name, args);
  const userExecutable = Boolean(fn.anon || fn.authenticated);

  if (!userExecutable) continue;

  if (targetNames.has(fn.name)) {
    // Already counted in remediation section.
    continue;
  }

  if (fn.name.startsWith("_")) {
    underscoreFailures.push(`${fn.name}(${args})`);
    continue;
  }

  if (fn.security_definer && !allowKeys.has(key)) {
    allowlistFailures.push(`${fn.name}(${args})`);
  }

  const comment = String(fn.comment || "");
  if (
    /service[_ ]role only|worker only|not callable by authenticated|EXECUTE granted to service_role only/i.test(
      comment
    )
  ) {
    serviceCommentFailures.push(`${fn.name}(${args})`);
  }
}

console.log("2) SECURITY DEFINER user-executable allowlist");
if (allowlistFailures.length === 0) {
  console.log("  PASS  no unallowlisted SECURITY DEFINER anon/authenticated EXECUTE");
} else {
  for (const item of allowlistFailures) console.log(`  FAIL  ${item}`);
}
console.log("");

console.log("3) Underscore functions user-executable");
if (underscoreFailures.length === 0) {
  console.log("  PASS  no underscore functions executable by anon/authenticated");
} else {
  for (const item of underscoreFailures) console.log(`  FAIL  ${item}`);
}
console.log("");

console.log("4) service-role-only comment vs ACL");
if (serviceCommentFailures.length === 0) {
  console.log("  PASS  no service-role-documented functions remain user-executable");
} else {
  for (const item of serviceCommentFailures) console.log(`  FAIL  ${item}`);
}
console.log("");

const totalFailures =
  remediationFailures +
  allowlistFailures.length +
  underscoreFailures.length +
  serviceCommentFailures.length;

if (totalFailures > 0) {
  fail(`FAIL: ${totalFailures} SECURITY DEFINER EXECUTE grant issue(s) detected.`);
}

console.log("PASS: SECURITY DEFINER EXECUTE grant regression checks succeeded.");
process.exit(0);
