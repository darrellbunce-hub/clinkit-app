/**
 * Application alignment with M2 (seller-side authority, awaiting connection) —
 * live Development checks through the app library paths.
 *
 *   AP1 EA "purchase agreed": the onward purchase is the sale's converted
 *       placeholder; no EA assignment, identity or authority on it; awaiting its seller
 *   AP2 duplicate onward address is refused with a customer message
 *   AP3 seller's EA in Join mode: sale creation reports property_already_exists for a
 *       purchase awaiting its seller; connect_ea_to_awaiting_property refuses (generic,
 *       nothing written); on a legacy EA-managed purchase (assignment written by the
 *       service role, as before 20261010090000) onward plans run from the purchase
 *       anchor and the onward purchase carries no EA authority
 *   AP4 Start Move pre-check: available / yours / awaiting_connection /
 *       already_represented per side; invalid input mapped to a message
 *
 * Usage (Development ONLY — bbbsxzxcjkmpqsfvmhbo):
 *   npx tsx scripts/verify-m2-app-alignment-development.ts --execute
 */
import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import { join } from "path";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { completeEstateAgentOnboarding } from "../lib/estateAgent/completeOnboarding";
import { completeEaManagedPropertyOrigination } from "../lib/estateAgent/completeEaManagedPropertyOrigination";
import { createEstateAgentProfile } from "../lib/estateAgent/createEstateAgentProfile";
import {
  createEaOperationalProperty,
  joinEaOperationalChain,
} from "../lib/estateAgent/originateOperationalProperty";
import { checkStartMoveAddress } from "../lib/onboarding/addressReservation";

const DEVELOPMENT_SUPABASE_PROJECT_REF = "bbbsxzxcjkmpqsfvmhbo";
const PASSWORD = "AppAlignmentDev123!";
const TEST_EMAIL_PREFIX = "appalign";
const TEST_DOMAIN_SUFFIX = ".appalign.test";
const GENERIC = "join_details_not_matched";

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

type Ctx = {
  url: string;
  anonKey: string;
  admin: SupabaseClient;
  stamp: string;
  userIds: string[];
  chainIds: number[];
  branchIds: string[];
  companyIds: string[];
};

type Actor = { userId: string; email: string; client: SupabaseClient };
type EaActor = Actor & { branchId: string };

function anonClient(ctx: Ctx): SupabaseClient {
  return createClient(ctx.url, ctx.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function signIn(ctx: Ctx, email: string): Promise<SupabaseClient> {
  const client = anonClient(ctx);
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`Sign in failed: ${error.message}`);
  return client;
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

async function setupHomeowner(ctx: Ctx, label: string): Promise<Actor> {
  const email = `${TEST_EMAIL_PREFIX}-${label}-${ctx.stamp}@ho-${ctx.stamp}${TEST_DOMAIN_SUFFIX}`;
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

async function setupEstateAgent(ctx: Ctx, label: string): Promise<EaActor> {
  const domain = `${label}-${ctx.stamp}${TEST_DOMAIN_SUFFIX}`;
  const email = `${TEST_EMAIL_PREFIX}-${label}-${ctx.stamp}@${domain}`;
  const userId = await createAuthUser(ctx, email);
  const client = await signIn(ctx, email);

  const profile = await createEstateAgentProfile(client, {
    userId,
    contactName: `EA ${label}`,
    email,
  });
  if (profile.error) throw new Error(profile.error);

  const onboard = await completeEstateAgentOnboarding(client, {
    userId,
    companyName: `App Alignment Co ${label} ${ctx.stamp}`,
    branchName: `Branch ${label}`,
    townOrCity: "Fareham",
    postcode: "PO16 7AA",
    isHeadOffice: true,
    emailDomain: domain,
  });
  if (!onboard.success) throw new Error(onboard.error);

  const { data: membership } = await client
    .from("ea_branch_members")
    .select("branch_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (!membership?.branch_id) throw new Error("EA branch membership missing");

  const { data: branch } = await ctx.admin
    .from("ea_branches")
    .select("id, company_id")
    .eq("id", membership.branch_id)
    .single();

  ctx.branchIds.push(membership.branch_id as string);
  if (branch?.company_id) ctx.companyIds.push(branch.company_id as string);

  return { userId, email, client, branchId: membership.branch_id as string };
}

let counter = 0;

async function eaChain(ctx: Ctx, ea: EaActor): Promise<{ chainId: number; accessCode: string }> {
  counter += 1;
  const suffix = `${ctx.stamp.slice(-6)}-${counter}`;
  const { data, error } = await ea.client.rpc("create_ea_operational_chain", {
    p_name: `AP EA ${suffix}`,
    p_access_code: `KN-APE-${suffix}`.toUpperCase(),
  });
  if (error || !data?.ok) throw new Error(`create_ea_operational_chain: ${error?.message ?? data?.error}`);
  const chainId = data.chain_id as number;
  ctx.chainIds.push(chainId);
  const { data: chain } = await ctx.admin.from("chains").select("access_code").eq("id", chainId).single();
  return { chainId, accessCode: chain!.access_code as string };
}

async function homeownerChain(ctx: Ctx, ho: Actor): Promise<{ chainId: number; accessCode: string }> {
  counter += 1;
  const suffix = `${ctx.stamp.slice(-6)}-${counter}`;
  const { data, error } = await ho.client.rpc("create_chain_for_onboarding", {
    p_name: `AP HO ${suffix}`,
    p_access_code: `KN-APH-${suffix}`.toUpperCase(),
  });
  if (error || data?.chain_id == null) {
    throw new Error(`create_chain_for_onboarding: ${error?.message ?? data?.error}`);
  }
  const chainId = data.chain_id as number;
  ctx.chainIds.push(chainId);
  const { data: chain } = await ctx.admin.from("chains").select("access_code").eq("id", chainId).single();
  return { chainId, accessCode: chain!.access_code as string };
}

async function homeownerOwnedRow(
  ho: Actor,
  chainId: number,
  options: { relationship: "sale" | "purchase"; address: string; postcode: string; position: number }
): Promise<number> {
  const { data, error } = await ho.client
    .from("properties")
    .insert({
      chain_id: chainId,
      chain_position: options.position,
      address: options.address,
      postcode: options.postcode,
      stage: options.relationship === "sale" ? "property_listed" : "offer_accepted",
      status: "pending_connection",
      relationship_type: options.relationship,
      created_by_user_id: ho.userId,
      buyer_connected: options.relationship === "purchase",
      seller_connected: options.relationship === "sale",
      is_searching: false,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`property insert: ${error?.message}`);

  const { data: grant, error: grantError } = await ho.client.rpc(
    "establish_operational_homeowner_for_created_property",
    { p_property_id: data.id }
  );
  if (grantError || !grant?.ok) {
    throw new Error(`grant: ${grantError?.message ?? grant?.error}`);
  }
  return data.id as number;
}

async function canOperate(actor: Actor, propertyId: number): Promise<boolean | null> {
  const { data, error } = await actor.client.rpc("can_operate_property", { p_property_id: propertyId });
  return error ? null : (data as boolean);
}

async function adminState(ctx: Ctx, propertyId: number): Promise<string | null> {
  const { data } = await ctx.admin.rpc("_property_reservation_state", { p_property_id: propertyId });
  return (data as string | null) ?? null;
}

async function row(ctx: Ctx, propertyId: number) {
  const { data } = await ctx.admin
    .from("properties")
    .select("id, chain_id, relationship_type, stage, address, linked_property_id, created_by_user_id")
    .eq("id", propertyId)
    .maybeSingle();
  return data as {
    id: number;
    chain_id: number;
    relationship_type: string;
    stage: string;
    address: string | null;
    linked_property_id: number | null;
    created_by_user_id: string;
  } | null;
}

async function identityOwner(ctx: Ctx, propertyId: number): Promise<string | null> {
  const { data } = await ctx.admin
    .from("property_operational_identities")
    .select("homeowner_user_id")
    .eq("property_id", propertyId)
    .maybeSingle();
  return (data?.homeowner_user_id as string | undefined) ?? null;
}

async function activeAssignments(ctx: Ctx, propertyId: number) {
  const { data } = await ctx.admin
    .from("property_ea_assignments")
    .select("branch_id, homeowner_only_updates")
    .eq("property_id", propertyId)
    .eq("status", "active");
  return (data ?? []) as { branch_id: string; homeowner_only_updates: boolean }[];
}

async function viewHas(ea: EaActor, propertyId: number): Promise<boolean> {
  const { data } = await ea.client
    .from("ea_operational_assignments")
    .select("property_id")
    .eq("property_id", propertyId)
    .maybeSingle();
  return data != null;
}

async function runScenarios(ctx: Ctx): Promise<void> {
  const personA = await setupHomeowner(ctx, "a");
  const personC = await setupHomeowner(ctx, "c");
  const eaA = await setupEstateAgent(ctx, "ea-a");
  const eaB = await setupEstateAgent(ctx, "ea-b");

  // AP1 — EA "purchase agreed" via the app path
  const chain1 = await eaChain(ctx, eaA);
  const sale1 = await createEaOperationalProperty(eaA.client, {
    chainId: chain1.chainId,
    relationshipType: "sale",
    address: `1 Agreed House ${ctx.stamp}`,
    postcode: "PO16 7AA",
    branchId: eaA.branchId,
    homeownerOnlyUpdates: false,
    awaitingBuyer: false,
  });
  if (sale1.error || sale1.propertyId == null) throw new Error(`AP1 sale: ${sale1.error}`);

  const onward1Address = `2 Agreed Flat ${ctx.stamp}`;
  const complete1 = await completeEaManagedPropertyOrigination(eaA.client, {
    chainId: chain1.chainId,
    salePropertyId: sale1.propertyId,
    userId: eaA.userId,
    branchId: eaA.branchId,
    homeownerOnlyUpdates: false,
    onwardPlan: "purchase_agreed",
    onwardAddress: onward1Address,
    onwardPostcode: "PO16 7AB",
  });
  record("AP1 purchase agreed completes", complete1.ok === true, JSON.stringify(complete1));

  const sale1Row = await row(ctx, sale1.propertyId);
  const onward1 = sale1Row?.linked_property_id ?? null;
  const onward1Row = onward1 == null ? null : await row(ctx, onward1);
  record(
    "AP1 sale links to a converted onward purchase at the given address",
    onward1Row?.relationship_type === "purchase" &&
      onward1Row?.stage === "offer_accepted" &&
      onward1Row?.address === onward1Address &&
      onward1Row?.chain_id === chain1.chainId,
    JSON.stringify(onward1Row)
  );
  record(
    "AP1 onward purchase: no EA assignment and no identity",
    onward1 != null &&
      (await activeAssignments(ctx, onward1)).length === 0 &&
      (await identityOwner(ctx, onward1)) == null
  );
  record("AP1 onward purchase is awaiting its seller", onward1 != null && (await adminState(ctx, onward1)) === "awaiting_seller");
  record("AP1 EA cannot operate the onward purchase", onward1 != null && (await canOperate(eaA, onward1)) === false);
  record("AP1 EA still operates the sale", (await canOperate(eaA, sale1.propertyId)) === true);
  record(
    "AP1 EA assignment list: the sale only",
    (await viewHas(eaA, sale1.propertyId)) && onward1 != null && !(await viewHas(eaA, onward1))
  );

  // AP2 — duplicate onward address
  const sale2 = await createEaOperationalProperty(eaA.client, {
    chainId: chain1.chainId,
    relationshipType: "sale",
    address: `3 Second House ${ctx.stamp}`,
    postcode: "PO16 7AA",
    branchId: eaA.branchId,
    homeownerOnlyUpdates: false,
    awaitingBuyer: false,
  });
  if (sale2.error || sale2.propertyId == null) throw new Error(`AP2 sale: ${sale2.error}`);
  const complete2 = await completeEaManagedPropertyOrigination(eaA.client, {
    chainId: chain1.chainId,
    salePropertyId: sale2.propertyId,
    userId: eaA.userId,
    branchId: eaA.branchId,
    homeownerOnlyUpdates: false,
    onwardPlan: "purchase_agreed",
    onwardAddress: onward1Address,
    onwardPostcode: "PO16 7AB",
  });
  record(
    "AP2 duplicate onward address refused with a customer message",
    complete2.ok === false && /already part of MoveLoop/.test(complete2.error),
    JSON.stringify(complete2)
  );

  // AP3 — seller's EA joins an existing chain where the address awaits its seller
  const chainA = await homeownerChain(ctx, personA);
  const houseA = await homeownerOwnedRow(personA, chainA.chainId, {
    relationship: "sale",
    address: `10 Buyer Home ${ctx.stamp}`,
    postcode: "PO16 7HA",
    position: 1,
  });
  const flatAddress = `11 Awaiting Flat ${ctx.stamp}`;
  const flatA = await homeownerOwnedRow(personA, chainA.chainId, {
    relationship: "purchase",
    address: flatAddress,
    postcode: "PO16 7HB",
    position: 2,
  });
  record("AP3 fixture: buyer's purchase awaits its seller", (await adminState(ctx, flatA)) === "awaiting_seller");

  const joinAttempt = await joinEaOperationalChain(eaB.client, {
    accessCode: chainA.accessCode,
    relationshipType: "sale",
    address: flatAddress,
    postcode: "PO16 7HB",
    branchId: eaB.branchId,
    homeownerOnlyUpdates: false,
    awaitingBuyer: false,
  });
  record(
    "AP3 Join mode sale creation reports property_already_exists (no connect fallback)",
    joinAttempt.error === "property_already_exists",
    JSON.stringify(joinAttempt)
  );

  const { data: wrongCode } = await eaB.client.rpc("connect_ea_to_awaiting_property", {
    p_access_code: "KN-ZZZ-0000",
    p_address: flatAddress,
    p_postcode: "PO16 7HB",
    p_branch_id: eaB.branchId,
  });
  record(
    "AP3 connect with wrong access code is generic and creates nothing",
    wrongCode?.error === GENERIC && (await activeAssignments(ctx, flatA)).length === 0,
    JSON.stringify(wrongCode)
  );

  const { data: refused } = await eaB.client.rpc("connect_ea_to_awaiting_property", {
    p_access_code: chainA.accessCode,
    p_address: flatAddress,
    p_postcode: "PO16 7HB",
    p_branch_id: eaB.branchId,
  });
  record(
    "AP3 connect with the right access code and address is refused (generic) and creates nothing",
    refused?.ok === false &&
      refused?.error === GENERIC &&
      (await activeAssignments(ctx, flatA)).length === 0 &&
      (await adminState(ctx, flatA)) === "awaiting_seller",
    JSON.stringify(refused)
  );

  // Purchases connected before 20261010090000 keep their EA assignment; the
  // remaining AP3 checks run on one written the same way by the service role.
  const { error: legacyAssignError } = await ctx.admin.from("property_ea_assignments").insert({
    property_id: flatA,
    branch_id: eaB.branchId,
    status: "active",
    assigned_by_user_id: eaB.userId,
  });
  const flatAssignments = await activeAssignments(ctx, flatA);
  record(
    "AP3 legacy fixture: one assignment for EA B only; identity stays with the buyer",
    legacyAssignError == null &&
      flatAssignments.length === 1 &&
      flatAssignments[0].branch_id === eaB.branchId &&
      (await identityOwner(ctx, flatA)) === personA.userId,
    legacyAssignError?.message
  );
  record("AP3 EA B operates the purchase while EA-only", (await canOperate(eaB, flatA)) === true);
  record("AP3 buyer cannot operate the purchase", (await canOperate(personA, flatA)) === false);
  record("AP3 EA B cannot operate the buyer's sale", (await canOperate(eaB, houseA)) === false);

  const onwardBAddress = `12 Seller Onward ${ctx.stamp}`;
  const completeB = await completeEaManagedPropertyOrigination(eaB.client, {
    chainId: chainA.chainId,
    salePropertyId: flatA,
    userId: eaB.userId,
    branchId: eaB.branchId,
    homeownerOnlyUpdates: false,
    onwardPlan: "purchase_agreed",
    onwardAddress: onwardBAddress,
    onwardPostcode: "PO16 7HC",
  });
  record("AP3 purchase agreed from the purchase anchor completes", completeB.ok === true, JSON.stringify(completeB));
  const onwardB = (await row(ctx, flatA))?.linked_property_id ?? null;
  const onwardBRow = onwardB == null ? null : await row(ctx, onwardB);
  record(
    "AP3 purchase links to the seller's converted onward purchase",
    onwardBRow?.relationship_type === "purchase" && onwardBRow?.address === onwardBAddress,
    JSON.stringify(onwardBRow)
  );
  record(
    "AP3 seller's onward purchase: no assignment, no identity, EA B cannot operate it",
    onwardB != null &&
      (await activeAssignments(ctx, onwardB)).length === 0 &&
      (await identityOwner(ctx, onwardB)) == null &&
      (await canOperate(eaB, onwardB)) === false
  );
  record(
    "AP3 buyer's records unchanged (sale identity, no assignment on the buyer's sale)",
    (await identityOwner(ctx, houseA)) === personA.userId &&
      (await activeAssignments(ctx, houseA)).length === 0
  );

  // AP4 — Start Move pre-check through the app wrapper
  const fresh = await checkStartMoveAddress(personC.client, {
    address: `99 Fresh Road ${ctx.stamp}`,
    postcode: "PO16 7ZZ",
    side: "selling",
  });
  record("AP4 unknown address is available", fresh.ok && fresh.state === "available", JSON.stringify(fresh));

  const yours = await checkStartMoveAddress(personA.client, {
    address: `10 Buyer Home ${ctx.stamp}`,
    postcode: "PO16 7HA",
    side: "selling",
  });
  record(
    "AP4 own sale is yours with the caller's chain",
    yours.ok && yours.state === "yours" && yours.chainId === chainA.chainId,
    JSON.stringify(yours)
  );

  const awaitingSelling = await checkStartMoveAddress(personC.client, {
    address: flatAddress,
    postcode: "PO16 7HB",
    side: "selling",
  });
  record(
    "AP4 purchase awaiting its seller (EA connected, no seller homeowner) is awaiting_connection for selling",
    awaitingSelling.ok && awaitingSelling.state === "awaiting_connection",
    JSON.stringify(awaitingSelling)
  );

  const awaitingBuying = await checkStartMoveAddress(personC.client, {
    address: `1 Agreed House ${ctx.stamp}`,
    postcode: "PO16 7AA",
    side: "buying",
  });
  record(
    "AP4 EA-only sale with no buyer is awaiting_connection for buying",
    awaitingBuying.ok && awaitingBuying.state === "awaiting_connection",
    JSON.stringify(awaitingBuying)
  );

  const representedSelling = await checkStartMoveAddress(personC.client, {
    address: `1 Agreed House ${ctx.stamp}`,
    postcode: "PO16 7AA",
    side: "selling",
  });
  record(
    "AP4 EA-represented sale is already_represented for selling (no agent disclosed)",
    representedSelling.ok &&
      representedSelling.state === "already_represented" &&
      Object.keys(representedSelling).sort().join(",") === "ok,state",
    JSON.stringify(representedSelling)
  );

  const invalid = await checkStartMoveAddress(personC.client, {
    address: "   ",
    postcode: "",
    side: "buying",
  });
  record(
    "AP4 invalid address maps to a customer message",
    !invalid.ok && invalid.error === "invalid_address" && invalid.message.length > 0,
    JSON.stringify(invalid)
  );
}

async function cleanupFixtures(ctx: Ctx): Promise<void> {
  const warn = (label: string, error: { message: string } | null) => {
    if (error) console.warn(`cleanup ${label}: ${error.message}`);
  };

  for (const chainId of ctx.chainIds) {
    const { data: props } = await ctx.admin.from("properties").select("id").eq("chain_id", chainId);
    const ids = (props ?? []).map((p) => p.id as number);

    if (ids.length > 0) {
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
        "property_operational_summary",
      ]) {
        warn(table, (await ctx.admin.from(table).delete().in("property_id", ids)).error);
      }
      warn("unlink", (await ctx.admin.from("properties").update({ linked_property_id: null }).in("id", ids)).error);
      warn("properties", (await ctx.admin.from("properties").delete().in("id", ids)).error);
    }

    warn("chain_operational_summary", (await ctx.admin.from("chain_operational_summary").delete().eq("chain_id", chainId)).error);
    warn("chain_nodes", (await ctx.admin.from("chain_nodes").delete().eq("chain_id", chainId)).error);
    warn("chains", (await ctx.admin.from("chains").delete().eq("id", chainId)).error);
  }

  for (const branchId of ctx.branchIds) {
    warn("ea_branch_invitations", (await ctx.admin.from("ea_branch_invitations").delete().eq("branch_id", branchId)).error);
    warn("ea_branches", (await ctx.admin.from("ea_branches").delete().eq("id", branchId)).error);
  }
  for (const companyId of ctx.companyIds) {
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
    console.log("Live Development checks only. Re-run with --execute.");
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
    userIds: [],
    chainIds: [],
    branchIds: [],
    companyIds: [],
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
