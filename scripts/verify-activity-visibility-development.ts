/**
 * Chain activity visibility / Buyer Ready activity coverage — live Development.
 *
 *   AV  chain shaped like a real EA listing joined by a selling homeowner:
 *         EA sale ← homeowner's own sale (moved in by Join Chain), EA sale → seller's
 *         purchase joined by a distant homeowner. Activities by the homeowner (own
 *         sale), the EA, the distant homeowner and the system.
 *       1 homeowner activity on their own sale is visible to the assigned EA
 *       2 … and to an authorised distant homeowner
 *       3 EA activity remains visible
 *       4 system activity is visible to participants only
 *       5 outsiders (homeowner, other EA, anon) see nothing
 *       6 activity rows carry only activity columns — no address / postcode
 *       7 properties RLS unchanged (hidden rows stay hidden; participant view still
 *         masks address / postcode)
 *       8 chain participant visibility unchanged
 *       + chain page timeline (as ChainContext + chain page compose it): same
 *         activities for every participant, labels equal tile titles, no address
 *   BR  two Buyer Ready steps in one chain: single step, multiple steps, own step,
 *       another participant's step, EA view, homeowner view, no duplicates,
 *       outsiders excluded
 *
 * Usage (Development ONLY — bbbsxzxcjkmpqsfvmhbo):
 *   npx tsx scripts/verify-activity-visibility-development.ts --execute
 */
import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import { join } from "path";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { OperationalActivity } from "../lib/activityIntelligence";
import type { TopologyProperty } from "../lib/buildChainTopology";
import {
  buildChainActivityTimeline,
  CHAIN_ACTIVITY_POSITION_SEPARATOR,
  resolveChainPropertyNumbers,
  type ChainActivityNode,
  type ChainTimelineActivity,
} from "../lib/chainActivityTimeline";
import { establishConnectedHopAfterSellerJoinsPurchase } from "../lib/chainConnection";
import type { ChainNodesChainSummary } from "../lib/chainNodesSummary";
import { composeChainTiles } from "../lib/composeChainTiles";
import { ensureBuyerReadyOnJoin } from "../lib/ensureBuyerReadyOnJoin";
import { completeEstateAgentOnboarding } from "../lib/estateAgent/completeOnboarding";
import { createEstateAgentProfile } from "../lib/estateAgent/createEstateAgentProfile";
import { loadEstateAgentOperationalAssignments } from "../lib/estateAgent/assignments";
import { migrateSourceChainOnwardProperties } from "../lib/joinChainSearching";
import {
  establishOperationalHomeowner,
  OPERATIONAL_IDENTITY_GRANT_VIA,
} from "../lib/ownership/grants";
import {
  CHAIN_TILE_LABEL,
  type OperationalBuyerReadyNode,
  type OperationalProperty,
} from "../lib/operationalPosition";
import {
  applyOperationalSubjectLens,
  resolveOperationalSubject,
  resolveSubjectOperationalPosition,
} from "../lib/operationalSubject";

const DEVELOPMENT_SUPABASE_PROJECT_REF = "bbbsxzxcjkmpqsfvmhbo";
const PASSWORD = "ActivityVisDev123!";
const TEST_EMAIL_PREFIX = "actvis";
const TEST_DOMAIN_SUFFIX = ".actvis.test";
const SALE_POSTCODE = "PO16 7AC";
const OWN_POSTCODE = "PO16 7AD";
const FLAT_POSTCODE = "PO16 7AE";
const ACTIVITY_COLUMNS = ["chain_node_id", "id", "property_id", "timestamp", "update", "updated_by"];

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
  activityIds: number[];
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
    companyName: `Activity Vis Co ${label} ${ctx.stamp}`,
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
    p_name: `AV EA ${suffix}`,
    p_access_code: `KN-AVE-${suffix}`.toUpperCase(),
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
  options: { sellerNotBuying?: boolean; homeownerOnlyUpdates?: boolean } = {}
): Promise<number> {
  const { data, error } = await ea.client.rpc("create_ea_operational_property", {
    p_chain_id: chainId,
    p_relationship_type: "sale",
    p_address: address,
    p_postcode: SALE_POSTCODE,
    p_branch_id: ea.branchId,
    p_homeowner_only_updates: options.homeownerOnlyUpdates ?? true,
    p_invite_email: null,
    p_awaiting_buyer: options.sellerNotBuying === true,
  });
  if (error || !data?.ok) throw new Error(`create_ea_operational_property: ${error?.message ?? data?.error}`);
  return data.property_id as number;
}

/** Start Move selling path (no onward search): own chain, sale row, operational homeowner. */
async function homeownerStartMoveSale(
  ctx: Ctx,
  ho: Actor,
  address: string
): Promise<{ chainId: number; sale: number }> {
  counter += 1;
  const suffix = `${ctx.stamp.slice(-6)}-${counter}`;
  const { data: chainData, error: chainError } = await ho.client.rpc("create_chain_for_onboarding", {
    p_name: `AV HO ${suffix}`,
    p_access_code: `KN-AVH-${suffix}`.toUpperCase(),
  });
  if (chainError || chainData?.chain_id == null) {
    throw new Error(`create_chain_for_onboarding: ${chainError?.message ?? chainData?.error}`);
  }
  const chainId = chainData.chain_id as number;
  ctx.chainIds.push(chainId);

  const { data: saleRow, error: saleError } = await ho.client
    .from("properties")
    .insert({
      chain_id: chainId,
      chain_position: 1,
      address,
      postcode: OWN_POSTCODE,
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

  return { chainId, sale };
}

async function joinChain(actor: Actor, accessCode: string, address: string, postcode: string): Promise<Rpc> {
  return rpc(actor.client, "join_chain_property", {
    p_access_code: accessCode,
    p_address: address,
    p_postcode: postcode,
  });
}

let minute = 0;
function nextTimestamp(): string {
  minute += 1;
  return new Date(Date.UTC(2026, 9, 5, 9, minute)).toISOString();
}

/** Inserts an activity as the actor (RLS applies); returns its id or the error. */
async function insertActivity(
  ctx: Ctx,
  client: SupabaseClient,
  row: { property_id?: number; chain_node_id?: number; update: string; updated_by: string }
): Promise<{ id: number | null; error: string | null }> {
  const { data, error } = await client
    .from("activities")
    .insert({ ...row, timestamp: nextTimestamp() })
    .select("id")
    .single();
  if (error || !data) return { id: null, error: error?.message ?? "no row" };
  ctx.activityIds.push(data.id as number);
  return { id: data.id as number, error: null };
}

async function visibleActivityIds(client: SupabaseClient, ids: number[]): Promise<number[]> {
  const { data } = await client.from("activities").select("id").in("id", ids).order("id");
  return (data ?? []).map((row) => row.id as number);
}

async function readablePropertyIds(client: SupabaseClient, ids: number[]): Promise<number[]> {
  const { data } = await client.from("properties").select("id").in("id", ids).order("id");
  return (data ?? []).map((row) => row.id as number);
}

async function chainPropertyIds(ctx: Ctx, chainId: number): Promise<number[]> {
  const { data } = await ctx.admin.from("properties").select("id").eq("chain_id", chainId).order("id");
  return (data ?? []).map((row) => row.id as number);
}

function sameIds(actual: number[], expected: number[]): boolean {
  return JSON.stringify([...actual].sort((a, b) => a - b)) === JSON.stringify([...expected].sort((a, b) => a - b));
}

// ---------------------------------------------------------------------------
// Chain page timeline — mirrors ChainContext.loadParticipantDataset + app/chain/[chainId]
// ---------------------------------------------------------------------------

type ViewRow = TopologyProperty &
  OperationalProperty & {
    chainId: number;
    chainPosition: number;
    postcode: string | null;
    activities: OperationalActivity[];
  };

type TimelineView = {
  rows: ViewRow[];
  timeline: ChainTimelineActivity[];
  propertyTileLabels: Map<number, string>;
  nodeIds: number[];
};

async function loadTimeline(
  actor: Actor,
  chainId: number,
  accountType: "homeowner" | "estate_agent"
): Promise<TimelineView> {
  const { data: rawRows, error } = await actor.client
    .from("chain_properties_participant")
    .select("*")
    .eq("chain_id", chainId)
    .order("chain_position");
  if (error) throw new Error(`participant view: ${error.message}`);

  const ids = (rawRows ?? []).map((row) => row.id as number);
  const { data: activityRows } = ids.length
    ? await actor.client
        .from("activities")
        .select("id, property_id, timestamp, update, updated_by")
        .in("property_id", ids)
        .order("timestamp", { ascending: false })
    : { data: [] };
  const activitiesByProperty = new Map<number, OperationalActivity[]>();
  for (const row of activityRows ?? []) {
    const list = activitiesByProperty.get(row.property_id as number) ?? [];
    list.push({ id: row.id, timestamp: row.timestamp, update: row.update, updated_by: row.updated_by });
    activitiesByProperty.set(row.property_id as number, list);
  }

  const rows: ViewRow[] = (rawRows ?? []).map((row) => ({
    id: row.id,
    chainId: row.chain_id,
    chainPosition: row.chain_position,
    address: row.address ?? null,
    postcode: row.postcode ?? null,
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
    activities: activitiesByProperty.get(row.id as number) ?? [],
  }));

  const { data: nodes } = await actor.client
    .from("chain_nodes")
    .select("id, chain_id, user_id, node_type, linked_property_id, activities(id, timestamp, update, updated_by)")
    .eq("chain_id", chainId);
  const chainNodes = (nodes ?? []) as unknown as Array<ChainActivityNode & { user_id: string }>;

  const { data: summaries } = await actor.client
    .from("chain_nodes_chain_summary")
    .select("*")
    .eq("chain_id", chainId)
    .eq("node_type", "buyer_ready")
    .order("position");
  const estateAgentAssignments =
    accountType === "estate_agent" ? await loadEstateAgentOperationalAssignments(actor.client) : [];

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
    chainNodes: chainNodes as unknown as OperationalBuyerReadyNode[],
  });
  const ownerNode =
    position?.kind === "buyer_ready" ? chainNodes.find((node) => node.id === position.nodeId) ?? null : null;

  const timeline = buildChainActivityTimeline({
    chainId,
    chainProperties: rows,
    labelProperties: subjectRows,
    operationalPosition: position,
    ownerBuyerReadyLinkedPropertyId: ownerNode?.linked_property_id ?? null,
    chainNodes,
  });

  const tiles = composeChainTiles({
    chainProperties: subjectRows,
    operationalPosition: position,
    buyerReadySummaries: (summaries ?? []) as ChainNodesChainSummary[],
  });
  const propertyTileLabels = new Map<number, string>();
  for (const tile of tiles) {
    if (tile.kind === "property" && tile.anchorPropertyId != null) {
      propertyTileLabels.set(tile.anchorPropertyId, tile.label);
    }
  }

  return { rows, timeline, propertyTileLabels, nodeIds: chainNodes.map((node) => node.id) };
}

function timelineIds(view: TimelineView): number[] {
  return view.timeline.map((entry) => entry.id as number).sort((a, b) => a - b);
}

function labelFor(view: TimelineView, activityId: number | null): string | null {
  return view.timeline.find((entry) => entry.id === activityId)?.positionLabel ?? null;
}

function baseLabel(label: string): string {
  return label.split(CHAIN_ACTIVITY_POSITION_SEPARATOR)[0];
}

function labelsMatchTiles(view: TimelineView): boolean {
  return view.timeline
    .filter((entry) => entry.source.kind === "property")
    .every((entry) => {
      const propertyId = entry.source.kind === "property" ? entry.source.propertyId : -1;
      return baseLabel(entry.positionLabel) === view.propertyTileLabels.get(propertyId);
    });
}

function noDuplicates(view: TimelineView): boolean {
  return new Set(view.timeline.map((entry) => entry.key)).size === view.timeline.length;
}

function leaksAny(value: unknown, secrets: string[]): boolean {
  const text = JSON.stringify(value).toLowerCase();
  return secrets.some((secret) => text.includes(secret.toLowerCase()));
}

function saysYou(view: TimelineView): boolean {
  return view.timeline.some((entry) => /\bYou\b/.test(entry.positionLabel));
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

async function runScenarios(ctx: Ctx): Promise<void> {
  const short = ctx.stamp.slice(-6);
  const ea = await setupEstateAgent(ctx, "ea");
  const otherEa = await setupEstateAgent(ctx, "otherea");
  const buyer = await setupHomeowner(ctx, "buyer");
  const distant = await setupHomeowner(ctx, "distant");
  const outsider = await setupHomeowner(ctx, "outsider");
  const anon = anonClient(ctx);

  // ---------------------------------------------------------------- AV setup
  const saleAddress = `321 Activity Lane ${short}`;
  const ownAddress = `2 Owner Close ${short}`;
  const flatAddress = `Flat 9 Activity Court ${short}`;
  const secrets = [saleAddress, ownAddress, flatAddress, SALE_POSTCODE, OWN_POSTCODE, FLAT_POSTCODE];

  const chain = await eaChain(ctx, ea);
  const eaSaleId = await eaSale(ea, chain.chainId, saleAddress, { homeownerOnlyUpdates: false });
  const placeholder = await rpc(ea.client, "create_searching_placeholder_for_sale", {
    p_sale_property_id: eaSaleId,
  });
  record("AV setup: EA lists the sale with the seller's onward search", placeholder?.ok === true, placeholder?.error);

  const own = await homeownerStartMoveSale(ctx, buyer, ownAddress);
  const joined = await joinChain(buyer, chain.accessCode, saleAddress, SALE_POSTCODE);
  record(
    "AV setup: selling homeowner joins the EA sale as its buyer",
    joined?.ok === true && joined?.joining_role === "buyer" && joined?.property_id === eaSaleId,
    JSON.stringify({ ok: joined?.ok, role: joined?.joining_role, error: joined?.error })
  );
  const migration = await migrateSourceChainOnwardProperties(buyer.client, {
    sourceChainId: String(own.chainId),
    userId: buyer.userId,
    joinedProperty: {
      id: eaSaleId,
      chain_id: chain.chainId,
      linked_property_id: (joined?.linked_property_id as number | null) ?? null,
    },
    excludePropertyId: eaSaleId,
  });
  await buyer.client.rpc("cleanup_abandoned_onboarding_chain", {
    p_chain_id: own.chainId,
    p_require_empty: true,
  });
  const { data: ownRow } = await ctx.admin
    .from("properties")
    .select("chain_id, linked_property_id")
    .eq("id", own.sale)
    .single();
  record(
    "AV setup: homeowner's own sale moved into the chain, linked to the EA sale",
    migration.onwardSaleMigrated && ownRow?.chain_id === chain.chainId && ownRow?.linked_property_id === eaSaleId
  );

  const converted = await rpc(ea.client, "convert_searching_placeholder_for_sale", {
    p_sale_property_id: eaSaleId,
    p_address: flatAddress,
    p_postcode: FLAT_POSTCODE,
  });
  const purchaseId = (converted?.property_id as number | undefined) ?? null;
  const sellerJoin = await joinChain(distant, chain.accessCode, flatAddress, FLAT_POSTCODE);
  if (sellerJoin?.ok && sellerJoin.joining_role === "seller") {
    await establishConnectedHopAfterSellerJoinsPurchase(distant.client, sellerJoin.property_id as number);
  }
  record(
    "AV setup: EA identifies the seller's purchase; a distant homeowner joins it as seller",
    converted?.ok === true && sellerJoin?.ok === true && sellerJoin?.joining_role === "seller",
    JSON.stringify({ convert: converted?.error, join: sellerJoin?.error, role: sellerJoin?.joining_role })
  );
  const distantPropertyId = (sellerJoin?.property_id as number | undefined) ?? purchaseId ?? -1;

  const chainIds = await chainPropertyIds(ctx, chain.chainId);
  record(
    "AV setup: chain holds own sale, EA sale and the seller's purchase",
    [own.sale, eaSaleId, distantPropertyId].every((id) => chainIds.includes(id)),
    `chain properties ${chainIds.join(",")}`
  );

  const hoOwn1 = await insertActivity(ctx, buyer.client, {
    property_id: own.sale,
    update: "Offer Accepted",
    updated_by: "homeowner",
  });
  const hoOwn2 = await insertActivity(ctx, buyer.client, {
    property_id: own.sale,
    update: "Solicitors Instructed",
    updated_by: "homeowner",
  });
  const eaAct = await insertActivity(ctx, ea.client, {
    property_id: eaSaleId,
    update: "Offer Accepted",
    updated_by: "estate_agent",
  });
  const distantAct = await insertActivity(ctx, distant.client, {
    property_id: distantPropertyId,
    update: "Offer Accepted",
    updated_by: "homeowner",
  });
  const systemAct = await insertActivity(ctx, ctx.admin, {
    property_id: own.sale,
    update: "Searches Ordered",
    updated_by: "system",
  });
  record(
    "AV setup: homeowner, EA, distant homeowner and system activities recorded",
    [hoOwn1, hoOwn2, eaAct, distantAct, systemAct].every((row) => row.id != null),
    JSON.stringify([hoOwn1, hoOwn2, eaAct, distantAct, systemAct].map((row) => row.error))
  );

  const homeownerIds = [hoOwn1.id, hoOwn2.id].filter((id): id is number => id != null);
  const { data: chainActivityRows } = await ctx.admin
    .from("activities")
    .select("id")
    .in("property_id", chainIds)
    .order("id");
  const allIds = (chainActivityRows ?? []).map((row) => row.id as number);
  record(
    "AV setup: chain activity set includes every recorded activity",
    [hoOwn1.id, hoOwn2.id, eaAct.id, distantAct.id, systemAct.id].every((id) => id != null && allIds.includes(id)),
    `chain activities ${allIds.join(",")}`
  );

  // ---------------------------------------------------------------- AV raw RLS
  const eaSees = await visibleActivityIds(ea.client, allIds);
  const buyerSees = await visibleActivityIds(buyer.client, allIds);
  const distantSees = await visibleActivityIds(distant.client, allIds);

  record(
    "AV1 homeowner activity on their own sale is visible to the EA assigned to the connected sale",
    homeownerIds.length === 2 && homeownerIds.every((id) => eaSees.includes(id)),
    `EA sees ${eaSees.join(",")}`
  );
  record(
    "AV2 homeowner activity on their own sale is visible to the distant homeowner in the chain",
    homeownerIds.length === 2 && homeownerIds.every((id) => distantSees.includes(id)),
    `distant sees ${distantSees.join(",")}`
  );
  record(
    "AV2b distant homeowner's activity is visible to the EA and the selling homeowner",
    distantAct.id != null && eaSees.includes(distantAct.id) && buyerSees.includes(distantAct.id),
    `EA ${eaSees.join(",")} / buyer ${buyerSees.join(",")}`
  );
  record(
    "AV3 EA activity remains visible to the EA, the selling homeowner and the distant homeowner",
    eaAct.id != null && [eaSees, buyerSees, distantSees].every((seen) => seen.includes(eaAct.id!))
  );
  record(
    "AV3b homeowner still sees their own activity",
    homeownerIds.every((id) => buyerSees.includes(id))
  );
  record(
    "AV4 system activity is visible to every chain participant",
    systemAct.id != null && [eaSees, buyerSees, distantSees].every((seen) => seen.includes(systemAct.id!))
  );
  record(
    "AV4b every participant sees every chain activity (including activity written by the app during setup)",
    [eaSees, buyerSees, distantSees].every((seen) => sameIds(seen, allIds)),
    JSON.stringify({ ea: eaSees, buyer: buyerSees, distant: distantSees, all: allIds })
  );

  const outsiderSees = await visibleActivityIds(outsider.client, allIds);
  const otherEaSees = await visibleActivityIds(otherEa.client, allIds);
  const anonSees = await visibleActivityIds(anon, allIds);
  record("AV5 outsider homeowner sees none of the chain's activities", outsiderSees.length === 0, outsiderSees.join(","));
  record("AV5b unrelated EA sees none of the chain's activities", otherEaSees.length === 0, otherEaSees.join(","));
  record("AV5c anonymous caller sees none of the chain's activities", anonSees.length === 0, anonSees.join(","));
  const { data: outsiderByProperty } = await outsider.client
    .from("activities")
    .select("id")
    .in("property_id", chainIds);
  record("AV5d outsider sees nothing when querying by the chain's property ids", (outsiderByProperty ?? []).length === 0);
  const { data: anonHelper, error: anonHelperError } = await anon.rpc("is_property_chain_operational_viewer", {
    p_property_id: own.sale,
  });
  record(
    "AV5e anonymous caller cannot execute the visibility helper",
    anonHelperError != null && anonHelper == null,
    anonHelperError ? undefined : `returned ${JSON.stringify(anonHelper)}`
  );
  const { data: outsiderHelper } = await outsider.client.rpc("is_property_chain_operational_viewer", {
    p_property_id: own.sale,
  });
  record("AV5f helper returns false for an outsider", outsiderHelper === false, JSON.stringify(outsiderHelper));

  for (const [label, actor] of [
    ["EA", ea],
    ["distant homeowner", distant],
  ] as const) {
    const { data: rows } = await actor.client.from("activities").select("*").in("id", allIds);
    const keysOk = (rows ?? []).every(
      (row) => JSON.stringify(Object.keys(row).sort()) === JSON.stringify(ACTIVITY_COLUMNS)
    );
    record(
      `AV6 ${label}: activity rows carry only activity columns`,
      (rows ?? []).length > 0 && keysOk,
      JSON.stringify(Object.keys(rows?.[0] ?? {}))
    );
    record(`AV6b ${label}: activity response contains no address or postcode`, !leaksAny(rows, secrets));
  }

  // ---------------------------------------------------------------- AV properties RLS
  const eaReadable = await readablePropertyIds(ea.client, chainIds);
  const distantReadable = await readablePropertyIds(distant.client, chainIds);
  const buyerReadable = await readablePropertyIds(buyer.client, chainIds);
  const outsiderReadable = await readablePropertyIds(outsider.client, chainIds);
  record(
    "AV7 properties RLS: EA still cannot read the homeowner's own sale row",
    eaReadable.includes(eaSaleId) && !eaReadable.includes(own.sale),
    `EA reads ${eaReadable.join(",")}`
  );
  record(
    "AV7b properties RLS: distant homeowner still cannot read the own sale or EA sale rows",
    distantReadable.includes(distantPropertyId) &&
      !distantReadable.includes(own.sale) &&
      !distantReadable.includes(eaSaleId),
    `distant reads ${distantReadable.join(",")}`
  );
  record(
    "AV7c properties RLS: selling homeowner reads own sale and purchase, not the distant property",
    buyerReadable.includes(own.sale) && buyerReadable.includes(eaSaleId) && !buyerReadable.includes(distantPropertyId),
    `buyer reads ${buyerReadable.join(",")}`
  );
  record("AV7d properties RLS: outsider reads no chain rows", outsiderReadable.length === 0, outsiderReadable.join(","));

  const eaView = await loadTimeline(ea, chain.chainId, "estate_agent");
  const buyerView = await loadTimeline(buyer, chain.chainId, "homeowner");
  const distantView = await loadTimeline(distant, chain.chainId, "homeowner");
  const outsiderRows = await outsider.client
    .from("chain_properties_participant")
    .select("id")
    .eq("chain_id", chain.chainId);

  const maskedFor = (view: TimelineView, propertyId: number) => {
    const row = view.rows.find((candidate) => candidate.id === propertyId);
    return row != null && row.address == null && row.postcode == null;
  };
  record(
    "AV7e participant view still masks the own sale's address and postcode from the EA",
    maskedFor(eaView, own.sale)
  );
  record(
    "AV7f participant view still masks own sale and EA sale address / postcode from the distant homeowner",
    maskedFor(distantView, own.sale) && maskedFor(distantView, eaSaleId)
  );
  record(
    "AV7g participant view still masks the distant property from the selling homeowner",
    maskedFor(buyerView, distantPropertyId)
  );

  record(
    "AV8 chain participant visibility unchanged: every participant sees every chain property",
    [eaView, buyerView, distantView].every((view) =>
      sameIds(
        view.rows.map((row) => row.id),
        chainIds
      )
    ),
    JSON.stringify({
      ea: eaView.rows.map((row) => row.id),
      buyer: buyerView.rows.map((row) => row.id),
      distant: distantView.rows.map((row) => row.id),
    })
  );
  record("AV8b outsider sees no chain participant rows", (outsiderRows.data ?? []).length === 0);

  // ---------------------------------------------------------------- AV timeline
  record(
    "AVT every participant's chain timeline lists the same activities",
    [eaView, buyerView, distantView].every((view) => sameIds(timelineIds(view), allIds)),
    JSON.stringify({ ea: timelineIds(eaView), buyer: timelineIds(buyerView), distant: timelineIds(distantView) })
  );
  record(
    "AVT homeowner timeline: own sale activity → Your Sale, EA activity → Your Purchase",
    labelFor(buyerView, hoOwn1.id) === CHAIN_TILE_LABEL.yourSale &&
      labelFor(buyerView, eaAct.id) === CHAIN_TILE_LABEL.yourPurchase,
    JSON.stringify({ own: labelFor(buyerView, hoOwn1.id), ea: labelFor(buyerView, eaAct.id) })
  );
  record(
    "AVT EA timeline: homeowner's own sale activity → Connected Buyer, EA activity → Your Sale",
    labelFor(eaView, hoOwn1.id) === CHAIN_TILE_LABEL.connectedBuyer &&
      labelFor(eaView, eaAct.id) === CHAIN_TILE_LABEL.yourSale,
    JSON.stringify({ own: labelFor(eaView, hoOwn1.id), ea: labelFor(eaView, eaAct.id) })
  );
  record(
    "AVT distant homeowner timeline: own sale and EA sale labelled apart",
    labelFor(distantView, hoOwn1.id) !== labelFor(distantView, eaAct.id) &&
      labelFor(distantView, distantAct.id) === CHAIN_TILE_LABEL.yourSale,
    JSON.stringify({
      own: labelFor(distantView, hoOwn1.id),
      ea: labelFor(distantView, eaAct.id),
      distant: labelFor(distantView, distantAct.id),
    })
  );
  for (const [label, view] of [
    ["EA", eaView],
    ["homeowner", buyerView],
    ["distant homeowner", distantView],
  ] as const) {
    record(`AVT ${label}: activity positions equal the chain tile titles`, labelsMatchTiles(view));
    record(
      `AVT ${label}: timeline carries no address or postcode`,
      !leaksAny(
        view.timeline.map((entry) => ({ update: entry.update, positionLabel: entry.positionLabel })),
        secrets
      )
    );
    record(`AVT ${label}: no duplicate activities`, noDuplicates(view));
    record(`AVT ${label}: no viewer-relative "You" actor`, !saysYou(view));
  }

  // ---------------------------------------------------------------- BR multiple Buyer Ready
  const brChain = await eaChain(ctx, ea);
  const addressA = `10 Ready Row ${short}`;
  const addressB = `12 Ready Row ${short}`;
  const saleA = await eaSale(ea, brChain.chainId, addressA, { sellerNotBuying: true });
  const saleB = await eaSale(ea, brChain.chainId, addressB, { sellerNotBuying: true });
  const readyBuyer1 = await setupHomeowner(ctx, "ready1");
  const readyBuyer2 = await setupHomeowner(ctx, "ready2");
  const brSecrets = [addressA, addressB, SALE_POSTCODE];

  const join1 = await joinChain(readyBuyer1, brChain.accessCode, addressA, SALE_POSTCODE);
  const ready1 = await ensureBuyerReadyOnJoin(readyBuyer1.client, {
    chainId: brChain.chainId,
    purchasePropertyId: saleA,
    userId: readyBuyer1.userId,
  });
  const node1 = ready1.ok ? ready1.nodeId ?? null : null;
  record(
    "BR setup: first buying-only buyer joins sale A with a Buyer Ready step",
    join1?.ok === true && join1?.joining_role === "buyer" && node1 != null,
    JSON.stringify({ join: join1?.error, ready: ready1 })
  );
  const step1Act = await insertActivity(ctx, readyBuyer1.client, {
    chain_node_id: node1 ?? -1,
    update: "Mortgage In Principle",
    updated_by: "homeowner",
  });
  record("BR setup: buyer 1 records a Buyer Ready activity", step1Act.id != null, step1Act.error ?? undefined);

  const singleEa = await loadTimeline(ea, brChain.chainId, "estate_agent");
  const singleBuyer = await loadTimeline(readyBuyer1, brChain.chainId, "homeowner");
  for (const [label, view] of [
    ["EA", singleEa],
    ["buyer 1", singleBuyer],
  ] as const) {
    record(
      `BR1 single step (${label}): Buyer Ready activity shown once as "Buyer Ready"`,
      view.timeline.filter((entry) => entry.id === step1Act.id).length === 1 &&
        labelFor(view, step1Act.id) === CHAIN_TILE_LABEL.buyerReady,
      labelFor(view, step1Act.id) ?? "missing"
    );
  }

  const join2 = await joinChain(readyBuyer2, brChain.accessCode, addressB, SALE_POSTCODE);
  const ready2 = await ensureBuyerReadyOnJoin(readyBuyer2.client, {
    chainId: brChain.chainId,
    purchasePropertyId: saleB,
    userId: readyBuyer2.userId,
  });
  const node2 = ready2.ok ? ready2.nodeId ?? null : null;
  record(
    "BR setup: second buying-only buyer joins sale B with its own Buyer Ready step",
    join2?.ok === true && join2?.joining_role === "buyer" && node2 != null && node2 !== node1,
    JSON.stringify({ join: join2?.error, ready: ready2 })
  );
  const step2Act = await insertActivity(ctx, readyBuyer2.client, {
    chain_node_id: node2 ?? -1,
    update: "Mortgage Application Submitted",
    updated_by: "homeowner",
  });
  const eaOnB = await insertActivity(ctx, ea.client, {
    property_id: saleB,
    update: "Offer Accepted",
    updated_by: "estate_agent",
  });
  record(
    "BR setup: buyer 2 records a Buyer Ready activity",
    step2Act.id != null,
    step2Act.error ?? undefined
  );

  const stepIds = [step1Act.id, step2Act.id].filter((id): id is number => id != null);
  const brAll = [...stepIds, eaOnB.id].filter((id): id is number => id != null);
  const multiEa = await loadTimeline(ea, brChain.chainId, "estate_agent");
  const multiBuyer1 = await loadTimeline(readyBuyer1, brChain.chainId, "homeowner");
  const multiBuyer2 = await loadTimeline(readyBuyer2, brChain.chainId, "homeowner");
  const numbers = resolveChainPropertyNumbers(multiEa.rows);
  const expectedStep1 = `${CHAIN_TILE_LABEL.buyerReady}${CHAIN_ACTIVITY_POSITION_SEPARATOR}Property ${numbers.get(saleA)}`;
  const expectedStep2 = `${CHAIN_TILE_LABEL.buyerReady}${CHAIN_ACTIVITY_POSITION_SEPARATOR}Property ${numbers.get(saleB)}`;

  for (const [label, view] of [
    ["EA", multiEa],
    ["buyer 1", multiBuyer1],
    ["buyer 2", multiBuyer2],
  ] as const) {
    record(
      `BR2 multiple steps (${label}): activities from every Buyer Ready step`,
      stepIds.length === 2 && stepIds.every((id) => timelineIds(view).includes(id)),
      JSON.stringify(timelineIds(view))
    );
    record(
      `BR2 multiple steps (${label}): each step labelled by the property it buys`,
      labelFor(view, step1Act.id) === expectedStep1 &&
        labelFor(view, step2Act.id) === expectedStep2 &&
        expectedStep1 !== expectedStep2,
      JSON.stringify({ step1: labelFor(view, step1Act.id), step2: labelFor(view, step2Act.id) })
    );
    record(`BR2 multiple steps (${label}): no duplicates`, noDuplicates(view));
    record(
      `BR2 multiple steps (${label}): property activity still included`,
      eaOnB.id != null && timelineIds(view).includes(eaOnB.id)
    );
    record(`BR2 multiple steps (${label}): no address or postcode`, !leaksAny(
      view.timeline.map((entry) => ({ update: entry.update, positionLabel: entry.positionLabel })),
      brSecrets
    ));
  }
  record(
    "BR3 buyer 1 sees their own step and buyer 2's step; buyer 2 sees both",
    stepIds.every((id) => timelineIds(multiBuyer1).includes(id) && timelineIds(multiBuyer2).includes(id))
  );

  const outsiderBr = await visibleActivityIds(outsider.client, brAll);
  const otherEaBr = await visibleActivityIds(otherEa.client, brAll);
  const anonBr = await visibleActivityIds(anon, brAll);
  const { data: outsiderNodes } = await outsider.client
    .from("chain_nodes")
    .select("id")
    .eq("chain_id", brChain.chainId);
  record(
    "BR4 no unauthorised activity: outsider, unrelated EA and anon see no Buyer Ready or property activity",
    outsiderBr.length === 0 && otherEaBr.length === 0 && anonBr.length === 0 && (outsiderNodes ?? []).length === 0,
    JSON.stringify({ outsider: outsiderBr, otherEa: otherEaBr, anon: anonBr, nodes: outsiderNodes?.length })
  );
  const crossChain = await loadTimeline(ea, chain.chainId, "estate_agent");
  record(
    "BR4b Buyer Ready activity from one chain never appears in another chain's timeline",
    stepIds.every((id) => !timelineIds(crossChain).includes(id))
  );
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

async function verifyNoLeftovers(ctx: Ctx): Promise<void> {
  const { count: chains } = await ctx.admin
    .from("chains")
    .select("id", { count: "exact", head: true })
    .in("id", ctx.chainIds.length ? ctx.chainIds : [-1]);
  const { count: properties } = await ctx.admin
    .from("properties")
    .select("id", { count: "exact", head: true })
    .in("chain_id", ctx.chainIds.length ? ctx.chainIds : [-1]);
  const { count: activities } = await ctx.admin
    .from("activities")
    .select("id", { count: "exact", head: true })
    .in("id", ctx.activityIds.length ? ctx.activityIds : [-1]);
  const { count: profiles } = await ctx.admin
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .in("id", ctx.userIds.length ? ctx.userIds : ["00000000-0000-0000-0000-000000000000"]);
  let authUsers = 0;
  for (const userId of ctx.userIds) {
    const { data } = await ctx.admin.auth.admin.getUserById(userId);
    if (data?.user) authUsers += 1;
  }
  record(
    "Cleanup: no fixture chains, properties, activities, profiles or auth users remain",
    chains === 0 && properties === 0 && activities === 0 && profiles === 0 && authUsers === 0,
    JSON.stringify({ chains, properties, activities, profiles, authUsers })
  );
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
    activityIds: [],
  };

  try {
    await runScenarios(ctx);
  } finally {
    await cleanupFixtures(ctx);
    await verifyNoLeftovers(ctx);
  }

  const failed = results.filter((r) => !r.pass).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed.`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
