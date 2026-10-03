/**
 * Address reservation classifier (M1) — live Development scenarios.
 *
 * Requires 20261005100000_address_reservation_classifier.sql on Development.
 *
 *   R1  unknown address → available (both sides)
 *   R2  own sale → yours, with the caller's chain id
 *   R3  homeowner sale without a buyer: buying → awaiting_connection, selling → already_represented
 *   R4  buyer-held purchase without a seller (awaiting seller): selling → awaiting_connection,
 *       buying → already_represented
 *   R5  case, whitespace and postcode spacing variants match
 *   R6  redaction placeholders: no key, redacted rows not reserved
 *   R7  unrepresented row (neither side represented) → awaiting_seller, reserved,
 *       already_represented ('stale' is no longer produced, 20261005140000)
 *   R8  released row (homeowner_self de-link, mistake reason, no dependants) → historical,
 *       available; R8b a non-mistake exit keeps a reserved awaiting_seller placeholder
 *   R9  EA-originated unclaimed sale: selling → already_represented, buying → awaiting_connection,
 *       branch member → yours
 *   R10 responses for other people's addresses disclose only ok/state
 *   R11 grants: anon refused; classifier internals and property_address_is_reserved refused to
 *       authenticated
 *   R12 invalid side / address
 *   R13 validate_onboarding_property_address uses the normalised match
 *   R14 cleanup hardening (require_empty, EA-originated chain, empty chain)
 *   R15 rate limit
 *   R16 every unrepresented self-delinked row still reserved has a running lifecycle clock
 *   R17 a plain property_members row is never 'yours' (no chain id)
 *
 * Reservation enforcement (requires 20261005120000, M3):
 *   R18 direct inserts of a reserved address are refused (23505 property_address_reserved),
 *       including normalised variants, awaiting-seller and EA-managed addresses, and the
 *       service role
 *   R19 changing a row's address to a reserved one is refused; non-address and
 *       key-preserving edits pass
 *   R20 an unrepresented placeholder's address cannot be reused; a released one can
 *   R21 searching placeholders without an address are unaffected
 *   R22 EA create of an address reserved in another chain → property_already_exists
 *   R23 converting a placeholder to a reserved address → duplicate_address
 *   R24 concurrent Start Move: unrepresented rows are reserved from insert, so exactly one
 *       insert lands and the other is property_address_reserved
 *   R25 an identity grant on a released row → property_released
 *   R26 the buyer leaving their purchase releases it and unlinks their sale; joining it is refused
 *   R27 estate_agent_remove_branch (added_by_mistake) on an ownerless sale with no dependants
 *       releases it; the invitee cannot claim and it leaves their claim list (R27b: archived rows too)
 *   R28 a claimable placeholder whose EA left stays reserved (another row is refused);
 *       the invitee can still claim it
 *   R29 an unrepresented onward purchase stays reserved; claiming the sale keeps it linked
 *   R30 an unrepresented purchase stays reserved; its own chain's sale can link to it
 *   (The claim address_reserved / onward-unlink / link-refusal conflict paths are now
 *   reachable only for legacy duplicate address keys and are covered statically.)
 *   R31 estate_agent_remove_branch on an ownerless sale a buyer joined keeps a placeholder: not
 *       released, buyer and claim invitation kept, assignment revoked, nobody new can operate,
 *       the invitee can still claim
 *
 * Usage (Development ONLY — bbbsxzxcjkmpqsfvmhbo):
 *   npx tsx scripts/verify-address-reservation-development.ts --execute
 */
import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import { join } from "path";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { completeEstateAgentOnboarding } from "../lib/estateAgent/completeOnboarding";
import { createEstateAgentProfile } from "../lib/estateAgent/createEstateAgentProfile";

const DEVELOPMENT_SUPABASE_PROJECT_REF = "bbbsxzxcjkmpqsfvmhbo";
const PASSWORD = "AddressReservationDev123!";
const TEST_EMAIL_PREFIX = "addr-res";
const TEST_DOMAIN_SUFFIX = ".addr-res.test";

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

type Rpc = { ok?: boolean; error?: string; state?: string; chain_id?: number; [key: string]: unknown } | null;

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
    companyName: `Address Reservation Co ${label} ${ctx.stamp}`,
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

async function homeownerChain(ctx: Ctx, ho: Actor): Promise<number> {
  counter += 1;
  const suffix = `${ctx.stamp.slice(-6)}-${counter}`;
  const { data, error } = await ho.client.rpc("create_chain_for_onboarding", {
    p_name: `AR HO ${suffix}`,
    p_access_code: `KN-ARH-${suffix}`.toUpperCase(),
  });
  if (error || data?.chain_id == null) {
    throw new Error(`create_chain_for_onboarding: ${error?.message ?? data?.error}`);
  }
  ctx.chainIds.push(data.chain_id as number);
  return data.chain_id as number;
}

async function homeownerProperty(
  ho: Actor,
  chainId: number,
  options: {
    relationship: "sale" | "purchase";
    address: string;
    postcode: string;
    position: number;
    grantIdentity: boolean;
  }
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

  if (options.grantIdentity) {
    const { data: grant, error: grantError } = await ho.client.rpc(
      "establish_operational_homeowner_for_created_property",
      { p_property_id: data.id }
    );
    if (grantError || !grant?.ok) {
      throw new Error(`for_created_property: ${grantError?.message ?? grant?.error}`);
    }
  }
  return data.id as number;
}

async function check(actor: SupabaseClient, address: string, postcode: string, side: string): Promise<Rpc> {
  const { data, error } = await actor.rpc("check_start_move_address", {
    p_address: address,
    p_postcode: postcode,
    p_side: side,
  });
  return error ? { ok: false, error: error.message } : (data as Rpc);
}

async function adminState(ctx: Ctx, propertyId: number): Promise<string | null> {
  const { data } = await ctx.admin.rpc("_property_reservation_state", { p_property_id: propertyId });
  return (data as string | null) ?? null;
}

async function adminReserved(ctx: Ctx, propertyId: number): Promise<boolean | null> {
  const { data } = await ctx.admin.rpc("property_address_is_reserved", { p_property_id: propertyId });
  return (data as boolean | null) ?? null;
}

async function adminSides(ctx: Ctx, propertyId: number): Promise<{ seller_side?: string; buyer_side?: string }> {
  const { data } = await ctx.admin.rpc("_property_side_representation", { p_property_id: propertyId });
  const row = Array.isArray(data) ? data[0] : data;
  return (row ?? {}) as { seller_side?: string; buyer_side?: string };
}

function onlyKeys(value: Rpc, allowed: string[]): boolean {
  return !!value && Object.keys(value).every((k) => allowed.includes(k));
}

type InsertOutcome = { id: number | null; code: string | null; message: string | null };

async function tryInsert(
  client: SupabaseClient,
  createdBy: string,
  chainId: number,
  address: string | null,
  postcode: string | null,
  position: number,
  stage = "property_listed"
): Promise<InsertOutcome> {
  const { data, error } = await client
    .from("properties")
    .insert({
      chain_id: chainId,
      chain_position: position,
      address,
      postcode,
      stage,
      status: "pending_connection",
      relationship_type: stage === "searching" ? "purchase" : "sale",
      created_by_user_id: createdBy,
      buyer_connected: false,
      seller_connected: stage !== "searching",
      is_searching: stage === "searching",
    })
    .select("id")
    .single();
  return {
    id: (data?.id as number | undefined) ?? null,
    code: error?.code ?? null,
    message: error?.message ?? null,
  };
}

function reservedRefusal(outcome: InsertOutcome | { code: string | null; message: string | null }): boolean {
  return outcome.code === "23505" && outcome.message === "property_address_reserved";
}

async function grantIdentity(actor: Actor, propertyId: number): Promise<Rpc> {
  const { data, error } = await actor.client.rpc("establish_operational_homeowner_for_created_property", {
    p_property_id: propertyId,
  });
  return error ? { ok: false, error: error.message } : (data as Rpc);
}

async function claimAs(actor: Actor, propertyId: number): Promise<Rpc> {
  const { data, error } = await actor.client.rpc("claim_operational_property", {
    p_property_id: propertyId,
    p_invitation_token: null,
  });
  return error ? { ok: false, error: error.message } : (data as Rpc);
}

async function homeownerChainWithCode(ctx: Ctx, ho: Actor): Promise<{ chainId: number; accessCode: string }> {
  counter += 1;
  const suffix = `${ctx.stamp.slice(-6)}-${counter}`;
  const accessCode = `KN-ARJ-${suffix}`.toUpperCase();
  const { data, error } = await ho.client.rpc("create_chain_for_onboarding", {
    p_name: `AR HO ${suffix}`,
    p_access_code: accessCode,
  });
  if (error || data?.chain_id == null) {
    throw new Error(`create_chain_for_onboarding: ${error?.message ?? data?.error}`);
  }
  ctx.chainIds.push(data.chain_id as number);
  return { chainId: data.chain_id as number, accessCode };
}

async function eaSaleWithInvite(
  ea: EaActor,
  chainId: number,
  address: string,
  postcode: string,
  inviteEmail: string | null
): Promise<number> {
  const { data, error } = await ea.client.rpc("create_ea_operational_property", {
    p_chain_id: chainId,
    p_relationship_type: "sale",
    p_address: address,
    p_postcode: postcode,
    p_branch_id: ea.branchId,
    p_homeowner_only_updates: false,
    p_invite_email: inviteEmail,
    p_awaiting_buyer: false,
  });
  if (error || !data?.ok) throw new Error(`create_ea_operational_property: ${error?.message ?? data?.error}`);
  return data.property_id as number;
}

async function activeIdentityCount(ctx: Ctx, propertyId: number): Promise<number> {
  const { data } = await ctx.admin
    .from("property_operational_identities")
    .select("property_id")
    .eq("property_id", propertyId)
    .eq("status", "active");
  return (data ?? []).length;
}

async function lifecycleState(ctx: Ctx, propertyId: number): Promise<string | null> {
  const { data } = await ctx.admin
    .from("property_lifecycle_states")
    .select("operational_state")
    .eq("property_id", propertyId)
    .maybeSingle();
  return (data?.operational_state as string | undefined) ?? null;
}

async function discoverIds(actor: Actor): Promise<number[]> {
  const { data } = await actor.client.rpc("discover_claimable_properties");
  return ((data ?? []) as Array<{ property_id?: number }>)
    .map((row) => row.property_id)
    .filter((id): id is number => typeof id === "number");
}

async function keepSnapshot(ctx: Ctx, propertyId: number) {
  const [{ data: row }, { data: counterparties }, { data: assignments }, { data: invitations }, { data: claim }] =
    await Promise.all([
      ctx.admin
        .from("properties")
        .select("chain_id, status, buyer_connected")
        .eq("id", propertyId)
        .single(),
      ctx.admin
        .from("property_counterparty_participants")
        .select("user_id")
        .eq("property_id", propertyId)
        .eq("status", "active"),
      ctx.admin
        .from("property_ea_assignments")
        .select("branch_id")
        .eq("property_id", propertyId)
        .eq("status", "active"),
      ctx.admin
        .from("property_claim_invitations")
        .select("id")
        .eq("property_id", propertyId)
        .is("invitation_revoked_at", null)
        .is("invitation_used_at", null),
      ctx.admin
        .from("property_claim_metadata")
        .select("claim_status")
        .eq("property_id", propertyId)
        .maybeSingle(),
    ]);
  return {
    chainId: row?.chain_id as number | null,
    status: row?.status as string | null,
    buyerConnected: row?.buyer_connected as boolean | null,
    activeCounterparties: (counterparties ?? []).length,
    activeAssignments: (assignments ?? []).length,
    openInvitations: (invitations ?? []).length,
    claimStatus: claim?.claim_status as string | null,
  };
}

async function runScenarios(ctx: Ctx): Promise<void> {
  const personA = await setupHomeowner(ctx, "a");
  const personC = await setupHomeowner(ctx, "c");
  const personD = await setupHomeowner(ctx, "d");
  const personF = await setupHomeowner(ctx, "f");
  const ea = await setupEstateAgent(ctx, "ea");

  const saleAddress = `1 Reservation Sale ${ctx.stamp}`;
  const purchaseAddress = `2 Reservation Purchase ${ctx.stamp}`;
  const postcode = "PO16 7AA";

  const chainA = await homeownerChain(ctx, personA);
  const saleA = await homeownerProperty(personA, chainA, {
    relationship: "sale",
    address: saleAddress,
    postcode,
    position: 1,
    grantIdentity: true,
  });
  const purchaseA = await homeownerProperty(personA, chainA, {
    relationship: "purchase",
    address: purchaseAddress,
    postcode,
    position: 2,
    grantIdentity: true,
  });
  await personA.client.from("properties").update({ linked_property_id: purchaseA }).eq("id", saleA);

  // R1
  const unknown = `9 Nowhere ${randomUUID().slice(0, 8)}`;
  record("R1 unknown address selling → available", (await check(personC.client, unknown, postcode, "selling"))?.state === "available");
  record("R1 unknown address buying → available", (await check(personC.client, unknown, postcode, "buying"))?.state === "available");

  // R2
  const own = await check(personA.client, saleAddress, postcode, "selling");
  record("R2 own sale → yours with own chain id", own?.state === "yours" && own?.chain_id === chainA, JSON.stringify(own));

  // R3
  record("R3 state of homeowner sale without buyer = awaiting_buyer", (await adminState(ctx, saleA)) === "awaiting_buyer");
  const r3Buy = await check(personC.client, saleAddress, postcode, "buying");
  const r3Sell = await check(personC.client, saleAddress, postcode, "selling");
  record("R3 buying → awaiting_connection", r3Buy?.state === "awaiting_connection", JSON.stringify(r3Buy));
  record("R3 selling → already_represented", r3Sell?.state === "already_represented", JSON.stringify(r3Sell));

  // R4
  const sidesPurchase = await adminSides(ctx, purchaseA);
  record(
    "R4 purchase sides: seller none, buyer homeowner",
    sidesPurchase.seller_side === "none" && sidesPurchase.buyer_side === "homeowner",
    JSON.stringify(sidesPurchase)
  );
  record("R4 state = awaiting_seller", (await adminState(ctx, purchaseA)) === "awaiting_seller");
  const r4Sell = await check(personC.client, purchaseAddress, postcode, "selling");
  const r4Buy = await check(personC.client, purchaseAddress, postcode, "buying");
  record("R4 selling → awaiting_connection", r4Sell?.state === "awaiting_connection", JSON.stringify(r4Sell));
  record("R4 buying → already_represented", r4Buy?.state === "already_represented", JSON.stringify(r4Buy));

  // R5
  const variant = `  ${saleAddress.toUpperCase().replace(/ /g, "   ")}  `;
  const r5 = await check(personC.client, variant, "po167aa", "buying");
  record("R5 case/whitespace/postcode variant matches", r5?.state === "awaiting_connection", JSON.stringify(r5));

  // R6
  const r6 = await check(personC.client, "[Released property]", "REDACTED", "selling");
  record("R6 redaction placeholders have no key → invalid_address", r6?.ok === false && r6?.error === "invalid_address", JSON.stringify(r6));
  const { data: redacted } = await ctx.admin
    .from("properties")
    .select("id")
    .eq("address", "[Released property]")
    .eq("postcode", "REDACTED")
    .limit(1)
    .maybeSingle();
  if (redacted?.id) {
    record("R6 redacted row state = historical", (await adminState(ctx, redacted.id as number)) === "historical");
    record("R6 redacted row not reserved", (await adminReserved(ctx, redacted.id as number)) === false);
  } else {
    record("R6 redacted row available to test", false, "no redacted row in Development");
  }

  // R7
  const placeholderAddress = `3 Reservation Placeholder ${ctx.stamp}`;
  const chainC = await homeownerChain(ctx, personC);
  const placeholderId = await homeownerProperty(personC, chainC, {
    relationship: "sale",
    address: placeholderAddress,
    postcode,
    position: 1,
    grantIdentity: false,
  });
  record("R7 unrepresented row state = awaiting_seller (never stale)", (await adminState(ctx, placeholderId)) === "awaiting_seller");
  record("R7 unrepresented placeholder stays reserved", (await adminReserved(ctx, placeholderId)) === true);
  const r7Sell = await check(personA.client, placeholderAddress, postcode, "selling");
  record("R7 unrepresented sale address → already_represented (not available)", r7Sell?.state === "already_represented", JSON.stringify(r7Sell));

  // R8
  const releasedAddress = `4 Reservation Released ${ctx.stamp}`;
  const chainD = await homeownerChain(ctx, personD);
  const releasedId = await homeownerProperty(personD, chainD, {
    relationship: "sale",
    address: releasedAddress,
    postcode,
    position: 1,
    grantIdentity: true,
  });
  record("R8 before release: reserved", (await adminReserved(ctx, releasedId)) === true);
  const { data: delink } = await personD.client.rpc("execute_participation_delink", {
    p_property_id: releasedId,
    p_operation: "homeowner_self",
    p_branch_id: null,
    p_reason_code: "wrong_property",
  });
  record(
    "R8 homeowner_self with a mistake reason and no dependants releases",
    (delink as Rpc)?.ok === true && (delink as Rpc)?.lifecycle_state === "released" && (delink as Rpc)?.placeholder === false,
    JSON.stringify(delink)
  );
  record("R8 released row state = historical", (await adminState(ctx, releasedId)) === "historical");
  record("R8 released address → available", (await check(personC.client, releasedAddress, postcode, "selling"))?.state === "available");

  // R8b — a non-mistake exit leaves an unrepresented placeholder, not a release
  const keptAddress = `4b Reservation Kept ${ctx.stamp}`;
  const keptChain = await homeownerChain(ctx, personD);
  const keptId = await homeownerProperty(personD, keptChain, {
    relationship: "sale",
    address: keptAddress,
    postcode,
    position: 1,
    grantIdentity: true,
  });
  const { data: keptDelink } = await personD.client.rpc("execute_participation_delink", {
    p_property_id: keptId,
    p_operation: "homeowner_self",
    p_branch_id: null,
    p_reason_code: "no_longer_moving",
  });
  record(
    "R8b no_longer_moving keeps an awaiting_seller placeholder (reserved, lifecycle not released)",
    (keptDelink as Rpc)?.ok === true &&
      (keptDelink as Rpc)?.placeholder === true &&
      (await adminState(ctx, keptId)) === "awaiting_seller" &&
      (await adminReserved(ctx, keptId)) === true &&
      (await lifecycleState(ctx, keptId)) !== "released" &&
      (await activeIdentityCount(ctx, keptId)) === 0,
    JSON.stringify(keptDelink)
  );
  record(
    "R8b the placeholder's address is not available to others",
    (await check(personC.client, keptAddress, postcode, "selling"))?.state === "already_represented"
  );

  // R17
  const { error: memberError } = await ctx.admin
    .from("property_members")
    .insert({ property_id: saleA, user_id: personD.userId, role: "buyer" });
  record("R17 fixture: plain member row on another homeowner's sale", !memberError, memberError?.message);
  const memberSell = await check(personD.client, saleAddress, postcode, "selling");
  const memberBuy = await check(personD.client, saleAddress, postcode, "buying");
  record(
    "R17 plain member selling → already_represented, no chain id",
    memberSell?.state === "already_represented" && onlyKeys(memberSell, ["ok", "state"]),
    JSON.stringify(memberSell)
  );
  record(
    "R17 plain member buying → awaiting_connection, no chain id",
    memberBuy?.state === "awaiting_connection" && onlyKeys(memberBuy, ["ok", "state"]),
    JSON.stringify(memberBuy)
  );
  await ctx.admin.from("property_members").delete().eq("property_id", saleA).eq("user_id", personD.userId);

  // R9
  const eaAddress = `5 Reservation Agent Sale ${ctx.stamp}`;
  counter += 1;
  const eaSuffix = `${ctx.stamp.slice(-6)}-${counter}`;
  const { data: eaChain, error: eaChainError } = await ea.client.rpc("create_ea_operational_chain", {
    p_name: `AR EA ${eaSuffix}`,
    p_access_code: `KN-ARE-${eaSuffix}`.toUpperCase(),
  });
  if (eaChainError || !eaChain?.ok) throw new Error(`create_ea_operational_chain: ${eaChainError?.message ?? eaChain?.error}`);
  ctx.chainIds.push(eaChain.chain_id as number);
  const { data: eaSale, error: eaSaleError } = await ea.client.rpc("create_ea_operational_property", {
    p_chain_id: eaChain.chain_id,
    p_relationship_type: "sale",
    p_address: eaAddress,
    p_postcode: postcode,
    p_branch_id: ea.branchId,
    p_homeowner_only_updates: false,
    p_invite_email: null,
    p_awaiting_buyer: false,
  });
  if (eaSaleError || !eaSale?.ok) throw new Error(`create_ea_operational_property: ${eaSaleError?.message ?? eaSale?.error}`);
  const eaSaleId = eaSale.property_id as number;
  const eaSides = await adminSides(ctx, eaSaleId);
  record("R9 EA sale sides: seller ea, buyer none", eaSides.seller_side === "ea" && eaSides.buyer_side === "none", JSON.stringify(eaSides));
  record("R9 homeowner selling → already_represented", (await check(personC.client, eaAddress, postcode, "selling"))?.state === "already_represented");
  record("R9 homeowner buying → awaiting_connection", (await check(personC.client, eaAddress, postcode, "buying"))?.state === "awaiting_connection");
  const eaOwn = await check(ea.client, eaAddress, postcode, "selling");
  record("R9 branch member → yours", eaOwn?.state === "yours" && eaOwn?.chain_id === eaChain.chain_id, JSON.stringify(eaOwn));

  // R10
  record("R10 awaiting response discloses only ok/state", onlyKeys(r4Sell, ["ok", "state"]), JSON.stringify(r4Sell));
  record("R10 represented response discloses only ok/state", onlyKeys(r3Sell, ["ok", "state"]), JSON.stringify(r3Sell));

  // R11
  const anon = anonClient(ctx);
  const { data: anonData, error: anonError } = await anon.rpc("check_start_move_address", {
    p_address: saleAddress,
    p_postcode: postcode,
    p_side: "selling",
  });
  record("R11 anon cannot call check_start_move_address", !!anonError || (anonData as Rpc)?.ok === false, anonError?.message ?? JSON.stringify(anonData));
  for (const [name, args] of [
    ["property_address_is_reserved", { p_property_id: saleA }],
    ["_property_reservation_state", { p_property_id: saleA }],
    ["_property_side_representation", { p_property_id: saleA }],
    ["_address_match_key", { p_address: saleAddress }],
    ["property_exists_for_onboarding", { p_address: saleAddress, p_postcode: postcode }],
  ] as const) {
    const { data, error } = await personC.client.rpc(name, args);
    record(`R11 authenticated refused: ${name}`, !!error && data == null, error?.message ?? JSON.stringify(data));
  }

  // R12
  const badSide = await check(personC.client, saleAddress, postcode, "renting");
  record("R12 invalid side refused", badSide?.ok === false && badSide?.error === "invalid_side");
  const blank = await check(personC.client, "   ", postcode, "selling");
  record("R12 blank address refused", blank?.ok === false && blank?.error === "invalid_address");

  // R13
  const { data: scoped } = await personA.client.rpc("validate_onboarding_property_address", {
    p_address: variant,
    p_postcode: "po16  7aa",
    p_chain_id: chainA,
  });
  record(
    "R13 validate_onboarding_property_address matches normalised variant",
    (scoped as Rpc)?.ok === false && (scoped as Rpc)?.error === "address_unavailable",
    JSON.stringify(scoped)
  );

  // R14
  const { data: notEmpty } = await personA.client.rpc("cleanup_abandoned_onboarding_chain", {
    p_chain_id: chainA,
    p_require_empty: true,
  });
  record("R14 require_empty refuses non-empty chain", (notEmpty as Rpc)?.error === "chain_not_empty", JSON.stringify(notEmpty));
  const { data: chainAStill } = await ctx.admin.from("chains").select("id").eq("id", chainA).maybeSingle();
  record("R14 non-empty chain kept", !!chainAStill);

  const { data: eaCleanup } = await ea.client.rpc("cleanup_abandoned_onboarding_chain", {
    p_chain_id: eaChain.chain_id,
  });
  record("R14 EA-originated chain cannot be cleaned up", (eaCleanup as Rpc)?.ok === false, JSON.stringify(eaCleanup));
  const { data: eaChainStill } = await ctx.admin.from("chains").select("id").eq("id", eaChain.chain_id).maybeSingle();
  record("R14 EA-originated chain kept", !!eaChainStill);

  const emptyChain = await homeownerChain(ctx, personF);
  const { data: emptyCleanup } = await personF.client.rpc("cleanup_abandoned_onboarding_chain", {
    p_chain_id: emptyChain,
    p_require_empty: true,
  });
  record("R14 require_empty cleans an empty own chain", (emptyCleanup as Rpc)?.ok === true && (emptyCleanup as Rpc)?.empty_chain === true, JSON.stringify(emptyCleanup));

  const { data: strangerCleanup } = await personC.client.rpc("cleanup_abandoned_onboarding_chain", {
    p_chain_id: chainA,
  });
  record("R14 stranger refused", (strangerCleanup as Rpc)?.error === "not_authorized", JSON.stringify(strangerCleanup));

  // R16
  const { data: selfReleases } = await ctx.admin
    .from("property_delink_events")
    .select("property_id")
    .eq("metadata->>operation", "homeowner_self");
  const releasedIds = [...new Set((selfReleases ?? []).map((row) => row.property_id as number))];
  const unbounded: number[] = [];
  for (const propertyId of releasedIds) {
    if ((await adminSides(ctx, propertyId)).seller_side !== "none") continue;
    const state = await adminState(ctx, propertyId);
    if (state === "historical" || state === "lifecycle_held") continue;
    const { data: lifecycle } = await ctx.admin
      .from("property_lifecycle_states")
      .select("operational_state, seller_side_unrepresented_since, next_evaluation_at")
      .eq("property_id", propertyId)
      .maybeSingle();
    const clockRunning = lifecycle?.seller_side_unrepresented_since != null;
    const graceScheduled = lifecycle?.operational_state === "completed_grace" && lifecycle?.next_evaluation_at != null;
    if (!clockRunning && !graceScheduled) unbounded.push(propertyId);
  }
  record(
    "R16 every unrepresented self-delinked placeholder still reserved has a running lifecycle clock (released in time)",
    releasedIds.length > 0 && unbounded.length === 0,
    `${unbounded.length} of ${releasedIds.length} without a clock`
  );

  // R18 — reservation trigger: direct inserts of a reserved address
  const dupDirect = await tryInsert(personC.client, personC.userId, chainC, saleAddress, postcode, 2);
  record(
    "R18 direct insert of a reserved address refused (23505 property_address_reserved)",
    reservedRefusal(dupDirect) && dupDirect.id == null,
    JSON.stringify(dupDirect)
  );
  const dupVariant = await tryInsert(personC.client, personC.userId, chainC, variant, "po167aa", 2);
  record("R18 case/whitespace/postcode variant refused", reservedRefusal(dupVariant), JSON.stringify(dupVariant));
  const dupPurchase = await tryInsert(personC.client, personC.userId, chainC, purchaseAddress, postcode, 2);
  record("R18 awaiting-seller purchase address refused", reservedRefusal(dupPurchase), JSON.stringify(dupPurchase));
  const dupEaManaged = await tryInsert(personC.client, personC.userId, chainC, eaAddress, postcode, 2);
  record("R18 EA-managed address refused", reservedRefusal(dupEaManaged), JSON.stringify(dupEaManaged));
  const dupAdmin = await tryInsert(ctx.admin, personC.userId, chainC, saleAddress, postcode, 2);
  record("R18 service role is refused too (trigger applies to every role)", reservedRefusal(dupAdmin), JSON.stringify(dupAdmin));

  // R19 — address changes
  const ownAddress = `6 Reservation Own ${ctx.stamp}`;
  const ownId = await homeownerProperty(personC, chainC, {
    relationship: "sale",
    address: ownAddress,
    postcode,
    position: 2,
    grantIdentity: true,
  });
  const { error: moveError } = await personC.client
    .from("properties")
    .update({ address: saleAddress })
    .eq("id", ownId);
  const { data: ownAfterMove } = await ctx.admin.from("properties").select("address").eq("id", ownId).single();
  record(
    "R19 changing an operated row's address to a reserved one is refused",
    reservedRefusal({ code: moveError?.code ?? null, message: moveError?.message ?? null }) &&
      ownAfterMove?.address === ownAddress,
    moveError?.message ?? "update succeeded"
  );
  const { data: plainUpdate, error: plainError } = await personC.client
    .from("properties")
    .update({ last_updated_days: 3 })
    .eq("id", ownId)
    .select("id");
  record("R19 non-address update of a reserved row passes", !plainError && (plainUpdate ?? []).length === 1, plainError?.message);
  const { data: sameKeyUpdate, error: sameKeyError } = await personC.client
    .from("properties")
    .update({ address: ownAddress.toUpperCase() })
    .eq("id", ownId)
    .select("id");
  record(
    "R19 key-preserving address edit (case only) of a reserved row passes",
    !sameKeyError && (sameKeyUpdate ?? []).length === 1,
    sameKeyError?.message
  );

  // R20 — an unrepresented placeholder keeps its address; a released one frees it
  const placeholderReuseChain = await homeownerChain(ctx, personF);
  const placeholderReuse = await tryInsert(
    personF.client,
    personF.userId,
    placeholderReuseChain,
    placeholderAddress,
    postcode,
    1
  );
  record(
    "R20 unrepresented placeholder address cannot be reused (23505 property_address_reserved)",
    placeholderReuse.id == null && reservedRefusal(placeholderReuse),
    JSON.stringify(placeholderReuse)
  );
  const releasedReuseChain = await homeownerChain(ctx, personF);
  const releasedReuse = await tryInsert(personF.client, personF.userId, releasedReuseChain, releasedAddress, postcode, 1);
  const releasedReuseGrant = releasedReuse.id != null ? await grantIdentity(personF, releasedReuse.id) : null;
  record(
    "R20 released address can be reused (insert + identity grant)",
    releasedReuse.id != null && releasedReuseGrant?.ok === true,
    JSON.stringify({ releasedReuse, releasedReuseGrant })
  );

  // R21 — null-address placeholders are unaffected
  const nullOne = await tryInsert(personA.client, personA.userId, chainA, null, null, 3, "searching");
  const nullTwoChain = await homeownerChain(ctx, personA);
  const nullTwo = await tryInsert(personA.client, personA.userId, nullTwoChain, null, null, 1, "searching");
  record(
    "R21 searching placeholders without an address are never refused",
    nullOne.id != null && nullTwo.id != null,
    JSON.stringify({ nullOne, nullTwo })
  );

  // R22 — EA create checks reservation globally
  const eaDuplicate = await ea.client.rpc("create_ea_operational_property", {
    p_chain_id: eaChain.chain_id,
    p_relationship_type: "sale",
    p_address: variant,
    p_postcode: "po167aa",
    p_branch_id: ea.branchId,
    p_homeowner_only_updates: false,
    p_invite_email: null,
    p_awaiting_buyer: false,
  });
  record(
    "R22 EA create of an address reserved in another chain → property_already_exists",
    (eaDuplicate.data as Rpc)?.ok === false && (eaDuplicate.data as Rpc)?.error === "property_already_exists",
    JSON.stringify(eaDuplicate.data ?? eaDuplicate.error?.message)
  );

  // R23 — convert of a placeholder to a reserved address
  const { data: ownPlaceholder } = await personC.client.rpc("create_searching_placeholder_for_sale", {
    p_sale_property_id: ownId,
  });
  const { data: convertDup } = await personC.client.rpc("convert_searching_placeholder_for_sale", {
    p_sale_property_id: ownId,
    p_address: saleAddress,
    p_postcode: postcode,
  });
  record(
    "R23 converting a placeholder to a reserved address → duplicate_address",
    (ownPlaceholder as Rpc)?.ok === true &&
      (convertDup as Rpc)?.ok === false &&
      (convertDup as Rpc)?.error === "duplicate_address",
    JSON.stringify(convertDup)
  );

  // R24 — concurrent Start Move race: an unrepresented row is reserved from
  // insert, so the inserts serialise on the address lock and only one lands
  const raceAddress = `7 Reservation Race ${ctx.stamp}`;
  const raceChainC = await homeownerChain(ctx, personC);
  const raceChainD = await homeownerChain(ctx, personD);
  const [raceC, raceD] = await Promise.all([
    tryInsert(personC.client, personC.userId, raceChainC, raceAddress, postcode, 1),
    tryInsert(personD.client, personD.userId, raceChainD, raceAddress, postcode, 1),
  ]);
  const raceInserted = [raceC, raceD].filter((r) => r.id != null);
  const raceRefused = [raceC, raceD].filter((r) => r.id == null && reservedRefusal(r));
  record(
    "R24 concurrent inserts of one address: exactly one row lands; the other is property_address_reserved",
    raceInserted.length === 1 && raceRefused.length === 1,
    JSON.stringify({ raceC, raceD })
  );
  if (raceInserted.length === 1) {
    const winnerIsC = raceC.id != null;
    const winner = (winnerIsC ? raceC.id : raceD.id) as number;
    const grant = await grantIdentity(winnerIsC ? personC : personD, winner);
    record(
      "R24 the winner is reserved from insert and its owner's identity grant succeeds",
      (await adminState(ctx, winner)) !== "historical" && grant?.ok === true && (await adminReserved(ctx, winner)) === true,
      JSON.stringify(grant)
    );
    const loserActor = winnerIsC ? personD : personC;
    const loserChain = winnerIsC ? raceChainD : raceChainC;
    const retry = await tryInsert(loserActor.client, loserActor.userId, loserChain, raceAddress, postcode, 1);
    record(
      "R24 the loser's retry is still refused and creates no row",
      retry.id == null && reservedRefusal(retry),
      JSON.stringify(retry)
    );
  }

  // R25 — a released row cannot be made operational again
  const reopenAddress = `8 Reservation Reopen ${ctx.stamp}`;
  const reopenChain = await homeownerChain(ctx, personD);
  const reopenId = await homeownerProperty(personD, reopenChain, {
    relationship: "sale",
    address: reopenAddress,
    postcode,
    position: 1,
    grantIdentity: true,
  });
  const { data: reopenDelink } = await personD.client.rpc("execute_participation_delink", {
    p_property_id: reopenId,
    p_operation: "homeowner_self",
    p_branch_id: null,
    p_reason_code: "wrong_property",
  });
  const reopenGrant = await grantIdentity(personD, reopenId);
  record(
    "R25 identity grant on a released row → property_released",
    (reopenDelink as Rpc)?.ok === true &&
      reopenGrant?.ok === false &&
      reopenGrant?.error === "property_released" &&
      (await activeIdentityCount(ctx, reopenId)) === 0,
    JSON.stringify({ reopenDelink, reopenGrant })
  );

  // R26 — join onto a released purchase is refused
  const personE = await setupHomeowner(ctx, "e");
  const joinChain = await homeownerChainWithCode(ctx, personE);
  const joinSaleAddress = `9 Reservation Join Sale ${ctx.stamp}`;
  const joinPurchaseAddress = `10 Reservation Join Purchase ${ctx.stamp}`;
  const joinSale = await homeownerProperty(personE, joinChain.chainId, {
    relationship: "sale",
    address: joinSaleAddress,
    postcode,
    position: 1,
    grantIdentity: true,
  });
  const joinPurchase = await homeownerProperty(personE, joinChain.chainId, {
    relationship: "purchase",
    address: joinPurchaseAddress,
    postcode,
    position: 2,
    grantIdentity: true,
  });
  await personE.client.from("properties").update({ linked_property_id: joinPurchase }).eq("id", joinSale);
  const { data: purchaseDelink } = await personE.client.rpc("execute_participation_delink", {
    p_property_id: joinPurchase,
    p_operation: "homeowner_self",
    p_branch_id: null,
    p_reason_code: "no_longer_moving",
  });
  const joinSides = await adminSides(ctx, joinPurchase);
  const { data: joinReleased, error: joinError } = await personC.client.rpc("join_chain_property", {
    p_access_code: joinChain.accessCode,
    p_address: joinPurchaseAddress,
    p_postcode: postcode,
  });
  const { data: joinCounterparties } = await ctx.admin
    .from("property_counterparty_participants")
    .select("user_id")
    .eq("property_id", joinPurchase)
    .eq("status", "active");
  record(
    "R26 the buyer leaving their purchase releases it and unlinks their own sale (no sides remain)",
    (purchaseDelink as Rpc)?.ok === true &&
      (purchaseDelink as Rpc)?.lifecycle_state === "released" &&
      ((purchaseDelink as Rpc)?.unlinked_sale_ids as number[] | undefined)?.includes(joinSale) === true &&
      joinSides.seller_side === "none" &&
      joinSides.buyer_side === "none",
    JSON.stringify({ purchaseDelink, joinSides })
  );
  record(
    "R26 join onto a released purchase is refused (no counterparty created)",
    !joinError &&
      (joinReleased as Rpc)?.ok === false &&
      (joinCounterparties ?? []).length === 0,
    joinError?.message ?? JSON.stringify(joinReleased)
  );

  // R27 — the branch leaving an ownerless sale it added by mistake releases it
  // (a non-mistake exit keeps a claimable placeholder: R28 / R31)
  const personG = await setupHomeowner(ctx, "g");
  const leaveAddress = `11 Reservation Branch Leaves ${ctx.stamp}`;
  const leaveId = await eaSaleWithInvite(ea, eaChain.chain_id as number, leaveAddress, postcode, personG.email);
  const leaveListedBefore = (await discoverIds(personG)).includes(leaveId);
  const { data: leave } = await ea.client.rpc("execute_participation_delink", {
    p_property_id: leaveId,
    p_operation: "estate_agent_remove_branch",
    p_branch_id: ea.branchId,
    p_reason_code: "added_by_mistake",
  });
  const { data: leaveClaimMeta } = await ctx.admin
    .from("property_claim_metadata")
    .select("claim_status")
    .eq("property_id", leaveId)
    .maybeSingle();
  const { data: leaveOpenInvites } = await ctx.admin
    .from("property_claim_invitations")
    .select("id")
    .eq("property_id", leaveId)
    .is("invitation_revoked_at", null)
    .is("invitation_used_at", null);
  record(
    "R27 estate_agent_remove_branch (added_by_mistake) on an ownerless sale releases it",
    (leave as Rpc)?.ok === true &&
      (leave as Rpc)?.lifecycle_state === "released" &&
      (await lifecycleState(ctx, leaveId)) === "released" &&
      (await adminState(ctx, leaveId)) === "historical" &&
      leaveClaimMeta?.claim_status === "unclaimed" &&
      (leaveOpenInvites ?? []).length === 0,
    JSON.stringify({ leave, claim: leaveClaimMeta, openInvites: leaveOpenInvites?.length })
  );
  const leaveClaim = await claimAs(personG, leaveId);
  record(
    "R27 the invitee can no longer claim the released sale",
    leaveClaim?.ok === false && (await activeIdentityCount(ctx, leaveId)) === 0,
    JSON.stringify(leaveClaim)
  );
  const leaveListedAfter = (await discoverIds(personG)).includes(leaveId);
  record(
    "R27 the released sale leaves the invitee's claim list (no post-sign-in claim redirect)",
    leaveListedBefore && !leaveListedAfter,
    JSON.stringify({ leaveListedBefore, leaveListedAfter })
  );

  // R27b — a lifecycle-archived claimable row is not offered either
  const personL = await setupHomeowner(ctx, "l");
  const archivedId = await eaSaleWithInvite(
    ea,
    eaChain.chain_id as number,
    `18 Reservation Archived Invite ${ctx.stamp}`,
    postcode,
    personL.email
  );
  const archivedListedBefore = (await discoverIds(personL)).includes(archivedId);
  const { error: archiveError } = await ctx.admin.from("property_lifecycle_states").upsert({
    property_id: archivedId,
    operational_state: "archived",
    lifecycle_reason: "verify_fixture",
    entered_state_at: new Date().toISOString(),
  });
  record(
    "R27b an archived claimable row is no longer listed for its invitee",
    !archiveError && archivedListedBefore && !(await discoverIds(personL)).includes(archivedId),
    archiveError?.message ?? JSON.stringify({ archivedListedBefore })
  );

  // R31 — the branch leaving an ownerless sale a buyer has joined keeps the chain
  const personM = await setupHomeowner(ctx, "m");
  const buyerN = await setupHomeowner(ctx, "n");
  const keepSuffix = `${ctx.stamp.slice(-6)}-keep`;
  const keepAccessCode = `KN-ARK-${keepSuffix}`.toUpperCase();
  const { data: keepChain, error: keepChainError } = await ea.client.rpc("create_ea_operational_chain", {
    p_name: `AR EA keep ${keepSuffix}`,
    p_access_code: keepAccessCode,
  });
  if (keepChainError || !keepChain?.ok) {
    throw new Error(`create_ea_operational_chain: ${keepChainError?.message ?? keepChain?.error}`);
  }
  ctx.chainIds.push(keepChain.chain_id as number);
  const keepAddress = `19 Reservation Branch Leaves Buyer Joined ${ctx.stamp}`;
  const keepId = await eaSaleWithInvite(ea, keepChain.chain_id as number, keepAddress, postcode, personM.email);
  const { data: keepJoin, error: keepJoinError } = await buyerN.client.rpc("join_chain_property", {
    p_access_code: keepAccessCode,
    p_address: keepAddress,
    p_postcode: postcode,
  });
  const keepBefore = await keepSnapshot(ctx, keepId);
  record(
    "R31 fixture: a buyer joined the EA sale by access code (active counterparty) before the branch leaves",
    !keepJoinError && (keepJoin as Rpc)?.ok === true && keepBefore.activeCounterparties === 1,
    keepJoinError?.message ?? JSON.stringify({ keepJoin, keepBefore })
  );
  const { data: keepLeave } = await ea.client.rpc("execute_participation_delink", {
    p_property_id: keepId,
    p_operation: "estate_agent_remove_branch",
    p_branch_id: ea.branchId,
    p_reason_code: "other",
  });
  const keepAfter = await keepSnapshot(ctx, keepId);
  record(
    "R31 remove_branch with a joined buyer: placeholder kept (not released); only the assignment is revoked",
    (keepLeave as Rpc)?.ok === true &&
      (keepLeave as Rpc)?.placeholder === true &&
      (keepLeave as Rpc)?.lifecycle_state === "active" &&
      (await lifecycleState(ctx, keepId)) !== "released" &&
      keepAfter.activeAssignments === 0 &&
      keepAfter.activeCounterparties === 1 &&
      keepAfter.buyerConnected === keepBefore.buyerConnected &&
      keepAfter.chainId === keepBefore.chainId &&
      keepAfter.status === keepBefore.status &&
      keepAfter.claimStatus === keepBefore.claimStatus &&
      keepAfter.claimStatus === "claim_invited" &&
      keepAfter.openInvitations === keepBefore.openInvitations,
    JSON.stringify({ keepLeave, keepBefore, keepAfter })
  );
  record(
    "R31 the preserved sale's address stays reserved and it is still offered to the invitee",
    (await adminReserved(ctx, keepId)) === true && (await discoverIds(personM)).includes(keepId)
  );
  const { data: eaCanKeep } = await ea.client.rpc("can_operate_property", { p_property_id: keepId });
  const { data: buyerCanKeep } = await buyerN.client.rpc("can_operate_property", { p_property_id: keepId });
  const { error: eaKeepWriteError, data: eaKeepWrite } = await ea.client
    .from("properties")
    .update({ stage: "offer_accepted" })
    .eq("id", keepId)
    .select("id");
  record(
    "R31 no new authority: the departed branch and the buyer cannot operate the preserved sale",
    eaCanKeep === false &&
      buyerCanKeep === false &&
      (eaKeepWriteError != null || (eaKeepWrite ?? []).length === 0),
    JSON.stringify({ eaCanKeep, buyerCanKeep, eaWrite: eaKeepWriteError?.message ?? eaKeepWrite?.length })
  );
  const keepClaim = await claimAs(personM, keepId);
  const { data: inviteeCanKeep } = await personM.client.rpc("can_operate_property", { p_property_id: keepId });
  record(
    "R31 the invited homeowner can still claim and becomes the seller-side operator; the buyer stays",
    keepClaim?.ok === true &&
      inviteeCanKeep === true &&
      (await activeIdentityCount(ctx, keepId)) === 1 &&
      (await keepSnapshot(ctx, keepId)).activeCounterparties === 1,
    JSON.stringify(keepClaim)
  );

  // R28 — a claimable placeholder whose EA left keeps its address; the invitee can still claim
  const personH = await setupHomeowner(ctx, "h");
  const placeholderClaimAddress = `12 Reservation Placeholder Claim ${ctx.stamp}`;
  const placeholderClaimId = await eaSaleWithInvite(ea, eaChain.chain_id as number, placeholderClaimAddress, postcode, personH.email);
  const { error: revokeError } = await ctx.admin
    .from("property_ea_assignments")
    .update({ status: "revoked", revoked_at: new Date().toISOString() })
    .eq("property_id", placeholderClaimId)
    .eq("status", "active");
  const takerChain = await homeownerChain(ctx, personC);
  const taker = await tryInsert(personC.client, personC.userId, takerChain, placeholderClaimAddress, postcode, 1);
  record(
    "R28 fixture: assignment revoked out of band leaves an awaiting_seller placeholder that stays reserved; another row cannot take its address",
    !revokeError &&
      (await adminState(ctx, placeholderClaimId)) === "awaiting_seller" &&
      (await adminReserved(ctx, placeholderClaimId)) === true &&
      taker.id == null &&
      reservedRefusal(taker),
    revokeError?.message ?? JSON.stringify(taker)
  );
  const placeholderClaim = await claimAs(personH, placeholderClaimId);
  record(
    "R28 the invited homeowner claims the placeholder (one identity; still reserved)",
    placeholderClaim?.ok === true &&
      (await activeIdentityCount(ctx, placeholderClaimId)) === 1 &&
      (await adminReserved(ctx, placeholderClaimId)) === true,
    JSON.stringify(placeholderClaim)
  );

  // R29 — the unrepresented onward purchase keeps its address; claiming the sale keeps it linked
  const personJ = await setupHomeowner(ctx, "j");
  const onwardSaleAddress = `13 Reservation Onward Sale ${ctx.stamp}`;
  const onwardAddress = `14 Reservation Onward Purchase ${ctx.stamp}`;
  const onwardSaleId = await eaSaleWithInvite(ea, eaChain.chain_id as number, onwardSaleAddress, postcode, personJ.email);
  const { data: onwardPlaceholder } = await ea.client.rpc("create_searching_placeholder_for_sale", {
    p_sale_property_id: onwardSaleId,
  });
  const { data: onwardConvert } = await ea.client.rpc("convert_searching_placeholder_for_sale", {
    p_sale_property_id: onwardSaleId,
    p_address: onwardAddress,
    p_postcode: postcode,
  });
  const onwardId = (onwardConvert as Rpc)?.property_id as number | undefined;
  await ctx.admin
    .from("property_ea_assignments")
    .update({ status: "revoked", revoked_at: new Date().toISOString() })
    .eq("property_id", onwardSaleId)
    .eq("status", "active");
  const onwardTakerChain = await homeownerChain(ctx, personC);
  const onwardTaker = await tryInsert(personC.client, personC.userId, onwardTakerChain, onwardAddress, postcode, 1);
  record(
    "R29 fixture: sale and its onward purchase are awaiting_seller placeholders and stay reserved; another row cannot take the onward address",
    (onwardPlaceholder as Rpc)?.ok === true &&
      onwardId != null &&
      (await adminState(ctx, onwardSaleId)) === "awaiting_seller" &&
      (await adminState(ctx, onwardId)) === "awaiting_seller" &&
      (await adminReserved(ctx, onwardId)) === true &&
      onwardTaker.id == null &&
      reservedRefusal(onwardTaker),
    JSON.stringify({ onwardConvert, onwardTaker })
  );
  if (onwardId != null) {
    const onwardClaim = await claimAs(personJ, onwardSaleId);
    const { data: onwardSaleRow } = await ctx.admin
      .from("properties")
      .select("linked_property_id")
      .eq("id", onwardSaleId)
      .single();
    const { data: unlinkNotice } = await ctx.admin
      .from("activities")
      .select("id")
      .eq("property_id", onwardSaleId)
      .eq(
        "update",
        "The onward purchase was unlinked from this sale because that address is now part of another MoveLoop chain."
      );
    record(
      "R29 claim succeeds; the onward purchase stays linked and reserved with no unlink notice",
      onwardClaim?.ok === true &&
        onwardSaleRow?.linked_property_id === onwardId &&
        (unlinkNotice ?? []).length === 0 &&
        (await adminReserved(ctx, onwardId)) === true,
      JSON.stringify({ onwardClaim, linked: onwardSaleRow?.linked_property_id, notices: unlinkNotice?.length })
    );
  }

  // R30 — an unrepresented purchase keeps its address; its own chain's sale can still link to it
  const personK = await setupHomeowner(ctx, "k");
  const linkChain = await homeownerChain(ctx, personK);
  const linkSale = await homeownerProperty(personK, linkChain, {
    relationship: "sale",
    address: `15 Reservation Link Sale ${ctx.stamp}`,
    postcode,
    position: 1,
    grantIdentity: true,
  });
  const takenPurchaseAddress = `16 Reservation Link Taken ${ctx.stamp}`;
  const takenPurchase = await homeownerProperty(personK, linkChain, {
    relationship: "purchase",
    address: takenPurchaseAddress,
    postcode,
    position: 2,
    grantIdentity: false,
  });
  const freePurchase = await homeownerProperty(personK, linkChain, {
    relationship: "purchase",
    address: `17 Reservation Link Free ${ctx.stamp}`,
    postcode,
    position: 3,
    grantIdentity: false,
  });
  const linkTakerChain = await homeownerChain(ctx, personC);
  const linkTaker = await tryInsert(personC.client, personC.userId, linkTakerChain, takenPurchaseAddress, postcode, 1);
  record(
    "R30 fixture: unrepresented purchase in the chain is awaiting_seller and reserved; another row cannot take its address",
    (await adminState(ctx, takenPurchase)) === "awaiting_seller" &&
      (await adminReserved(ctx, takenPurchase)) === true &&
      linkTaker.id == null &&
      reservedRefusal(linkTaker),
    JSON.stringify(linkTaker)
  );
  const { data: linkOwn, error: linkOwnError } = await personK.client
    .from("properties")
    .update({ linked_property_id: takenPurchase })
    .eq("id", linkSale)
    .select("id");
  record(
    "R30 the chain's own sale links to its reserved purchase (no conflicting row)",
    !linkOwnError && (linkOwn ?? []).length === 1 && (await adminReserved(ctx, takenPurchase)) === true,
    linkOwnError?.message
  );
  const { data: linkFree, error: linkFreeError } = await personK.client
    .from("properties")
    .update({ linked_property_id: freePurchase })
    .eq("id", linkSale)
    .select("id");
  record(
    "R30 relinking to another unrepresented purchase passes; it stays awaiting_seller",
    !linkFreeError &&
      (linkFree ?? []).length === 1 &&
      (await adminState(ctx, freePurchase)) === "awaiting_seller",
    linkFreeError?.message
  );

  // R15
  let limited: Rpc = null;
  for (let i = 0; i < 31; i++) {
    limited = await check(personF.client, `${i} Rate Limit ${ctx.stamp}`, postcode, "selling");
  }
  record("R15 31st call within 15 minutes is rate limited", limited?.ok === false && limited?.error === "rate_limited", JSON.stringify(limited));
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
  for (const userId of ctx.userIds) {
    warn("profiles", (await ctx.admin.from("profiles").delete().eq("id", userId)).error);
    const { error } = await ctx.admin.auth.admin.deleteUser(userId);
    warn("auth user", error);
  }
}

async function main() {
  if (!process.argv.includes("--execute")) {
    console.log("Live Development scenarios only. Re-run with --execute after applying 20261005100000.");
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
