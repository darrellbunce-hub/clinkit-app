/**
 * Operational authority enforcement (M3) — live Development scenarios.
 *
 * Requires 20261005100000, 20261005110000 and 20261005120000 on Development.
 *
 * Each probe runs one actor against one row across the client write paths:
 *   can_operate_property; direct properties update (row count); activity insert;
 *   report_operational_delay + resolve_operational_delay; can_operate_in_chain;
 *   chains update (row count); and, when refused, break_chain_connection,
 *   upsert_operational_summaries and resolving the operator's delay.
 *
 *   OA1 Flat 2: Person A sells House 1 (EA A, EA updates allowed); EA A creates Person A's
 *       onward purchase Flat 2 and gains no authority over it; Person A (its buyer) has
 *       none either; neither can appoint an EA or run the connected hop; Person B, Flat 2's
 *       seller, connects and operates it; Person B cannot appoint EA A
 *       (branch_acts_for_buyer); Person B appoints EA B, who operates Flat 2 exactly while
 *       Person B allows EA updates; nothing moves to or from House 1
 *   OA2 the five authority states:
 *       1. homeowner + EA + updates enabled → EA operates
 *       2. homeowner + EA + updates disabled → EA cannot operate (and follows the toggle)
 *       3. EA-only property → EA operates normally; nobody can appoint
 *       4. connected participant / viewer, plain property_members row, active
 *          property_delegates row → cannot operate
 *       5. EA assigned to a different property → cannot operate this one
 *   OA3 Buyer Ready node: owner only (activity, delay, node update); others refused
 *   OA4 placement: plain members cannot insert properties or Buyer Ready nodes in the chain
 *   OA5 appointment RPCs: direct property_ea_assignments writes are refused; replacement
 *       revokes the previous branch; anon refused
 *
 * Usage (Development ONLY — bbbsxzxcjkmpqsfvmhbo):
 *   npx tsx scripts/verify-operational-authority-rls-development.ts --execute
 */
import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import { join } from "path";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { completeEstateAgentOnboarding } from "../lib/estateAgent/completeOnboarding";
import { createEstateAgentProfile } from "../lib/estateAgent/createEstateAgentProfile";

const DEVELOPMENT_SUPABASE_PROJECT_REF = "bbbsxzxcjkmpqsfvmhbo";
const PASSWORD = "OperationalAuthorityDev123!";
const TEST_EMAIL_PREFIX = "opauth";
const TEST_DOMAIN_SUFFIX = ".opauth.test";
const GENERIC = "join_details_not_matched";
const DELAY_REASON = "Awaiting Searches";

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
    companyName: `Operational Authority Co ${label} ${ctx.stamp}`,
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

/** RLS / privilege refusal only (42501); validation or trigger errors do not count. */
function isPermissionDenied(error: { code?: string } | null): boolean {
  return error?.code === "42501";
}

async function eaChain(ctx: Ctx, ea: EaActor): Promise<{ chainId: number; accessCode: string }> {
  counter += 1;
  const suffix = `${ctx.stamp.slice(-6)}-${counter}`;
  const { data, error } = await ea.client.rpc("create_ea_operational_chain", {
    p_name: `OA EA ${suffix}`,
    p_access_code: `KN-OAE-${suffix}`.toUpperCase(),
  });
  if (error || !data?.ok) throw new Error(`create_ea_operational_chain: ${error?.message ?? data?.error}`);
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

async function claimedEaSale(
  ea: EaActor,
  homeowner: Actor,
  chainId: number,
  address: string,
  homeownerOnlyUpdates: boolean
): Promise<number> {
  const propertyId = await eaSale(ea, chainId, address, { homeownerOnlyUpdates, inviteEmail: homeowner.email });
  const claim = await rpc(homeowner.client, "claim_operational_property", {
    p_property_id: propertyId,
    p_invitation_token: null,
  });
  if (!claim?.ok) throw new Error(`claim_operational_property: ${JSON.stringify(claim)}`);
  return propertyId;
}

async function canOperate(actor: Actor, propertyId: number): Promise<boolean | null> {
  const { data, error } = await actor.client.rpc("can_operate_property", { p_property_id: propertyId });
  return error ? null : (data as boolean);
}

async function canOperateInChain(actor: Actor, chainId: number): Promise<boolean | null> {
  const { data, error } = await actor.client.rpc("can_operate_in_chain", { p_chain_id: chainId });
  return error ? null : (data as boolean);
}

async function joinChain(actor: Actor, accessCode: string, address: string, postcode: string): Promise<Rpc> {
  return rpc(actor.client, "join_chain_property", {
    p_access_code: accessCode,
    p_address: address,
    p_postcode: postcode,
  });
}

async function assign(actor: Actor, propertyId: number, branchId: string, homeownerOnlyUpdates: boolean): Promise<Rpc> {
  return rpc(actor.client, "assign_property_ea_branch", {
    p_property_id: propertyId,
    p_branch_id: branchId,
    p_homeowner_only_updates: homeownerOnlyUpdates,
  });
}

async function setPermission(actor: Actor, propertyId: number, homeownerOnlyUpdates: boolean): Promise<Rpc> {
  return rpc(actor.client, "set_property_ea_update_permission", {
    p_property_id: propertyId,
    p_homeowner_only_updates: homeownerOnlyUpdates,
  });
}

async function activeAssignments(ctx: Ctx, propertyId: number) {
  const { data } = await ctx.admin
    .from("property_ea_assignments")
    .select("id, branch_id, status, homeowner_only_updates")
    .eq("property_id", propertyId)
    .eq("status", "active");
  return (data ?? []) as { id: string; branch_id: string; status: string; homeowner_only_updates: boolean }[];
}

async function chainName(ctx: Ctx, chainId: number): Promise<string> {
  const { data } = await ctx.admin.from("chains").select("name").eq("id", chainId).single();
  return data!.name as string;
}

type ProbeOptions = {
  /** Expected can_operate_in_chain (defaults to `operate`). */
  chainOperate?: boolean;
  /** An operator of the row, used to prove a refused actor cannot resolve its delay. */
  operator?: Actor;
};

/** Runs one actor across every client write path for one row. */
async function probe(
  ctx: Ctx,
  label: string,
  actor: Actor,
  target: { propertyId: number; chainId: number },
  operate: boolean,
  options: ProbeOptions = {}
): Promise<void> {
  const chainOperate = options.chainOperate ?? operate;
  const verdict = operate ? "can" : "cannot";

  record(`${label}: can_operate_property = ${operate}`, (await canOperate(actor, target.propertyId)) === operate);

  const { data: updated, error: updateError } = await actor.client
    .from("properties")
    .update({ last_updated_days: 1 })
    .eq("id", target.propertyId)
    .select("id");
  record(
    `${label}: ${verdict} update the row directly`,
    operate ? !updateError && (updated ?? []).length === 1 : (updated ?? []).length === 0,
    updateError?.message ?? `${(updated ?? []).length} row(s)`
  );

  const { error: activityError } = await actor.client.from("activities").insert({
    property_id: target.propertyId,
    update: "Solicitors Instructed",
    updated_by: "homeowner",
  });
  record(
    `${label}: ${verdict} insert a timeline activity`,
    operate ? !activityError : isPermissionDenied(activityError),
    activityError?.message ?? "inserted"
  );

  const reported = await rpc(actor.client, "report_operational_delay", {
    p_reason: DELAY_REASON,
    p_property_id: target.propertyId,
    p_chain_node_id: null,
    p_actor_role: "homeowner",
  });
  if (operate) {
    const resolved = reported?.ok
      ? await rpc(actor.client, "resolve_operational_delay", { p_delay_id: reported.delay_id, p_actor_role: "homeowner" })
      : null;
    record(
      `${label}: can report and resolve a delay`,
      reported?.ok === true && resolved?.ok === true,
      JSON.stringify({ reported, resolved })
    );
  } else {
    record(`${label}: cannot report a delay`, reported?.ok === false && reported?.error === "forbidden", JSON.stringify(reported));
    if (options.operator) {
      const operatorDelay = await rpc(options.operator.client, "report_operational_delay", {
        p_reason: DELAY_REASON,
        p_property_id: target.propertyId,
        p_chain_node_id: null,
        p_actor_role: "homeowner",
      });
      const foreignResolve = operatorDelay?.ok
        ? await rpc(actor.client, "resolve_operational_delay", { p_delay_id: operatorDelay.delay_id, p_actor_role: "homeowner" })
        : null;
      record(
        `${label}: cannot resolve the operator's delay`,
        operatorDelay?.ok === true && foreignResolve?.ok === false && foreignResolve?.error === "forbidden",
        JSON.stringify({ operatorDelay, foreignResolve })
      );
      if (operatorDelay?.ok) {
        await rpc(options.operator.client, "resolve_operational_delay", { p_delay_id: operatorDelay.delay_id, p_actor_role: "homeowner" });
      }
    }

    const broken = await rpc(actor.client, "break_chain_connection", {
      p_property_id: target.propertyId,
      p_break_reason: "seller_side",
    });
    record(`${label}: cannot break the chain connection`, broken?.ok === false && broken?.error === "not_authorized", JSON.stringify(broken));
  }

  record(`${label}: can_operate_in_chain = ${chainOperate}`, (await canOperateInChain(actor, target.chainId)) === chainOperate);

  const name = await chainName(ctx, target.chainId);
  const { data: chainRows, error: chainError } = await actor.client
    .from("chains")
    .update({ name })
    .eq("id", target.chainId)
    .select("id");
  record(
    `${label}: ${chainOperate ? "can" : "cannot"} update the chain`,
    chainOperate ? !chainError && (chainRows ?? []).length === 1 : (chainRows ?? []).length === 0,
    chainError?.message ?? `${(chainRows ?? []).length} row(s)`
  );

  if (!chainOperate) {
    const { error: summaryError } = await actor.client.rpc("upsert_operational_summaries", {
      p_chain_summary: { chain_id: target.chainId, health_status: "healthy" },
      p_property_summaries: [],
    });
    record(
      `${label}: cannot write operational summaries`,
      !!summaryError && summaryError.message.includes("access denied"),
      summaryError?.message ?? "written"
    );
  }
}

async function runScenarios(ctx: Ctx): Promise<void> {
  const personA = await setupHomeowner(ctx, "a");
  const personB = await setupHomeowner(ctx, "b");
  const personH1 = await setupHomeowner(ctx, "h1");
  const personH2 = await setupHomeowner(ctx, "h2");
  const buyerC = await setupHomeowner(ctx, "c");
  const memberM = await setupHomeowner(ctx, "m");
  const delegateD = await setupHomeowner(ctx, "d");
  const eaA = await setupEstateAgent(ctx, "ea-a");
  const eaB = await setupEstateAgent(ctx, "ea-b");
  const eaC = await setupEstateAgent(ctx, "ea-c");

  // ---------------------------------------------------------------------------
  // OA1 — Flat 2
  // ---------------------------------------------------------------------------
  const chain1 = await eaChain(ctx, eaA);
  const house1 = await claimedEaSale(eaA, personA, chain1.chainId, `1 House One ${ctx.stamp}`, false);
  const placeholder = await rpc(eaA.client, "create_searching_placeholder_for_sale", { p_sale_property_id: house1 });
  const flatAddress = `2 Flat Two ${ctx.stamp}`;
  const converted = await rpc(eaA.client, "convert_searching_placeholder_for_sale", {
    p_sale_property_id: house1,
    p_address: flatAddress,
    p_postcode: "PO16 7AB",
  });
  const flat2 = converted?.property_id as number;
  record(
    "OA1 EA A creates Person A's awaiting Flat 2",
    placeholder?.ok === true && converted?.ok === true && typeof flat2 === "number",
    JSON.stringify({ placeholder, converted })
  );
  const flat = { propertyId: flat2, chainId: chain1.chainId };

  await probe(ctx, "OA1 EA A on Flat 2 (created it, acts for the buyer)", eaA, flat, false, { chainOperate: true });
  await probe(ctx, "OA1 Person A on Flat 2 (its buyer)", personA, flat, false, { chainOperate: true });
  for (const [label, actor] of [
    ["EA A", eaA],
    ["Person A", personA],
  ] as const) {
    const appointed = await assign(actor, flat2, eaA.branchId, false);
    record(`OA1 ${label} cannot appoint an EA to Flat 2`, appointed?.error === "not_authorized", JSON.stringify(appointed));
    const hop = await rpc(actor.client, "establish_connected_hop", { p_purchase_property_id: flat2 });
    record(`OA1 ${label} cannot run the connected hop on Flat 2`, hop?.error === "not_authorized", JSON.stringify(hop));
  }
  const eaASelfConnect = await rpc(eaA.client, "connect_ea_to_awaiting_property", {
    p_access_code: chain1.accessCode,
    p_address: flatAddress,
    p_postcode: "PO16 7AB",
    p_branch_id: eaA.branchId,
  });
  record(
    "OA1 EA A cannot take Flat 2's seller side by access code",
    eaASelfConnect?.error === GENERIC && (await activeAssignments(ctx, flat2)).length === 0,
    JSON.stringify(eaASelfConnect)
  );

  const bJoin = await joinChain(personB, chain1.accessCode, flatAddress, "PO16 7AB");
  record(
    "OA1 Person B connects to the existing awaiting Flat 2 as its seller",
    bJoin?.ok === true && bJoin?.joining_role === "seller" && bJoin?.property_id === flat2,
    JSON.stringify(bJoin)
  );
  await probe(ctx, "OA1 Person B on Flat 2 (its seller)", personB, flat, true);
  await probe(ctx, "OA1 EA A on Flat 2 after Person B connects", eaA, flat, false, { chainOperate: true, operator: personB });

  const bPicksEaA = await assign(personB, flat2, eaA.branchId, false);
  record(
    "OA1 Person B cannot appoint EA A to Flat 2 (branch_acts_for_buyer)",
    bPicksEaA?.ok === false && bPicksEaA?.error === "branch_acts_for_buyer" && (await activeAssignments(ctx, flat2)).length === 0,
    JSON.stringify(bPicksEaA)
  );
  const bPicksEaB = await assign(personB, flat2, eaB.branchId, true);
  record("OA1 Person B appoints EA B to Flat 2 (EA updates disabled)", bPicksEaB?.ok === true, JSON.stringify(bPicksEaB));
  await probe(ctx, "OA1 EA B on Flat 2, updates disabled", eaB, flat, false, { operator: personB });
  const allow = await setPermission(personB, flat2, false);
  record("OA1 Person B enables EA updates", allow?.ok === true, JSON.stringify(allow));
  await probe(ctx, "OA1 EA B on Flat 2, updates enabled", eaB, flat, true);
  const restrict = await setPermission(personB, flat2, true);
  record(
    "OA1 Person B disables EA updates again → EA B cannot operate",
    restrict?.ok === true && (await canOperate(eaB, flat2)) === false,
    JSON.stringify(restrict)
  );
  record(
    "OA1 House 1 unchanged: EA A still its only branch; Person B and EA B cannot operate it",
    (await activeAssignments(ctx, house1)).map((a) => a.branch_id).join() === eaA.branchId &&
      (await canOperate(personB, house1)) === false &&
      (await canOperate(eaB, house1)) === false &&
      (await canOperate(eaA, house1)) === true
  );
  const hopAfter = await rpc(personA.client, "establish_connected_hop", { p_purchase_property_id: flat2 });
  record("OA1 Person A still cannot run the connected hop on Flat 2", hopAfter?.error === "not_authorized", JSON.stringify(hopAfter));

  // ---------------------------------------------------------------------------
  // OA2 — the five authority states
  // ---------------------------------------------------------------------------
  const chainS1 = await eaChain(ctx, eaA);
  const s1Address = `10 State One ${ctx.stamp}`;
  const s1 = await claimedEaSale(eaA, personH1, chainS1.chainId, s1Address, false);
  const state1 = { propertyId: s1, chainId: chainS1.chainId };
  await probe(ctx, "OA2.1 homeowner (EA updates enabled)", personH1, state1, true);
  await probe(ctx, "OA2.1 EA with updates enabled", eaA, state1, true);

  const chainS2 = await eaChain(ctx, eaB);
  const s2 = await claimedEaSale(eaB, personH2, chainS2.chainId, `20 State Two ${ctx.stamp}`, true);
  const state2 = { propertyId: s2, chainId: chainS2.chainId };
  await probe(ctx, "OA2.2 homeowner (EA updates disabled)", personH2, state2, true);
  await probe(ctx, "OA2.2 EA with updates disabled", eaB, state2, false, { operator: personH2 });
  const eaGrantsItself = await setPermission(eaB, s2, false);
  record(
    "OA2.2 the EA cannot enable its own updates",
    eaGrantsItself?.error === "not_authorized" && (await canOperate(eaB, s2)) === false,
    JSON.stringify(eaGrantsItself)
  );
  const h2Allows = await setPermission(personH2, s2, false);
  record("OA2.2 homeowner enables EA updates → EA operates", h2Allows?.ok === true && (await canOperate(eaB, s2)) === true);
  const h2Restricts = await setPermission(personH2, s2, true);
  record("OA2.2 homeowner disables EA updates → EA refused again", h2Restricts?.ok === true && (await canOperate(eaB, s2)) === false);

  const chainS3 = await eaChain(ctx, eaC);
  const s3 = await eaSale(eaC, chainS3.chainId, `30 State Three ${ctx.stamp}`, { homeownerOnlyUpdates: true });
  const state3 = { propertyId: s3, chainId: chainS3.chainId };
  await probe(ctx, "OA2.3 EA on an EA-only property (homeowner-only flag set)", eaC, state3, true);
  const eaOnlyAppoint = await assign(eaC, s3, eaA.branchId, false);
  record("OA2.3 nobody can appoint on an EA-only row (EA refused)", eaOnlyAppoint?.error === "not_authorized", JSON.stringify(eaOnlyAppoint));

  const cJoin = await joinChain(buyerC, chainS1.accessCode, s1Address, "PO16 7AA");
  record("OA2.4 fixture: buyer joins state-1 sale", cJoin?.ok === true && cJoin?.joining_role === "buyer", JSON.stringify(cJoin));
  await probe(ctx, "OA2.4 connected buyer (participant)", buyerC, state1, false, { operator: personH1 });
  const buyerAppoint = await assign(buyerC, s1, eaB.branchId, false);
  record("OA2.4 connected buyer cannot appoint an EA", buyerAppoint?.error === "not_authorized", JSON.stringify(buyerAppoint));
  const buyerPermission = await setPermission(buyerC, s1, true);
  record("OA2.4 connected buyer cannot change the EA-update permission", buyerPermission?.error === "not_authorized", JSON.stringify(buyerPermission));

  const { error: memberError } = await ctx.admin
    .from("property_members")
    .insert({ property_id: s1, user_id: memberM.userId, role: "buyer" });
  record("OA2.4 fixture: plain property_members row", !memberError, memberError?.message);
  await probe(ctx, "OA2.4 plain member (viewer)", memberM, state1, false, { operator: personH1 });

  const { error: delegateError } = await ctx.admin.from("property_delegates").insert({
    property_id: s1,
    delegate_user_id: delegateD.userId,
    invited_by_user_id: personH1.userId,
    permissions: ["view", "update"],
    status: "active",
    accepted_at: new Date().toISOString(),
  });
  record("OA2.4 fixture: active property_delegates row", !delegateError, delegateError?.message);
  await probe(ctx, "OA2.4 active delegate", delegateD, state1, false, { operator: personH1 });

  await probe(ctx, "OA2.5 EA assigned to a different property (other chain)", eaC, state1, false, { operator: personH1 });
  await probe(ctx, "OA2.5 EA assigned to a different property (same chain: House 1)", eaA, flat, false, {
    chainOperate: true,
    operator: personB,
  });

  // ---------------------------------------------------------------------------
  // OA3 — Buyer Ready node
  // ---------------------------------------------------------------------------
  const { data: node, error: nodeError } = await buyerC.client
    .from("chain_nodes")
    .insert({
      chain_id: chainS1.chainId,
      linked_property_id: s1,
      node_type: "buyer_ready",
      user_id: buyerC.userId,
      position: 0,
      stage: "mortgage_preparation",
      status: "healthy",
      progress: 10,
    })
    .select("id")
    .single();
  record("OA3 the connected buyer creates their Buyer Ready node", !nodeError && !!node, nodeError?.message);
  const nodeId = node?.id as number;
  if (nodeId) {
    const { error: ownActivity } = await buyerC.client.from("activities").insert({
      chain_node_id: nodeId,
      update: "Mortgage Application",
      updated_by: "homeowner",
    });
    record("OA3 owner can add a Buyer Ready activity", !ownActivity, ownActivity?.message);
    const ownDelay = await rpc(buyerC.client, "report_operational_delay", {
      p_reason: "Awaiting Mortgage Offer",
      p_property_id: null,
      p_chain_node_id: nodeId,
      p_actor_role: "homeowner",
    });
    record("OA3 owner can report a Buyer Ready delay", ownDelay?.ok === true, JSON.stringify(ownDelay));
    const { data: ownNodeUpdate } = await buyerC.client
      .from("chain_nodes")
      .update({ progress: 20 })
      .eq("id", nodeId)
      .select("id");
    record("OA3 owner can update the node", (ownNodeUpdate ?? []).length === 1);
    record("OA3 owner can operate in the chain (Buyer Ready)", (await canOperateInChain(buyerC, chainS1.chainId)) === true);

    for (const [label, actor] of [
      ["seller homeowner", personH1],
      ["seller's EA", eaA],
      ["plain member", memberM],
    ] as const) {
      const { error: foreignActivity } = await actor.client.from("activities").insert({
        chain_node_id: nodeId,
        update: "Mortgage Application",
        updated_by: "homeowner",
      });
      record(
        `OA3 ${label} cannot add a Buyer Ready activity`,
        isPermissionDenied(foreignActivity),
        foreignActivity?.message ?? "inserted"
      );
      const foreignResolve = ownDelay?.ok
        ? await rpc(actor.client, "resolve_operational_delay", { p_delay_id: ownDelay.delay_id, p_actor_role: "homeowner" })
        : null;
      record(`OA3 ${label} cannot resolve the Buyer Ready delay`, foreignResolve?.error === "forbidden", JSON.stringify(foreignResolve));
      const { data: foreignNodeUpdate } = await actor.client
        .from("chain_nodes")
        .update({ progress: 90 })
        .eq("id", nodeId)
        .select("id");
      record(`OA3 ${label} cannot update the Buyer Ready node`, (foreignNodeUpdate ?? []).length === 0);
    }
    if (ownDelay?.ok) {
      const ownResolve = await rpc(buyerC.client, "resolve_operational_delay", { p_delay_id: ownDelay.delay_id, p_actor_role: "homeowner" });
      record("OA3 owner resolves the Buyer Ready delay", ownResolve?.ok === true, JSON.stringify(ownResolve));
    }
  }

  // ---------------------------------------------------------------------------
  // OA4 — placement: plain membership does not place rows in the chain
  // ---------------------------------------------------------------------------
  const { error: memberInsert } = await memberM.client.from("properties").insert({
    chain_id: chainS1.chainId,
    chain_position: 50,
    address: null,
    postcode: null,
    stage: "searching",
    status: "pending_connection",
    relationship_type: "purchase",
    created_by_user_id: memberM.userId,
    buyer_connected: false,
    seller_connected: true,
    is_searching: true,
  });
  record(
    "OA4 plain member cannot insert a property into the chain",
    memberInsert?.message === "properties_insert_chain_not_authorised",
    memberInsert?.message ?? "inserted"
  );
  const { error: memberNode } = await memberM.client.from("chain_nodes").insert({
    chain_id: chainS1.chainId,
    linked_property_id: s1,
    node_type: "buyer_ready",
    user_id: memberM.userId,
    position: 0,
    stage: "mortgage_preparation",
    status: "healthy",
    progress: 10,
  });
  record("OA4 plain member cannot create a Buyer Ready node in the chain", !!memberNode, memberNode?.message ?? "inserted");

  // ---------------------------------------------------------------------------
  // OA5 — appointment RPCs and direct writes
  // ---------------------------------------------------------------------------
  const { error: directInsert } = await personH1.client.from("property_ea_assignments").insert({
    property_id: s1,
    branch_id: eaB.branchId,
    status: "active",
    assigned_by_user_id: personH1.userId,
    homeowner_only_updates: true,
  });
  record("OA5 homeowner direct assignment insert refused (RPC only)", !!directInsert, directInsert?.message ?? "inserted");
  const { error: directUpdate } = await personH1.client
    .from("property_ea_assignments")
    .update({ homeowner_only_updates: true })
    .eq("property_id", s1);
  record("OA5 homeowner direct assignment update refused (RPC only)", !!directUpdate, directUpdate?.message ?? "updated");
  const { error: directDelete } = await personH1.client.from("property_ea_assignments").delete().eq("property_id", s1);
  record(
    "OA5 homeowner direct assignment delete refused (RPC only)",
    !!directDelete && (await activeAssignments(ctx, s1)).length === 1,
    directDelete?.message ?? "deleted"
  );

  const replace = await assign(personH1, s1, eaB.branchId, true);
  const afterReplace = await activeAssignments(ctx, s1);
  record(
    "OA5 homeowner replaces EA A with EA B: one active row (EA B), EA A revoked",
    replace?.ok === true &&
      replace?.replaced === true &&
      afterReplace.length === 1 &&
      afterReplace[0].branch_id === eaB.branchId &&
      afterReplace[0].homeowner_only_updates === true,
    JSON.stringify({ replace, afterReplace })
  );
  record(
    "OA5 after replacement: EA A cannot operate; EA B (updates disabled) cannot operate",
    (await canOperate(eaA, s1)) === false && (await canOperate(eaB, s1)) === false
  );
  const sameBranch = await assign(personH1, s1, eaB.branchId, false);
  record(
    "OA5 re-appointing the same branch only updates its permission",
    sameBranch?.ok === true && sameBranch?.replaced === false && (await canOperate(eaB, s1)) === true,
    JSON.stringify(sameBranch)
  );

  const anon = anonClient(ctx);
  for (const [name, args] of [
    ["assign_property_ea_branch", { p_property_id: s1, p_branch_id: eaA.branchId, p_homeowner_only_updates: false }],
    ["set_property_ea_update_permission", { p_property_id: s1, p_homeowner_only_updates: false }],
    ["can_operate_in_chain", { p_chain_id: chainS1.chainId }],
    ["owns_chain_node", { p_chain_node_id: nodeId ?? 0 }],
  ] as const) {
    const { data, error } = await anon.rpc(name, args);
    record(`OA5 anon refused: ${name}`, !!error && data == null, error?.message ?? JSON.stringify(data));
  }
  for (const [name, args] of [
    ["_address_reservation_conflict", { p_address: s1Address, p_postcode: "PO16 7AA", p_exclude_property_id: null }],
  ] as const) {
    const { data, error } = await personH1.client.rpc(name, args);
    record(`OA5 authenticated refused: ${name}`, !!error && data == null, error?.message ?? JSON.stringify(data));
  }
}

async function cleanupFixtures(ctx: Ctx): Promise<void> {
  const warn = (label: string, error: { message: string } | null) => {
    if (error) console.warn(`cleanup ${label}: ${error.message}`);
  };

  for (const chainId of ctx.chainIds) {
    const { data: props } = await ctx.admin.from("properties").select("id").eq("chain_id", chainId);
    const ids = (props ?? []).map((p) => p.id as number);

    warn("operational_delays", (await ctx.admin.from("operational_delays").delete().eq("chain_id", chainId)).error);
    const { data: nodes } = await ctx.admin.from("chain_nodes").select("id").eq("chain_id", chainId);
    const nodeIds = (nodes ?? []).map((n) => n.id as number);
    if (nodeIds.length > 0) {
      warn("node activities", (await ctx.admin.from("activities").delete().in("chain_node_id", nodeIds)).error);
    }

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
