/**
 * Offline safety checks for the Estate Agent directory verifiers.
 *
 *   verify-ea-branch-directory-eligibility-development.ts (shared Development)
 *     - refuses anything but the Development URL and keys, and needs both
 *       --execute and the explicit confirmation flag
 *     - every user and company uses the reserved .test domain; the fixture is
 *       registered before anything is created and each object as it is created
 *     - one branch is entitled, only after registration, and the directory is
 *       checked for exposure after every phase
 *     - cleanup removes entitlement first and leaves the fixture active if
 *       anything is left behind
 *   verify-ea-branch-directory-eligibility-local.ts (isolated local stack)
 *     - refuses any non-loopback URL and never reads .env.local
 *
 * Reads repository files and calls the verifiers' guard functions with
 * synthetic inputs; never connects to a database.
 *
 * Usage:
 *   npx tsx scripts/verify-ea-directory-verifier-safety.ts
 */
import { readFileSync } from "fs";
import { join } from "path";

import {
  assertDevelopmentTarget,
  CONFIRM_FLAG,
  DEVELOPMENT_SUPABASE_PROJECT_REF,
  PRODUCTION_SUPABASE_PROJECT_REF,
  RESERVED_DOMAIN,
} from "./verify-ea-branch-directory-eligibility-development";
import { assertLocalTarget } from "./verify-ea-branch-directory-eligibility-local";

const ROOT = join(import.meta.dirname, "..");
const DEV = "scripts/verify-ea-branch-directory-eligibility-development.ts";
const LOCAL = "scripts/verify-ea-branch-directory-eligibility-local.ts";

type TestResult = { name: string; pass: boolean; detail?: string };
const results: TestResult[] = [];

function record(name: string, pass: boolean, detail?: string) {
  results.push({ name, pass, detail });
  console.log(pass ? `✓ ${name}` : `✗ ${name}${detail ? `: ${detail}` : ""}`);
}

function read(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), "utf8").replace(/\r\n/g, "\n");
}

function between(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  return from >= 0 && to > from ? source.slice(from, to) : "";
}

function fakeJwt(claims: Record<string, unknown>): string {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode(claims)}.c2lnbmF0dXJl`;
}

function throws(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

const DEV_URL = `https://${DEVELOPMENT_SUPABASE_PROJECT_REF}.supabase.co`;
const ARGV = ["node", DEV, "--execute", CONFIRM_FLAG];
const SENTINEL = "sentinel-not-a-real-key-7f3a";

function devTarget(overrides: Partial<Parameters<typeof assertDevelopmentTarget>[0]>) {
  return () =>
    assertDevelopmentTarget({
      url: DEV_URL,
      anonKey: SENTINEL,
      serviceRoleKey: SENTINEL,
      argv: ARGV,
      vercelEnv: undefined,
      ...overrides,
    });
}

function main() {
  // --- Development guard ---------------------------------------------------
  record("dev guard: accepts the Development URL with both flags", throws(devTarget({})) === null);
  record(
    "dev guard: accepts Development JWT keys with the right roles",
    throws(
      devTarget({
        anonKey: fakeJwt({ ref: DEVELOPMENT_SUPABASE_PROJECT_REF, role: "anon" }),
        serviceRoleKey: fakeJwt({ ref: DEVELOPMENT_SUPABASE_PROJECT_REF, role: "service_role" }),
      })
    ) === null
  );
  const refusals: Array<[string, ReturnType<typeof devTarget>]> = [
    ["without --execute", devTarget({ argv: ["node", DEV, CONFIRM_FLAG] })],
    ["without the confirmation flag", devTarget({ argv: ["node", DEV, "--execute"] })],
    ["with a confirmation for another project", devTarget({ argv: ["node", DEV, "--execute", `--confirm-development=${PRODUCTION_SUPABASE_PROJECT_REF}`] })],
    ["the Production URL", devTarget({ url: `https://${PRODUCTION_SUPABASE_PROJECT_REF}.supabase.co` })],
    ["another project's URL", devTarget({ url: "https://abcdefghijklmnopqrst.supabase.co" })],
    ["a look-alike host", devTarget({ url: `https://${DEVELOPMENT_SUPABASE_PROJECT_REF}.supabase.co.example.net` })],
    ["a URL with a path", devTarget({ url: `${DEV_URL}/rest/v1` })],
    ["plain http", devTarget({ url: `http://${DEVELOPMENT_SUPABASE_PROJECT_REF}.supabase.co` })],
    ["a local URL", devTarget({ url: "http://127.0.0.1:54321" })],
    ["a Production service-role JWT", devTarget({ serviceRoleKey: fakeJwt({ ref: PRODUCTION_SUPABASE_PROJECT_REF, role: "service_role" }) })],
    ["a Production anon JWT", devTarget({ anonKey: fakeJwt({ ref: PRODUCTION_SUPABASE_PROJECT_REF, role: "anon" }) })],
    ["a Development anon JWT in the service-role slot", devTarget({ serviceRoleKey: fakeJwt({ ref: DEVELOPMENT_SUPABASE_PROJECT_REF, role: "anon" }) })],
    ["a key mentioning the Production ref", devTarget({ serviceRoleKey: `x-${PRODUCTION_SUPABASE_PROJECT_REF}-x` })],
    ["VERCEL_ENV=production", devTarget({ vercelEnv: "production" })],
    ["VERCEL_ENV=preview", devTarget({ vercelEnv: "preview" })],
  ];
  for (const [label, attempt] of refusals) {
    const message = throws(attempt);
    record(`dev guard: refuses ${label}`, message !== null && !message.includes(SENTINEL), message ?? "accepted");
  }
  const leaked = refusals.map(([, attempt]) => throws(attempt) ?? "").filter((m) => m.includes(SENTINEL) || m.includes("c2lnbmF0dXJl"));
  record("dev guard: refusal messages never include key material", leaked.length === 0);

  // --- Development verifier source ----------------------------------------
  const dev = read(DEV);
  const main = between(dev, "async function main()", "\nif (process.argv[1]");
  record(
    "dev source: guard runs before any client is created",
    main.indexOf("assertDevelopmentTarget(") > -1 && main.indexOf("assertDevelopmentTarget(") < main.indexOf("createClient(")
  );
  record(
    "dev source: without --execute it only prints usage",
    /if \(!process\.argv\.includes\("--execute"\)\) \{\s*console\.log\([\s\S]*?\);\s*return;\s*\}/.test(main) &&
      main.indexOf('includes("--execute")') < main.indexOf("loadEnvLocal()")
  );
  record(
    "dev source: the fixture is created before any scenario",
    main.indexOf("await createFixture(ctx);") > -1 && main.indexOf("await createFixture(ctx);") < main.indexOf("await runScenarios(ctx);")
  );
  record("dev source: imported without running (main only when executed directly)", /\nif \(process\.argv\[1\][^\n]*endsWith\("verify-ea-branch-directory-eligibility-development\.ts"\)\)/.test(dev));

  const domainLiterals = [...dev.matchAll(/@[\w${}.-]+|email_domain:\s*[^,}]+/g)].map((m) => m[0]);
  const realisticDomains = dev.match(/\.(co\.uk|com|net|org|io|dev|uk)\b(?!\.)/g) ?? [];
  const unexpectedLiterals = domainLiterals.filter((literal) => !/RESERVED_DOMAIN|domain/i.test(literal) && literal !== "@supabase");
  record(
    `dev source: every address and company domain uses the reserved .${RESERVED_DOMAIN.split(".").pop()} domain`,
    RESERVED_DOMAIN.endsWith(".test") && realisticDomains.length === 0 && unexpectedLiterals.length === 0,
    [...realisticDomains, ...unexpectedLiterals].join(", ")
  );
  const domainAssignments = [...dev.matchAll(/const (\w*[dD]omain) = ([^;]+);/g)];
  record(
    "dev source: every domain variable is built on RESERVED_DOMAIN",
    domainAssignments.length >= 2 &&
      domainAssignments.every(([, name, value]) => name === "RESERVED_DOMAIN" || value.includes("${RESERVED_DOMAIN}")),
    domainAssignments.map(([, name]) => name).join(", ")
  );
  record(
    "dev source: createAuthUser refuses non-reserved addresses and registers every user",
    /async function createAuthUser[\s\S]*?if \(!email\.endsWith\(`\.\$\{RESERVED_DOMAIN\}`\)\) throw[\s\S]*?await register\(ctx, "auth_user", data\.user\.id\);/.test(dev)
  );
  const company = between(dev, "async function createHiddenCompany", "\nasync function addMember");
  const at = (needle: string) => company.indexOf(needle);
  record(
    "dev source: the company creator is registered before the company, the company before its branches",
    at("await createAuthUser(") > -1 &&
      at("await createAuthUser(") < at('.from("ea_companies")') &&
      at('.from("ea_companies")') < at('await register(ctx, "ea_company", companyId);') &&
      at('await register(ctx, "ea_company", companyId);') < at('.from("ea_branches")') &&
      at('await register(ctx, "ea_branch", branchId);') > at('.from("ea_branches")') &&
      at("await assertNotListed(") > at('await register(ctx, "ea_branch", branchId);')
  );
  record(
    "dev source: company and branch names are marked as test data",
    /name: `ZZ TEST \$\{word\} \$\{ctx\.token\}`/.test(company) && /name: `ZZ TEST \$\{name\}`/.test(company)
  );
  const subscriptionInserts = dev.match(/from\("ea_branch_subscriptions"\)\.insert\(/g) ?? [];
  const scenarios = between(dev, "async function runScenarios", "\nasync function cleanupFixtures");
  record(
    "dev source: exactly one entitlement is created, after the hidden company and before an exposure check",
    subscriptionInserts.length === 1 &&
      scenarios.indexOf("await createHiddenCompany(") < scenarios.indexOf('from("ea_branch_subscriptions").insert(') &&
      /from\("ea_branch_subscriptions"\)\.insert\([\s\S]*?\}\);\s*if \(subscribeError\)[^\n]*\n\s*await assertNotListed\(/.test(scenarios)
  );
  record(
    "dev source: no filler branches, bulk subscriptions or other entitlement states",
    !/FILLER|subscribe\(|"trialing"|"grace"|"past_due"|"ended"|cleaned_at: status/.test(dev)
  );
  record(
    "dev source: the exposure check reads the view and search, and aborts on any listed verifier branch",
    /async function assertNotListed[\s\S]*?\.from\("ea_branch_directory"\)[\s\S]*?\.in\("branch_id", ctx\.branchIds\)[\s\S]*?rpc\("search_ea_branch_directory"[\s\S]*?throw new ExposureError/.test(dev) &&
      (scenarios.match(/await assertNotListed\(/g) ?? []).length >= 3
  );
  record(
    "dev source: every created object type is registered",
    ["auth_user", "profile", "ea_company", "ea_branch", "ea_branch_member", "chain", "property", "property_ea_assignment"].every(
      (type) => dev.includes(`register(ctx, "${type}"`)
    )
  );
  const cleanup = between(dev, "async function cleanupFixtures", "\nasync function main");
  record(
    "dev source: cleanup removes entitlement before anything else",
    cleanup.indexOf('from("ea_branch_subscriptions").delete()') > -1 &&
      cleanup.indexOf('from("ea_branch_subscriptions").delete()') < cleanup.indexOf('from("properties")')
  );
  record(
    "dev source: cleanup always runs and leaves the fixture active when anything is left behind",
    /finally \{\s*const clean = await cleanupFixtures\(ctx\);/.test(main) &&
      /if \(!clean\) \{[\s\S]*?left active[\s\S]*?return false;\s*\}[\s\S]*?status: "cleaned"/.test(cleanup)
  );
  record(
    "dev source: no direct member deletion (one-owner invariant) and no deletion outside verifier ids",
    !cleanup.includes('"ea_branch_members"') &&
      !/\.delete\(\)\s*\.(neq|not|gt|lt|like|ilike)\(/.test(cleanup) &&
      (cleanup.match(/\.delete\(\)/g) ?? []).length === (cleanup.match(/\.delete\(\)\s*\.(in|eq)\(/g) ?? []).length
  );

  // --- Local guard and source ----------------------------------------------
  for (const url of ["http://127.0.0.1:54321", "http://localhost:54321", "http://[::1]:54321"]) {
    record(`local guard: accepts ${url}`, throws(() => assertLocalTarget(url)) === null);
  }
  for (const url of [
    DEV_URL,
    `https://${PRODUCTION_SUPABASE_PROJECT_REF}.supabase.co`,
    "http://127.0.0.1.example.net:54321",
    "http://localhost.example.net",
    "http://10.0.0.5:54321",
    "http://0.0.0.0:54321",
    "postgres://127.0.0.1:54322/postgres",
    "not a url",
  ]) {
    record(`local guard: refuses ${url}`, throws(() => assertLocalTarget(url)) !== null);
  }
  const local = read(LOCAL);
  const localEnv = [...local.matchAll(/process\.env\.([A-Z_]+)/g)].map((m) => m[1]);
  record(
    "local source: never reads .env.local and takes credentials only from LOCAL_SUPABASE_*",
    !/readFileSync|loadEnvLocal|\.env\.local"\)/.test(local) &&
      localEnv.every((name) => name.startsWith("LOCAL_SUPABASE_") || name === "VERCEL_ENV"),
    localEnv.join(", ")
  );
  const localMain = between(local, "async function main()", "\nif (process.argv[1]");
  record(
    "local source: needs --execute and checks the target before creating a client",
    localMain.indexOf('includes("--execute")') > -1 &&
      localMain.indexOf("assertLocalTarget(") > -1 &&
      localMain.indexOf("assertLocalTarget(") < localMain.indexOf("createClient(")
  );
  record(
    "local source: imported without running (main only when executed directly)",
    /\nif \(process\.argv\[1\][^\n]*endsWith\("verify-ea-branch-directory-eligibility-local\.ts"\)\)/.test(local)
  );

  const failed = results.filter((r) => !r.pass).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed.`);
  if (failed > 0) process.exit(1);
}

main();
