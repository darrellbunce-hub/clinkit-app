/**
 * Start Move sale-to-onward-purchase link — live Development scenarios.
 *
 * Requires 20261010110000_link_start_move_onward_purchase.sql on Development.
 *
 *   SM1 Start Move with an onward purchase (same client calls as the page) links
 *       sale -> purchase; topology is one segment; repeating the link is a no-op
 *   SM2 Start Move without an onward purchase: sale only and buyer only create no
 *       link; the searching-placeholder path still links and converts, and the
 *       Start Move link refuses a sale already linked to its placeholder
 *   SM3 refusals change nothing: stranger, foreign purchase, cross-chain pair,
 *       reversed pair, same row, placeholder target, purchase already linked into,
 *       estate-agent account, anon
 *   SM4 failure path: a refused link followed by the page's fail() cleanup leaves
 *       no chain, rows or identities behind
 *   SM5 the purchase's seller joins by access code and establish_connected_hop
 *       runs: the link is kept; the branch acting for the homeowner's sale cannot
 *       take the purchase's seller side (branch_acts_for_buyer); another branch can
 *
 * Usage (Development ONLY — bbbsxzxcjkmpqsfvmhbo):
 *   npx tsx scripts/verify-start-move-onward-purchase-link-development.ts --execute
 */
import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import { join } from "path";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { buildChainTopology, type TopologyProperty } from "../lib/buildChainTopology";
import { createChainForOnboarding } from "../lib/createChainForOnboarding";
import { completeEstateAgentOnboarding } from "../lib/estateAgent/completeOnboarding";
import { createEstateAgentProfile } from "../lib/estateAgent/createEstateAgentProfile";
import { linkStartMoveOnwardPurchase } from "../lib/onboarding/startMoveOnwardPurchase";
import { establishOperationalHomeowner } from "../lib/ownership/grants";
import { OPERATIONAL_IDENTITY_GRANT_VIA } from "../lib/ownership/types";

const DEVELOPMENT_SUPABASE_PROJECT_REF = "bbbsxzxcjkmpqsfvmhbo";
const PASSWORD = "StartMoveLinkDev123!";
const TEST_EMAIL_PREFIX = "smlink";
const TEST_DOMAIN_SUFFIX = ".smlink.test";
const POSTCODE = "PO16 7SM";

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
    companyName: `Start Move Link Co ${label} ${ctx.stamp}`,
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

function nextAddress(ctx: Ctx, label: string): string {
  counter += 1;
  return `${counter} ${label} Link Road ${ctx.stamp.slice(-8)}`;
}

async function rpc(client: SupabaseClient, name: string, args: Record<string, unknown>): Promise<Rpc> {
  const { data, error } = await client.rpc(name, args);
  return error ? { ok: false, error: error.message } : (data as Rpc);
}

/** create_chain_for_onboarding through the page's helper. */
async function startMoveChain(ctx: Ctx, ho: Actor): Promise<{ chainId: number; accessCode: string }> {
  counter += 1;
  const result = await createChainForOnboarding(ho.client, {
    name: `CHAIN-SMLINK-${ctx.stamp.slice(-6)}-${counter}`,
    accessCode: `KN-SML-${ctx.stamp.slice(-6)}-${counter}`.toUpperCase(),
  });
  if (result.error || result.chainId == null) throw new Error(`createChainForOnboarding: ${result.error}`);
  ctx.chainIds.push(result.chainId);
  return { chainId: result.chainId, accessCode: result.accessCode! };
}

/** Same insert and identity grant as app/start-move/page.tsx. */
async function startMoveRow(
  ho: Actor,
  chainId: number,
  relationship: "sale" | "purchase",
  address: string
): Promise<number> {
  const { data, error } = await ho.client
    .from("properties")
    .insert({
      chain_id: chainId,
      chain_position: relationship === "sale" ? 1 : 2,
      address,
      postcode: POSTCODE,
      stage: relationship === "sale" ? "property_listed" : "offer_accepted",
      status: "pending_connection",
      relationship_type: relationship,
      created_by_user_id: ho.userId,
      awaiting_buyer: false,
      buyer_connected: relationship === "purchase",
      seller_connected: relationship === "sale",
      is_searching: false,
      is_current_user: true,
      last_updated_days: 0,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`${relationship} insert: ${error?.message}`);

  const { data: grant, error: grantError } = await establishOperationalHomeowner(ho.client, {
    propertyId: data.id as number,
    grantedVia: OPERATIONAL_IDENTITY_GRANT_VIA.startMove,
  });
  if (grantError || !grant.ok) {
    throw new Error(`grant ${relationship}: ${grantError?.message ?? (!grant.ok ? grant.error : "")}`);
  }
  return data.id as number;
}

async function links(ctx: Ctx, ids: number[]): Promise<Record<number, number | null>> {
  const { data } = await ctx.admin.from("properties").select("id, linked_property_id").in("id", ids);
  return Object.fromEntries((data ?? []).map((r) => [r.id as number, (r.linked_property_id as number | null) ?? null]));
}

async function topologyFor(ctx: Ctx, chainId: number) {
  const { data } = await ctx.admin
    .from("properties")
    .select("id, chain_position, stage, status, address, awaiting_buyer, is_searching, buyer_connected, seller_connected, relationship_type, linked_property_id")
    .eq("chain_id", chainId)
    .order("chain_position");
  const rows: TopologyProperty[] = (data ?? []).map((r) => ({
    id: r.id as number,
    chainPosition: r.chain_position as number,
    stage: r.stage as string,
    status: r.status as string,
    currentUserRole: null,
    lastUpdatedDays: 0,
    address: (r.address as string | null) ?? null,
    awaiting_buyer: r.awaiting_buyer as boolean,
    is_searching: r.is_searching as boolean,
    buyer_connected: r.buyer_connected as boolean,
    seller_connected: r.seller_connected as boolean,
    relationship_type: r.relationship_type as string,
    linked_property_id: (r.linked_property_id as number | null) ?? null,
  }));
  return buildChainTopology(rows, null);
}

async function runScenarios(ctx: Ctx) {
  const owner = await setupHomeowner(ctx, "owner");
  const stranger = await setupHomeowner(ctx, "stranger");
  const seller = await setupHomeowner(ctx, "seller");
  const eaA = await setupEstateAgent(ctx, "ea-a");
  const eaB = await setupEstateAgent(ctx, "ea-b");

  // SM1
  const chain1 = await startMoveChain(ctx, owner);
  const saleAddress = nextAddress(ctx, "Sale");
  const purchaseAddress = nextAddress(ctx, "Purchase");
  const sale1 = await startMoveRow(owner, chain1.chainId, "sale", saleAddress);
  const purchase1 = await startMoveRow(owner, chain1.chainId, "purchase", purchaseAddress);
  const link1 = await linkStartMoveOnwardPurchase(owner.client, {
    salePropertyId: sale1,
    purchasePropertyId: purchase1,
  });
  record("SM1 link succeeds", link1.ok && !link1.idempotent, JSON.stringify(link1));
  const after1 = await links(ctx, [sale1, purchase1]);
  record("SM1 sale.linked_property_id = purchase", after1[sale1] === purchase1, JSON.stringify(after1));
  record("SM1 purchase has no onward link", after1[purchase1] === null);
  const topo1 = await topologyFor(ctx, chain1.chainId);
  record(
    "SM1 chain topology is one segment (sale, purchase) with no awaiting-connection gap",
    topo1.segments.length === 1 &&
      topo1.segments[0].gapBefore === null &&
      topo1.segments[0].propertyNodes.map((p) => p.id).join() === `${sale1},${purchase1}`
  );
  const again = await linkStartMoveOnwardPurchase(owner.client, {
    salePropertyId: sale1,
    purchasePropertyId: purchase1,
  });
  record("SM1 repeating the link is an idempotent no-op", again.ok && again.idempotent, JSON.stringify(again));

  // SM2
  const chainSaleOnly = await startMoveChain(ctx, owner);
  const saleOnly = await startMoveRow(owner, chainSaleOnly.chainId, "sale", nextAddress(ctx, "SaleOnly"));
  record("SM2 sale-only Start Move creates its sale with no link", (await links(ctx, [saleOnly]))[saleOnly] === null);

  const chainBuyerOnly = await startMoveChain(ctx, owner);
  const buyerOnly = await startMoveRow(owner, chainBuyerOnly.chainId, "purchase", nextAddress(ctx, "BuyOnly"));
  record("SM2 buyer-only Start Move creates its purchase with no link", (await links(ctx, [buyerOnly]))[buyerOnly] === null);

  const chainSearch = await startMoveChain(ctx, owner);
  const saleSearch = await startMoveRow(owner, chainSearch.chainId, "sale", nextAddress(ctx, "SaleSearch"));
  const placeholder = await rpc(owner.client, "create_searching_placeholder_for_sale", {
    p_sale_property_id: saleSearch,
  });
  const placeholderId = placeholder?.property_id as number | undefined;
  record(
    "SM2 searching placeholder still links the sale",
    placeholder?.ok === true &&
      placeholderId != null &&
      (await links(ctx, [saleSearch]))[saleSearch] === placeholderId,
    JSON.stringify(placeholder)
  );
  const extraPurchase = await startMoveRow(owner, chainSearch.chainId, "purchase", nextAddress(ctx, "Extra"));
  const refusedPlaceholderSale = await linkStartMoveOnwardPurchase(owner.client, {
    salePropertyId: saleSearch,
    purchasePropertyId: extraPurchase,
  });
  record(
    "SM2 link refuses a sale already linked to its searching placeholder",
    !refusedPlaceholderSale.ok && refusedPlaceholderSale.error === "sale_already_linked",
    JSON.stringify(refusedPlaceholderSale)
  );
  const convertAddress = nextAddress(ctx, "Converted");
  const converted = await rpc(owner.client, "convert_searching_placeholder_for_sale", {
    p_sale_property_id: saleSearch,
    p_address: convertAddress,
    p_postcode: POSTCODE,
  });
  const { data: convertedRow } = await ctx.admin
    .from("properties")
    .select("id, stage, address, relationship_type")
    .eq("id", placeholderId ?? -1)
    .maybeSingle();
  record(
    "SM2 placeholder conversion still works and the sale stays linked to the converted row",
    converted?.ok === true &&
      (await links(ctx, [saleSearch]))[saleSearch] === placeholderId &&
      convertedRow?.stage !== "searching" &&
      convertedRow?.address === convertAddress,
    JSON.stringify(converted)
  );

  // SM3
  const chainRefusals = await startMoveChain(ctx, owner);
  const saleR = await startMoveRow(owner, chainRefusals.chainId, "sale", nextAddress(ctx, "SaleR"));
  const purchaseR = await startMoveRow(owner, chainRefusals.chainId, "purchase", nextAddress(ctx, "PurchaseR"));
  const chainOther = await startMoveChain(ctx, owner);
  const purchaseOtherChain = await startMoveRow(owner, chainOther.chainId, "purchase", nextAddress(ctx, "OtherChain"));
  const strangerChain = await startMoveChain(ctx, stranger);
  const strangerPurchase = await startMoveRow(stranger, strangerChain.chainId, "purchase", nextAddress(ctx, "Stranger"));
  const tracked = [sale1, purchase1, saleR, purchaseR, purchaseOtherChain, strangerPurchase, saleSearch, extraPurchase];
  const before = await links(ctx, tracked);

  const expectRefusal = async (label: string, client: SupabaseClient, saleId: number, purchaseId: number, error: string) => {
    const result = await linkStartMoveOnwardPurchase(client, { salePropertyId: saleId, purchasePropertyId: purchaseId });
    record(`SM3 ${label} refused (${error})`, !result.ok && result.error === error, JSON.stringify(result));
  };

  await expectRefusal("stranger linking the owner's pair", stranger.client, saleR, purchaseR, "not_authorized");
  await expectRefusal("owner linking to a stranger's purchase", owner.client, saleR, strangerPurchase, "not_authorized");
  await expectRefusal("own sale and purchase in different chains", owner.client, saleR, purchaseOtherChain, "chain_mismatch");
  await expectRefusal("reversed pair", owner.client, purchaseR, saleR, "not_authorized");
  await expectRefusal("same row twice", owner.client, saleR, saleR, "invalid_pair");
  await expectRefusal("missing row", owner.client, saleR, 9_000_000_000_000 + counter, "not_authorized");
  if (placeholderId != null) {
    const chainPlaceholderTarget = await startMoveChain(ctx, owner);
    const salePT = await startMoveRow(owner, chainPlaceholderTarget.chainId, "sale", nextAddress(ctx, "SalePT"));
    const ph = await rpc(owner.client, "create_searching_placeholder_for_sale", { p_sale_property_id: salePT });
    const salePT2 = await startMoveRow(owner, chainPlaceholderTarget.chainId, "sale", nextAddress(ctx, "SalePT2"));
    await expectRefusal("searching placeholder as the purchase", owner.client, salePT2, ph?.property_id as number, "invalid_purchase");
  }
  const secondSale = await startMoveRow(owner, chain1.chainId, "sale", nextAddress(ctx, "SecondSale"));
  await expectRefusal("purchase already linked from another sale", owner.client, secondSale, purchase1, "purchase_already_linked");
  await expectRefusal("estate-agent account", eaA.client, saleR, purchaseR, "not_authorized");
  const anonResult = await linkStartMoveOnwardPurchase(anonClient(ctx), { salePropertyId: saleR, purchasePropertyId: purchaseR });
  record("SM3 anon cannot execute the link", !anonResult.ok, JSON.stringify(anonResult));

  const afterRefusals = await links(ctx, tracked);
  record(
    "SM3 no refused call changed any link",
    JSON.stringify(before) === JSON.stringify(afterRefusals),
    `${JSON.stringify(before)} -> ${JSON.stringify(afterRefusals)}`
  );
  record("SM3 second sale left unlinked", (await links(ctx, [secondSale]))[secondSale] === null);

  // SM4
  const chainFail = await startMoveChain(ctx, owner);
  const saleF = await startMoveRow(owner, chainFail.chainId, "sale", nextAddress(ctx, "SaleF"));
  const purchaseF = await startMoveRow(owner, chainFail.chainId, "purchase", nextAddress(ctx, "PurchaseF"));
  const failedLink = await linkStartMoveOnwardPurchase(owner.client, {
    salePropertyId: saleF,
    purchasePropertyId: strangerPurchase,
  });
  const cleanup = await rpc(owner.client, "cleanup_abandoned_onboarding_chain", { p_chain_id: chainFail.chainId });
  const { count: leftRows } = await ctx.admin
    .from("properties")
    .select("id", { count: "exact", head: true })
    .in("id", [saleF, purchaseF]);
  const { count: leftIdentities } = await ctx.admin
    .from("property_operational_identities")
    .select("property_id", { count: "exact", head: true })
    .in("property_id", [saleF, purchaseF]);
  const { data: leftChain } = await ctx.admin.from("chains").select("id").eq("id", chainFail.chainId).maybeSingle();
  record(
    "SM4 refused link then fail() cleanup leaves no chain, rows or identities",
    !failedLink.ok && cleanup?.ok === true && leftRows === 0 && leftIdentities === 0 && !leftChain,
    JSON.stringify({ failedLink, cleanup, leftRows, leftIdentities, leftChain })
  );
  record(
    "SM4 the stranger's purchase was not linked or removed",
    (await links(ctx, [strangerPurchase]))[strangerPurchase] === null
  );

  // SM5
  const joined = await rpc(seller.client, "join_chain_property", {
    p_access_code: chain1.accessCode,
    p_address: purchaseAddress,
    p_postcode: POSTCODE,
  });
  record("SM5 the purchase's seller joins by access code", joined?.ok === true, JSON.stringify(joined));
  const hop = await rpc(seller.client, "establish_connected_hop", { p_purchase_property_id: purchase1 });
  record("SM5 establish_connected_hop succeeds", hop?.ok === true, JSON.stringify(hop));
  const { data: hopRows } = await ctx.admin
    .from("properties")
    .select("id, linked_property_id, seller_connected, status")
    .in("id", [sale1, purchase1]);
  const hopSale = hopRows?.find((r) => r.id === sale1);
  const hopPurchase = hopRows?.find((r) => r.id === purchase1);
  record(
    "SM5 sale stays linked to the purchase; purchase is seller-connected",
    hopSale?.linked_property_id === purchase1 && hopPurchase?.seller_connected === true,
    JSON.stringify(hopRows)
  );
  const topo5 = await topologyFor(ctx, chain1.chainId);
  record(
    "SM5 sale and purchase remain one segment after the seller connects",
    topo5.segments.some((s) => s.propertyNodes.map((p) => p.id).join().includes(`${sale1},${purchase1}`))
  );

  const appointA = await rpc(owner.client, "assign_property_ea_branch", {
    p_property_id: sale1,
    p_branch_id: eaA.branchId,
    p_homeowner_only_updates: true,
  });
  record("SM5 owner appoints EA A on their sale", appointA?.ok === true, JSON.stringify(appointA));
  const sellerAppointsA = await rpc(seller.client, "assign_property_ea_branch", {
    p_property_id: purchase1,
    p_branch_id: eaA.branchId,
    p_homeowner_only_updates: true,
  });
  record(
    "SM5 the branch acting for the owner's sale cannot take the purchase's seller side",
    sellerAppointsA?.ok === false && sellerAppointsA?.error === "branch_acts_for_buyer",
    JSON.stringify(sellerAppointsA)
  );
  const sellerAppointsB = await rpc(seller.client, "assign_property_ea_branch", {
    p_property_id: purchase1,
    p_branch_id: eaB.branchId,
    p_homeowner_only_updates: true,
  });
  record("SM5 the seller can appoint a different branch", sellerAppointsB?.ok === true, JSON.stringify(sellerAppointsB));
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
    console.log("Live Development scenarios only. Re-run with --execute after applying 20261010110000.");
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
