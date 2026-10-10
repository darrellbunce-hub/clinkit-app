/**
 * Estate Agent branch directory search and eligibility — live Development scenarios.
 *
 * Requires 20261010120000_ea_branch_directory_search_eligibility.sql on Development.
 *
 *   D1 a branch sorting after row 200 of the directory is found by search
 *   D2 entitlement per branch: trial, paid and grace are listed; expired grace,
 *      ended, open "none" and no subscription are not
 *   D3 Rule 17.15: branches on an active fixture (branch, company or company
 *      creator), or with a reserved test domain on the company or its creator,
 *      are not listed; a cleaned fixture does not hide a branch
 *   D4 a company with an entitled branch and an ended branch: only the entitled
 *      one is listed, whoever searches; assignment labels follow membership of
 *      each branch, not of the company
 *   D5 direct access: view by id, base tables, wildcard and short queries,
 *      oversized limits, view writes and anon cannot bypass eligibility
 *   D6 homeowner flow: search, assign, label; after entitlement ends the branch
 *      leaves search and the existing assignment keeps its label
 *   D7 EA onboarding still works; the new branch is listed once it has a trial
 *
 * Fixture companies use non-reserved .co.uk domains so they look like customer
 * branches; they are listed in the shared Development directory only while the
 * run is in progress and are removed in cleanup.
 *
 * Usage (Development ONLY — bbbsxzxcjkmpqsfvmhbo):
 *   npx tsx scripts/verify-ea-branch-directory-eligibility-development.ts --execute
 */
import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import { join } from "path";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { createChainForOnboarding } from "../lib/createChainForOnboarding";
import type { EaBranchDirectoryEntry } from "../lib/estateAgent/assignmentTypes";
import {
  assignPropertyToBranch,
  loadAssignmentWithBranchDirectory,
  searchEaBranchDirectory,
} from "../lib/estateAgent/assignments";
import { completeEstateAgentOnboarding } from "../lib/estateAgent/completeOnboarding";
import { createEstateAgentProfile } from "../lib/estateAgent/createEstateAgentProfile";
import { establishOperationalHomeowner } from "../lib/ownership/grants";
import { OPERATIONAL_IDENTITY_GRANT_VIA } from "../lib/ownership/types";

const DEVELOPMENT_SUPABASE_PROJECT_REF = "bbbsxzxcjkmpqsfvmhbo";
const PASSWORD = "DirectoryEligibilityDev123!";
const HOMEOWNER_DOMAIN_SUFFIX = ".dirv.test";
const FILLER_BRANCH_COUNT = 205;
const CHUNK = 50;

type TestResult = { name: string; pass: boolean; detail?: string };
const results: TestResult[] = [];

function record(name: string, pass: boolean, detail?: string) {
  results.push({ name, pass, detail });
  console.log(pass ? `✓ ${name}` : `✗ ${name}${detail ? `: ${detail}` : ""}`);
}

function loadEnvLocal(): void {
  try {
    for (const line of readFileSync(join(process.cwd(), ".env.local"), "utf8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const separatorIndex = trimmed.indexOf("=");
      if (separatorIndex <= 0) continue;
      const key = trimmed.slice(0, separatorIndex).trim();
      let value = trimmed.slice(separatorIndex + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  } catch {
    // optional
  }
}

function assertDevelopmentEnvironment(supabaseUrl: string): string {
  const projectRef = supabaseUrl.match(/^https:\/\/([a-z0-9]+)\.supabase\.co/i)?.[1] ?? null;
  if (projectRef !== DEVELOPMENT_SUPABASE_PROJECT_REF) {
    throw new Error(
      `Refusing to run: Supabase project "${projectRef ?? "unknown"}" is not Development (${DEVELOPMENT_SUPABASE_PROJECT_REF}).`
    );
  }
  if (process.env.VERCEL_ENV === "production") {
    throw new Error("Refusing to run: VERCEL_ENV=production.");
  }
  return projectRef;
}

function chunks<T>(items: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += CHUNK) out.push(items.slice(i, i + CHUNK));
  return out;
}

type Ctx = {
  url: string;
  anonKey: string;
  admin: SupabaseClient;
  stamp: string;
  token: string;
  userIds: string[];
  chainIds: number[];
  branchIds: string[];
  companyIds: string[];
  fixtureIds: string[];
};

type Actor = { userId: string; email: string; client: SupabaseClient };

type SubscriptionKind = "trial" | "paid" | "grace" | "grace_expired" | "ended" | "none";

function anonClient(ctx: Ctx): SupabaseClient {
  return createClient(ctx.url, ctx.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function createAuthUser(ctx: Ctx, email: string): Promise<string> {
  const { data, error } = await ctx.admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user?.id) {
    throw new Error(`createUser failed: ${error?.message ?? "no user"}`);
  }
  ctx.userIds.push(data.user.id);
  return data.user.id;
}

async function signIn(ctx: Ctx, email: string): Promise<SupabaseClient> {
  const client = anonClient(ctx);
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`Sign in failed: ${error.message}`);
  return client;
}

async function setupHomeowner(ctx: Ctx, label: string): Promise<Actor> {
  const email = `dirv-${label}-${ctx.stamp}@ho-${ctx.token}${HOMEOWNER_DOMAIN_SUFFIX}`;
  const userId = await createAuthUser(ctx, email);
  const client = await signIn(ctx, email);
  const { error } = await client.from("profiles").upsert(
    {
      id: userId,
      role: "homeowner",
      account_type: "homeowner",
      contact_name: `HO ${label}`,
      onboarding_completed_at: new Date().toISOString(),
    },
    { onConflict: "id" }
  );
  if (error) throw new Error(`homeowner profile: ${error.message}`);
  return { userId, email, client };
}

/** Company created directly with the service role, as onboarding would leave it. */
async function createCompany(
  ctx: Ctx,
  name: string,
  options: { companyDomain?: string; creatorEmail?: string } = {}
): Promise<{ companyId: string; creatorUserId: string; creatorEmail: string }> {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  const companyDomain = options.companyDomain ?? `dirv-${slug}.co.uk`;
  const creatorEmail = options.creatorEmail ?? `owner-${ctx.stamp}@${companyDomain}`;
  const creatorUserId = await createAuthUser(ctx, creatorEmail);
  const { data, error } = await ctx.admin
    .from("ea_companies")
    .insert({ name, email_domain: companyDomain, created_by_user_id: creatorUserId })
    .select("id")
    .single();
  if (error || !data) throw new Error(`company ${name}: ${error?.message}`);
  ctx.companyIds.push(data.id as string);
  return { companyId: data.id as string, creatorUserId, creatorEmail };
}

async function createBranches(
  ctx: Ctx,
  companyId: string,
  names: string[],
  postcode = "PO16 7DV"
): Promise<string[]> {
  const ids: string[] = [];
  for (const batch of chunks(names)) {
    const { data, error } = await ctx.admin
      .from("ea_branches")
      .insert(
        batch.map((name, index) => ({
          company_id: companyId,
          name,
          town_or_city: "Fareham",
          postcode,
          region_code: "SE",
          is_head_office: ids.length === 0 && index === 0,
        }))
      )
      .select("id, name");
    if (error || !data) throw new Error(`branches: ${error?.message}`);
    const byName = new Map(data.map((row) => [row.name as string, row.id as string]));
    for (const name of batch) ids.push(byName.get(name)!);
  }
  ctx.branchIds.push(...ids);
  return ids;
}

function subscriptionRow(branchId: string, kind: SubscriptionKind) {
  const now = Date.now();
  const base = {
    branch_id: branchId,
    pricing_tier: "standard",
    amount_gbp_minor: 12900,
    currency: "gbp",
  };
  switch (kind) {
    case "trial":
      return { ...base, stripe_status: "trialing", entitlement_status: "entitled" };
    case "paid":
      return { ...base, stripe_status: "active", entitlement_status: "entitled" };
    case "grace":
      return {
        ...base,
        stripe_status: "past_due",
        entitlement_status: "grace",
        grace_ends_at: new Date(now + 3 * 86_400_000).toISOString(),
      };
    case "grace_expired":
      return {
        ...base,
        stripe_status: "past_due",
        entitlement_status: "grace",
        grace_ends_at: new Date(now - 3_600_000).toISOString(),
      };
    case "ended":
      return {
        ...base,
        stripe_status: "canceled",
        entitlement_status: "ended",
        ended_at: new Date(now).toISOString(),
      };
    case "none":
      return { ...base, stripe_status: "not_started", entitlement_status: "none" };
  }
}

async function subscribe(ctx: Ctx, branchIds: string[], kind: SubscriptionKind): Promise<void> {
  for (const batch of chunks(branchIds)) {
    const { error } = await ctx.admin
      .from("ea_branch_subscriptions")
      .insert(batch.map((branchId) => subscriptionRow(branchId, kind)));
    if (error) throw new Error(`subscriptions (${kind}): ${error.message}`);
  }
}

async function addMember(
  ctx: Ctx,
  branchId: string,
  userId: string,
  role: "branch_admin" | "agent"
): Promise<void> {
  const { error } = await ctx.admin
    .from("ea_branch_members")
    .insert({ branch_id: branchId, user_id: userId, role });
  if (error) throw new Error(`member: ${error.message}`);
}

async function registerFixture(
  ctx: Ctx,
  status: "active" | "cleaned",
  objectType: "ea_branch" | "ea_company" | "auth_user",
  objectId: string
): Promise<void> {
  const { data, error } = await ctx.admin
    .from("smoke_test_fixtures")
    .insert({
      label: `directory eligibility ${ctx.token}`,
      status,
      cleaned_at: status === "cleaned" ? new Date().toISOString() : null,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`fixture: ${error?.message}`);
  ctx.fixtureIds.push(data.id as string);
  const { error: objectError } = await ctx.admin.from("smoke_test_fixture_objects").insert({
    fixture_id: data.id,
    object_type: objectType,
    object_id: objectId,
    ownership: "owned",
  });
  if (objectError) throw new Error(`fixture object: ${objectError.message}`);
}

async function search(client: SupabaseClient, query: string, limit?: number): Promise<EaBranchDirectoryEntry[]> {
  const { branches, error } = await searchEaBranchDirectory(client, query, limit);
  if (error) throw new Error(`search "${query}": ${error}`);
  return branches;
}

async function rawSearch(
  client: SupabaseClient,
  query: string,
  limit = 20
): Promise<{ rows: EaBranchDirectoryEntry[]; error: string | null }> {
  const { data, error } = await client.rpc("search_ea_branch_directory", { p_query: query, p_limit: limit });
  return { rows: (data ?? []) as EaBranchDirectoryEntry[], error: error?.message ?? null };
}

const ids = (rows: EaBranchDirectoryEntry[]) => new Set(rows.map((row) => row.branch_id));

let counter = 0;

async function homeownerSale(ctx: Ctx, ho: Actor): Promise<number> {
  counter += 1;
  const chain = await createChainForOnboarding(ho.client, {
    name: `CHAIN-DIRV-${ctx.token}-${counter}`,
    accessCode: `KN-DIRV-${ctx.token.slice(-6)}-${counter}`.toUpperCase(),
  });
  if (chain.error || chain.chainId == null) throw new Error(`createChainForOnboarding: ${chain.error}`);
  ctx.chainIds.push(chain.chainId);

  const { data, error } = await ho.client
    .from("properties")
    .insert({
      chain_id: chain.chainId,
      chain_position: 1,
      address: `${counter} Directory Verifier Road ${ctx.token}`,
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

  const { data: grant, error: grantError } = await establishOperationalHomeowner(ho.client, {
    propertyId: data.id as number,
    grantedVia: OPERATIONAL_IDENTITY_GRANT_VIA.startMove,
  });
  if (grantError || !grant.ok) {
    throw new Error(`grant sale: ${grantError?.message ?? (!grant.ok ? grant.error : "")}`);
  }
  return data.id as number;
}

async function runScenarios(ctx: Ctx) {
  const t = ctx.token;
  const owner = await setupHomeowner(ctx, "owner");
  const stranger = await setupHomeowner(ctx, "stranger");

  // Fixtures --------------------------------------------------------------
  const filler = await createCompany(ctx, `Aa Directory Verifier Filler ${t}`);
  const fillerNames = Array.from({ length: FILLER_BRANCH_COUNT }, (_, i) => `Filler ${String(i + 1).padStart(3, "0")}`);
  const fillerIds = await createBranches(ctx, filler.companyId, fillerNames);
  await subscribe(ctx, fillerIds, "paid");

  const target = await createCompany(ctx, `Zz Directory Verifier ${t}`);
  const kinds: Array<[string, SubscriptionKind | null]> = [
    ["Target Trial", "trial"],
    ["Target Paid", "paid"],
    ["Target Grace", "grace"],
    ["Target Grace Expired", "grace_expired"],
    ["Target Ended", "ended"],
    ["Target None", "none"],
    ["Target No Subscription", null],
  ];
  const targetIds = await createBranches(ctx, target.companyId, kinds.map(([name]) => name), "PO16 7DT");
  const targetBy = Object.fromEntries(kinds.map(([name], i) => [name, targetIds[i]]));
  for (const [name, kind] of kinds) {
    if (kind) await subscribe(ctx, [targetBy[name]], kind);
  }

  const companyFor1715 = async (word: string, options: { companyDomain?: string; creatorEmail?: string } = {}) => {
    const company = await createCompany(ctx, `${word} ${t}`, options);
    const [branchId] = await createBranches(ctx, company.companyId, [`${word} Branch`]);
    await subscribe(ctx, [branchId], "paid");
    return { ...company, branchId };
  };
  const fixtureBranch = await companyFor1715("Fixturebranch");
  await registerFixture(ctx, "active", "ea_branch", fixtureBranch.branchId);
  const fixtureCompany = await companyFor1715("Fixturecompany");
  await registerFixture(ctx, "active", "ea_company", fixtureCompany.companyId);
  const fixtureCreator = await companyFor1715("Fixturecreator");
  await registerFixture(ctx, "active", "auth_user", fixtureCreator.creatorUserId);
  const cleanedFixture = await companyFor1715("Cleanedfixture");
  await registerFixture(ctx, "cleaned", "ea_branch", cleanedFixture.branchId);
  const reservedDomain = await companyFor1715("Reserveddomain", {
    companyDomain: `dirv-reserved-${t}.test`,
    creatorEmail: `owner-${ctx.stamp}@dirv-reserved-creator-ok-${t}.co.uk`,
  });
  const reservedCreator = await companyFor1715("Reservedcreator", {
    companyDomain: `dirv-reservedcreator-${t}.co.uk`,
    creatorEmail: `owner-${ctx.stamp}@dirv-${t}.example.com`,
  });

  // A user belongs to at most one branch (ea_branch_members_one_branch_per_user_idx),
  // so "several branches" means a company creator whose company has branches in
  // different entitlement states, with each branch run by its own admin.
  const multi = await createCompany(ctx, `Multibranch ${t}`);
  const [multiPaid, multiEnded] = await createBranches(ctx, multi.companyId, ["Multibranch Paid", "Multibranch Ended"]);
  await subscribe(ctx, [multiPaid], "paid");
  await subscribe(ctx, [multiEnded], "ended");
  await addMember(ctx, multiPaid, multi.creatorUserId, "branch_admin");
  const endedAdminEmail = `endedadmin-${ctx.stamp}@dirv-multibranch-${t}.co.uk`;
  const endedAdminId = await createAuthUser(ctx, endedAdminEmail);
  await addMember(ctx, multiEnded, endedAdminId, "branch_admin");
  const multiClient = await signIn(ctx, multi.creatorEmail);
  const endedAdminClient = await signIn(ctx, endedAdminEmail);

  const targetAdminEmail = `targetadmin-${ctx.stamp}@dirv-zz-directory-verifier-${t}.co.uk`;
  const targetAdminId = await createAuthUser(ctx, targetAdminEmail);
  await addMember(ctx, targetBy["Target Trial"], targetAdminId, "branch_admin");
  const targetAdminClient = await signIn(ctx, targetAdminEmail);

  // D1 --------------------------------------------------------------------
  const { data: firstPage, error: firstPageError } = await owner.client
    .from("ea_branch_directory")
    .select("*")
    .order("company_name")
    .order("branch_name")
    .limit(200);
  const firstPageIds = new Set((firstPage ?? []).map((row) => row.branch_id as string));
  const { count: eligibleCount } = await owner.client
    .from("ea_branch_directory")
    .select("branch_id", { count: "exact", head: true });
  record(
    "D1 the target branch sorts after row 200 (the old 200-row load could not contain it)",
    firstPageError == null &&
      firstPageIds.size === 200 &&
      !firstPageIds.has(targetBy["Target Trial"]) &&
      (eligibleCount ?? 0) > 200,
    `firstPage=${firstPageIds.size} eligible=${eligibleCount} error=${firstPageError?.message ?? ""}`
  );
  const byName = await search(owner.client, `Zz Directory Verifier ${t} trial`);
  record(
    "D1 search finds the branch beyond row 200 by company and branch name",
    byName.length === 1 && byName[0].branch_id === targetBy["Target Trial"],
    JSON.stringify(byName.map((row) => row.branch_name))
  );
  const byPostcode = await search(owner.client, `po16 7dt ${t}`);
  record(
    "D1 search matches postcode terms (with the space) before the limit",
    ids(byPostcode).has(targetBy["Target Trial"]) && byPostcode.every((row) => row.company_id === target.companyId)
  );
  const byTown = await search(owner.client, `fareham zz ${t}`);
  record("D1 search matches town and company terms together", ids(byTown).has(targetBy["Target Trial"]));

  // D2 --------------------------------------------------------------------
  const targetRows = ids(await search(owner.client, `Zz Directory Verifier ${t}`));
  for (const [name, kind] of kinds) {
    const listed = targetRows.has(targetBy[name]);
    const expected = kind === "trial" || kind === "paid" || kind === "grace";
    record(
      `D2 ${kind ?? "no subscription"} branch is ${expected ? "listed" : "not listed"}`,
      listed === expected
    );
  }

  // D3 --------------------------------------------------------------------
  const expect1715 = async (label: string, word: string, branchId: string, listed: boolean) => {
    const rows = ids(await search(owner.client, `${word} ${t}`));
    record(`D3 ${label} ${listed ? "is listed" : "is not listed"}`, rows.has(branchId) === listed);
  };
  await expect1715("branch on an active fixture", "Fixturebranch", fixtureBranch.branchId, false);
  await expect1715("branch whose company is on an active fixture", "Fixturecompany", fixtureCompany.branchId, false);
  await expect1715("branch whose company creator is on an active fixture", "Fixturecreator", fixtureCreator.branchId, false);
  await expect1715("branch on a cleaned fixture", "Cleanedfixture", cleanedFixture.branchId, true);
  await expect1715("company with a reserved (.test) email domain", "Reserveddomain", reservedDomain.branchId, false);
  await expect1715("company created from a reserved (example.com) address", "Reservedcreator", reservedCreator.branchId, false);

  // D4 --------------------------------------------------------------------
  for (const [label, client] of [
    ["homeowner", owner.client],
    ["the company creator", multiClient],
    ["the ended branch's admin", endedAdminClient],
  ] as const) {
    const rows = ids(await search(client, `Multibranch ${t}`));
    record(
      `D4 ${label} sees the company's entitled branch but not its ended branch`,
      rows.has(multiPaid) && !rows.has(multiEnded)
    );
  }

  // D5 --------------------------------------------------------------------
  const excluded = [
    targetBy["Target Grace Expired"],
    targetBy["Target Ended"],
    targetBy["Target None"],
    targetBy["Target No Subscription"],
    fixtureBranch.branchId,
    fixtureCompany.branchId,
    fixtureCreator.branchId,
    reservedDomain.branchId,
    reservedCreator.branchId,
    multiEnded,
  ];
  const { data: viewById, error: viewByIdError } = await owner.client
    .from("ea_branch_directory")
    .select("branch_id")
    .in("branch_id", excluded);
  record(
    "D5 reading the view by id returns no ineligible branch",
    viewByIdError == null && (viewById ?? []).length === 0,
    `${(viewById ?? []).length} ${viewByIdError?.message ?? ""}`
  );
  const { data: baseBranches } = await owner.client.from("ea_branches").select("id").in("id", excluded);
  const { data: baseCompanies } = await owner.client
    .from("ea_companies")
    .select("id")
    .in("id", [target.companyId, multi.companyId, fixtureBranch.companyId]);
  const { data: baseSubscriptions } = await owner.client
    .from("ea_branch_subscriptions")
    .select("id")
    .in("branch_id", excluded);
  record(
    "D5 base tables return nothing to a homeowner (branches, companies, subscriptions)",
    (baseBranches ?? []).length === 0 && (baseCompanies ?? []).length === 0 && (baseSubscriptions ?? []).length === 0
  );
  const ownEnded = await endedAdminClient.from("ea_branch_directory").select("branch_id").eq("branch_id", multiEnded);
  const creatorEnded = await multiClient.from("ea_branch_directory").select("branch_id").eq("branch_id", multiEnded);
  record(
    "D5 membership of the ended branch, or creating its company, does not list it in the directory",
    ownEnded.error == null &&
      (ownEnded.data ?? []).length === 0 &&
      creatorEnded.error == null &&
      (creatorEnded.data ?? []).length === 0
  );

  const wildcard = await rawSearch(owner.client, "%%");
  const underscore = await rawSearch(owner.client, "__ __");
  const regex = await rawSearch(owner.client, ".* .*");
  record(
    "D5 wildcard and pattern characters are matched literally",
    wildcard.error == null &&
      wildcard.rows.length === 0 &&
      underscore.rows.length === 0 &&
      regex.rows.length === 0,
    `${wildcard.rows.length}/${underscore.rows.length}/${regex.rows.length} ${wildcard.error ?? ""}`
  );
  const short = await rawSearch(owner.client, "a");
  const blank = await rawSearch(owner.client, "   ");
  const tooLong = await rawSearch(owner.client, `${t} ${"x".repeat(120)}`);
  record(
    "D5 queries under 2 or over 100 characters return nothing",
    short.rows.length === 0 && blank.rows.length === 0 && tooLong.rows.length === 0
  );
  const huge = await rawSearch(owner.client, t, 100_000);
  const zero = await rawSearch(owner.client, t, 0);
  record(
    "D5 the row limit is clamped to 1–50",
    huge.error == null && huge.rows.length === 50 && zero.rows.length === 1,
    `huge=${huge.rows.length} zero=${zero.rows.length}`
  );
  const broad = await rawSearch(owner.client, t, 50);
  record(
    "D5 a broad search never returns an ineligible branch",
    broad.rows.every((row) => !excluded.includes(row.branch_id))
  );
  const viewWrite = await owner.client.from("ea_branch_directory").insert({
    branch_id: randomUUID(),
    branch_name: "x",
    town_or_city: "x",
    postcode: "x",
    company_id: target.companyId,
    company_name: "x",
  });
  const viewDelete = await owner.client.from("ea_branch_directory").delete().eq("branch_id", targetBy["Target Paid"]);
  record("D5 authenticated users cannot write to the view", viewWrite.error != null && viewDelete.error != null);

  const anon = anonClient(ctx);
  const anonSearch = await rawSearch(anon, `Zz Directory Verifier ${t}`);
  const anonView = await anon.from("ea_branch_directory").select("branch_id").limit(1);
  const anonLabel = await anon.rpc("get_property_ea_branch_entry", { p_property_id: 1 });
  record(
    "D5 anon cannot search, read the view or read labels",
    anonSearch.error != null && anonView.error != null && anonLabel.error != null
  );

  // D6 --------------------------------------------------------------------
  const sale = await homeownerSale(ctx, owner);
  const [found] = await search(owner.client, `Zz Directory Verifier ${t} trial`);
  const assigned = found
    ? await assignPropertyToBranch(owner.client, {
        propertyId: sale,
        branchId: found.branch_id,
        homeownerOnlyUpdates: true,
      })
    : { assignmentId: null, error: "not found" };
  record("D6 homeowner assigns the branch found by search", assigned.error == null && assigned.assignmentId != null, JSON.stringify(assigned));

  const ownerLabel = await loadAssignmentWithBranchDirectory(owner.client, sale);
  record(
    "D6 homeowner sees the assigned branch label",
    ownerLabel.assignment?.branch_id === targetBy["Target Trial"] &&
      ownerLabel.branch?.branch_id === targetBy["Target Trial"] &&
      ownerLabel.branch?.company_name === `Zz Directory Verifier ${t}`
  );
  const eaLabel = await loadAssignmentWithBranchDirectory(targetAdminClient, sale);
  record(
    "D6 the assigned branch's member sees the label",
    eaLabel.branch?.branch_id === targetBy["Target Trial"] && eaLabel.branch?.branch_name === "Target Trial"
  );
  const strangerLabel = await loadAssignmentWithBranchDirectory(stranger.client, sale);
  const strangerRpc = await stranger.client.rpc("get_property_ea_branch_entry", { p_property_id: sale });
  record(
    "D6 a stranger gets neither the assignment nor the label",
    strangerLabel.assignment == null &&
      strangerLabel.branch == null &&
      strangerRpc.error == null &&
      ((strangerRpc.data as unknown[] | null) ?? []).length === 0
  );
  const otherBranchLabel = await multiClient.rpc("get_property_ea_branch_entry", { p_property_id: sale });
  record(
    "D6 a member of a different branch gets no label",
    ((otherBranchLabel.data as unknown[] | null) ?? []).length === 0
  );

  const { error: endError } = await ctx.admin
    .from("ea_branch_subscriptions")
    .update({ entitlement_status: "ended", stripe_status: "canceled", ended_at: new Date().toISOString() })
    .eq("branch_id", targetBy["Target Trial"])
    .is("ended_at", null);
  const afterEnd = ids(await search(owner.client, `Zz Directory Verifier ${t}`));
  const labelAfterEnd = await loadAssignmentWithBranchDirectory(owner.client, sale);
  record(
    "D6 once its entitlement ends the branch leaves search",
    endError == null && !afterEnd.has(targetBy["Target Trial"]) && afterEnd.has(targetBy["Target Paid"])
  );
  record(
    "D6 the existing assignment keeps its branch label after entitlement ends",
    labelAfterEnd.branch?.branch_id === targetBy["Target Trial"] && labelAfterEnd.assignment != null
  );

  // D4 labels: assignment on the multi-branch user's ended branch
  const multiSale = await homeownerSale(ctx, owner);
  const { error: legacyAssignError } = await ctx.admin.from("property_ea_assignments").insert({
    property_id: multiSale,
    branch_id: multiEnded,
    status: "active",
    assigned_by_user_id: owner.userId,
    homeowner_only_updates: true,
  });
  const endedAdminLabel = await loadAssignmentWithBranchDirectory(endedAdminClient, multiSale);
  const creatorLabel = await multiClient.rpc("get_property_ea_branch_entry", { p_property_id: multiSale });
  const ownerMultiLabel = await loadAssignmentWithBranchDirectory(owner.client, multiSale);
  record(
    "D4 labels are per branch: the ended branch's admin and the homeowner see it; the company creator, a member of the sibling branch, does not",
    legacyAssignError == null &&
      endedAdminLabel.branch?.branch_id === multiEnded &&
      ((creatorLabel.data as unknown[] | null) ?? []).length === 0 &&
      ownerMultiLabel.branch?.branch_id === multiEnded,
    legacyAssignError?.message
  );

  // D7 --------------------------------------------------------------------
  const onboardDomain = `dirv-onboarding-${t}.co.uk`;
  const onboardEmail = `founder-${ctx.stamp}@${onboardDomain}`;
  const onboardUserId = await createAuthUser(ctx, onboardEmail);
  const onboardClient = await signIn(ctx, onboardEmail);
  const profile = await createEstateAgentProfile(onboardClient, {
    userId: onboardUserId,
    contactName: "Directory Onboarding",
    email: onboardEmail,
  });
  const onboard = profile.error
    ? { success: false as const, error: profile.error }
    : await completeEstateAgentOnboarding(onboardClient, {
        userId: onboardUserId,
        companyName: `Onboardco ${t}`,
        branchName: "Onboard Branch",
        townOrCity: "Fareham",
        postcode: "PO16 7AA",
        isHeadOffice: true,
        emailDomain: onboardDomain,
      });
  const { data: onboardMembership } = await ctx.admin
    .from("ea_branch_members")
    .select("branch_id, role")
    .eq("user_id", onboardUserId)
    .maybeSingle();
  const onboardBranchId = (onboardMembership?.branch_id as string | undefined) ?? null;
  if (onboardBranchId) {
    ctx.branchIds.push(onboardBranchId);
    const { data: onboardBranch } = await ctx.admin
      .from("ea_branches")
      .select("company_id")
      .eq("id", onboardBranchId)
      .single();
    if (onboardBranch?.company_id) ctx.companyIds.push(onboardBranch.company_id as string);
  }
  record(
    "D7 EA onboarding still creates the company, branch and admin membership",
    onboard.success && onboardBranchId != null && onboardMembership?.role === "branch_admin",
    onboard.success ? undefined : onboard.error
  );
  const beforeTrial = ids(await search(owner.client, `Onboardco ${t}`));
  if (onboardBranchId) await subscribe(ctx, [onboardBranchId], "trial");
  const afterTrial = ids(await search(owner.client, `Onboardco ${t}`));
  record(
    "D7 the onboarded branch is listed only once its trial is active",
    onboardBranchId != null && !beforeTrial.has(onboardBranchId) && afterTrial.has(onboardBranchId)
  );
}

async function cleanupFixtures(ctx: Ctx): Promise<void> {
  const warn = (label: string, error: { message: string } | null) => {
    if (error) console.warn(`cleanup ${label}: ${error.message}`);
  };

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

  for (const fixtureId of ctx.fixtureIds) {
    warn("smoke_test_fixtures", (await ctx.admin.from("smoke_test_fixtures").delete().eq("id", fixtureId)).error);
  }

  for (const batch of chunks(ctx.branchIds)) {
    warn("property_ea_assignments", (await ctx.admin.from("property_ea_assignments").delete().in("branch_id", batch)).error);
    warn("ea_subscription_events", (await ctx.admin.from("ea_subscription_events").delete().in("branch_id", batch)).error);
    warn("ea_branch_subscriptions", (await ctx.admin.from("ea_branch_subscriptions").delete().in("branch_id", batch)).error);
    warn("ea_branch_invitations", (await ctx.admin.from("ea_branch_invitations").delete().in("branch_id", batch)).error);
    warn(
      "ea_branch_membership_events",
      (await ctx.admin.from("ea_branch_membership_events").delete().in("branch_id", batch)).error
    );
  }
  for (const companyId of ctx.companyIds) {
    warn("ea_branches", (await ctx.admin.from("ea_branches").delete().eq("company_id", companyId)).error);
    warn("ea_companies", (await ctx.admin.from("ea_companies").delete().eq("id", companyId)).error);
  }
  if (ctx.userIds.length > 0) {
    warn(
      "rpc_rate_limit_buckets",
      (await ctx.admin.from("rpc_rate_limit_buckets").delete().in("subject_key", ctx.userIds)).error
    );
  }
  for (const userId of ctx.userIds) {
    warn("profiles", (await ctx.admin.from("profiles").delete().eq("id", userId)).error);
    const { error } = await ctx.admin.auth.admin.deleteUser(userId);
    warn("auth user", error);
  }
}

async function main() {
  if (!process.argv.includes("--execute")) {
    console.log("Live Development scenarios only. Re-run with --execute after applying 20261010120000.");
    return;
  }

  loadEnvLocal();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !anonKey || !serviceRoleKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are required for --execute"
    );
  }
  console.log(`Development project: ${assertDevelopmentEnvironment(url)}\n`);

  const ctx: Ctx = {
    url,
    anonKey,
    admin: createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    }),
    stamp: `${Date.now()}-${randomUUID().slice(0, 8)}`,
    token: `dv${randomUUID().replace(/-/g, "").slice(0, 8)}`,
    userIds: [],
    chainIds: [],
    branchIds: [],
    companyIds: [],
    fixtureIds: [],
  };

  try {
    await runScenarios(ctx);
  } finally {
    await cleanupFixtures(ctx);
  }

  const failed = results.filter((r) => !r.pass).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed.`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
