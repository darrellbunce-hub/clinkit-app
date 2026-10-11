/**
 * Estate Agent branch directory eligibility and appointment — shared
 * Development scenarios that never list a verifier branch.
 *
 * Requires 20261010120000 and 20261011090000 on Development.
 *
 * Every branch this verifier creates stays out of ea_branch_directory for its
 * whole life, so no signed-in Development user can ever find it:
 *   - one smoke-test fixture is registered before anything else is created,
 *     and every object is registered as soon as it exists;
 *   - each company's creator is registered before the company exists, so the
 *     company and its branches are hidden from the moment they are inserted;
 *   - every company email domain and creator address uses the reserved .test
 *     domain;
 *   - entitlement is added to one branch only, after it is registered;
 *   - after every phase the verifier asserts that none of its branches is in
 *     the directory or in search, and aborts (cleaning up first) if one is.
 * Scenarios that need a listed branch (search beyond row 200, entitlement
 * states, each Rule 17.15 exclusion on its own, successful appointment) run
 * only against an isolated local stack:
 * verify-ea-branch-directory-eligibility-local.ts.
 *
 *   DV1 hidden by construction: no verifier branch is listed or searchable,
 *       including the entitled one
 *   DV2 direct access: view by id, base tables, own-branch membership,
 *       wildcard and short queries, limit clamp, view writes and anon cannot
 *       bypass eligibility
 *   DV3 appointment (20261011090000): an entitled-but-excluded branch, an
 *       unentitled branch and an unknown id are all refused with the same
 *       branch_not_found and nothing is written
 *   DV4 replacing an existing assignment with an unlisted branch is refused
 *       and the existing assignment is untouched
 *   DV5 the assigned, unlisted branch keeps its assignment: keeping or
 *       restricting delegation succeeds; enabling delegated updates is refused
 *   DV6 labels for an existing assignment: homeowner and branch member see
 *       them; a stranger and a member of another branch do not
 *   DV7 EA onboarding still creates company, branch and admin; the new branch
 *       is not listed
 *
 * Cleanup removes entitlement first, then every created row, then marks the
 * fixture cleaned. If any step fails the fixture stays active and its id is
 * printed, so the smoke-test fixture cleanup can finish the job.
 *
 * Usage (Development ONLY — bbbsxzxcjkmpqsfvmhbo; run only once approved):
 *   npx tsx scripts/verify-ea-branch-directory-eligibility-development.ts --execute --confirm-development=bbbsxzxcjkmpqsfvmhbo
 */
import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import { join } from "path";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { createChainForOnboarding } from "../lib/createChainForOnboarding";
import { loadAssignmentWithBranchDirectory } from "../lib/estateAgent/assignments";
import { completeEstateAgentOnboarding } from "../lib/estateAgent/completeOnboarding";
import { createEstateAgentProfile } from "../lib/estateAgent/createEstateAgentProfile";
import { establishOperationalHomeowner } from "../lib/ownership/grants";
import { OPERATIONAL_IDENTITY_GRANT_VIA } from "../lib/ownership/types";

export const DEVELOPMENT_SUPABASE_PROJECT_REF = "bbbsxzxcjkmpqsfvmhbo";
export const PRODUCTION_SUPABASE_PROJECT_REF = "qguwzsdonffgfebchfqy";
export const CONFIRM_FLAG = `--confirm-development=${DEVELOPMENT_SUPABASE_PROJECT_REF}`;
export const RESERVED_DOMAIN = "dirv.test";
const PASSWORD = "DirectoryEligibilityDev123!";

type TestResult = { name: string; pass: boolean; detail?: string };
const results: TestResult[] = [];

function record(name: string, pass: boolean, detail?: string) {
  results.push({ name, pass, detail });
  console.log(pass ? `✓ ${name}` : `✗ ${name}${detail ? `: ${detail}` : ""}`);
}

class ExposureError extends Error {}

function loadEnvLocal(): void {
  try {
    for (const line of readFileSync(join(process.cwd(), ".env.local"), "utf8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const separatorIndex = trimmed.indexOf("=");
      if (separatorIndex <= 0) continue;
      const key = trimmed.slice(0, separatorIndex).trim();
      let value = trimmed.slice(separatorIndex + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  } catch {
    // optional
  }
}

function jwtClaims(key: string): Record<string, unknown> | null {
  const parts = key.split(".");
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Throws unless every input points at Development; never echoes keys. */
export function assertDevelopmentTarget(input: {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
  argv: readonly string[];
  vercelEnv: string | undefined;
}): string {
  if (!input.argv.includes("--execute") || !input.argv.includes(CONFIRM_FLAG)) {
    throw new Error(`Refusing to run: --execute and ${CONFIRM_FLAG} are both required.`);
  }
  if (input.vercelEnv === "production" || input.vercelEnv === "preview") {
    throw new Error(`Refusing to run: VERCEL_ENV=${input.vercelEnv}.`);
  }
  const url = input.url.trim().replace(/\/+$/, "");
  if (url.includes(PRODUCTION_SUPABASE_PROJECT_REF) || url !== `https://${DEVELOPMENT_SUPABASE_PROJECT_REF}.supabase.co`) {
    throw new Error("Refusing to run: the Supabase URL is not the Development project URL.");
  }
  for (const [label, key, role] of [
    ["anon", input.anonKey, "anon"],
    ["service role", input.serviceRoleKey, "service_role"],
  ] as const) {
    if (key.includes(PRODUCTION_SUPABASE_PROJECT_REF)) {
      throw new Error(`Refusing to run: the ${label} key references Production.`);
    }
    const claims = jwtClaims(key);
    if (claims && (claims.ref !== DEVELOPMENT_SUPABASE_PROJECT_REF || claims.role !== role)) {
      throw new Error(`Refusing to run: the ${label} key is not a Development ${role} key.`);
    }
  }
  return DEVELOPMENT_SUPABASE_PROJECT_REF;
}

type Ctx = {
  url: string;
  anonKey: string;
  admin: SupabaseClient;
  stamp: string;
  token: string;
  fixtureId: string | null;
  userIds: string[];
  chainIds: number[];
  branchIds: string[];
  companyIds: string[];
  observer: SupabaseClient | null;
};

type Actor = { userId: string; email: string; client: SupabaseClient };

type FixtureObjectType =
  | "auth_user"
  | "profile"
  | "ea_company"
  | "ea_branch"
  | "ea_branch_member"
  | "property"
  | "chain"
  | "property_ea_assignment";

function anonClient(ctx: Ctx): SupabaseClient {
  return createClient(ctx.url, ctx.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function createFixture(ctx: Ctx): Promise<void> {
  const label = `ea directory eligibility verifier ${ctx.token}`;
  const { data, error } = await ctx.admin
    .from("smoke_test_fixtures")
    .insert({ label, status: "active", notes: "verify-ea-branch-directory-eligibility-development" })
    .select("id")
    .single();
  if (error || !data) throw new Error(`fixture: ${error?.message}`);
  ctx.fixtureId = data.id as string;
  await ctx.admin.from("smoke_test_fixture_audit_events").insert({
    fixture_id: ctx.fixtureId,
    event_type: "fixture_created",
    dry_run: false,
    payload: { label },
  });
}

async function register(ctx: Ctx, objectType: FixtureObjectType, objectId: string | number): Promise<void> {
  if (!ctx.fixtureId) throw new Error("register: no fixture");
  const { error } = await ctx.admin.from("smoke_test_fixture_objects").upsert(
    { fixture_id: ctx.fixtureId, object_type: objectType, object_id: String(objectId), ownership: "owned" },
    { onConflict: "fixture_id,object_type,object_id" }
  );
  if (error) throw new Error(`register ${objectType}: ${error.message}`);
  await ctx.admin.from("smoke_test_fixture_audit_events").insert({
    fixture_id: ctx.fixtureId,
    event_type: "object_registered",
    dry_run: false,
    payload: { object_type: objectType, object_id: String(objectId), ownership: "owned" },
  });
}

async function createAuthUser(ctx: Ctx, email: string): Promise<string> {
  if (!email.endsWith(`.${RESERVED_DOMAIN}`)) throw new Error("verifier users must use the reserved domain");
  const { data, error } = await ctx.admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error || !data.user?.id) throw new Error(`createUser failed: ${error?.message ?? "no user"}`);
  ctx.userIds.push(data.user.id);
  await register(ctx, "auth_user", data.user.id);
  await register(ctx, "profile", data.user.id);
  return data.user.id;
}

async function signIn(ctx: Ctx, email: string): Promise<SupabaseClient> {
  const client = anonClient(ctx);
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`Sign in failed: ${error.message}`);
  return client;
}

async function setupHomeowner(ctx: Ctx, label: string): Promise<Actor> {
  const email = `ho-${label}-${ctx.stamp}@${ctx.token}.${RESERVED_DOMAIN}`;
  const userId = await createAuthUser(ctx, email);
  const client = await signIn(ctx, email);
  const { error } = await client.from("profiles").upsert(
    {
      id: userId,
      role: "homeowner",
      account_type: "homeowner",
      contact_name: `Directory Verifier HO ${label}`,
      onboarding_completed_at: new Date().toISOString(),
    },
    { onConflict: "id" }
  );
  if (error) throw new Error(`homeowner profile: ${error.message}`);
  return { userId, email, client };
}

/** Creator registered first, reserved domains throughout, no subscription. */
async function createHiddenCompany(ctx: Ctx, word: string, branchNames: string[]) {
  const domain = `${word.toLowerCase()}-${ctx.token}.${RESERVED_DOMAIN}`;
  const creatorUserId = await createAuthUser(ctx, `owner-${ctx.stamp}@${domain}`);
  const { data, error } = await ctx.admin
    .from("ea_companies")
    .insert({ name: `ZZ TEST ${word} ${ctx.token}`, email_domain: domain, created_by_user_id: creatorUserId })
    .select("id")
    .single();
  if (error || !data) throw new Error(`company ${word}: ${error?.message}`);
  const companyId = data.id as string;
  ctx.companyIds.push(companyId);
  await register(ctx, "ea_company", companyId);

  const { data: branches, error: branchError } = await ctx.admin
    .from("ea_branches")
    .insert(
      branchNames.map((name, index) => ({
        company_id: companyId,
        name: `ZZ TEST ${name}`,
        town_or_city: "Testtown",
        postcode: "PO16 7DV",
        region_code: "SE",
        is_head_office: index === 0,
      }))
    )
    .select("id, name");
  if (branchError || !branches) throw new Error(`branches ${word}: ${branchError?.message}`);
  const byName = new Map(branches.map((row) => [row.name as string, row.id as string]));
  const branchIds = branchNames.map((name) => byName.get(`ZZ TEST ${name}`)!);
  for (const branchId of branchIds) {
    ctx.branchIds.push(branchId);
    await register(ctx, "ea_branch", branchId);
  }
  await assertNotListed(ctx, `after creating ${word}`);
  return { companyId, creatorUserId, domain, branchIds };
}

async function addMember(ctx: Ctx, branchId: string, label: string, domain: string): Promise<Actor> {
  const email = `${label}-${ctx.stamp}@${domain}`;
  const userId = await createAuthUser(ctx, email);
  const { data, error } = await ctx.admin
    .from("ea_branch_members")
    .insert({ branch_id: branchId, user_id: userId, role: "branch_admin" })
    .select("id")
    .single();
  if (error || !data) throw new Error(`member: ${error?.message}`);
  await register(ctx, "ea_branch_member", data.id as string);
  return { userId, email, client: await signIn(ctx, email) };
}

/** Fail fast: no verifier branch may ever be in the directory or in search. */
async function assertNotListed(ctx: Ctx, phase: string): Promise<void> {
  if (!ctx.observer || ctx.branchIds.length === 0) return;
  const { data, error } = await ctx.observer.from("ea_branch_directory").select("branch_id").in("branch_id", ctx.branchIds);
  const { data: searched, error: searchError } = await ctx.observer.rpc("search_ea_branch_directory", {
    p_query: ctx.token,
    p_limit: 50,
  });
  if (error || searchError) {
    throw new ExposureError(`exposure check failed ${phase}: ${error?.message ?? searchError?.message}`);
  }
  if ((data ?? []).length > 0 || ((searched as unknown[] | null) ?? []).length > 0) {
    throw new ExposureError(`a verifier branch became listed ${phase}; aborting`);
  }
}

type AssignResult = { ok?: boolean; error?: string; assignment_id?: string; replaced?: boolean };

async function assign(
  client: SupabaseClient,
  propertyId: number,
  branchId: string,
  homeownerOnlyUpdates: boolean | null
): Promise<AssignResult> {
  const { data, error } = await client.rpc("assign_property_ea_branch", {
    p_property_id: propertyId,
    p_branch_id: branchId,
    p_homeowner_only_updates: homeownerOnlyUpdates,
  });
  if (error) return { ok: false, error: error.message };
  return (data ?? {}) as AssignResult;
}

type AssignmentRow = { id: string; branch_id: string; status: string; homeowner_only_updates: boolean };

async function assignments(ctx: Ctx, propertyId: number): Promise<AssignmentRow[]> {
  const { data, error } = await ctx.admin
    .from("property_ea_assignments")
    .select("id, branch_id, status, homeowner_only_updates")
    .eq("property_id", propertyId)
    .order("created_at");
  if (error) throw new Error(`assignments: ${error.message}`);
  return (data ?? []) as AssignmentRow[];
}

async function seedAssignment(ctx: Ctx, propertyId: number, branchId: string, homeownerOnlyUpdates: boolean, assignedBy: string) {
  const { data, error } = await ctx.admin
    .from("property_ea_assignments")
    .insert({
      property_id: propertyId,
      branch_id: branchId,
      status: "active",
      homeowner_only_updates: homeownerOnlyUpdates,
      assigned_by_user_id: assignedBy,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`seed assignment: ${error?.message}`);
  await register(ctx, "property_ea_assignment", data.id as string);
  return data.id as string;
}

let counter = 0;

async function homeownerSale(ctx: Ctx, ho: Actor): Promise<number> {
  counter += 1;
  const chain = await createChainForOnboarding(ho.client, {
    name: `CHAIN-DIRV-${ctx.token}-${counter}`,
    accessCode: `KN-DIRV-${ctx.token.slice(-6)}-${counter}`.toUpperCase(),
  });
  if (chain.error || chain.chainId == null) throw new Error(`createChainForOnboarding: ${chain.error}`);
  ctx.chainIds.push(chain.chainId);
  await register(ctx, "chain", chain.chainId);

  const { data, error } = await ho.client
    .from("properties")
    .insert({
      chain_id: chain.chainId,
      chain_position: 1,
      address: `${counter} Directory Verifier Test Road ${ctx.token}`,
      postcode: "PO16 7DH",
      stage: "property_listed",
      status: "pending_connection",
      relationship_type: "sale",
      created_by_user_id: ho.userId,
      awaiting_buyer: false,
      buyer_connected: false,
      seller_connected: true,
      is_searching: false,
      is_current_user: true,
      last_updated_days: 0,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`sale insert: ${error?.message}`);
  await register(ctx, "property", data.id as number);

  const { data: grant, error: grantError } = await establishOperationalHomeowner(ho.client, {
    propertyId: data.id as number,
    grantedVia: OPERATIONAL_IDENTITY_GRANT_VIA.startMove,
  });
  if (grantError || !grant.ok) {
    throw new Error(`grant sale: ${grantError?.message ?? (!grant.ok ? grant.error : "")}`);
  }
  return data.id as number;
}

const rowsOf = (data: unknown) => ((data as unknown[] | null) ?? []).length;

async function runScenarios(ctx: Ctx) {
  const t = ctx.token;
  const owner = await setupHomeowner(ctx, "owner");
  const stranger = await setupHomeowner(ctx, "stranger");
  ctx.observer = owner.client;

  // DV1 -------------------------------------------------------------------
  const hidden = await createHiddenCompany(ctx, "Hidden", ["Entitled", "Unentitled", "Second"]);
  const [entitled, unentitled, second] = hidden.branchIds;
  const { error: subscribeError } = await ctx.admin.from("ea_branch_subscriptions").insert({
    branch_id: entitled,
    pricing_tier: "standard",
    amount_gbp_minor: 12900,
    currency: "gbp",
    stripe_status: "active",
    entitlement_status: "entitled",
  });
  if (subscribeError) throw new Error(`subscription: ${subscribeError.message}`);
  await assertNotListed(ctx, "after entitling the hidden branch");
  record("DV1 the entitled verifier branch is hidden by its fixture and reserved domains", true);

  const adminA = await addMember(ctx, unentitled, "admin-a", hidden.domain);
  const adminB = await addMember(ctx, second, "admin-b", hidden.domain);
  const creator = await signIn(ctx, `owner-${ctx.stamp}@${hidden.domain}`);
  await assertNotListed(ctx, "after adding members");

  // DV2 -------------------------------------------------------------------
  const { data: viewById, error: viewByIdError } = await owner.client
    .from("ea_branch_directory")
    .select("branch_id")
    .in("branch_id", hidden.branchIds);
  record(
    "DV2 reading the view by id returns no verifier branch",
    viewByIdError == null && rowsOf(viewById) === 0,
    viewByIdError?.message
  );
  const { data: baseBranches } = await owner.client.from("ea_branches").select("id").in("id", hidden.branchIds);
  const { data: baseCompanies } = await owner.client.from("ea_companies").select("id").eq("id", hidden.companyId);
  const { data: baseSubscriptions } = await owner.client.from("ea_branch_subscriptions").select("id").in("branch_id", hidden.branchIds);
  record(
    "DV2 base tables return nothing to a homeowner (branches, companies, subscriptions)",
    rowsOf(baseBranches) === 0 && rowsOf(baseCompanies) === 0 && rowsOf(baseSubscriptions) === 0
  );
  const ownBranch = await adminA.client.from("ea_branch_directory").select("branch_id").eq("branch_id", unentitled);
  const creatorBranches = await creator.from("ea_branch_directory").select("branch_id").in("branch_id", hidden.branchIds);
  record(
    "DV2 membership of a branch, or creating its company, does not list it",
    ownBranch.error == null && rowsOf(ownBranch.data) === 0 && creatorBranches.error == null && rowsOf(creatorBranches.data) === 0
  );
  const raw = (client: SupabaseClient, query: string, limit = 20) =>
    client.rpc("search_ea_branch_directory", { p_query: query, p_limit: limit });
  const wildcard = await raw(owner.client, "%%");
  const underscore = await raw(owner.client, "__ __");
  const regex = await raw(owner.client, ".* .*");
  record(
    "DV2 wildcard and pattern characters are matched literally",
    wildcard.error == null && rowsOf(wildcard.data) === 0 && rowsOf(underscore.data) === 0 && rowsOf(regex.data) === 0
  );
  const short = await raw(owner.client, "a");
  const blank = await raw(owner.client, "   ");
  const tooLong = await raw(owner.client, `${t} ${"x".repeat(120)}`);
  record(
    "DV2 queries under 2 or over 100 characters return nothing",
    rowsOf(short.data) === 0 && rowsOf(blank.data) === 0 && rowsOf(tooLong.data) === 0
  );
  const huge = await raw(owner.client, "ea", 100_000);
  const zero = await raw(owner.client, "ea", 0);
  record(
    "DV2 the row limit never exceeds 50 (or 1 when 0 is requested)",
    huge.error == null && rowsOf(huge.data) <= 50 && zero.error == null && rowsOf(zero.data) <= 1,
    `huge=${rowsOf(huge.data)} zero=${rowsOf(zero.data)}`
  );
  const viewWrite = await owner.client.from("ea_branch_directory").insert({
    branch_id: randomUUID(),
    branch_name: "x",
    town_or_city: "x",
    postcode: "x",
    company_id: hidden.companyId,
    company_name: "x",
  });
  const viewDelete = await owner.client.from("ea_branch_directory").delete().eq("branch_id", entitled);
  record("DV2 authenticated users cannot write to the view", viewWrite.error != null && viewDelete.error != null);
  const anon = anonClient(ctx);
  const anonSearch = await raw(anon, t);
  const anonView = await anon.from("ea_branch_directory").select("branch_id").limit(1);
  const anonLabel = await anon.rpc("get_property_ea_branch_entry", { p_property_id: 1 });
  record(
    "DV2 anon cannot search, read the view or read labels",
    anonSearch.error != null && anonView.error != null && anonLabel.error != null
  );

  // DV3 -------------------------------------------------------------------
  const fresh = await homeownerSale(ctx, owner);
  for (const [label, branchId] of [
    ["an entitled branch excluded by Rule 17.15", entitled],
    ["an unentitled branch", unentitled],
    ["an unknown branch id", randomUUID()],
  ] as const) {
    const refused = await assign(owner.client, fresh, branchId, true);
    record(
      `DV3 appointing ${label} is refused (branch_not_found, nothing written)`,
      refused.error === "branch_not_found" && (await assignments(ctx, fresh)).length === 0,
      JSON.stringify(refused)
    );
  }

  // DV4 -------------------------------------------------------------------
  const sale = await homeownerSale(ctx, owner);
  const seededId = await seedAssignment(ctx, sale, unentitled, true, owner.userId);
  const before = await assignments(ctx, sale);
  for (const [label, branchId] of [
    ["another unentitled branch", second],
    ["an entitled branch excluded by Rule 17.15", entitled],
  ] as const) {
    const refused = await assign(owner.client, sale, branchId, true);
    record(
      `DV4 replacing the assignment with ${label} is refused and the assignment is untouched`,
      refused.error === "branch_not_found" && JSON.stringify(await assignments(ctx, sale)) === JSON.stringify(before),
      JSON.stringify(refused)
    );
  }

  // DV5 -------------------------------------------------------------------
  const enable = await assign(owner.client, sale, unentitled, false);
  const afterEnable = await assignments(ctx, sale);
  const { data: canOperate } = await adminA.client.rpc("can_operate_property", { p_property_id: sale });
  record(
    "DV5 the assigned unlisted branch cannot be given delegated updates (branch_not_found, unchanged)",
    enable.error === "branch_not_found" && JSON.stringify(afterEnable) === JSON.stringify(before) && canOperate === false,
    JSON.stringify({ enable, canOperate })
  );
  const keep = await assign(owner.client, sale, unentitled, true);
  const keepNull = await assign(owner.client, sale, unentitled, null);
  const afterKeep = await assignments(ctx, sale);
  record(
    "DV5 re-appointing it with homeowner-only updates, or without a choice, succeeds and is not a replacement",
    keep.ok === true &&
      keep.replaced === false &&
      keep.assignment_id === seededId &&
      keepNull.ok === true &&
      afterKeep.length === 1 &&
      afterKeep[0].status === "active" &&
      afterKeep[0].homeowner_only_updates === true,
    JSON.stringify({ keep, keepNull })
  );

  const delegatedSale = await homeownerSale(ctx, owner);
  await seedAssignment(ctx, delegatedSale, second, false, owner.userId);
  const keepDelegated = await assign(owner.client, delegatedSale, second, false);
  const keptDelegated = await assignments(ctx, delegatedSale);
  record(
    "DV5 an existing delegated assignment is kept as it is (no new authority)",
    keepDelegated.ok === true && keptDelegated.length === 1 && keptDelegated[0].homeowner_only_updates === false,
    JSON.stringify(keepDelegated)
  );
  const restrict = await assign(owner.client, delegatedSale, second, true);
  const reEnable = await assign(owner.client, delegatedSale, second, false);
  const afterReEnable = await assignments(ctx, delegatedSale);
  record(
    "DV5 once restricted, delegated updates cannot be re-enabled for the unlisted branch",
    restrict.ok === true &&
      reEnable.error === "branch_not_found" &&
      afterReEnable.length === 1 &&
      afterReEnable[0].status === "active" &&
      afterReEnable[0].homeowner_only_updates === true,
    JSON.stringify({ restrict, reEnable })
  );

  // DV6 -------------------------------------------------------------------
  const ownerLabel = await loadAssignmentWithBranchDirectory(owner.client, sale);
  record(
    "DV6 the homeowner sees the label of the existing assignment",
    ownerLabel.assignment?.branch_id === unentitled && ownerLabel.branch?.branch_id === unentitled
  );
  const memberLabel = await loadAssignmentWithBranchDirectory(adminA.client, sale);
  record("DV6 the assigned branch's member sees the label", memberLabel.branch?.branch_id === unentitled);
  const strangerLabel = await stranger.client.rpc("get_property_ea_branch_entry", { p_property_id: sale });
  record(
    "DV6 a stranger gets no label",
    strangerLabel.error == null && rowsOf(strangerLabel.data) === 0,
    strangerLabel.error?.message
  );
  const otherBranchLabel = await adminB.client.rpc("get_property_ea_branch_entry", { p_property_id: sale });
  record("DV6 a member of another branch of the same company gets no label", rowsOf(otherBranchLabel.data) === 0);

  // DV7 -------------------------------------------------------------------
  const onboardDomain = `onboard-${t}.${RESERVED_DOMAIN}`;
  const onboardEmail = `founder-${ctx.stamp}@${onboardDomain}`;
  const onboardUserId = await createAuthUser(ctx, onboardEmail);
  const onboardClient = await signIn(ctx, onboardEmail);
  const profile = await createEstateAgentProfile(onboardClient, {
    userId: onboardUserId,
    contactName: "Directory Verifier Onboarding",
    email: onboardEmail,
  });
  const onboard = profile.error
    ? { success: false as const, error: profile.error }
    : await completeEstateAgentOnboarding(onboardClient, {
        userId: onboardUserId,
        companyName: `ZZ TEST Onboard ${t}`,
        branchName: "ZZ TEST Onboard Branch",
        townOrCity: "Testtown",
        postcode: "PO16 7AA",
        isHeadOffice: true,
        emailDomain: onboardDomain,
      });
  const { data: onboardMembership } = await ctx.admin
    .from("ea_branch_members")
    .select("id, branch_id, role")
    .eq("user_id", onboardUserId)
    .maybeSingle();
  const onboardBranchId = (onboardMembership?.branch_id as string | undefined) ?? null;
  if (onboardBranchId) {
    ctx.branchIds.push(onboardBranchId);
    await register(ctx, "ea_branch", onboardBranchId);
    await register(ctx, "ea_branch_member", onboardMembership!.id as string);
    const { data: onboardBranch } = await ctx.admin.from("ea_branches").select("company_id").eq("id", onboardBranchId).single();
    if (onboardBranch?.company_id) {
      ctx.companyIds.push(onboardBranch.company_id as string);
      await register(ctx, "ea_company", onboardBranch.company_id as string);
    }
  }
  record(
    "DV7 EA onboarding still creates the company, branch and admin membership",
    onboard.success && onboardBranchId != null && onboardMembership?.role === "branch_admin",
    onboard.success ? undefined : onboard.error
  );
  await assertNotListed(ctx, "after onboarding");
  record("DV7 the onboarded verifier branch is not listed", true);
}

async function cleanupFixtures(ctx: Ctx): Promise<boolean> {
  let clean = true;
  const warn = (label: string, error: { message: string } | null) => {
    if (error) {
      clean = false;
      console.warn(`cleanup ${label}: ${error.message}`);
    }
  };

  if (ctx.branchIds.length > 0) {
    warn("ea_branch_subscriptions", (await ctx.admin.from("ea_branch_subscriptions").delete().in("branch_id", ctx.branchIds)).error);
  }

  for (const chainId of ctx.chainIds) {
    const { data: props } = await ctx.admin.from("properties").select("id").eq("chain_id", chainId);
    const propertyIds = (props ?? []).map((p) => p.id as number);
    if (propertyIds.length > 0) {
      for (const table of [
        "activities",
        "property_members",
        "property_operational_identities",
        "property_counterparty_participants",
        "property_delegates",
        "property_claim_invitations",
        "property_claim_metadata",
        "property_ea_assignments",
        "property_delink_events",
        "property_lifecycle_events",
        "property_lifecycle_states",
      ]) {
        warn(table, (await ctx.admin.from(table).delete().in("property_id", propertyIds)).error);
      }
      warn("unlink", (await ctx.admin.from("properties").update({ linked_property_id: null }).in("id", propertyIds)).error);
      warn("properties", (await ctx.admin.from("properties").delete().in("id", propertyIds)).error);
    }
    warn("chain_nodes", (await ctx.admin.from("chain_nodes").delete().eq("chain_id", chainId)).error);
    warn("chains", (await ctx.admin.from("chains").delete().eq("id", chainId)).error);
  }

  if (ctx.branchIds.length > 0) {
    for (const table of [
      "property_ea_assignments",
      "ea_subscription_events",
      "ea_branch_invitations",
      "ea_branch_membership_events",
    ]) {
      warn(table, (await ctx.admin.from(table).delete().in("branch_id", ctx.branchIds)).error);
    }
  }
  for (const companyId of ctx.companyIds) {
    warn("ea_branches", (await ctx.admin.from("ea_branches").delete().eq("company_id", companyId)).error);
    warn("ea_companies", (await ctx.admin.from("ea_companies").delete().eq("id", companyId)).error);
  }
  if (ctx.userIds.length > 0) {
    warn("rpc_rate_limit_buckets", (await ctx.admin.from("rpc_rate_limit_buckets").delete().in("subject_key", ctx.userIds)).error);
  }
  for (const userId of ctx.userIds) {
    warn("profiles", (await ctx.admin.from("profiles").delete().eq("id", userId)).error);
    warn("auth user", (await ctx.admin.auth.admin.deleteUser(userId)).error);
  }

  if (!ctx.fixtureId) return clean;
  if (!clean) {
    console.warn(`cleanup incomplete: smoke-test fixture ${ctx.fixtureId} left active for the fixture cleanup`);
    return false;
  }
  warn(
    "smoke_test_fixtures",
    (
      await ctx.admin
        .from("smoke_test_fixtures")
        .update({ status: "cleaned", cleaned_at: new Date().toISOString() })
        .eq("id", ctx.fixtureId)
    ).error
  );
  await ctx.admin.from("smoke_test_fixture_audit_events").insert({
    fixture_id: ctx.fixtureId,
    event_type: "fixture_cleaned",
    dry_run: false,
    payload: { source: "verify-ea-branch-directory-eligibility-development" },
  });
  return clean;
}

async function main() {
  if (!process.argv.includes("--execute")) {
    console.log(
      `Writes to shared Development. Run only once approved, with --execute ${CONFIRM_FLAG}, after applying 20261010120000 and 20261011090000.`
    );
    return;
  }

  loadEnvLocal();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !anonKey || !serviceRoleKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are required for --execute");
  }
  const projectRef = assertDevelopmentTarget({
    url,
    anonKey,
    serviceRoleKey,
    argv: process.argv,
    vercelEnv: process.env.VERCEL_ENV,
  });
  console.log(`Development project: ${projectRef}\n`);

  const ctx: Ctx = {
    url,
    anonKey,
    admin: createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } }),
    stamp: `${Date.now()}-${randomUUID().slice(0, 8)}`,
    token: `dv${randomUUID().replace(/-/g, "").slice(0, 8)}`,
    fixtureId: null,
    userIds: [],
    chainIds: [],
    branchIds: [],
    companyIds: [],
    observer: null,
  };

  let aborted: unknown = null;
  try {
    await createFixture(ctx);
    await runScenarios(ctx);
  } catch (error) {
    aborted = error;
  } finally {
    const clean = await cleanupFixtures(ctx);
    record("cleanup removed every verifier row", clean);
  }
  if (aborted) {
    console.error(aborted instanceof ExposureError ? `EXPOSURE: ${aborted.message}` : aborted);
    process.exit(1);
  }

  const failed = results.filter((r) => !r.pass).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed.`);
  if (failed > 0) process.exit(1);
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("verify-ea-branch-directory-eligibility-development.ts")) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
