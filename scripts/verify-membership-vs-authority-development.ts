/**
 * Membership vs operational authority — live Development probe.
 *
 * Every check states what the authority model requires. A failing check is a write a
 * caller can make with property membership alone, without operational authority.
 * Before 20261005120000 (M3) the MA1/MA2/MA3/MA5 refusals fail; after M3 all pass.
 *
 *   MA1 link_sale_to_searching_placeholder on a homeowner sale with EA updates disabled:
 *       operational owner links; the EA is refused; a connected buyer is refused, including
 *       re-pointing a sale that is already linked
 *   MA2 direct properties writes by a connected buyer on the seller's sale
 *   MA3 EA assignment writes (direct and through the appointment RPCs) by a connected
 *       buyer; the EA cannot change its own update permission
 *   MA4 link with EA updates allowed: the authorised EA links
 *   MA5 purchase anchor: the seller links; the buyer and the buyer's EA are refused,
 *       including appointing an EA through assign_property_ea_branch
 *
 * Usage (Development ONLY — bbbsxzxcjkmpqsfvmhbo):
 *   npx tsx scripts/verify-membership-vs-authority-development.ts --execute
 */
import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import { join } from "path";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { completeEstateAgentOnboarding } from "../lib/estateAgent/completeOnboarding";
import { createEstateAgentProfile } from "../lib/estateAgent/createEstateAgentProfile";

const DEVELOPMENT_SUPABASE_PROJECT_REF = "bbbsxzxcjkmpqsfvmhbo";
const PASSWORD = "MembershipAuthorityDev123!";
const TEST_EMAIL_PREFIX = "memauth";
const TEST_DOMAIN_SUFFIX = ".memauth.test";

type TestResult = { name: string; pass: boolean; detail?: string };
const results: TestResult[] = [];

function record(name: string, pass: boolean, detail?: string) {
  results.push({ name, pass, detail });
  console.log(pass ? `✓ ${name}` : `✗ ${name}${detail ? `: ${detail}` : ""}`);
}

function note(text: string) {
  console.log(`  · ${text}`);
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
    companyName: `Membership Authority Co ${label} ${ctx.stamp}`,
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
    p_name: `MA EA ${suffix}`,
    p_access_code: `KN-MAE-${suffix}`.toUpperCase(),
  });
  if (error || !data?.ok) throw new Error(`create_ea_operational_chain: ${error?.message ?? data?.error}`);
  const chainId = data.chain_id as number;
  ctx.chainIds.push(chainId);
  const { data: chain } = await ctx.admin.from("chains").select("access_code").eq("id", chainId).single();
  return { chainId, accessCode: chain!.access_code as string };
}

async function claimedEaSale(
  ctx: Ctx,
  ea: EaActor,
  homeowner: Actor,
  chainId: number,
  address: string,
  homeownerOnlyUpdates: boolean
): Promise<number> {
  const { data, error } = await ea.client.rpc("create_ea_operational_property", {
    p_chain_id: chainId,
    p_relationship_type: "sale",
    p_address: address,
    p_postcode: "PO16 7AA",
    p_branch_id: ea.branchId,
    p_homeowner_only_updates: homeownerOnlyUpdates,
    p_invite_email: homeowner.email,
    p_awaiting_buyer: false,
  });
  if (error || !data?.ok) throw new Error(`create_ea_operational_property: ${error?.message ?? data?.error}`);
  const propertyId = data.property_id as number;
  const claim = await rpc(homeowner.client, "claim_operational_property", {
    p_property_id: propertyId,
    p_invitation_token: null,
  });
  if (!claim?.ok) throw new Error(`claim_operational_property: ${JSON.stringify(claim)}`);
  return propertyId;
}

async function joinChain(actor: Actor, accessCode: string, address: string, postcode: string): Promise<Rpc> {
  return rpc(actor.client, "join_chain_property", {
    p_access_code: accessCode,
    p_address: address,
    p_postcode: postcode,
  });
}

async function insertPlaceholder(
  actor: Actor,
  chainId: number,
  own: boolean
): Promise<{ id: number | null; error: string | null }> {
  const { data: position } = await actor.client.rpc("get_next_chain_position", { p_chain_id: chainId });
  const { data, error } = await actor.client
    .from("properties")
    .insert({
      chain_id: chainId,
      chain_position: Number(position ?? 1),
      stage: "searching",
      address: null,
      postcode: null,
      relationship_type: "purchase",
      status: "pending_connection",
      created_by_user_id: actor.userId,
      linked_property_id: null,
      awaiting_buyer: false,
      buyer_connected: false,
      seller_connected: true,
      is_searching: true,
      is_current_user: true,
      last_updated_days: 0,
    })
    .select("id")
    .single();
  if (error || !data) return { id: null, error: error?.message ?? "insert failed" };
  if (own) {
    const grant = await rpc(actor.client, "establish_operational_homeowner_for_created_property", {
      p_property_id: data.id,
    });
    if (!grant?.ok) return { id: data.id as number, error: `grant: ${JSON.stringify(grant)}` };
  }
  return { id: data.id as number, error: null };
}

async function link(actor: Actor, saleId: number, placeholderId: number | null): Promise<Rpc> {
  if (placeholderId == null) return { ok: false, error: "no_placeholder_fixture" };
  return rpc(actor.client, "link_sale_to_searching_placeholder", {
    p_sale_property_id: saleId,
    p_searching_property_id: placeholderId,
  });
}

async function linkedOf(ctx: Ctx, propertyId: number): Promise<number | null> {
  const { data } = await ctx.admin.from("properties").select("linked_property_id").eq("id", propertyId).single();
  return (data?.linked_property_id as number | null) ?? null;
}

async function canOperate(actor: Actor, propertyId: number): Promise<boolean | null> {
  const { data, error } = await actor.client.rpc("can_operate_property", { p_property_id: propertyId });
  return error ? null : (data as boolean);
}

async function count(ctx: Ctx, table: string, filters: Record<string, unknown>): Promise<number> {
  let query = ctx.admin.from(table).select("*", { count: "exact", head: true });
  for (const [key, value] of Object.entries(filters)) query = query.eq(key, value as never);
  const { count: total } = await query;
  return total ?? -1;
}

async function activeAssignment(ctx: Ctx, propertyId: number) {
  const { data } = await ctx.admin
    .from("property_ea_assignments")
    .select("id, branch_id, homeowner_only_updates")
    .eq("property_id", propertyId)
    .eq("status", "active")
    .maybeSingle();
  return data as { id: string; branch_id: string; homeowner_only_updates: boolean } | null;
}

async function runScenarios(ctx: Ctx): Promise<void> {
  const personA = await setupHomeowner(ctx, "a");
  const personB = await setupHomeowner(ctx, "b");
  const personC = await setupHomeowner(ctx, "c");
  const eaA = await setupEstateAgent(ctx, "ea-a");

  // MA1 — homeowner sale, EA updates disabled; Person C is the connected buyer
  const chainQ = await eaChain(ctx, eaA);
  const houseQAddress = `1 Quiet House ${ctx.stamp}`;
  const houseQ = await claimedEaSale(ctx, eaA, personA, chainQ.chainId, houseQAddress, true);
  const cJoinQ = await joinChain(personC, chainQ.accessCode, houseQAddress, "PO16 7AA");
  if (!cJoinQ?.ok || cJoinQ.joining_role !== "buyer") throw new Error(`buyer join: ${JSON.stringify(cJoinQ)}`);
  note(
    `fixture: Person C is the connected buyer (member: ${
      (await count(ctx, "property_members", { property_id: houseQ, user_id: personC.userId })) > 0
    }); EA A member of the sale: ${(await count(ctx, "property_members", { property_id: houseQ, user_id: eaA.userId })) > 0}`
  );

  const eaPlaceholderQ = await insertPlaceholder(eaA, chainQ.chainId, false);
  note(`EA A direct placeholder insert into the chain: ${eaPlaceholderQ.error ?? "allowed (unowned)"}`);
  const eaLinkQ = await link(eaA, houseQ, eaPlaceholderQ.id);
  record(
    "MA1 EA with EA updates disabled cannot link the sale",
    eaLinkQ?.ok !== true && (await linkedOf(ctx, houseQ)) == null,
    JSON.stringify(eaLinkQ)
  );

  const cPlaceholderQ = await insertPlaceholder(personC, chainQ.chainId, false);
  note(`Person C direct placeholder insert into the seller's chain: ${cPlaceholderQ.error ?? "allowed (unowned)"}`);
  const cLinkOwnQ = await link(personC, houseQ, cPlaceholderQ.id);
  record(
    "MA1 connected buyer cannot link the seller's sale to a placeholder",
    cLinkOwnQ?.ok !== true && (await linkedOf(ctx, houseQ)) == null,
    JSON.stringify(cLinkOwnQ)
  );
  if (cLinkOwnQ?.ok === true) {
    await ctx.admin.from("properties").update({ linked_property_id: null }).eq("id", houseQ);
  }
  const cLinkEaQ = await link(personC, houseQ, eaPlaceholderQ.id);
  record(
    "MA1 connected buyer cannot link the sale to another unowned placeholder",
    cLinkEaQ?.ok !== true && (await linkedOf(ctx, houseQ)) == null,
    JSON.stringify(cLinkEaQ)
  );
  if (cLinkEaQ?.ok === true) {
    await ctx.admin.from("properties").update({ linked_property_id: null }).eq("id", houseQ);
  }

  const aPlaceholderQ = await insertPlaceholder(personA, chainQ.chainId, true);
  const aLinkQ = await link(personA, houseQ, aPlaceholderQ.id);
  record(
    "MA1 operational owner links their sale to their own placeholder",
    aLinkQ?.ok === true && (await linkedOf(ctx, houseQ)) === aPlaceholderQ.id,
    JSON.stringify({ aLinkQ, insert: aPlaceholderQ.error })
  );

  const cRepointQ = await link(personC, houseQ, cPlaceholderQ.id);
  const linkedAfterRepoint = await linkedOf(ctx, houseQ);
  record(
    "MA1 connected buyer cannot re-point the seller's existing onward link",
    cRepointQ?.ok !== true && linkedAfterRepoint === aPlaceholderQ.id,
    JSON.stringify({ cRepointQ, linkedNowIsBuyerPlaceholder: linkedAfterRepoint === cPlaceholderQ.id })
  );
  if (linkedAfterRepoint !== aPlaceholderQ.id) {
    await ctx.admin.from("properties").update({ linked_property_id: aPlaceholderQ.id }).eq("id", houseQ);
  }

  // MA2 — direct properties writes by the connected buyer
  const { data: directLink } = await personC.client
    .from("properties")
    .update({ linked_property_id: cPlaceholderQ.id })
    .eq("id", houseQ)
    .select("id");
  const linkedAfterDirect = await linkedOf(ctx, houseQ);
  record(
    "MA2 connected buyer cannot directly re-point the seller's linked_property_id",
    (directLink ?? []).length === 0 && linkedAfterDirect === aPlaceholderQ.id,
    JSON.stringify({ rows: (directLink ?? []).length })
  );
  if (linkedAfterDirect !== aPlaceholderQ.id) {
    await ctx.admin.from("properties").update({ linked_property_id: aPlaceholderQ.id }).eq("id", houseQ);
  }
  const { data: directStage } = await personC.client
    .from("properties")
    .update({ last_updated_days: 42 })
    .eq("id", houseQ)
    .select("id");
  record(
    "MA2 connected buyer cannot directly update the seller's sale row",
    (directStage ?? []).length === 0,
    JSON.stringify({ rows: (directStage ?? []).length })
  );

  // MA3 — EA assignment writes through membership
  const { data: cFlip } = await personC.client
    .from("property_ea_assignments")
    .update({ homeowner_only_updates: false })
    .eq("property_id", houseQ)
    .eq("status", "active")
    .select("id");
  const assignmentQ = await activeAssignment(ctx, houseQ);
  record(
    "MA3 connected buyer cannot change the seller's EA-update permission",
    (cFlip ?? []).length === 0 && assignmentQ?.homeowner_only_updates === true,
    JSON.stringify({ rows: (cFlip ?? []).length, homeownerOnly: assignmentQ?.homeowner_only_updates })
  );
  const cPermissionRpc = await rpc(personC.client, "set_property_ea_update_permission", {
    p_property_id: houseQ,
    p_homeowner_only_updates: false,
  });
  const eaPermissionRpc = await rpc(eaA.client, "set_property_ea_update_permission", {
    p_property_id: houseQ,
    p_homeowner_only_updates: false,
  });
  const cAssignRpc = await rpc(personC.client, "assign_property_ea_branch", {
    p_property_id: houseQ,
    p_branch_id: eaA.branchId,
    p_homeowner_only_updates: false,
  });
  const assignmentQAfterRpc = await activeAssignment(ctx, houseQ);
  record(
    "MA3 connected buyer cannot change the EA-update permission or appoint through the RPCs",
    cPermissionRpc?.error === "not_authorized" &&
      cAssignRpc?.error === "not_authorized" &&
      assignmentQAfterRpc?.id === assignmentQ?.id &&
      assignmentQAfterRpc?.homeowner_only_updates === true,
    JSON.stringify({ cPermissionRpc, cAssignRpc })
  );
  record(
    "MA3 the EA cannot grant itself update permission",
    eaPermissionRpc?.error === "not_authorized",
    JSON.stringify(eaPermissionRpc)
  );
  const eaOperatesAfterFlip = await canOperate(eaA, houseQ);
  record("MA3 EA with updates disabled still cannot operate the sale", eaOperatesAfterFlip === false);
  if (assignmentQ && (await activeAssignment(ctx, houseQ))?.homeowner_only_updates === false) {
    await ctx.admin.from("property_ea_assignments").update({ homeowner_only_updates: true }).eq("id", assignmentQ.id);
  }

  // MA4 — EA updates allowed: the authorised EA links
  const chainP = await eaChain(ctx, eaA);
  const houseP = await claimedEaSale(ctx, eaA, personA, chainP.chainId, `1 Permitted House ${ctx.stamp}`, false);
  const eaPlaceholderP = await insertPlaceholder(eaA, chainP.chainId, false);
  const eaLinkP = await link(eaA, houseP, eaPlaceholderP.id);
  record(
    "MA4 EA with EA updates allowed links the sale",
    eaLinkP?.ok === true && (await linkedOf(ctx, houseP)) === eaPlaceholderP.id,
    JSON.stringify({ eaLinkP, insert: eaPlaceholderP.error })
  );

  // MA5 — purchase anchor (Flat): Person A is its buyer, Person B its seller
  const flatAddress = `2 Flat ${ctx.stamp}`;
  const flatConvert = await rpc(personA.client, "convert_searching_placeholder_for_sale", {
    p_sale_property_id: houseP,
    p_address: flatAddress,
    p_postcode: "PO16 7AB",
  });
  if (!flatConvert?.ok) throw new Error(`convert: ${JSON.stringify(flatConvert)}`);
  const flat = flatConvert.property_id as number;
  const bJoin = await joinChain(personB, chainP.accessCode, flatAddress, "PO16 7AB");
  if (!bJoin?.ok || bJoin.joining_role !== "seller") throw new Error(`seller join: ${JSON.stringify(bJoin)}`);

  const eaPlaceholderF = await insertPlaceholder(eaA, chainP.chainId, false);
  const eaLinkF = await link(eaA, flat, eaPlaceholderF.id);
  record(
    "MA5 the buyer's EA cannot link the purchase",
    eaLinkF?.ok !== true && (await linkedOf(ctx, flat)) == null,
    JSON.stringify(eaLinkF)
  );
  const aLinkF = await link(personA, flat, eaPlaceholderF.id);
  record(
    "MA5 the buyer (member of the purchase) cannot link the purchase",
    aLinkF?.ok !== true && (await linkedOf(ctx, flat)) == null,
    JSON.stringify(aLinkF)
  );
  if ((await linkedOf(ctx, flat)) != null) {
    await ctx.admin.from("properties").update({ linked_property_id: null }).eq("id", flat);
  }

  const { error: aAssignError } = await personA.client.from("property_ea_assignments").insert({
    property_id: flat,
    branch_id: eaA.branchId,
    status: "active",
    assigned_by_user_id: personA.userId,
    homeowner_only_updates: false,
  });
  const flatAssignment = await activeAssignment(ctx, flat);
  const eaOperatesFlat = await canOperate(eaA, flat);
  record(
    "MA5 the buyer cannot appoint an EA to the purchase",
    aAssignError != null && flatAssignment == null,
    JSON.stringify({ insertError: aAssignError?.message ?? null, assigned: flatAssignment != null })
  );
  record("MA5 the buyer's EA does not gain authority over the purchase", eaOperatesFlat === false);
  if (flatAssignment) {
    await ctx.admin.from("property_ea_assignments").delete().eq("id", flatAssignment.id);
  }
  const aAssignRpc = await rpc(personA.client, "assign_property_ea_branch", {
    p_property_id: flat,
    p_branch_id: eaA.branchId,
    p_homeowner_only_updates: false,
  });
  const eaAssignRpc = await rpc(eaA.client, "assign_property_ea_branch", {
    p_property_id: flat,
    p_branch_id: eaA.branchId,
    p_homeowner_only_updates: false,
  });
  record(
    "MA5 neither the buyer nor the buyer's EA can appoint through assign_property_ea_branch",
    aAssignRpc?.error === "not_authorized" &&
      eaAssignRpc?.error === "not_authorized" &&
      (await activeAssignment(ctx, flat)) == null,
    JSON.stringify({ aAssignRpc, eaAssignRpc })
  );
  if ((await activeAssignment(ctx, flat)) != null) {
    await ctx.admin.from("property_ea_assignments").delete().eq("property_id", flat);
  }

  const bPlaceholderF = await insertPlaceholder(personB, chainP.chainId, true);
  const bLinkF = await link(personB, flat, bPlaceholderF.id);
  record(
    "MA5 the purchase's seller links it to their own placeholder",
    bLinkF?.ok === true && (await linkedOf(ctx, flat)) === bPlaceholderF.id,
    JSON.stringify({ bLinkF, insert: bPlaceholderF.error })
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
    console.log("Live Development probe only. Re-run with --execute.");
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

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  if (failed.length > 0) {
    console.log("Authority gaps (membership alone sufficed):");
    for (const f of failed) console.log(` - ${f.name}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
