/**
 * Buyer join / Buyer Ready / chain visibility — live Development journey.
 *
 *   BJ1 EA lists "887 Jenni Road" with the seller's onward search (unowned placeholder)
 *   BJ2 buying-only homeowner: Start Move → awaiting connection → Join Chain carries
 *       "not selling"; join_chain_property (buyer) → guarded ensureBuyerReadyOnJoin
 *   BJ3 database: one Buyer Ready node for the joiner only; no seller-side identity;
 *       EA sale, assignment and placeholder unchanged; no placeholder for the buyer
 *   BJ4 authorisation: EA / outsider cannot create or edit the buyer's Buyer Ready node
 *   BJ5 perspectives (participant view + chain nodes + summaries + EA lens, as the chain
 *       page composes them): same topology, placeholder visible once to both,
 *       homeowner "Your Purchase", EA "Your Sale" + Buyer Ready
 *   BJ6 placeholder authority: the buyer cannot edit, convert or add the seller's search
 *   BJ7 onward progression: EA identifies the seller's purchase (awaiting connection);
 *       its seller joins with searching intent → connected + new searching placeholder
 *       visible to all; EA / buyer cannot edit that seller's search
 *   BJ8 a seller who is not buying gets no placeholder; a later buying-only joiner gets
 *       Buyer Ready and no placeholder
 *   BJ9 legacy join without a Buyer Ready node: EA still sees Connected Buyer
 *
 * Usage (Development ONLY — bbbsxzxcjkmpqsfvmhbo):
 *   npx tsx scripts/verify-buyer-join-buyer-ready-development.ts --execute
 */
import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import { join } from "path";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { BUYER_READY_STAGES } from "../data/buyerReadyStages";
import type { TopologyProperty } from "../lib/buildChainTopology";
import { establishConnectedHopAfterSellerJoinsPurchase } from "../lib/chainConnection";
import type { ChainNodesChainSummary } from "../lib/chainNodesSummary";
import {
  composeChainTiles,
  composedPropertyIds,
  composedTileLabels,
  type ComposedChainTile,
} from "../lib/composeChainTiles";
import { ensureBuyerReadyOnJoin } from "../lib/ensureBuyerReadyOnJoin";
import { completeEstateAgentOnboarding } from "../lib/estateAgent/completeOnboarding";
import { createEstateAgentProfile } from "../lib/estateAgent/createEstateAgentProfile";
import { loadEstateAgentOperationalAssignments } from "../lib/estateAgent/assignments";
import { resolveSearchingFromJoinIntent } from "../lib/joinChainSearching";
import {
  establishOperationalHomeowner,
  OPERATIONAL_IDENTITY_GRANT_VIA,
} from "../lib/ownership/grants";
import { attachSearchingPlaceholderToSale } from "../lib/searchingPlaceholder";
import { checkStartMoveAddress } from "../lib/onboarding/addressReservation";
import {
  buildJoinExistingChainHref,
  readJoinChainIntent,
  resolveBuyingAwaitingConnectionAction,
  shouldCreateBuyerReadyOnJoin,
} from "../lib/onboarding/joinChainIntent";
import {
  CHAIN_TILE_LABEL,
  getDashboardChainTitle,
  getParticipantPropertyLabel,
  resolveDashboardOperationalPropertyId,
  type OperationalBuyerReadyNode,
  type OperationalPosition,
  type OperationalProperty,
} from "../lib/operationalPosition";
import {
  applyOperationalSubjectLens,
  resolveOperationalSubject,
  resolveSubjectOperationalPosition,
} from "../lib/operationalSubject";

const DEVELOPMENT_SUPABASE_PROJECT_REF = "bbbsxzxcjkmpqsfvmhbo";
const PASSWORD = "BuyerJoinReadyDev123!";
const TEST_EMAIL_PREFIX = "buyerjoin";
const TEST_DOMAIN_SUFFIX = ".buyerjoin.test";
const SALE_POSTCODE = "PO16 7AA";
const FLAT_POSTCODE = "PO16 7AB";

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
    companyName: `Buyer Join Co ${label} ${ctx.stamp}`,
    branchName: `Branch ${label}`,
    townOrCity: "Fareham",
    postcode: SALE_POSTCODE,
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
    p_name: `BJ EA ${suffix}`,
    p_access_code: `KN-BJE-${suffix}`.toUpperCase(),
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
  options: { sellerNotBuying?: boolean } = {}
): Promise<number> {
  const { data, error } = await ea.client.rpc("create_ea_operational_property", {
    p_chain_id: chainId,
    p_relationship_type: "sale",
    p_address: address,
    p_postcode: SALE_POSTCODE,
    p_branch_id: ea.branchId,
    p_homeowner_only_updates: true,
    p_invite_email: null,
    p_awaiting_buyer: options.sellerNotBuying === true,
  });
  if (error || !data?.ok) throw new Error(`create_ea_operational_property: ${error?.message ?? data?.error}`);
  return data.property_id as number;
}

/** Start Move selling path: chain, sale row, operational homeowner, optional searching placeholder. */
async function homeownerStartMoveSale(
  ctx: Ctx,
  ho: Actor,
  address: string,
  options: { searching: boolean }
): Promise<{ chainId: number; accessCode: string; sale: number; search: number | null }> {
  counter += 1;
  const suffix = `${ctx.stamp.slice(-6)}-${counter}`;
  const { data: chainData, error: chainError } = await ho.client.rpc("create_chain_for_onboarding", {
    p_name: `BJ HO ${suffix}`,
    p_access_code: `KN-BJH-${suffix}`.toUpperCase(),
  });
  if (chainError || chainData?.chain_id == null) {
    throw new Error(`create_chain_for_onboarding: ${chainError?.message ?? chainData?.error}`);
  }
  const chainId = chainData.chain_id as number;
  ctx.chainIds.push(chainId);
  const { data: chain } = await ctx.admin.from("chains").select("access_code").eq("id", chainId).single();

  const { data: saleRow, error: saleError } = await ho.client
    .from("properties")
    .insert({
      chain_id: chainId,
      chain_position: 1,
      address,
      postcode: SALE_POSTCODE,
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
  if (saleError || !saleRow) throw new Error(`sale insert: ${saleError?.message}`);
  const sale = saleRow.id as number;

  const grant = await establishOperationalHomeowner(ho.client, {
    propertyId: sale,
    grantedVia: OPERATIONAL_IDENTITY_GRANT_VIA.startMove,
  });
  if (grant.error || !grant.data.ok) throw new Error("operational homeowner grant failed");

  let search: number | null = null;
  if (options.searching) {
    const attach = await attachSearchingPlaceholderToSale(ho.client, {
      chainId,
      salePropertyId: sale,
      userId: ho.userId,
    });
    if (!attach.ok) throw new Error(`attach searching placeholder: ${attach.error}`);
    search = attach.placeholderId;
  }

  return { chainId, accessCode: chain!.access_code as string, sale, search };
}

async function createPlaceholder(actor: Actor, anchorId: number): Promise<Rpc> {
  return rpc(actor.client, "create_searching_placeholder_for_sale", { p_sale_property_id: anchorId });
}

async function convert(actor: Actor, anchorId: number, address: string, postcode = FLAT_POSTCODE): Promise<Rpc> {
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
    .eq("property_id", propertyId)
    .order("id");
  return (data ?? []) as { id: string; branch_id: string; status: string; homeowner_only_updates: boolean }[];
}

async function count(ctx: Ctx, table: string, filters: Record<string, unknown>): Promise<number> {
  let query = ctx.admin.from(table).select("*", { count: "exact", head: true });
  for (const [key, value] of Object.entries(filters)) query = query.eq(key, value as never);
  const { count: total } = await query;
  return total ?? -1;
}

const PROPERTY_SNAPSHOT_COLUMNS =
  "id, chain_id, chain_position, stage, status, relationship_type, linked_property_id, is_searching, buyer_connected, seller_connected, address, postcode, created_by_user_id";

async function propertySnapshot(ctx: Ctx, propertyId: number) {
  const { data } = await ctx.admin
    .from("properties")
    .select(PROPERTY_SNAPSHOT_COLUMNS)
    .eq("id", propertyId)
    .maybeSingle();
  return data as Record<string, unknown> | null;
}

async function buyerReadyNodes(ctx: Ctx, chainId: number) {
  const { data } = await ctx.admin
    .from("chain_nodes")
    .select("id, chain_id, user_id, node_type, linked_property_id, progress, stage")
    .eq("chain_id", chainId)
    .eq("node_type", "buyer_ready");
  return (data ?? []) as {
    id: number;
    chain_id: number;
    user_id: string;
    node_type: string;
    linked_property_id: number | null;
    progress: number | null;
    stage: string | null;
  }[];
}

async function chainPropertyIds(ctx: Ctx, chainId: number): Promise<number[]> {
  const { data } = await ctx.admin.from("properties").select("id").eq("chain_id", chainId).order("id");
  return (data ?? []).map((row) => row.id as number);
}

function variant(address: string): string {
  return `  ${address.toUpperCase().replace(/ /g, "   ")} `;
}

// ---------------------------------------------------------------------------
// Perspective — mirrors ChainContext + app/chain/[chainId] tile composition
// ---------------------------------------------------------------------------

type ViewRow = TopologyProperty &
  OperationalProperty & { chainId: number; chainPosition: number };

type Perspective = {
  rows: ViewRow[];
  tiles: ComposedChainTile[];
  position: OperationalPosition | null;
  labels: string[];
  ids: number[];
};

async function loadPerspective(
  actor: Actor,
  chainId: number,
  accountType: "homeowner" | "estate_agent"
): Promise<Perspective> {
  const { data: rawRows, error } = await actor.client
    .from("chain_properties_participant")
    .select("*")
    .eq("chain_id", chainId)
    .order("chain_position");
  if (error) throw new Error(`participant view: ${error.message}`);

  const rows: ViewRow[] = (rawRows ?? []).map((row) => ({
    id: row.id,
    chainId: row.chain_id,
    chainPosition: row.chain_position,
    address: row.address ?? null,
    stage: row.stage,
    status: row.status,
    awaiting_buyer: row.awaiting_buyer ?? false,
    is_searching: row.is_searching ?? false,
    buyer_connected: row.buyer_connected ?? false,
    seller_connected: row.seller_connected ?? false,
    relationship_type: row.relationship_type ?? null,
    linked_property_id: row.linked_property_id ?? null,
    isOwnProperty: row.is_own_property ?? false,
    members: [],
    currentUserRole: row.current_user_role ?? null,
    lastUpdatedDays: 0,
  }));

  const { data: nodes } = await actor.client
    .from("chain_nodes")
    .select("id, chain_id, user_id, node_type, linked_property_id")
    .eq("chain_id", chainId);
  const { data: summaries } = await actor.client
    .from("chain_nodes_chain_summary")
    .select("*")
    .eq("chain_id", chainId)
    .eq("node_type", "buyer_ready")
    .order("position");
  const estateAgentAssignments =
    accountType === "estate_agent"
      ? await loadEstateAgentOperationalAssignments(actor.client)
      : [];

  const subject = resolveOperationalSubject({
    viewerUserId: actor.userId,
    accountType,
    chainId,
    chainProperties: rows,
    estateAgentAssignments,
  });
  const subjectRows = applyOperationalSubjectLens(rows, subject) as ViewRow[];
  const { position } = resolveSubjectOperationalPosition({
    subject,
    chainId,
    chainProperties: rows,
    chainNodes: (nodes ?? []) as OperationalBuyerReadyNode[],
  });
  const tiles = composeChainTiles({
    chainProperties: subjectRows,
    operationalPosition: position,
    buyerReadySummaries: (summaries ?? []) as ChainNodesChainSummary[],
  });

  return {
    rows,
    tiles,
    position,
    labels: composedTileLabels(tiles),
    ids: composedPropertyIds(tiles),
  };
}

function searchTiles(perspective: Perspective, placeholderId: number) {
  return perspective.tiles.filter((tile) => tile.anchorPropertyId === placeholderId && tile.kind === "property");
}

function isSearchLabel(label: string): boolean {
  return label === CHAIN_TILE_LABEL.nextHomeSearch || label === CHAIN_TILE_LABEL.sellerNextHomeSearch;
}

function hasSearchLabel(perspective: Perspective): boolean {
  return perspective.labels.some(isSearchLabel);
}

/** Searching is only ever a real placeholder row, never synthesised. */
function onlyRealSearchTiles(perspective: Perspective): boolean {
  const searchingIds = new Set(
    perspective.rows.filter((row) => row.stage === "searching" && !row.address).map((row) => row.id)
  );
  return perspective.tiles.every(
    (tile) =>
      !isSearchLabel(tile.label) ||
      (tile.kind === "property" && tile.anchorPropertyId != null && searchingIds.has(tile.anchorPropertyId))
  );
}

function sameLabels(actual: string[], expected: string[]): boolean {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

async function attemptPropertyUpdate(actor: Actor, propertyId: number) {
  const { data, error } = await actor.client
    .from("properties")
    .update({ address: `Hijack ${propertyId}` })
    .eq("id", propertyId)
    .select("id");
  return { rows: data?.length ?? 0, error: error?.message ?? null };
}

function buyerReadyInsert(chainId: number, propertyId: number, userId: string) {
  return {
    chain_id: chainId,
    linked_property_id: propertyId,
    node_type: "buyer_ready",
    user_id: userId,
    position: 0,
    stage: BUYER_READY_STAGES[0]?.value ?? "mortgage_in_principle",
    status: "healthy",
    progress: BUYER_READY_STAGES[0]?.progress ?? 10,
  };
}

/** Join Chain completion for a direct join (no source chain), as app/join-chain does it. */
async function completeDirectJoin(
  actor: Actor,
  joinResult: Rpc,
  intent: ReturnType<typeof readJoinChainIntent>
) {
  const joiningRole = joinResult?.joining_role as string;
  const property = {
    id: joinResult?.property_id as number,
    chain_id: joinResult?.chain_id as number,
    linked_property_id: (joinResult?.linked_property_id as number | null) ?? null,
  };

  if (joiningRole === "seller") {
    await establishConnectedHopAfterSellerJoinsPurchase(actor.client, property.id);
  }

  const buyerReady = shouldCreateBuyerReadyOnJoin({
    joiningRole,
    nothingToSell: intent.notSellingIntent,
  })
    ? await ensureBuyerReadyOnJoin(actor.client, {
        chainId: property.chain_id,
        purchasePropertyId: property.id,
        userId: actor.userId,
      })
    : null;

  const searching = await resolveSearchingFromJoinIntent(actor.client, {
    userId: actor.userId,
    joinedProperty: property,
    searchingIntent: intent.searchingIntent,
    migratedSearchingId: null,
  });

  return { buyerReady, searching };
}

function intentFromHref(href: string) {
  return readJoinChainIntent(new URLSearchParams(href.split("?")[1] ?? ""));
}

async function runScenarios(ctx: Ctx): Promise<void> {
  const homeowner = await setupHomeowner(ctx, "buyer");
  const onwardSeller = await setupHomeowner(ctx, "onward-seller");
  const notBuyingSeller = await setupHomeowner(ctx, "not-buying");
  const laterBuyer = await setupHomeowner(ctx, "later-buyer");
  const legacyBuyer = await setupHomeowner(ctx, "legacy-buyer");
  const outsider = await setupHomeowner(ctx, "outsider");
  const ea = await setupEstateAgent(ctx, "ea");

  // BJ1 — EA lists the sale with the seller's onward search
  const chain = await eaChain(ctx, ea);
  const saleAddress = `887 Jenni Road ${ctx.stamp}`;
  const sale = await eaSale(ea, chain.chainId, saleAddress);
  const placeholderResult = await createPlaceholder(ea, sale);
  const placeholder = placeholderResult?.property_id as number;
  record(
    "BJ1 EA adds the seller's searching placeholder (unowned)",
    placeholderResult?.ok === true && placeholderResult?.owned === false && typeof placeholder === "number",
    JSON.stringify(placeholderResult)
  );
  const saleBefore = await propertySnapshot(ctx, sale);
  const placeholderBefore = await propertySnapshot(ctx, placeholder);
  const assignmentsBefore = await assignments(ctx, sale);
  const claimMetadataBefore = await count(ctx, "property_claim_metadata", { property_id: sale });
  const saleIdentityBefore = await identity(ctx, sale);
  record("BJ1 sale links to the placeholder", saleBefore?.linked_property_id === placeholder);

  const eaBefore = await loadPerspective(ea, chain.chainId, "estate_agent");
  record(
    "BJ1 EA before join: Awaiting Buyer / Your Sale / Next Home Search",
    sameLabels(eaBefore.labels, [
      CHAIN_TILE_LABEL.awaitingBuyer,
      CHAIN_TILE_LABEL.yourSale,
      CHAIN_TILE_LABEL.nextHomeSearch,
    ]),
    JSON.stringify(eaBefore.labels)
  );

  // BJ2 — buying-only homeowner journey
  const startMoveCheck = await checkStartMoveAddress(homeowner.client, {
    address: saleAddress,
    postcode: SALE_POSTCODE,
    side: "buying",
  });
  record(
    "BJ2 Start Move: buying address is awaiting connection",
    startMoveCheck.ok === true && startMoveCheck.state === "awaiting_connection",
    JSON.stringify(startMoveCheck)
  );
  const action = resolveBuyingAwaitingConnectionAction({ hasSellingAddress: false });
  const href =
    action.kind === "join"
      ? buildJoinExistingChainHref({ sourceChainId: null, searching: false, notSelling: action.notSelling })
      : "";
  const intent = intentFromHref(href);
  record(
    "BJ2 not-selling intent passed through to Join Chain",
    action.kind === "join" && intent.notSellingIntent === true && intent.sourceChainId == null && !intent.searchingIntent,
    href
  );

  const join = await joinChain(homeowner, chain.accessCode, variant(saleAddress), "po167aa");
  record(
    "BJ2 homeowner joins 887 Jenni Road as buyer with the access code",
    join?.ok === true && join?.joining_role === "buyer" && join?.property_id === sale,
    JSON.stringify(join)
  );
  const completion = await completeDirectJoin(homeowner, join, intent);
  record(
    "BJ2 Buyer Ready created through the guarded helper",
    completion.buyerReady?.ok === true && completion.buyerReady.created === true,
    JSON.stringify(completion.buyerReady)
  );
  record("BJ2 no searching step for a buying-only join", completion.searching === null);
  const again = await ensureBuyerReadyOnJoin(homeowner.client, {
    chainId: chain.chainId,
    purchasePropertyId: sale,
    userId: homeowner.userId,
  });
  record("BJ2 Buyer Ready creation is idempotent", again.ok === true && again.created === false, JSON.stringify(again));

  // BJ3 — database state
  const nodes = await buyerReadyNodes(ctx, chain.chainId);
  const node = nodes[0];
  record(
    "BJ3 exactly one Buyer Ready node, owned by the joiner, anchored to the sale",
    nodes.length === 1 && node.user_id === homeowner.userId && node.linked_property_id === sale,
    JSON.stringify(nodes.map((n) => ({ id: n.id, linked: n.linked_property_id, own: n.user_id === homeowner.userId })))
  );
  record(
    "BJ3 buyer has no seller-side identity anywhere",
    (await count(ctx, "property_operational_identities", { homeowner_user_id: homeowner.userId })) === 0 &&
      (await sellerSideHomeowner(homeowner, sale)) === false
  );
  record(
    "BJ3 buyer is an active counterparty buyer on the sale",
    (await count(ctx, "property_counterparty_participants", {
      property_id: sale,
      user_id: homeowner.userId,
      counterparty_role: "buyer",
      status: "active",
    })) === 1
  );
  record(
    "BJ3 buyer holds only the buyer membership on the sale",
    (await count(ctx, "property_members", { user_id: homeowner.userId })) === 1 &&
      (await count(ctx, "property_members", { user_id: homeowner.userId, property_id: sale, role: "buyer" })) === 1
  );
  const saleAfter = await propertySnapshot(ctx, sale);
  record(
    "BJ3 EA sale intact (address, link, creator) and buyer connected",
    saleAfter?.address === saleBefore?.address &&
      saleAfter?.linked_property_id === placeholder &&
      saleAfter?.created_by_user_id === saleBefore?.created_by_user_id &&
      saleAfter?.relationship_type === "sale" &&
      saleAfter?.buyer_connected === true,
    JSON.stringify({ linked: saleAfter?.linked_property_id, buyer_connected: saleAfter?.buyer_connected })
  );
  record(
    "BJ3 EA assignment, claim metadata and sale identity unchanged",
    JSON.stringify(await assignments(ctx, sale)) === JSON.stringify(assignmentsBefore) &&
      (await count(ctx, "property_claim_metadata", { property_id: sale })) === claimMetadataBefore &&
      JSON.stringify(await identity(ctx, sale)) === JSON.stringify(saleIdentityBefore)
  );
  record(
    "BJ3 seller's placeholder unchanged",
    JSON.stringify(await propertySnapshot(ctx, placeholder)) === JSON.stringify(placeholderBefore)
  );
  record(
    "BJ3 no new property or placeholder for the buyer",
    JSON.stringify(await chainPropertyIds(ctx, chain.chainId)) === JSON.stringify([sale, placeholder].sort((a, b) => a - b)) &&
      (await count(ctx, "properties", { created_by_user_id: homeowner.userId })) === 0
  );
  record(
    "BJ3 buyer cannot operate the sale or the placeholder",
    (await canOperate(homeowner, sale)) === false && (await canOperate(homeowner, placeholder)) === false
  );
  record("BJ3 EA still operates its sale", (await canOperate(ea, sale)) === true);

  // BJ4 — Buyer Ready authorisation
  const eaForBuyer = await ea.client.from("chain_nodes").insert(buyerReadyInsert(chain.chainId, sale, homeowner.userId));
  record(
    "BJ4 EA cannot create a Buyer Ready node for the buyer (RLS)",
    eaForBuyer.error?.code === "42501",
    eaForBuyer.error?.code ?? "insert succeeded"
  );
  const outsiderOwn = await outsider.client
    .from("chain_nodes")
    .insert(buyerReadyInsert(chain.chainId, sale, outsider.userId));
  record(
    "BJ4 outsider cannot place a Buyer Ready node in the chain (RLS)",
    outsiderOwn.error?.code === "42501",
    outsiderOwn.error?.code ?? "insert succeeded"
  );
  const eaEdit = await ea.client.from("chain_nodes").update({ progress: 99 }).eq("id", node.id).select("id");
  const nodeAfterEdit = (await buyerReadyNodes(ctx, chain.chainId))[0];
  record(
    "BJ4 EA cannot edit the buyer's Buyer Ready node",
    (eaEdit.data?.length ?? 0) === 0 && nodeAfterEdit.progress === node.progress,
    JSON.stringify({ rows: eaEdit.data?.length ?? 0, error: eaEdit.error?.code ?? null })
  );
  record("BJ4 still exactly one Buyer Ready node", (await buyerReadyNodes(ctx, chain.chainId)).length === 1);

  // BJ5 — perspectives
  const hoView = await loadPerspective(homeowner, chain.chainId, "homeowner");
  const eaView = await loadPerspective(ea, chain.chainId, "estate_agent");
  record("BJ5 homeowner position is Buyer Ready", hoView.position?.kind === "buyer_ready", JSON.stringify(hoView.position));
  record(
    "BJ5 EA position stays its sale",
    eaView.position?.kind === "sale" && eaView.position.propertyId === sale,
    JSON.stringify(eaView.position)
  );
  record(
    "BJ5 homeowner: Buyer Ready / Your Purchase / Seller's Next Home Search",
    sameLabels(hoView.labels, [
      CHAIN_TILE_LABEL.buyerReady,
      CHAIN_TILE_LABEL.yourPurchase,
      CHAIN_TILE_LABEL.sellerNextHomeSearch,
    ]),
    JSON.stringify(hoView.labels)
  );
  record(
    "BJ5 EA: Buyer Ready / Your Sale / Next Home Search (connected state kept)",
    sameLabels(eaView.labels, [
      CHAIN_TILE_LABEL.buyerReady,
      CHAIN_TILE_LABEL.yourSale,
      CHAIN_TILE_LABEL.nextHomeSearch,
    ]),
    JSON.stringify(eaView.labels)
  );
  record(
    "BJ5 same topology for both viewers",
    JSON.stringify(hoView.ids) === JSON.stringify([sale, placeholder]) &&
      JSON.stringify(eaView.ids) === JSON.stringify(hoView.ids),
    JSON.stringify({ ho: hoView.ids, ea: eaView.ids })
  );
  record(
    "BJ5 placeholder visible exactly once to each viewer; every Searching tile is a real row",
    searchTiles(hoView, placeholder).length === 1 &&
      searchTiles(eaView, placeholder).length === 1 &&
      onlyRealSearchTiles(hoView) &&
      onlyRealSearchTiles(eaView)
  );
  const hoDashboardOperationalId = resolveDashboardOperationalPropertyId(hoView.rows);
  const hoSaleRow = hoView.rows.find((row) => row.id === sale)!;
  record(
    "BJ5 homeowner dashboard: chain titled by the purchase, row 'Your Purchase — address'",
    getDashboardChainTitle(chain.chainId, hoView.rows, hoDashboardOperationalId) === saleAddress &&
      getParticipantPropertyLabel(hoSaleRow, hoDashboardOperationalId) ===
        `${CHAIN_TILE_LABEL.yourPurchase} — ${saleAddress}`,
    getParticipantPropertyLabel(hoSaleRow, hoDashboardOperationalId).replace(ctx.stamp, "<stamp>")
  );

  // BJ6 — placeholder authority
  const hoPlaceholderEdit = await attemptPropertyUpdate(homeowner, placeholder);
  record(
    "BJ6 buyer cannot edit the seller's placeholder",
    hoPlaceholderEdit.rows === 0 &&
      JSON.stringify(await propertySnapshot(ctx, placeholder)) === JSON.stringify(placeholderBefore),
    JSON.stringify(hoPlaceholderEdit)
  );
  const hoConvert = await convert(homeowner, sale, `Buyer Pick ${ctx.stamp}`);
  record(
    "BJ6 buyer cannot convert the seller's placeholder",
    hoConvert?.ok === false && hoConvert?.error === "not_authorized",
    JSON.stringify(hoConvert)
  );
  const hoCreate = await createPlaceholder(homeowner, sale);
  record(
    "BJ6 buyer cannot add a search for the seller's sale",
    hoCreate?.ok === false && hoCreate?.error === "not_authorized",
    JSON.stringify(hoCreate)
  );
  record(
    "BJ6 placeholder still not duplicated",
    JSON.stringify(await chainPropertyIds(ctx, chain.chainId)) === JSON.stringify([sale, placeholder].sort((a, b) => a - b))
  );

  // BJ7 — onward progression: identified → awaiting connection → connected → searching
  const flatAddress = `Flat 1 Onward Court ${ctx.stamp}`;
  const flatConvert = await convert(ea, sale, flatAddress);
  const flat = flatConvert?.property_id as number;
  record(
    "BJ7 EA identifies the seller's onward purchase",
    flatConvert?.ok === true && typeof flat === "number",
    JSON.stringify(flatConvert)
  );
  record("BJ7 onward purchase is awaiting its seller", (await adminState(ctx, flat)) === "awaiting_seller");
  record("BJ7 EA gains no authority on the onward purchase", (await canOperate(ea, flat)) === false && (await assignments(ctx, flat)).length === 0);

  const hoAwaiting = await loadPerspective(homeowner, chain.chainId, "homeowner");
  const eaAwaiting = await loadPerspective(ea, chain.chainId, "estate_agent");
  record(
    "BJ7 homeowner (awaiting connection): Buyer Ready / Your Purchase / Connected Purchase",
    sameLabels(hoAwaiting.labels, [
      CHAIN_TILE_LABEL.buyerReady,
      CHAIN_TILE_LABEL.yourPurchase,
      CHAIN_TILE_LABEL.connectedPurchase,
    ]),
    JSON.stringify(hoAwaiting.labels)
  );
  record(
    "BJ7 EA (awaiting connection): Buyer Ready / Your Sale / Your Purchase",
    sameLabels(eaAwaiting.labels, [
      CHAIN_TILE_LABEL.buyerReady,
      CHAIN_TILE_LABEL.yourSale,
      CHAIN_TILE_LABEL.yourPurchase,
    ]),
    JSON.stringify(eaAwaiting.labels)
  );
  record(
    "BJ7 same topology while awaiting connection",
    JSON.stringify(hoAwaiting.ids) === JSON.stringify(eaAwaiting.ids) && hoAwaiting.ids.includes(flat),
    JSON.stringify({ ho: hoAwaiting.ids, ea: eaAwaiting.ids })
  );

  const sellerHref = buildJoinExistingChainHref({ sourceChainId: null, searching: true, notSelling: false });
  const sellerIntent = intentFromHref(sellerHref);
  const sellerJoin = await joinChain(onwardSeller, chain.accessCode, flatAddress, FLAT_POSTCODE);
  record(
    "BJ7 the onward purchase's seller joins with the access code",
    sellerJoin?.ok === true && sellerJoin?.joining_role === "seller" && sellerJoin?.property_id === flat,
    JSON.stringify(sellerJoin)
  );
  const sellerCompletion = await completeDirectJoin(onwardSeller, sellerJoin, sellerIntent);
  const sellerSearch = sellerCompletion.searching?.ok ? sellerCompletion.searching.searchingId : null;
  record(
    "BJ7 seller's searching intent creates their placeholder; no Buyer Ready for a seller",
    sellerSearch != null && sellerCompletion.buyerReady === null,
    JSON.stringify(sellerCompletion)
  );
  record("BJ7 onward purchase connected", (await adminState(ctx, flat)) === "live_homeowner");
  record(
    "BJ7 still exactly one Buyer Ready node (the buyer's)",
    (await buyerReadyNodes(ctx, chain.chainId)).length === 1
  );

  if (sellerSearch != null) {
    const hoConnected = await loadPerspective(homeowner, chain.chainId, "homeowner");
    const eaConnected = await loadPerspective(ea, chain.chainId, "estate_agent");
    const sellerConnected = await loadPerspective(onwardSeller, chain.chainId, "homeowner");
    record(
      "BJ7 all three viewers see the same topology (sale → flat → seller's search)",
      JSON.stringify(hoConnected.ids) === JSON.stringify([sale, flat, sellerSearch]) &&
        JSON.stringify(eaConnected.ids) === JSON.stringify(hoConnected.ids) &&
        JSON.stringify(sellerConnected.ids) === JSON.stringify(hoConnected.ids),
      JSON.stringify({ ho: hoConnected.ids, ea: eaConnected.ids, seller: sellerConnected.ids })
    );
    record(
      "BJ7 homeowner: Buyer Ready / Your Purchase / Connected Purchase / Seller's Next Home Search",
      sameLabels(hoConnected.labels, [
        CHAIN_TILE_LABEL.buyerReady,
        CHAIN_TILE_LABEL.yourPurchase,
        CHAIN_TILE_LABEL.connectedPurchase,
        CHAIN_TILE_LABEL.sellerNextHomeSearch,
      ]),
      JSON.stringify(hoConnected.labels)
    );
    record(
      "BJ7 EA: Buyer Ready / Your Sale / Your Purchase / Seller's Next Home Search",
      sameLabels(eaConnected.labels, [
        CHAIN_TILE_LABEL.buyerReady,
        CHAIN_TILE_LABEL.yourSale,
        CHAIN_TILE_LABEL.yourPurchase,
        CHAIN_TILE_LABEL.sellerNextHomeSearch,
      ]),
      JSON.stringify(eaConnected.labels)
    );
    record(
      "BJ7 onward seller: Buyer Ready / Connected Buyer / Your Sale / Next Home Search",
      sameLabels(sellerConnected.labels, [
        CHAIN_TILE_LABEL.buyerReady,
        CHAIN_TILE_LABEL.connectedBuyer,
        CHAIN_TILE_LABEL.yourSale,
        CHAIN_TILE_LABEL.nextHomeSearch,
      ]),
      JSON.stringify(sellerConnected.labels)
    );
    record(
      "BJ7 the seller's new search is shown exactly once to every viewer",
      [hoConnected, eaConnected, sellerConnected].every((view) => searchTiles(view, sellerSearch).length === 1)
    );

    const sellerSearchBefore = await propertySnapshot(ctx, sellerSearch);
    const eaSearchEdit = await attemptPropertyUpdate(ea, sellerSearch);
    const hoSearchEdit = await attemptPropertyUpdate(homeowner, sellerSearch);
    record(
      "BJ7 EA and buyer cannot edit the onward seller's search",
      eaSearchEdit.rows === 0 &&
        hoSearchEdit.rows === 0 &&
        JSON.stringify(await propertySnapshot(ctx, sellerSearch)) === JSON.stringify(sellerSearchBefore),
      JSON.stringify({ ea: eaSearchEdit, ho: hoSearchEdit })
    );
    const eaConvertOnward = await convert(ea, flat, `EA Pick ${ctx.stamp}`, "PO16 7AC");
    const hoConvertOnward = await convert(homeowner, flat, `Buyer Pick 2 ${ctx.stamp}`, "PO16 7AC");
    record(
      "BJ7 EA and buyer cannot convert the onward seller's search",
      eaConvertOnward?.ok === false &&
        eaConvertOnward?.error === "not_authorized" &&
        hoConvertOnward?.ok === false &&
        hoConvertOnward?.error === "not_authorized",
      JSON.stringify({ ea: eaConvertOnward, ho: hoConvertOnward })
    );
    const sellerSearchIdentity = await identity(ctx, sellerSearch);
    record(
      "BJ7 the new search is owned by the onward seller (not the EA or the buyer)",
      sellerSearchIdentity?.homeowner_user_id === onwardSeller.userId && sellerSearchIdentity?.status === "active",
      JSON.stringify({ owned: sellerSearchIdentity?.homeowner_user_id === onwardSeller.userId, status: sellerSearchIdentity?.status })
    );
  }

  // BJ8 — not buying: no placeholder; later buying-only joiner: Buyer Ready, no placeholder
  const chainB = await eaChain(ctx, ea);
  const saleBAddress = `887 Jenni Road B ${ctx.stamp}`;
  const saleB = await eaSale(ea, chainB.chainId, saleBAddress);
  await createPlaceholder(ea, saleB);
  const flatBAddress = `Flat 2 Onward Court ${ctx.stamp}`;
  const flatBConvert = await convert(ea, saleB, flatBAddress);
  const flatB = flatBConvert?.property_id as number;
  const notBuyingIntent = intentFromHref(
    buildJoinExistingChainHref({ sourceChainId: null, searching: false, notSelling: false })
  );
  const notBuyingJoin = await joinChain(notBuyingSeller, chainB.accessCode, flatBAddress, FLAT_POSTCODE);
  const notBuyingCompletion = await completeDirectJoin(notBuyingSeller, notBuyingJoin, notBuyingIntent);
  record(
    "BJ8 seller who is not buying joins; no searching step",
    notBuyingJoin?.ok === true && notBuyingJoin?.joining_role === "seller" && notBuyingCompletion.searching === null,
    JSON.stringify({ notBuyingJoin, notBuyingCompletion })
  );
  record(
    "BJ8 no placeholder created for the seller who is not buying",
    JSON.stringify(await chainPropertyIds(ctx, chainB.chainId)) === JSON.stringify([saleB, flatB].sort((a, b) => a - b)) &&
      (await count(ctx, "properties", { created_by_user_id: notBuyingSeller.userId })) === 0
  );

  const laterAction = resolveBuyingAwaitingConnectionAction({ hasSellingAddress: false });
  const laterIntent = intentFromHref(
    buildJoinExistingChainHref({
      sourceChainId: null,
      searching: false,
      notSelling: laterAction.kind === "join" && laterAction.notSelling,
    })
  );
  const laterJoin = await joinChain(laterBuyer, chainB.accessCode, saleBAddress, SALE_POSTCODE);
  const laterCompletion = await completeDirectJoin(laterBuyer, laterJoin, laterIntent);
  record(
    "BJ8 later buying-only joiner gets Buyer Ready and no placeholder",
    laterJoin?.ok === true &&
      laterCompletion.buyerReady?.ok === true &&
      laterCompletion.searching === null &&
      (await count(ctx, "properties", { created_by_user_id: laterBuyer.userId })) === 0 &&
      (await chainPropertyIds(ctx, chainB.chainId)).length === 2,
    JSON.stringify(laterCompletion)
  );
  const sellerBView = await loadPerspective(notBuyingSeller, chainB.chainId, "homeowner");
  const laterView = await loadPerspective(laterBuyer, chainB.chainId, "homeowner");
  const eaBView = await loadPerspective(ea, chainB.chainId, "estate_agent");
  record(
    "BJ8 chain ends at the flat for every viewer (no Searching tile)",
    [sellerBView, laterView, eaBView].every(
      (view) =>
        JSON.stringify(view.ids) === JSON.stringify([saleB, flatB]) && !hasSearchLabel(view)
    ),
    JSON.stringify({ seller: sellerBView.labels, buyer: laterView.labels, ea: eaBView.labels })
  );

  // BJ9 — legacy join without a Buyer Ready node
  const chainC = await eaChain(ctx, ea);
  const saleCAddress = `887 Jenni Road C ${ctx.stamp}`;
  const saleC = await eaSale(ea, chainC.chainId, saleCAddress);
  const placeholderC = (await createPlaceholder(ea, saleC))?.property_id as number;
  const legacyJoin = await joinChain(legacyBuyer, chainC.accessCode, saleCAddress, SALE_POSTCODE);
  const legacyCompletion = await completeDirectJoin(legacyBuyer, legacyJoin, intentFromHref("/join-chain"));
  record(
    "BJ9 legacy fixture: buyer joined without a Buyer Ready node",
    legacyJoin?.ok === true &&
      legacyCompletion.buyerReady === null &&
      (await buyerReadyNodes(ctx, chainC.chainId)).length === 0
  );
  const eaLegacy = await loadPerspective(ea, chainC.chainId, "estate_agent");
  const hoLegacy = await loadPerspective(legacyBuyer, chainC.chainId, "homeowner");
  record(
    "BJ9 EA still sees the connected buyer: Connected Buyer / Your Sale / Next Home Search",
    sameLabels(eaLegacy.labels, [
      CHAIN_TILE_LABEL.connectedBuyer,
      CHAIN_TILE_LABEL.yourSale,
      CHAIN_TILE_LABEL.nextHomeSearch,
    ]),
    JSON.stringify(eaLegacy.labels)
  );
  record(
    "BJ9 buyer sees Your Purchase / Seller's Next Home Search (no Connected Buyer for themself)",
    sameLabels(hoLegacy.labels, [CHAIN_TILE_LABEL.yourPurchase, CHAIN_TILE_LABEL.sellerNextHomeSearch]) &&
      searchTiles(hoLegacy, placeholderC).length === 1,
    JSON.stringify(hoLegacy.labels)
  );

  const buyingOnlyIntent = () => {
    const buyingAction = resolveBuyingAwaitingConnectionAction({ hasSellingAddress: false });
    return intentFromHref(
      buildJoinExistingChainHref({
        sourceChainId: null,
        searching: false,
        notSelling: buyingAction.kind === "join" && buyingAction.notSelling,
      })
    );
  };

  // BJ10 — EA sale, seller not buying, no buyer yet: Awaiting Buyer, no Searching
  const notBuyingBuyer = await setupHomeowner(ctx, "nb-buyer");
  const chainD = await eaChain(ctx, ea);
  const saleDAddress = `5 Agent Row ${ctx.stamp}`;
  const saleD = await eaSale(ea, chainD.chainId, saleDAddress, { sellerNotBuying: true });
  const eaNoBuyer = await loadPerspective(ea, chainD.chainId, "estate_agent");
  record(
    "BJ10 EA sale, seller not buying, no buyer: Awaiting Buyer / Your Sale (no Searching tile)",
    sameLabels(eaNoBuyer.labels, [CHAIN_TILE_LABEL.awaitingBuyer, CHAIN_TILE_LABEL.yourSale]) &&
      JSON.stringify(await chainPropertyIds(ctx, chainD.chainId)) === JSON.stringify([saleD]),
    JSON.stringify(eaNoBuyer.labels)
  );
  const joinD = await joinChain(notBuyingBuyer, chainD.accessCode, saleDAddress, SALE_POSTCODE);
  const completionD = await completeDirectJoin(notBuyingBuyer, joinD, buyingOnlyIntent());
  const eaJoinedD = await loadPerspective(ea, chainD.chainId, "estate_agent");
  const buyerJoinedD = await loadPerspective(notBuyingBuyer, chainD.chainId, "homeowner");
  record(
    "BJ10 buyer joins: EA sees Buyer Ready / Your Sale (Awaiting Buyer replaced)",
    joinD?.ok === true &&
      completionD.buyerReady?.ok === true &&
      sameLabels(eaJoinedD.labels, [CHAIN_TILE_LABEL.buyerReady, CHAIN_TILE_LABEL.yourSale]),
    JSON.stringify(eaJoinedD.labels)
  );
  record(
    "BJ10 not-selling buyer: Buyer Ready / Your Purchase, nothing beyond either side",
    sameLabels(buyerJoinedD.labels, [CHAIN_TILE_LABEL.buyerReady, CHAIN_TILE_LABEL.yourPurchase]) &&
      JSON.stringify(await chainPropertyIds(ctx, chainD.chainId)) === JSON.stringify([saleD]),
    JSON.stringify(buyerJoinedD.labels)
  );

  // BJ11 — homeowner-created sale + homeowner-owned search, with an appointed EA
  const hoSeller = await setupHomeowner(ctx, "ho-seller");
  const hoBuyer = await setupHomeowner(ctx, "ho-buyer");
  const hoOnwardSeller = await setupHomeowner(ctx, "ho-onward");
  const hoSaleAddress = `12 Homeowner Close ${ctx.stamp}`;
  const hoChain = await homeownerStartMoveSale(ctx, hoSeller, hoSaleAddress, { searching: true });
  const hoSearch = hoChain.search!;
  const hoSearchIdentity = await identity(ctx, hoSearch);
  record(
    "BJ11 homeowner-created search is owned by the homeowner seller",
    hoSearchIdentity?.homeowner_user_id === hoSeller.userId && hoSearchIdentity?.status === "active"
  );
  const appoint = await rpc(hoSeller.client, "assign_property_ea_branch", {
    p_property_id: hoChain.sale,
    p_branch_id: ea.branchId,
    p_homeowner_only_updates: true,
  });
  record("BJ11 homeowner appoints the EA (homeowner-only updates)", appoint?.ok === true, JSON.stringify(appoint));

  const sellerNoBuyer = await loadPerspective(hoSeller, hoChain.chainId, "homeowner");
  const eaNoBuyerHo = await loadPerspective(ea, hoChain.chainId, "estate_agent");
  const awaitingWithSearch = [
    CHAIN_TILE_LABEL.awaitingBuyer,
    CHAIN_TILE_LABEL.yourSale,
    CHAIN_TILE_LABEL.nextHomeSearch,
  ];
  record(
    "BJ11 homeowner sale + searching, no buyer: Awaiting Buyer / Your Sale / Next Home Search",
    sameLabels(sellerNoBuyer.labels, awaitingWithSearch),
    JSON.stringify(sellerNoBuyer.labels)
  );
  record(
    "BJ11 homeowner-created search visible to the EA (same tiles)",
    sameLabels(eaNoBuyerHo.labels, awaitingWithSearch) &&
      JSON.stringify(eaNoBuyerHo.ids) === JSON.stringify(sellerNoBuyer.ids) &&
      onlyRealSearchTiles(eaNoBuyerHo),
    JSON.stringify(eaNoBuyerHo.labels)
  );
  const hoSearchBefore = await propertySnapshot(ctx, hoSearch);
  const eaHoSearchEdit = await attemptPropertyUpdate(ea, hoSearch);
  const eaHoConvert = await convert(ea, hoChain.sale, `EA Pick HO ${ctx.stamp}`);
  record(
    "BJ11 EA cannot edit or convert the homeowner's search (homeowner-only updates)",
    eaHoSearchEdit.rows === 0 &&
      eaHoConvert?.ok === false &&
      eaHoConvert?.error === "not_authorized" &&
      JSON.stringify(await propertySnapshot(ctx, hoSearch)) === JSON.stringify(hoSearchBefore),
    JSON.stringify({ edit: eaHoSearchEdit, convert: eaHoConvert })
  );
  record("BJ11 EA cannot operate the homeowner's sale", (await canOperate(ea, hoChain.sale)) === false);

  const hoJoin = await joinChain(hoBuyer, hoChain.accessCode, variant(hoSaleAddress), "po167aa");
  const hoJoinCompletion = await completeDirectJoin(hoBuyer, hoJoin, buyingOnlyIntent());
  record(
    "BJ11 buying-only buyer joins the homeowner's sale with the access code; Buyer Ready created",
    hoJoin?.ok === true && hoJoin?.joining_role === "buyer" && hoJoinCompletion.buyerReady?.ok === true,
    JSON.stringify({ hoJoin, buyerReady: hoJoinCompletion.buyerReady })
  );
  const sellerJoined = await loadPerspective(hoSeller, hoChain.chainId, "homeowner");
  const eaJoinedHo = await loadPerspective(ea, hoChain.chainId, "estate_agent");
  const buyerJoinedHo = await loadPerspective(hoBuyer, hoChain.chainId, "homeowner");
  const readyWithSearch = [CHAIN_TILE_LABEL.buyerReady, CHAIN_TILE_LABEL.yourSale, CHAIN_TILE_LABEL.nextHomeSearch];
  record(
    "BJ11 seller and EA: Buyer Ready / Your Sale / Next Home Search (no Awaiting Buyer left)",
    sameLabels(sellerJoined.labels, readyWithSearch) && sameLabels(eaJoinedHo.labels, readyWithSearch),
    JSON.stringify({ seller: sellerJoined.labels, ea: eaJoinedHo.labels })
  );
  record(
    "BJ11 buyer: Buyer Ready / Your Purchase / Seller's Next Home Search",
    sameLabels(buyerJoinedHo.labels, [
      CHAIN_TILE_LABEL.buyerReady,
      CHAIN_TILE_LABEL.yourPurchase,
      CHAIN_TILE_LABEL.sellerNextHomeSearch,
    ]),
    JSON.stringify(buyerJoinedHo.labels)
  );
  const buyerHoSearchEdit = await attemptPropertyUpdate(hoBuyer, hoSearch);
  const buyerHoConvert = await convert(hoBuyer, hoChain.sale, `Buyer Pick HO ${ctx.stamp}`);
  record(
    "BJ11 buyer cannot edit or convert the seller's search; buyer has no seller authority",
    buyerHoSearchEdit.rows === 0 &&
      buyerHoConvert?.ok === false &&
      (await canOperate(hoBuyer, hoChain.sale)) === false &&
      (await sellerSideHomeowner(hoBuyer, hoChain.sale)) === false,
    JSON.stringify({ edit: buyerHoSearchEdit, convert: buyerHoConvert })
  );

  const hoFlatAddress = `Flat 3 Onward Court ${ctx.stamp}`;
  const hoFlatConvert = await convert(hoSeller, hoChain.sale, hoFlatAddress);
  const hoFlat = hoFlatConvert?.property_id as number;
  record(
    "BJ11 homeowner identifies their onward purchase → awaiting connection",
    hoFlatConvert?.ok === true && (await adminState(ctx, hoFlat)) === "awaiting_seller",
    JSON.stringify(hoFlatConvert)
  );
  record(
    "BJ11 EA gains no authority or assignment on the homeowner's onward purchase",
    (await canOperate(ea, hoFlat)) === false && (await assignments(ctx, hoFlat)).length === 0
  );
  const sellerAwaiting = await loadPerspective(hoSeller, hoChain.chainId, "homeowner");
  record(
    "BJ11 seller sees Buyer Ready / Your Sale / Your Purchase while awaiting connection",
    sameLabels(sellerAwaiting.labels, [
      CHAIN_TILE_LABEL.buyerReady,
      CHAIN_TILE_LABEL.yourSale,
      CHAIN_TILE_LABEL.yourPurchase,
    ]),
    JSON.stringify(sellerAwaiting.labels)
  );

  const onwardJoin = await joinChain(hoOnwardSeller, hoChain.accessCode, hoFlatAddress, FLAT_POSTCODE);
  const onwardCompletion = await completeDirectJoin(
    hoOnwardSeller,
    onwardJoin,
    intentFromHref(buildJoinExistingChainHref({ sourceChainId: null, searching: true, notSelling: false }))
  );
  const onwardSearch = onwardCompletion.searching?.ok ? onwardCompletion.searching.searchingId : null;
  record(
    "BJ11 onward seller joins → connected, and their searching placeholder is created",
    onwardJoin?.ok === true &&
      onwardJoin?.joining_role === "seller" &&
      (await adminState(ctx, hoFlat)) === "live_homeowner" &&
      onwardSearch != null,
    JSON.stringify({ onwardJoin, searching: onwardCompletion.searching })
  );
  if (onwardSearch != null) {
    const views = await Promise.all([
      loadPerspective(hoSeller, hoChain.chainId, "homeowner"),
      loadPerspective(hoBuyer, hoChain.chainId, "homeowner"),
      loadPerspective(ea, hoChain.chainId, "estate_agent"),
      loadPerspective(hoOnwardSeller, hoChain.chainId, "homeowner"),
    ]);
    record(
      "BJ11 seller, buyer, EA and onward seller see the same topology and the onward search once",
      views.every(
        (view) =>
          JSON.stringify(view.ids) === JSON.stringify([hoChain.sale, hoFlat, onwardSearch]) &&
          searchTiles(view, onwardSearch).length === 1 &&
          onlyRealSearchTiles(view)
      ),
      JSON.stringify(views.map((view) => view.labels))
    );
    record(
      "BJ11 onward seller labels their own search Next Home Search; others see Seller's Next Home Search",
      views[3].labels.at(-1) === CHAIN_TILE_LABEL.nextHomeSearch &&
        views.slice(0, 3).every((view) => view.labels.at(-1) === CHAIN_TILE_LABEL.sellerNextHomeSearch),
      JSON.stringify(views.map((view) => view.labels.at(-1)))
    );
    const eaOnwardEdit = await attemptPropertyUpdate(ea, onwardSearch);
    const sellerOnwardEdit = await attemptPropertyUpdate(hoSeller, onwardSearch);
    const eaOnwardConvert = await convert(ea, hoFlat, `EA Pick Onward ${ctx.stamp}`, "PO16 7AC");
    record(
      "BJ11 EA and the original seller cannot edit or convert the onward seller's search",
      eaOnwardEdit.rows === 0 &&
        sellerOnwardEdit.rows === 0 &&
        eaOnwardConvert?.ok === false &&
        eaOnwardConvert?.error === "not_authorized",
      JSON.stringify({ ea: eaOnwardEdit, seller: sellerOnwardEdit, convert: eaOnwardConvert })
    );
  }
}

async function cleanupFixtures(ctx: Ctx): Promise<void> {
  const warn = (label: string, error: { message: string } | null) => {
    if (error) console.warn(`cleanup ${label}: ${error.message}`);
  };

  for (const chainId of ctx.chainIds) {
    const { data: nodes } = await ctx.admin.from("chain_nodes").select("id").eq("chain_id", chainId);
    const nodeIds = (nodes ?? []).map((n) => n.id as number);
    if (nodeIds.length > 0) {
      warn("node activities", (await ctx.admin.from("activities").delete().in("chain_node_id", nodeIds)).error);
      warn("node delays", (await ctx.admin.from("operational_delays").delete().in("chain_node_id", nodeIds)).error);
    }
    warn("chain_nodes", (await ctx.admin.from("chain_nodes").delete().eq("chain_id", chainId)).error);

    const { data: props } = await ctx.admin.from("properties").select("id").eq("chain_id", chainId);
    const ids = (props ?? []).map((p) => p.id as number);

    if (ids.length > 0) {
      for (const table of [
        "activities",
        "operational_delays",
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
    console.log("Live Development scenarios only. Re-run with --execute.");
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
