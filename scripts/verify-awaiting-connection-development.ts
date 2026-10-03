/**
 * Seller-side authority and awaiting connection (M2) — live Development scenarios.
 *
 * Requires 20261005100000, 20261005110000 and 20261005120000 on Development.
 *
 *   AW1 EA-only sale: the assigned EA operates it (even with homeowner-only updates) and
 *       converts the onward purchase; the purchase stays awaiting its seller, with no EA
 *       identity, assignment or authority; EA A cannot take its seller side by access code
 *   AW2 the actual seller connects by access code (normalised address) and operates the
 *       purchase; a second seller is refused (slot held); the seller adds and converts
 *       their own onward purchase from the purchase row; EA A stays view-only
 *   AW3 the seller's EA connects to an awaiting purchase by access code (assignment only)
 *       and operates it while EA-only; a second EA is refused; EA B's onward purchase is unowned
 *   AW4 the seller joins the EA-managed purchase: EA B's onward purchase converges to the
 *       seller; EA B's subject is the seller; EA B's capability follows the seller's
 *       EA-update permission; EA A stays view-only
 *   AW5 homeowner + EA with updates disabled: homeowner operates, EA refused
 *   AW6 opposite-side rule: a buyer may join an EA-only sale; joins to rows whose opposite
 *       side is unrepresented are refused
 *   AW7 EA purchase origination refused (create and access-code join)
 *   AW8 grants: internal helpers not callable by clients; predicates not callable by anon
 *   AW9 connect requires branch membership
 *   AW10 homeowner + EA: EA A creates Person A's onward purchase (Flat 2); Person B, its
 *       seller, connects by access code; no identity, assignment or authority moves from
 *       House 1 / EA A to Flat 2; EA A cannot appoint itself, Person A cannot appoint, and
 *       Person B cannot appoint EA A (branch_acts_for_buyer); Person B appoints EA B through
 *       assign_property_ea_branch and EA B operates per Person B's permission
 *       (set_property_ea_update_permission); direct assignment writes are refused
 *
 * Usage (Development ONLY — bbbsxzxcjkmpqsfvmhbo):
 *   npx tsx scripts/verify-awaiting-connection-development.ts --execute
 */
import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import { join } from "path";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { completeEstateAgentOnboarding } from "../lib/estateAgent/completeOnboarding";
import { createEstateAgentProfile } from "../lib/estateAgent/createEstateAgentProfile";

const DEVELOPMENT_SUPABASE_PROJECT_REF = "bbbsxzxcjkmpqsfvmhbo";
const PASSWORD = "AwaitingConnectionDev123!";
const TEST_EMAIL_PREFIX = "awaiting";
const TEST_DOMAIN_SUFFIX = ".awaiting.test";
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

type Rpc = { ok?: boolean; error?: string; [key: string]: unknown } | null;

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
    companyName: `Awaiting Connection Co ${label} ${ctx.stamp}`,
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

async function rpc(actor: SupabaseClient, name: string, args: Record<string, unknown>): Promise<Rpc> {
  const { data, error } = await actor.rpc(name, args);
  return error ? { ok: false, error: error.message } : (data as Rpc);
}

async function eaChain(ctx: Ctx, ea: EaActor): Promise<{ chainId: number; accessCode: string }> {
  counter += 1;
  const suffix = `${ctx.stamp.slice(-6)}-${counter}`;
  const { data, error } = await ea.client.rpc("create_ea_operational_chain", {
    p_name: `AW EA ${suffix}`,
    p_access_code: `KN-AWE-${suffix}`.toUpperCase(),
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
    p_name: `AW HO ${suffix}`,
    p_access_code: `KN-AWH-${suffix}`.toUpperCase(),
  });
  if (error || data?.chain_id == null) {
    throw new Error(`create_chain_for_onboarding: ${error?.message ?? data?.error}`);
  }
  const chainId = data.chain_id as number;
  ctx.chainIds.push(chainId);
  const { data: chain } = await ctx.admin.from("chains").select("access_code").eq("id", chainId).single();
  return { chainId, accessCode: chain!.access_code as string };
}

async function eaSale(
  ea: EaActor,
  chainId: number,
  address: string,
  options: { homeownerOnlyUpdates: boolean; inviteEmail?: string }
): Promise<number> {
  const { data, error } = await ea.client.rpc("create_ea_operational_property", {
    p_chain_id: chainId,
    p_relationship_type: "sale",
    p_address: address,
    p_postcode: "PO16 7AA",
    p_branch_id: ea.branchId,
    p_homeowner_only_updates: options.homeownerOnlyUpdates,
    p_invite_email: options.inviteEmail ?? null,
    p_awaiting_buyer: false,
  });
  if (error || !data?.ok) throw new Error(`create_ea_operational_property: ${error?.message ?? data?.error}`);
  return data.property_id as number;
}

async function homeownerRow(
  ho: Actor,
  chainId: number,
  options: { relationship: "sale" | "purchase"; address: string; position: number }
): Promise<number> {
  const { data, error } = await ho.client
    .from("properties")
    .insert({
      chain_id: chainId,
      chain_position: options.position,
      address: options.address,
      postcode: "PO16 7HO",
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
  return data.id as number;
}

async function canOperate(actor: Actor, propertyId: number): Promise<boolean | null> {
  const { data, error } = await actor.client.rpc("can_operate_property", { p_property_id: propertyId });
  return error ? null : (data as boolean);
}

async function sellerSideHomeowner(actor: Actor, propertyId: number): Promise<boolean | null> {
  const { data, error } = await actor.client.rpc("is_property_seller_side_homeowner", { p_property_id: propertyId });
  return error ? null : (data as boolean);
}

async function adminState(ctx: Ctx, propertyId: number): Promise<string | null> {
  const { data } = await ctx.admin.rpc("_property_reservation_state", { p_property_id: propertyId });
  return (data as string | null) ?? null;
}

async function identity(ctx: Ctx, propertyId: number) {
  const { data } = await ctx.admin
    .from("property_operational_identities")
    .select("homeowner_user_id, status, granted_via")
    .eq("property_id", propertyId)
    .maybeSingle();
  return data as { homeowner_user_id: string; status: string; granted_via: string } | null;
}

async function assignments(ctx: Ctx, propertyId: number) {
  const { data } = await ctx.admin
    .from("property_ea_assignments")
    .select("id, branch_id, status, homeowner_only_updates")
    .eq("property_id", propertyId);
  return (data ?? []) as { id: string; branch_id: string; status: string; homeowner_only_updates: boolean }[];
}

async function count(ctx: Ctx, table: string, filters: Record<string, unknown>): Promise<number> {
  let query = ctx.admin.from(table).select("*", { count: "exact", head: true });
  for (const [key, value] of Object.entries(filters)) query = query.eq(key, value as never);
  const { count: total } = await query;
  return total ?? -1;
}

async function viewRow(ea: EaActor, propertyId: number) {
  const { data } = await ea.client
    .from("ea_operational_assignments")
    .select("property_id, subject_user_id, homeowner_only_updates")
    .eq("property_id", propertyId)
    .maybeSingle();
  return data as { property_id: number; subject_user_id: string | null; homeowner_only_updates: boolean } | null;
}

async function createPlaceholder(actor: Actor, anchorId: number): Promise<Rpc> {
  return rpc(actor.client, "create_searching_placeholder_for_sale", { p_sale_property_id: anchorId });
}

async function convert(actor: Actor, anchorId: number, address: string, postcode = "PO16 7AB"): Promise<Rpc> {
  return rpc(actor.client, "convert_searching_placeholder_for_sale", {
    p_sale_property_id: anchorId,
    p_address: address,
    p_postcode: postcode,
  });
}

async function joinChain(actor: Actor, accessCode: string, address: string, postcode: string): Promise<Rpc> {
  return rpc(actor.client, "join_chain_property", {
    p_access_code: accessCode,
    p_address: address,
    p_postcode: postcode,
  });
}

async function connect(actor: Actor, accessCode: string, address: string, postcode: string, branchId: string): Promise<Rpc> {
  return rpc(actor.client, "connect_ea_to_awaiting_property", {
    p_access_code: accessCode,
    p_address: address,
    p_postcode: postcode,
    p_branch_id: branchId,
  });
}

function variant(address: string): string {
  return `  ${address.toUpperCase().replace(/ /g, "   ")} `;
}

async function runScenarios(ctx: Ctx): Promise<void> {
  const personA = await setupHomeowner(ctx, "a");
  const personB = await setupHomeowner(ctx, "b");
  const sellerS = await setupHomeowner(ctx, "s");
  const sellerS2 = await setupHomeowner(ctx, "s2");
  const sellerS3 = await setupHomeowner(ctx, "s3");
  const eaA = await setupEstateAgent(ctx, "ea-a");
  const eaB = await setupEstateAgent(ctx, "ea-b");
  const eaC = await setupEstateAgent(ctx, "ea-c");
  const s = ctx.stamp.slice(-6);

  // AW1 — EA-only sale, awaiting onward purchase
  const chain1 = await eaChain(ctx, eaA);
  const house = await eaSale(eaA, chain1.chainId, `1 The House ${ctx.stamp}`, { homeownerOnlyUpdates: true });
  record("AW1 EA-only sale (homeowner-only updates): assigned EA can operate", (await canOperate(eaA, house)) === true);
  record("AW1 unrelated EA cannot operate the sale", (await canOperate(eaB, house)) === false);
  record("AW1 homeowner with no role cannot operate the sale", (await canOperate(personA, house)) === false);
  record("AW1 EA is not the seller-side homeowner", (await sellerSideHomeowner(eaA, house)) === false);

  const housePlaceholder = await createPlaceholder(eaA, house);
  record(
    "AW1 EA adds the onward placeholder (unowned)",
    housePlaceholder?.ok === true && housePlaceholder?.owned === false,
    JSON.stringify(housePlaceholder)
  );
  const flatAddress = `2 The Flat ${ctx.stamp}`;
  const flatConvert = await convert(eaA, house, flatAddress);
  const flat = flatConvert?.property_id as number;
  record("AW1 EA converts the onward purchase", flatConvert?.ok === true && typeof flat === "number", JSON.stringify(flatConvert));
  record(
    "AW1 onward purchase: no identity, no assignment, no claim metadata",
    (await identity(ctx, flat)) == null &&
      (await assignments(ctx, flat)).length === 0 &&
      (await count(ctx, "property_claim_metadata", { property_id: flat })) === 0
  );
  record(
    "AW1 EA holds no membership on the onward purchase",
    (await count(ctx, "property_members", { property_id: flat, user_id: eaA.userId })) === 0
  );
  record("AW1 onward purchase is awaiting its seller", (await adminState(ctx, flat)) === "awaiting_seller");
  record("AW1 EA A cannot operate the onward purchase", (await canOperate(eaA, flat)) === false);
  const eaAFlatCreate = await createPlaceholder(eaA, flat);
  record(
    "AW1 EA A cannot add an onward purchase from 2 The Flat",
    eaAFlatCreate?.ok === false && eaAFlatCreate?.error === "not_authorized",
    JSON.stringify(eaAFlatCreate)
  );
  const eaAFlatConvert = await convert(eaA, flat, `X ${s} Never`);
  record(
    "AW1 EA A cannot convert from 2 The Flat",
    eaAFlatConvert?.ok === false && eaAFlatConvert?.error === "not_authorized",
    JSON.stringify(eaAFlatConvert)
  );
  record("AW1 EA A's assignment list: the sale only", (await viewRow(eaA, house)) != null && (await viewRow(eaA, flat)) == null);
  const eaASelfConnect = await connect(eaA, chain1.accessCode, flatAddress, "PO16 7AB", eaA.branchId);
  record(
    "AW1 EA A cannot take 2 The Flat's seller side by access code (acts for the buyer)",
    eaASelfConnect?.ok === false && eaASelfConnect?.error === GENERIC && (await assignments(ctx, flat)).length === 0,
    JSON.stringify(eaASelfConnect)
  );

  // AW2 — the actual seller connects
  const sJoin = await joinChain(sellerS, chain1.accessCode, variant(flatAddress), "po167ab");
  record(
    "AW2 seller joins 2 The Flat by access code with a normalised address",
    sJoin?.ok === true && sJoin?.joining_role === "seller" && sJoin?.property_id === flat,
    JSON.stringify(sJoin)
  );
  record("AW2 seller is the seller-side homeowner", (await sellerSideHomeowner(sellerS, flat)) === true);
  record("AW2 seller can operate 2 The Flat", (await canOperate(sellerS, flat)) === true);
  record("AW2 EA A still cannot operate 2 The Flat", (await canOperate(eaA, flat)) === false);
  record("AW2 2 The Flat is live with a homeowner seller", (await adminState(ctx, flat)) === "live_homeowner");
  record("AW2 the seller does not gain authority over the buyer's sale", (await canOperate(sellerS, house)) === false);

  const s2Join = await joinChain(sellerS2, chain1.accessCode, flatAddress, "PO16 7AB");
  record(
    "AW2 second seller refused (slot held, generic error)",
    s2Join?.ok === false &&
      s2Join?.error === GENERIC &&
      (await count(ctx, "property_counterparty_participants", { property_id: flat, status: "active", counterparty_role: "seller" })) === 1,
    JSON.stringify(s2Join)
  );

  const sPlaceholder = await createPlaceholder(sellerS, flat);
  const sPlaceholderId = sPlaceholder?.property_id as number;
  const sPlaceholderIdentity = sPlaceholderId ? await identity(ctx, sPlaceholderId) : null;
  record(
    "AW2 seller adds their onward placeholder from the purchase row (owned, start_move)",
    sPlaceholder?.ok === true &&
      sPlaceholderIdentity?.homeowner_user_id === sellerS.userId &&
      sPlaceholderIdentity?.granted_via === "start_move",
    JSON.stringify(sPlaceholder)
  );
  const sConvert = await convert(sellerS, flat, `3 The Cottage ${ctx.stamp}`, "PO16 7AC");
  const cottageIdentity = sConvert?.ok ? await identity(ctx, sConvert.property_id as number) : null;
  record(
    "AW2 seller converts → onward purchase owned by the seller",
    sConvert?.ok === true && cottageIdentity?.homeowner_user_id === sellerS.userId,
    JSON.stringify(sConvert)
  );

  // AW3 — the seller's EA connects before the seller
  const chain2 = await eaChain(ctx, eaA);
  const house2 = await eaSale(eaA, chain2.chainId, `1 The Mews ${ctx.stamp}`, { homeownerOnlyUpdates: false });
  await createPlaceholder(eaA, house2);
  const flat2Address = `2 The Lodge ${ctx.stamp}`;
  const flat2Convert = await convert(eaA, house2, flat2Address);
  const flat2 = flat2Convert?.property_id as number;
  record("AW3 fixture: EA A's onward purchase awaiting its seller", (await adminState(ctx, flat2)) === "awaiting_seller");

  const wrongCode = await connect(eaB, "KN-ZZZ-ZZZZ", flat2Address, "PO16 7AB", eaB.branchId);
  record("AW3 wrong access code refused (generic)", wrongCode?.ok === false && wrongCode?.error === GENERIC, JSON.stringify(wrongCode));
  const saleConnect = await connect(eaB, chain2.accessCode, `1 The Mews ${ctx.stamp}`, "PO16 7AA", eaB.branchId);
  record(
    "AW3 a sale row cannot be connected (generic)",
    saleConnect?.ok === false && saleConnect?.error === GENERIC,
    JSON.stringify(saleConnect)
  );
  const eaBConnect = await connect(eaB, chain2.accessCode, variant(flat2Address), "po16 7ab", eaB.branchId);
  const flat2Assignments = await assignments(ctx, flat2);
  record(
    "AW3 EA B connects to the awaiting purchase",
    eaBConnect?.ok === true && eaBConnect?.property_id === flat2,
    JSON.stringify(eaBConnect)
  );
  record(
    "AW3 one active assignment to EA B's branch, homeowner-only updates by default",
    flat2Assignments.length === 1 &&
      flat2Assignments[0].branch_id === eaB.branchId &&
      flat2Assignments[0].status === "active" &&
      flat2Assignments[0].homeowner_only_updates === true,
    JSON.stringify(flat2Assignments)
  );
  record(
    "AW3 connect wrote no identity, claim metadata or counterparty",
    (await identity(ctx, flat2)) == null &&
      (await count(ctx, "property_claim_metadata", { property_id: flat2 })) === 0 &&
      (await count(ctx, "property_counterparty_participants", { property_id: flat2 })) === 0
  );
  record("AW3 purchase now live and EA-managed", (await adminState(ctx, flat2)) === "live_ea_managed");
  const eaCConnect = await connect(eaC, chain2.accessCode, flat2Address, "PO16 7AB", eaC.branchId);
  record(
    "AW3 second EA refused (generic)",
    eaCConnect?.ok === false && eaCConnect?.error === GENERIC && (await assignments(ctx, flat2)).length === 1,
    JSON.stringify(eaCConnect)
  );
  record("AW3 EA B operates the EA-only purchase", (await canOperate(eaB, flat2)) === true);
  record("AW3 EA A cannot operate EA B's purchase", (await canOperate(eaA, flat2)) === false);
  const eaBView = await viewRow(eaB, flat2);
  record(
    "AW3 EA B's assignment list shows the purchase with no subject yet",
    eaBView != null && eaBView.subject_user_id == null,
    JSON.stringify(eaBView)
  );

  const eaBPlaceholder = await createPlaceholder(eaB, flat2);
  record(
    "AW3 EA B adds the onward placeholder (unowned)",
    eaBPlaceholder?.ok === true && eaBPlaceholder?.owned === false,
    JSON.stringify(eaBPlaceholder)
  );
  const eaBConvert = await convert(eaB, flat2, `3 The Barn ${ctx.stamp}`, "PO16 7AD");
  const barn = eaBConvert?.property_id as number;
  record(
    "AW3 EA B converts → unowned onward purchase, no EA identity or assignment",
    eaBConvert?.ok === true && (await identity(ctx, barn)) == null && (await assignments(ctx, barn)).length === 0,
    JSON.stringify(eaBConvert)
  );

  // AW4 — the seller joins the EA-managed purchase
  const s3Join = await joinChain(sellerS3, chain2.accessCode, flat2Address, "PO16 7AB");
  record(
    "AW4 seller joins the EA-managed purchase",
    s3Join?.ok === true && s3Join?.joining_role === "seller",
    JSON.stringify(s3Join)
  );
  const barnIdentity = await identity(ctx, barn);
  record(
    "AW4 EA B's onward purchase converges to the seller (ea_origination_claim)",
    barnIdentity?.homeowner_user_id === sellerS3.userId &&
      barnIdentity?.status === "active" &&
      barnIdentity?.granted_via === "ea_origination_claim",
    JSON.stringify(barnIdentity)
  );
  const eaBViewAfter = await viewRow(eaB, flat2);
  record(
    "AW4 EA B's subject is the seller, not the purchase's buyer side",
    eaBViewAfter?.subject_user_id === sellerS3.userId,
    JSON.stringify(eaBViewAfter)
  );
  record("AW4 seller operates the purchase", (await canOperate(sellerS3, flat2)) === true);
  record(
    "AW4 EA B with homeowner-only updates cannot operate once the seller is connected",
    (await canOperate(eaB, flat2)) === false
  );
  const allow4 = await rpc(sellerS3.client, "set_property_ea_update_permission", {
    p_property_id: flat2,
    p_homeowner_only_updates: false,
  });
  record(
    "AW4 EA B operates once the seller allows EA updates",
    allow4?.ok === true && (await canOperate(eaB, flat2)) === true,
    JSON.stringify(allow4)
  );
  record("AW4 EA A remains view-only on the purchase", (await canOperate(eaA, flat2)) === false);
  record("AW4 EA A still operates its own sale", (await canOperate(eaA, house2)) === true);

  // AW5 — homeowner + EA with updates disabled
  const chain3 = await eaChain(ctx, eaA);
  const house3 = await eaSale(eaA, chain3.chainId, `1 The Grange ${ctx.stamp}`, {
    homeownerOnlyUpdates: true,
    inviteEmail: personA.email,
  });
  const claim = await rpc(personA.client, "claim_operational_property", {
    p_property_id: house3,
    p_invitation_token: null,
  });
  record("AW5 homeowner claims the EA sale", claim?.ok === true, JSON.stringify(claim));
  record("AW5 homeowner operates the claimed sale", (await canOperate(personA, house3)) === true);
  record("AW5 EA with updates disabled cannot operate", (await canOperate(eaA, house3)) === false);
  const eaAClaimedCreate = await createPlaceholder(eaA, house3);
  record(
    "AW5 EA with updates disabled cannot add an onward purchase",
    eaAClaimedCreate?.ok === false && eaAClaimedCreate?.error === "not_authorized",
    JSON.stringify(eaAClaimedCreate)
  );
  const hoCreate = await createPlaceholder(personA, house3);
  record(
    "AW5 homeowner adds the onward placeholder (owned by the homeowner)",
    hoCreate?.ok === true && hoCreate?.owned === true,
    JSON.stringify(hoCreate)
  );
  record("AW5 EA remains assigned", (await assignments(ctx, house3)).some((a) => a.status === "active" && a.branch_id === eaA.branchId));

  // AW6 — opposite-side rule
  const buyerJoin = await joinChain(personB, chain1.accessCode, `1 The House ${ctx.stamp}`, "PO16 7AA");
  record(
    "AW6 a buyer may join an EA-only sale (seller side is the EA)",
    buyerJoin?.ok === true && buyerJoin?.joining_role === "buyer",
    JSON.stringify(buyerJoin)
  );
  record("AW6 the joined buyer cannot operate the sale", (await canOperate(personB, house)) === false);

  const chain4 = await homeownerChain(ctx, personA);
  const staleSale = await homeownerRow(personA, chain4.chainId, {
    relationship: "sale",
    address: `4 Unrepresented Sale ${ctx.stamp}`,
    position: 1,
  });
  const staleJoin = await joinChain(personB, chain4.accessCode, `4 Unrepresented Sale ${ctx.stamp}`, "PO16 7HO");
  record(
    "AW6 join refused when the sale has no seller side",
    staleJoin?.ok === false &&
      staleJoin?.error === GENERIC &&
      (await count(ctx, "property_counterparty_participants", { property_id: staleSale })) === 0,
    JSON.stringify(staleJoin)
  );
  const lonePurchase = await homeownerRow(personA, chain4.chainId, {
    relationship: "purchase",
    address: `5 Unrepresented Purchase ${ctx.stamp}`,
    position: 2,
  });
  const loneJoin = await joinChain(personB, chain4.accessCode, `5 Unrepresented Purchase ${ctx.stamp}`, "PO16 7HO");
  record(
    "AW6 join refused when the purchase has no buyer side",
    loneJoin?.ok === false &&
      loneJoin?.error === GENERIC &&
      (await count(ctx, "property_counterparty_participants", { property_id: lonePurchase })) === 0,
    JSON.stringify(loneJoin)
  );

  // AW7 — EA purchase origination refused
  const eaPurchase = await rpc(eaA.client, "create_ea_operational_property", {
    p_chain_id: chain1.chainId,
    p_relationship_type: "purchase",
    p_address: `6 Agent Purchase ${ctx.stamp}`,
    p_postcode: "PO16 7AE",
    p_branch_id: eaA.branchId,
    p_homeowner_only_updates: false,
    p_invite_email: null,
    p_awaiting_buyer: false,
  });
  record(
    "AW7 create_ea_operational_property refuses purchase",
    eaPurchase?.ok === false && eaPurchase?.error === "invalid_relationship_type",
    JSON.stringify(eaPurchase)
  );
  const eaJoinPurchase = await rpc(eaC.client, "join_ea_operational_chain", {
    p_access_code: chain2.accessCode,
    p_relationship_type: "purchase",
    p_address: `7 Agent Purchase ${ctx.stamp}`,
    p_postcode: "PO16 7AF",
    p_branch_id: eaC.branchId,
    p_homeowner_only_updates: false,
    p_invite_email: null,
    p_invite_display_name: null,
    p_awaiting_buyer: false,
  });
  record(
    "AW7 join_ea_operational_chain refuses purchase",
    eaJoinPurchase?.ok === false && eaJoinPurchase?.error === "invalid_relationship_type",
    JSON.stringify(eaJoinPurchase)
  );

  // AW8 — grants
  const anon = anonClient(ctx);
  for (const [name, args] of [
    ["can_operate_property", { p_property_id: house }],
    ["is_property_seller_side_homeowner", { p_property_id: house }],
    [
      "connect_ea_to_awaiting_property",
      { p_access_code: chain2.accessCode, p_address: flat2Address, p_postcode: "PO16 7AB", p_branch_id: eaB.branchId },
    ],
  ] as const) {
    const { data, error } = await anon.rpc(name, args);
    record(`AW8 anon refused: ${name}`, !!error && data == null, error?.message ?? JSON.stringify(data));
  }
  for (const [name, args] of [
    ["_property_seller_side_user_id", { p_property_id: flat }],
    ["_converge_onward_purchase_after_seller_join", { p_purchase_property_id: flat, p_seller_user_id: personB.userId }],
    ["_grant_counterparty_participation_core", { p_property_id: flat, p_user_id: personB.userId }],
  ] as const) {
    const { data, error } = await personB.client.rpc(name, args);
    record(`AW8 authenticated refused: ${name}`, !!error && data == null, error?.message ?? JSON.stringify(data));
  }

  // AW9 — connect requires branch membership
  const nonMember = await connect(personA, chain2.accessCode, flat2Address, "PO16 7AB", eaB.branchId);
  record(
    "AW9 non-member refused (not_ea_branch_member)",
    nonMember?.ok === false && nonMember?.error === "not_ea_branch_member",
    JSON.stringify(nonMember)
  );

  // AW10 — homeowner + EA (updates allowed): EA A records Person A's onward purchase;
  // Person B, its actual seller, connects; nothing transfers from House 1 / EA A to Flat 2
  const chain10 = await eaChain(ctx, eaA);
  const house10 = await eaSale(eaA, chain10.chainId, `1 House One ${ctx.stamp}`, {
    homeownerOnlyUpdates: false,
    inviteEmail: personA.email,
  });
  const claim10 = await rpc(personA.client, "claim_operational_property", {
    p_property_id: house10,
    p_invitation_token: null,
  });
  record("AW10 Person A claims House 1 (EA A assigned, EA updates allowed)", claim10?.ok === true, JSON.stringify(claim10));
  record("AW10 Person A operates House 1", (await canOperate(personA, house10)) === true);
  record("AW10 EA A operates House 1 under Person A's permission", (await canOperate(eaA, house10)) === true);

  const house10Placeholder = await createPlaceholder(eaA, house10);
  record(
    "AW10 EA A adds Person A's onward placeholder (owned by Person A)",
    house10Placeholder?.ok === true && house10Placeholder?.owned === true,
    JSON.stringify(house10Placeholder)
  );
  const flat10Address = `2 Flat Two ${ctx.stamp}`;
  const flat10Convert = await convert(eaA, house10, flat10Address);
  const flat10 = flat10Convert?.property_id as number;
  record("AW10 EA A converts Flat 2", flat10Convert?.ok === true && typeof flat10 === "number", JSON.stringify(flat10Convert));

  const { data: flat10Row } = await ctx.admin
    .from("properties")
    .select("created_by_user_id, relationship_type, linked_property_id")
    .eq("id", flat10)
    .single();
  const flat10IdentityBefore = await identity(ctx, flat10);
  record("AW10 Flat 2 is a purchase created by EA A", flat10Row?.created_by_user_id === eaA.userId && flat10Row?.relationship_type === "purchase");
  record(
    "AW10 Flat 2's identity is Person A as buyer; no EA identity",
    flat10IdentityBefore?.homeowner_user_id === personA.userId && flat10IdentityBefore?.status === "active",
    JSON.stringify(flat10IdentityBefore)
  );
  record(
    "AW10 Flat 2: no EA assignment and no EA A membership",
    (await assignments(ctx, flat10)).length === 0 &&
      (await count(ctx, "property_members", { property_id: flat10, user_id: eaA.userId })) === 0
  );
  record("AW10 Flat 2 is awaiting its seller", (await adminState(ctx, flat10)) === "awaiting_seller");
  record("AW10 EA A cannot operate Flat 2 (creator only)", (await canOperate(eaA, flat10)) === false);
  record("AW10 Person A (buyer) cannot operate Flat 2", (await canOperate(personA, flat10)) === false);
  record("AW10 EA A's assignment list: House 1 only", (await viewRow(eaA, house10)) != null && (await viewRow(eaA, flat10)) == null);
  record("AW10 EA A's subject on House 1 is Person A", (await viewRow(eaA, house10))?.subject_user_id === personA.userId);

  const bJoin10 = await joinChain(personB, chain10.accessCode, flat10Address, "PO16 7AB");
  record(
    "AW10 Person B connects to Flat 2 as its seller with the access code",
    bJoin10?.ok === true && bJoin10?.joining_role === "seller" && bJoin10?.property_id === flat10,
    JSON.stringify(bJoin10)
  );
  record("AW10 Person B is Flat 2's seller-side homeowner", (await sellerSideHomeowner(personB, flat10)) === true);
  record("AW10 Person B operates Flat 2", (await canOperate(personB, flat10)) === true);
  record("AW10 Flat 2 is live with a homeowner seller", (await adminState(ctx, flat10)) === "live_homeowner");
  record("AW10 EA A still cannot operate Flat 2", (await canOperate(eaA, flat10)) === false);
  record("AW10 Person A still cannot operate Flat 2", (await canOperate(personA, flat10)) === false);
  const flat10IdentityAfter = await identity(ctx, flat10);
  record(
    "AW10 Flat 2's identity unchanged (Person A, buyer); Person B is not given it",
    flat10IdentityAfter?.homeowner_user_id === personA.userId,
    JSON.stringify(flat10IdentityAfter)
  );
  record("AW10 Flat 2 still has no EA assignment", (await assignments(ctx, flat10)).length === 0);
  const house10Assignments = await assignments(ctx, house10);
  record(
    "AW10 House 1 keeps exactly its own EA A assignment",
    house10Assignments.length === 1 &&
      house10Assignments[0].branch_id === eaA.branchId &&
      house10Assignments[0].status === "active" &&
      house10Assignments[0].homeowner_only_updates === false,
    JSON.stringify(house10Assignments)
  );
  record("AW10 House 1 identity still Person A", (await identity(ctx, house10))?.homeowner_user_id === personA.userId);
  record("AW10 Person B cannot operate House 1", (await canOperate(personB, house10)) === false);
  record("AW10 EA A still operates House 1", (await canOperate(eaA, house10)) === true);
  const eaAFlat10Create = await createPlaceholder(eaA, flat10);
  record(
    "AW10 EA A cannot add an onward purchase from Flat 2",
    eaAFlat10Create?.ok === false && eaAFlat10Create?.error === "not_authorized",
    JSON.stringify(eaAFlat10Create)
  );
  const eaAFlat10Connect = await connect(eaA, chain10.accessCode, flat10Address, "PO16 7AB", eaA.branchId);
  record(
    "AW10 EA A cannot attach itself to Flat 2 by access code",
    eaAFlat10Connect?.ok === false && eaAFlat10Connect?.error === GENERIC && (await assignments(ctx, flat10)).length === 0,
    JSON.stringify(eaAFlat10Connect)
  );

  const eaASelfAssign = await rpc(eaA.client, "assign_property_ea_branch", {
    p_property_id: flat10,
    p_branch_id: eaA.branchId,
    p_homeowner_only_updates: false,
  });
  record(
    "AW10 EA A cannot appoint itself to Flat 2",
    eaASelfAssign?.ok === false && eaASelfAssign?.error === "not_authorized",
    JSON.stringify(eaASelfAssign)
  );
  const personAAssign = await rpc(personA.client, "assign_property_ea_branch", {
    p_property_id: flat10,
    p_branch_id: eaA.branchId,
    p_homeowner_only_updates: false,
  });
  record(
    "AW10 Person A (buyer) cannot appoint an EA to Flat 2",
    personAAssign?.ok === false && personAAssign?.error === "not_authorized",
    JSON.stringify(personAAssign)
  );
  const personBPicksEaA = await rpc(personB.client, "assign_property_ea_branch", {
    p_property_id: flat10,
    p_branch_id: eaA.branchId,
    p_homeowner_only_updates: false,
  });
  record(
    "AW10 Person B cannot appoint EA A, which acts for the buyer (branch_acts_for_buyer)",
    personBPicksEaA?.ok === false &&
      personBPicksEaA?.error === "branch_acts_for_buyer" &&
      (await assignments(ctx, flat10)).length === 0,
    JSON.stringify(personBPicksEaA)
  );
  const { error: directAssignError } = await personB.client.from("property_ea_assignments").insert({
    property_id: flat10,
    branch_id: eaB.branchId,
    status: "active",
    assigned_by_user_id: personB.userId,
    homeowner_only_updates: false,
  });
  record(
    "AW10 direct assignment insert is refused (RPC only)",
    !!directAssignError && (await assignments(ctx, flat10)).length === 0,
    directAssignError?.message ?? "insert succeeded"
  );

  const assignB = await rpc(personB.client, "assign_property_ea_branch", {
    p_property_id: flat10,
    p_branch_id: eaB.branchId,
    p_homeowner_only_updates: true,
  });
  const flat10Assignments = await assignments(ctx, flat10);
  record(
    "AW10 Person B appoints EA B on Flat 2 (EA updates disabled)",
    assignB?.ok === true &&
      flat10Assignments.length === 1 &&
      flat10Assignments[0].branch_id === eaB.branchId &&
      flat10Assignments[0].homeowner_only_updates === true,
    JSON.stringify({ assignB, flat10Assignments })
  );
  record("AW10 EA B cannot operate Flat 2 while EA updates are disabled", (await canOperate(eaB, flat10)) === false);
  record("AW10 EA B's subject on Flat 2 is Person B", (await viewRow(eaB, flat10))?.subject_user_id === personB.userId);

  const allowB = await rpc(personB.client, "set_property_ea_update_permission", {
    p_property_id: flat10,
    p_homeowner_only_updates: false,
  });
  record(
    "AW10 EA B operates Flat 2 once Person B enables EA updates",
    allowB?.ok === true && (await canOperate(eaB, flat10)) === true,
    JSON.stringify(allowB)
  );
  record("AW10 EA A remains view-only on Flat 2", (await canOperate(eaA, flat10)) === false);
  const eaBTogglesItself = await rpc(eaB.client, "set_property_ea_update_permission", {
    p_property_id: flat10,
    p_homeowner_only_updates: false,
  });
  record(
    "AW10 EA B cannot change Person B's EA-update permission",
    eaBTogglesItself?.ok === false && eaBTogglesItself?.error === "not_authorized",
    JSON.stringify(eaBTogglesItself)
  );
  const { error: directRestrictError } = await personB.client
    .from("property_ea_assignments")
    .update({ homeowner_only_updates: true })
    .eq("property_id", flat10)
    .eq("status", "active");
  record(
    "AW10 direct permission update is refused (RPC only)",
    !!directRestrictError && (await canOperate(eaB, flat10)) === true,
    directRestrictError?.message ?? "update succeeded"
  );
  const restrictB = await rpc(personB.client, "set_property_ea_update_permission", {
    p_property_id: flat10,
    p_homeowner_only_updates: true,
  });
  record(
    "AW10 EA B cannot operate once Person B disables EA updates",
    restrictB?.ok === true && (await canOperate(eaB, flat10)) === false,
    JSON.stringify(restrictB)
  );
  record("AW10 Person B still operates Flat 2", (await canOperate(personB, flat10)) === true);
  record(
    "AW10 House 1 keeps its own EA A assignment throughout",
    (await assignments(ctx, house10)).filter((a) => a.status === "active").map((a) => a.branch_id).join() === eaA.branchId
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
      ]) {
        warn(table, (await ctx.admin.from(table).delete().in("property_id", ids)).error);
      }
      warn("unlink", (await ctx.admin.from("properties").update({ linked_property_id: null }).in("id", ids)).error);
      warn("properties", (await ctx.admin.from("properties").delete().in("id", ids)).error);
    }

    warn("chain_nodes", (await ctx.admin.from("chain_nodes").delete().eq("chain_id", chainId)).error);
    warn("chains", (await ctx.admin.from("chains").delete().eq("id", chainId)).error);
  }

  // Branch delete cascades members; deleting the last owner first trips the owner invariant.
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
    console.log("Live Development scenarios only. Re-run with --execute after applying 20261005120000.");
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
