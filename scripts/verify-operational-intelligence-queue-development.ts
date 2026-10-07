/**
 * Development-only verification of the operational intelligence cache
 * (supabase/migrations/20261006120000_operational_intelligence_refresh_queue.sql).
 *
 *   Q  queue: genuine activity, stage and Buyer Ready changes queue; duplicates
 *      collapse into one row; system notices and irrelevant edits never queue
 *   W  worker: missing (EA first), queued, time-due, completed excluded,
 *      batch limit; processed chains leave the queue
 *   C  clocks: Day 1 activity seen on Day 3 stays Day 1; fallback clock goes
 *      stale at 15 days (page alert) and 22 days (confidence)
 *   T  Day 1 → Day 15 → Day 22 recalculation without page views
 *   B  Buyer Ready feeds chain intelligence, never property Last updated
 *   P  Dashboard / Chain RPC parity; outsiders, homeowners of other chains and
 *      anon get nothing
 *   PP Property page action state from the cached property clock (fallback
 *      clock, system notices, genuine reset, 14/15 boundary, EA wording)
 *
 * Fixtures use real auth users (admin API) and are removed at the end.
 *
 * Usage (Development ONLY — bbbsxzxcjkmpqsfvmhbo):
 *   npx tsx scripts/verify-operational-intelligence-queue-development.ts
 */
import { readFileSync } from "fs";
import { join } from "path";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { runChainIntelligenceWorkerBatch } from "../lib/chainIntelligence/worker";
import type { AgentBranchPropertySummary } from "../lib/estateAgent/assignmentTypes";
import {
  assignPropertyToBranch,
  loadAgentBranchPropertySummaries,
} from "../lib/estateAgent/assignments";
import {
  cachedPropertyClockDays,
  isCachedPropertyClockBehind,
  loadCachedPropertyClock,
  type CachedPropertyClock,
} from "../lib/operationalSummary/cachedPropertyClock";
import {
  loadOperationalRefreshDatasets,
  processOperationalRefreshForChains,
} from "../lib/operationalSummary/processOperationalRefresh";
import { getPropertyActionMessage, type WorkflowAccess } from "../lib/workflowPermissions";

const DEVELOPMENT_SUPABASE_PROJECT_REF = "bbbsxzxcjkmpqsfvmhbo";
const PASSWORD = "OpIntelQueueVerify123!";
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

type Result = { name: string; pass: boolean; detail?: string };
const results: Result[] = [];

function record(name: string, pass: boolean, detail?: string) {
  results.push({ name, pass, detail });
  console.log(pass ? `✓ ${name}` : `✗ ${name}${detail ? `: ${detail}` : ""}`);
}

function loadEnvLocal(): void {
  try {
    for (const line of readFileSync(join(process.cwd(), ".env.local"), "utf8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const at = trimmed.indexOf("=");
      if (at <= 0) continue;
      let value = trimmed.slice(at + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[trimmed.slice(0, at).trim()] = value;
    }
  } catch {
    // optional
  }
}

loadEnvLocal();
const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

function assertDevelopmentEnvironment(supabaseUrl: string): void {
  const projectRef = supabaseUrl.match(/^https:\/\/([a-z0-9]+)\.supabase\.co/i)?.[1] ?? null;
  if (projectRef !== DEVELOPMENT_SUPABASE_PROJECT_REF) {
    throw new Error(`Refusing to run: Supabase project "${projectRef ?? "unknown"}" is not Development.`);
  }
}

type Ctx = {
  admin: SupabaseClient;
  userIds: string[];
  companyIds: string[];
  branchIds: string[];
  chainIds: number[];
};

type Fixture = { client: SupabaseClient; userId: string; propertyId: number; chainId: number };

async function main() {
  console.log("=== Operational intelligence queue / worker verification (Development only) ===\n");
  if (!url || !anonKey || !serviceRoleKey) {
    throw new Error("Supabase URL, anon key, and service role key are required.");
  }
  assertDevelopmentEnvironment(url);

  const ctx: Ctx = {
    admin: createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } }),
    userIds: [],
    companyIds: [],
    branchIds: [],
    chainIds: [],
  };

  try {
    await run(ctx);
  } finally {
    await cleanup(ctx);
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\nPassed: ${results.length - failed.length}/${results.length}`);
  if (failed.length > 0) process.exit(1);
}

async function run(ctx: Ctx) {
  const { admin } = ctx;
  const stamp = Date.now();
  let seq = 0;

  const anonClient = () =>
    createClient(url!, anonKey!, { auth: { persistSession: false, autoRefreshToken: false } });

  async function user(label: string) {
    const email = `opq-${label}-${stamp}@keynetic-test.dev`;
    const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
    if (error || !data.user) throw new Error(`createUser failed (${label}): ${error?.message}`);
    ctx.userIds.push(data.user.id);
    const client = anonClient();
    const { error: signInError } = await client.auth.signInWithPassword({ email, password: PASSWORD });
    if (signInError) throw new Error(`sign in failed (${label}): ${signInError.message}`);
    return { client, userId: data.user.id };
  }

  async function setupEa(label: string) {
    const n = ++seq;
    const domain = `opq-${label}-${stamp}.dev`;
    const { client, userId } = await user(`ea-${label}`);
    await client.from("profiles").upsert({
      id: userId,
      role: "homeowner",
      account_type: "estate_agent",
      contact_name: `EA OPQ ${label}`,
      email_domain: domain,
      onboarding_completed_at: new Date().toISOString(),
    });
    const { data: company, error: companyError } = await client
      .from("ea_companies")
      .insert({ name: `OPQ Agency ${label} ${stamp}`, email_domain: domain, created_by_user_id: userId })
      .select("id")
      .single();
    if (companyError || !company) throw new Error(`company failed (${label}): ${companyError?.message}`);
    ctx.companyIds.push(company.id);
    const { data: branch, error: branchError } = await client
      .from("ea_branches")
      .insert({
        company_id: company.id,
        name: `Main ${n}`,
        town_or_city: "London",
        postcode: "E1 1DL",
        region_code: "UK-LONDON",
        is_head_office: true,
      })
      .select("id")
      .single();
    if (branchError || !branch) throw new Error(`branch failed (${label}): ${branchError?.message}`);
    ctx.branchIds.push(branch.id);
    const { error: memberError } = await client
      .from("ea_branch_members")
      .insert({ branch_id: branch.id, user_id: userId, role: "branch_admin" });
    if (memberError) throw new Error(`member failed (${label}): ${memberError.message}`);
    return { client, userId, branchId: branch.id as string };
  }

  async function homeownerSale(label: string, branchId: string | null): Promise<Fixture> {
    const n = ++seq;
    const { client, userId } = await user(`ho-${label}`);
    await client.from("profiles").upsert({
      id: userId,
      role: "homeowner",
      account_type: "homeowner",
      contact_name: `HO OPQ ${label}`,
      onboarding_completed_at: new Date().toISOString(),
    });
    const { data: chain, error: chainError } = await client.rpc("create_chain_for_onboarding", {
      p_name: `OPQ ${label} ${stamp}`,
      p_access_code: `KN-OQ${n}-${stamp}`,
    });
    if (chainError || !chain?.chain_id) throw new Error(`chain failed (${label}): ${chainError?.message}`);
    const chainId = chain.chain_id as number;
    ctx.chainIds.push(chainId);
    const { data: sale, error: saleError } = await client
      .from("properties")
      .insert({
        chain_id: chainId,
        chain_position: 1,
        address: `OPQ ${label} ${stamp}`,
        postcode: "E2 2OQ",
        stage: "property_listed",
        status: "healthy",
        relationship_type: "sale",
        created_by_user_id: userId,
        buyer_connected: false,
        seller_connected: true,
        is_searching: false,
      })
      .select("id")
      .single();
    if (saleError || !sale) throw new Error(`sale failed (${label}): ${saleError?.message}`);
    const propertyId = sale.id as number;
    const { error: establishError } = await client.rpc("establish_operational_homeowner_for_created_property", {
      p_property_id: propertyId,
    });
    if (establishError) throw new Error(`establish failed (${label}): ${establishError.message}`);
    if (branchId) {
      const assigned = await assignPropertyToBranch(client, { propertyId, branchId, homeownerOnlyUpdates: false });
      if (assigned.error) throw new Error(`assign failed (${label}): ${assigned.error}`);
    }
    return { client, userId, propertyId, chainId };
  }

  const queueRow = async (chainId: number) => {
    const { data } = await admin
      .from("chain_operational_refresh_queue")
      .select("chain_id, reason, request_count")
      .eq("chain_id", chainId)
      .maybeSingle();
    return data as { chain_id: number; reason: string; request_count: number } | null;
  };
  const clearQueue = async (chainIds: number[]) => {
    await admin.from("chain_operational_refresh_queue").delete().in("chain_id", chainIds);
  };
  const workList = async (limit = 500) => {
    const { data, error } = await admin.rpc("list_chain_operational_refresh_work", { p_limit: limit });
    if (error) throw new Error(`work list: ${error.message}`);
    return (data ?? []) as Array<{ chain_id: number; reason: string; priority: number }>;
  };
  const workFor = async (chainId: number) => (await workList()).find((w) => w.chain_id === chainId) ?? null;
  const process = async (chainIds: number[], referenceDate?: Date) =>
    processOperationalRefreshForChains(admin, chainIds, { referenceDate });
  const adminActivity = async (
    target: { property_id?: number; chain_node_id?: number },
    update: string,
    updatedBy: string,
    timestamp: string
  ) => {
    const { data, error } = await admin
      .from("activities")
      .insert({ ...target, update, updated_by: updatedBy, timestamp })
      .select("id, timestamp")
      .single();
    if (error || !data) throw new Error(`activity insert failed: ${error?.message}`);
    return data as { id: number; timestamp: string };
  };
  const propertySummary = async (propertyId: number) => {
    const { data } = await admin
      .from("property_operational_summary")
      .select(
        "last_update_at, days_since_last_update, stale_update, activity_clock_at, activity_clock_source, buyer_ready_last_update, buyer_ready_stale, computed_at"
      )
      .eq("property_id", propertyId)
      .maybeSingle();
    return data as Record<string, unknown> | null;
  };
  const chainSummary = async (chainId: number) => {
    const { data } = await admin
      .from("chain_operational_summary")
      .select("health_status, stale_count, stale_property_ids, buyer_ready_stale, next_recalculation_at, summary_version")
      .eq("chain_id", chainId)
      .maybeSingle();
    return data as Record<string, unknown> | null;
  };
  const sameInstant = (a: unknown, b: unknown) =>
    typeof a === "string" && typeof b === "string" && new Date(a).getTime() === new Date(b).getTime();

  const { data: genuineLabel } = await admin.rpc("is_genuine_property_activity", {
    p_update: "Solicitors Instructed",
    p_updated_by: "homeowner",
  });
  const { data: systemLabel } = await admin.rpc("is_genuine_property_activity", {
    p_update: "Estate agent branch reconnected to this property.",
    p_updated_by: "system",
  });
  record(
    "Precondition: the SQL classifier counts 'Solicitors Instructed' and not a system notice",
    genuineLabel === true && systemLabel === false
  );

  // -------------------------------------------------------------------------
  // Fixtures
  // -------------------------------------------------------------------------
  const ea = await setupEa("main");
  const outsider = await setupEa("outsider");
  const fA = await homeownerSale("a", ea.branchId);
  const fB = await homeownerSale("b", null);
  const fC = await homeownerSale("c", null);
  const fE = await homeownerSale("e", ea.branchId);

  // -------------------------------------------------------------------------
  // W: priorities for fixtures that have never been calculated
  // -------------------------------------------------------------------------
  const queuedOnCreate = await queueRow(fB.chainId);
  const wA = await workFor(fA.chainId);
  const wB = await workFor(fB.chainId);
  record(
    "Q: creating a property queues its chain",
    queuedOnCreate != null,
    JSON.stringify(queuedOnCreate)
  );
  record(
    "W: missing summary on an active EA chain is priority 1 (missing_summary_ea)",
    wA?.reason === "missing_summary_ea" && wA.priority === 1,
    JSON.stringify(wA)
  );
  record(
    "W: a queued chain without a summary is priority 2 (queued)",
    wB?.priority === 2 && wB.reason.startsWith("queued:"),
    JSON.stringify(wB)
  );
  await clearQueue([fB.chainId]);
  const wBMissing = await workFor(fB.chainId);
  record(
    "W: an unqueued non-EA chain without a summary is still picked up (missing_summary)",
    wBMissing?.reason === "missing_summary" && wBMissing.priority === 4,
    JSON.stringify(wBMissing)
  );

  // W: completed chains are excluded.
  const { error: completeError } = await admin
    .from("chains")
    .update({ completed_at: new Date().toISOString() })
    .eq("id", fC.chainId);
  const wC = await workFor(fC.chainId);
  await admin.from("activities").insert({
    property_id: fC.propertyId,
    update: "Solicitors Instructed",
    updated_by: "homeowner",
    timestamp: new Date().toISOString(),
  });
  const { data: purged } = await admin.rpc("purge_chain_operational_refresh_queue");
  const cQueue = await queueRow(fC.chainId);
  record(
    "W: a completed chain is excluded from the work list and never queued",
    !completeError && wC == null && cQueue == null,
    JSON.stringify({ completeError: completeError?.message, work: wC, queue: cQueue, purged })
  );

  // W: batch limit.
  const limited = await workList(1);
  record("W: the work list respects the batch limit", limited.length === 1, `rows=${limited.length}`);

  // -------------------------------------------------------------------------
  // 1: the worker creates missing summaries
  // -------------------------------------------------------------------------
  const { data: rpcBefore } = await ea.client.rpc("get_chain_operational_intelligence", {
    p_chain_id: fA.chainId,
  });
  const batch = await runChainIntelligenceWorkerBatch(admin, { batchLimit: 1, maxBatches: 1 });
  record(
    "W: one worker batch with limit 1 processes exactly one chain, highest priority first",
    batch.candidateCount === 1 && batch.successCount === 1 && batch.errorCount === 0,
    JSON.stringify({ candidates: batch.candidateCount, reasons: batch.candidatesByReason, errors: batch.errors.slice(0, 2) })
  );
  const created = await process([fA.chainId, fB.chainId, fE.chainId]);
  const [sA, sB, sE] = await Promise.all([fA, fB, fE].map((f) => chainSummary(f.chainId)));
  const { data: rpcAfter } = await ea.client.rpc("get_chain_operational_intelligence", {
    p_chain_id: fA.chainId,
  });
  record(
    "1: missing summaries are created by the worker path (state missing → fresh)",
    created.failures.length === 0 &&
      [sA, sB, sE].every((s) => s?.summary_version === 3) &&
      rpcBefore?.summary_state === "missing" &&
      rpcBefore?.health_status == null &&
      rpcAfter?.summary_state === "fresh",
    JSON.stringify({ failures: created.failures, before: rpcBefore?.summary_state, after: rpcAfter?.summary_state })
  );
  const processedQueue = await Promise.all([fA, fB, fE].map((f) => queueRow(f.chainId)));
  record(
    "W: processed chains leave the queue and the work list",
    processedQueue.every((q) => q == null) &&
      (await workFor(fA.chainId)) == null &&
      (await workFor(fB.chainId)) == null,
    JSON.stringify(processedQueue)
  );

  // -------------------------------------------------------------------------
  // Q: what queues and what does not
  // -------------------------------------------------------------------------
  await adminActivity(
    { property_id: fA.propertyId },
    "Estate agent branch reconnected to this property.",
    "system",
    new Date().toISOString()
  );
  await admin.from("properties").update({ postcode: "E2 2OR" }).eq("id", fA.propertyId);
  record(
    "Q: a system notice and an irrelevant property edit do not queue",
    (await queueRow(fA.chainId)) == null
  );

  const { error: genuine1Error } = await fA.client.from("activities").insert({
    property_id: fA.propertyId,
    update: "Solicitors Instructed",
    updated_by: "homeowner",
  });
  const afterFirst = await queueRow(fA.chainId);
  const { error: genuine2Error } = await fA.client.from("activities").insert({
    property_id: fA.propertyId,
    update: "Searches Ordered",
    updated_by: "homeowner",
  });
  const afterSecond = await queueRow(fA.chainId);
  const { count: queueRowsForA } = await admin
    .from("chain_operational_refresh_queue")
    .select("chain_id", { count: "exact", head: true })
    .eq("chain_id", fA.chainId);
  record(
    "Q: genuine activity queues the chain (reason genuine_activity)",
    !genuine1Error && afterFirst?.reason === "genuine_activity" && afterFirst.request_count === 1,
    JSON.stringify({ error: genuine1Error?.message, row: afterFirst })
  );
  record(
    "Q: a duplicate request does not duplicate the queue row",
    !genuine2Error && queueRowsForA === 1 && afterSecond?.request_count === 2,
    JSON.stringify({ rows: queueRowsForA, row: afterSecond })
  );

  const dashQueued = (await loadAgentBranchPropertySummaries(ea.client)).find(
    (r) => r.property_id === fA.propertyId
  );
  const { data: rpcQueued } = await ea.client.rpc("get_chain_operational_intelligence", {
    p_chain_id: fA.chainId,
  });
  const wAQueued = await workFor(fA.chainId);
  record(
    "F: a queued chain reads as stale (Updating) on Dashboard and Chain view; worker sees queued work",
    dashQueued?.summary_state === "stale" &&
      rpcQueued?.summary_state === "stale" &&
      rpcQueued?.health_status != null &&
      wAQueued?.reason === "queued:genuine_activity",
    JSON.stringify({ dash: dashQueued?.summary_state, rpc: rpcQueued?.summary_state, work: wAQueued })
  );

  await process([fA.chainId]);
  const { data: stageRows } = await fA.client
    .from("properties")
    .update({ stage: "solicitors_instructed", stage_entered_at: new Date().toISOString() })
    .eq("id", fA.propertyId)
    .select("id");
  const stageQueue = await queueRow(fA.chainId);
  record(
    "Q: a stage change queues the chain",
    (stageRows ?? []).length === 1 && stageQueue != null,
    JSON.stringify({ rows: (stageRows ?? []).length, queue: stageQueue })
  );
  await process([fA.chainId]);

  // -------------------------------------------------------------------------
  // C: Last updated and the activity clock
  // -------------------------------------------------------------------------
  const { data: aActivities } = await admin
    .from("activities")
    .select("timestamp, update, updated_by")
    .eq("property_id", fA.propertyId)
    .order("timestamp", { ascending: false });
  const latestGenuine = (aActivities ?? []).find((a) => a.updated_by !== "system")?.timestamp as string | undefined;
  const dashA = (await loadAgentBranchPropertySummaries(ea.client)).find((r) => r.property_id === fA.propertyId);
  const posA = await propertySummary(fA.propertyId);
  record(
    "3/4: Last updated is the latest genuine activity; a newer system notice is ignored",
    sameInstant(dashA?.last_update_at, latestGenuine) &&
      sameInstant(posA?.last_update_at, latestGenuine) &&
      dashA?.activity_clock_source === "genuine_activity",
    JSON.stringify({ dash: dashA?.last_update_at, cache: posA?.last_update_at, source: dashA?.activity_clock_source })
  );

  const day3 = new Date(new Date(latestGenuine ?? Date.now()).getTime() + 2 * DAY_MS + HOUR_MS);
  await process([fA.chainId], day3);
  const posADay3 = await propertySummary(fA.propertyId);
  record(
    "12: Day 1 activity, Day 3 worker run → Last updated still Day 1 (2 days)",
    sameInstant(posADay3?.last_update_at, latestGenuine) &&
      posADay3?.days_since_last_update === 2 &&
      sameInstant(posADay3?.computed_at, day3.toISOString()),
    JSON.stringify(posADay3)
  );
  await process([fA.chainId]);

  // Fallback clock on B (no activity at all).
  const loadedB = await loadOperationalRefreshDatasets(admin, [fB.chainId]);
  const bProperty = loadedB.datasets[0]?.properties.find((p) => p.id === fB.propertyId);
  const bClock = bProperty?.activityClockAt ?? null;
  record(
    "5: an untouched property has a fallback clock (no genuine activity)",
    bClock != null &&
      bProperty?.genuineLastActivityAt === null &&
      bProperty?.activityClockSource !== "genuine_activity",
    JSON.stringify({ source: bProperty?.activityClockSource })
  );
  if (bClock) {
    const at = (days: number) => new Date(new Date(bClock).getTime() + days * DAY_MS + HOUR_MS);
    await process([fB.chainId], at(14));
    const b14 = await propertySummary(fB.propertyId);
    await process([fB.chainId], at(15));
    const b15 = await propertySummary(fB.propertyId);
    record(
      "6: fallback clock 14 days → not stale; 15 days → stale (page alert)",
      b14?.stale_update === false && b15?.stale_update === true && b15?.last_update_at == null,
      JSON.stringify({ d14: b14?.days_since_last_update, d15: b15?.days_since_last_update })
    );
    await process([fB.chainId], at(21));
    const c21 = await chainSummary(fB.chainId);
    await process([fB.chainId], at(22));
    const c22 = await chainSummary(fB.chainId);
    record(
      "7: fallback clock 21 days → not confidence-stale; 22 days → stale property in the chain",
      c21?.stale_count === 0 &&
        Array.isArray(c22?.stale_property_ids) &&
        (c22?.stale_property_ids as number[]).includes(fB.propertyId),
      JSON.stringify({ d21: c21?.stale_count, d22: c22?.stale_property_ids })
    );
    await process([fB.chainId]);
  }

  // -------------------------------------------------------------------------
  // T: Day 1 → Day 15 → Day 22 without page views
  // -------------------------------------------------------------------------
  const eActivity = await adminActivity(
    { property_id: fE.propertyId },
    "Solicitors Instructed",
    "homeowner",
    new Date(Date.now() - 16 * DAY_MS).toISOString()
  );
  const eDay1 = new Date(new Date(eActivity.timestamp).getTime() + HOUR_MS);
  await process([fE.chainId], eDay1);
  const eAfterDay1 = await chainSummary(fE.chainId);
  const wEDue = await workFor(fE.chainId);
  const tBatch = await runChainIntelligenceWorkerBatch(admin, { batchLimit: 50, maxBatches: 2 });
  const eAfterWorker = await chainSummary(fE.chainId);
  const posE = await propertySummary(fE.propertyId);
  const dashE = (await loadAgentBranchPropertySummaries(ea.client)).find((r) => r.property_id === fE.propertyId);
  const firstDue = eAfterDay1?.next_recalculation_at as string | undefined;
  const secondDue = eAfterWorker?.next_recalculation_at as string | undefined;
  const activityMs = new Date(eActivity.timestamp).getTime();
  record(
    "T: a summary computed on Day 1 is due by Day 15 and the worker picks it up (time_due) without a page view",
    firstDue != null &&
      new Date(firstDue).getTime() <= activityMs + 15 * DAY_MS + HOUR_MS &&
      wEDue?.reason === "time_due" &&
      tBatch.candidatesByReason.time_due >= 1,
    JSON.stringify({ firstDue, work: wEDue, reasons: tBatch.candidatesByReason })
  );
  record(
    "T: after the Day 15 run the property shows stale (Requires Action) and the next run is due by Day 22",
    posE?.stale_update === true &&
      dashE?.needs_attention === true &&
      sameInstant(dashE?.last_update_at, eActivity.timestamp) &&
      secondDue != null &&
      new Date(secondDue).getTime() > Date.now() &&
      new Date(secondDue).getTime() <= activityMs + 22 * DAY_MS + HOUR_MS,
    JSON.stringify({ stale: posE?.stale_update, needsAttention: dashE?.needs_attention, secondDue })
  );

  // -------------------------------------------------------------------------
  // B: Buyer Ready
  // -------------------------------------------------------------------------
  const { data: node, error: nodeError } = await admin
    .from("chain_nodes")
    .insert({
      chain_id: fA.chainId,
      linked_property_id: fA.propertyId,
      node_type: "buyer_ready",
      user_id: fA.userId,
      position: 0,
      stage: "mortgage_preparation",
      status: "healthy",
      progress: 10,
    })
    .select("id")
    .single();
  const nodeId = node?.id as number | undefined;
  await process([fA.chainId]);
  const posABefore = await propertySummary(fA.propertyId);
  let nodeActivity: { timestamp: string } | null = null;
  if (nodeId) {
    nodeActivity = await adminActivity(
      { chain_node_id: nodeId },
      "Solicitors Instructed",
      "homeowner",
      new Date().toISOString()
    );
  }
  const nodeQueue = await queueRow(fA.chainId);
  record(
    "Q/B: genuine Buyer Ready activity queues the chain (reason buyer_ready_activity)",
    !nodeError && nodeQueue?.reason === "buyer_ready_activity",
    JSON.stringify({ nodeError: nodeError?.message, queue: nodeQueue })
  );
  await process([fA.chainId]);
  const posAAfterNode = await propertySummary(fA.propertyId);
  const dashAAfterNode = (await loadAgentBranchPropertySummaries(ea.client)).find(
    (r) => r.property_id === fA.propertyId
  );
  record(
    "8: Buyer Ready activity does not change the property's Last updated",
    sameInstant(posAAfterNode?.last_update_at, posABefore?.last_update_at) &&
      sameInstant(dashAAfterNode?.last_update_at, latestGenuine) &&
      sameInstant(posAAfterNode?.buyer_ready_last_update, nodeActivity?.timestamp),
    JSON.stringify({
      before: posABefore?.last_update_at,
      after: posAAfterNode?.last_update_at,
      buyerReady: posAAfterNode?.buyer_ready_last_update,
    })
  );
  await process([fA.chainId], new Date(Date.now() + 23 * DAY_MS));
  const aStalled = await chainSummary(fA.chainId);
  const posAStalled = await propertySummary(fA.propertyId);
  record(
    "8: a stalled Buyer Ready node (23 days) makes the chain Buyer Ready stale and not Stable",
    aStalled?.buyer_ready_stale === true &&
      aStalled?.health_status !== "stable" &&
      posAStalled?.buyer_ready_stale === true,
    JSON.stringify({ chain: aStalled?.health_status, brStale: aStalled?.buyer_ready_stale })
  );
  await process([fA.chainId]);
  const aNow = await chainSummary(fA.chainId);
  record(
    "8: with a fresh Buyer Ready node the chain is not Buyer Ready stale",
    aNow?.buyer_ready_stale === false,
    JSON.stringify(aNow)
  );

  // -------------------------------------------------------------------------
  // P: parity and privacy
  // -------------------------------------------------------------------------
  const dash = (await loadAgentBranchPropertySummaries(ea.client)).find(
    (r) => r.property_id === fA.propertyId
  ) as AgentBranchPropertySummary | undefined;
  const { data: rpc } = await ea.client.rpc("get_chain_operational_intelligence", { p_chain_id: fA.chainId });
  type Clock = { property_id: number; activity_clock_at: string | null };
  record(
    "11: Dashboard and Chain view read the same cached summary (state, health, confidence)",
    dash != null &&
      rpc != null &&
      dash.summary_state === rpc.summary_state &&
      dash.health_status === rpc.health_status &&
      dash.confidence_score === rpc.confidence_score &&
      (rpc.property_clocks as Clock[]).length === 0,
    JSON.stringify({
      dash: [dash?.summary_state, dash?.health_status, dash?.confidence_score],
      rpc: [rpc?.summary_state, rpc?.health_status, rpc?.confidence_score],
      clocks: rpc?.property_clocks,
    })
  );
  const dashEParity = (await loadAgentBranchPropertySummaries(ea.client)).find(
    (r) => r.property_id === fE.propertyId
  );
  const { data: rpcE } = await ea.client.rpc("get_chain_operational_intelligence", { p_chain_id: fE.chainId });
  const rpcEClock = (rpcE?.property_clocks as Clock[] | undefined)?.find((c) => c.property_id === fE.propertyId);
  record(
    "11: a stale bottleneck property shows the same clock and health on Dashboard and Chain view",
    rpcE?.bottleneck_property_id === fE.propertyId &&
      sameInstant(rpcEClock?.activity_clock_at, dashEParity?.activity_clock_at) &&
      sameInstant(rpcEClock?.activity_clock_at, eActivity.timestamp) &&
      rpcE?.health_status === dashEParity?.health_status &&
      rpcE?.confidence_score === dashEParity?.confidence_score,
    JSON.stringify({
      bottleneck: rpcE?.bottleneck_property_id === fE.propertyId,
      clocksEqual: sameInstant(rpcEClock?.activity_clock_at, dashEParity?.activity_clock_at),
      health: [rpcE?.health_status, dashEParity?.health_status],
    })
  );
  const { data: homeownerRpc } = await fA.client.rpc("get_chain_operational_intelligence", { p_chain_id: fA.chainId });
  const { data: outsiderRpc, error: outsiderError } = await outsider.client.rpc("get_chain_operational_intelligence", {
    p_chain_id: fA.chainId,
  });
  const { data: otherHomeownerRpc } = await fB.client.rpc("get_chain_operational_intelligence", {
    p_chain_id: fA.chainId,
  });
  const { data: anonRpc, error: anonError } = await anonClient().rpc("get_chain_operational_intelligence", {
    p_chain_id: fA.chainId,
  });
  record(
    "13: the chain's homeowner sees the cached summary; an outsider EA and another homeowner get null; anon is refused",
    homeownerRpc?.summary_state === "fresh" &&
      !outsiderError &&
      outsiderRpc == null &&
      otherHomeownerRpc == null &&
      Boolean(anonError) &&
      anonRpc == null,
    JSON.stringify({ homeowner: homeownerRpc?.summary_state, outsider: outsiderRpc, other: otherHomeownerRpc, anon: anonError?.code })
  );
  const { error: anonQueueError } = await anonClient().from("chain_operational_refresh_queue").select("chain_id").limit(1);
  const { data: eaQueueRows, error: eaQueueError } = await ea.client
    .from("chain_operational_refresh_queue")
    .select("chain_id")
    .limit(1);
  const { error: eaWorkError } = await ea.client.rpc("list_chain_operational_refresh_work", { p_limit: 1 });
  const { error: eaPersistError } = await ea.client.rpc("persist_chain_operational_refreshes", {
    p_items: [],
    p_snapshot_at: new Date().toISOString(),
  });
  record(
    "L: the queue, work list and persist RPC are service-role only",
    Boolean(anonQueueError) &&
      (Boolean(eaQueueError) || (eaQueueRows ?? []).length === 0) &&
      Boolean(eaWorkError) &&
      Boolean(eaPersistError),
    JSON.stringify({ anon: anonQueueError?.code, ea: eaQueueError?.code, work: eaWorkError?.code, persist: eaPersistError?.code })
  );
  const clockViewErrors: string[] = [];
  for (const view of ["property_operational_clock_fallback", "property_operational_clock", "chain_node_operational_clock"]) {
    const { data: eaRows, error: eaError } = await ea.client.from(view).select("*").limit(1);
    const { data: anonRows, error: anonViewError } = await anonClient().from(view).select("*").limit(1);
    if (!eaError || (eaRows ?? []).length > 0 || !anonViewError || (anonRows ?? []).length > 0) {
      clockViewErrors.push(view);
    }
  }
  record(
    "L: the activity clock views are not readable by authenticated users or anon",
    clockViewErrors.length === 0,
    clockViewErrors.join(",")
  );

  // -------------------------------------------------------------------------
  // PP: Property page action state from the cached property clock
  // -------------------------------------------------------------------------
  const ownerAccess: WorkflowAccess = {
    canView: true,
    canEdit: true,
    mode: "editable",
    viewerRole: "owner",
    bannerMessage: null,
  };
  const eaAccess: WorkflowAccess = { ...ownerAccess, viewerRole: "estate_agent" };
  const pageAction = (access: WorkflowAccess, clock: CachedPropertyClock | null) =>
    getPropertyActionMessage({
      access,
      activeDelayReason: null,
      staleClockDays: cachedPropertyClockDays(clock),
      isCompletionLifecycleFrozen: false,
    });

  const eClock = await loadCachedPropertyClock(ea.client, fE.propertyId);
  const eAction = pageAction(eaAccess, eClock);
  record(
    "PP-A/G: genuine activity 16 days ago → the assigned EA's Property page reads the cached clock and shows the EA stale wording",
    sameInstant(eClock?.activity_clock_at, eActivity.timestamp) &&
      sameInstant(eClock?.last_update_at, eActivity.timestamp) &&
      cachedPropertyClockDays(eClock) === 16 &&
      eAction.title === "Progress Update Recommended" &&
      eAction.message ===
        "No updates have been added for 16 days. Consider posting an update on behalf of the homeowner.",
    JSON.stringify({ days: cachedPropertyClockDays(eClock), action: eAction })
  );

  const { data: outsiderClockRows } = await outsider.client
    .from("property_operational_summary")
    .select("property_id")
    .eq("property_id", fE.propertyId);
  const otherHomeownerClock = await loadCachedPropertyClock(fB.client, fE.propertyId);
  const anonClock = await loadCachedPropertyClock(anonClient(), fE.propertyId);
  record(
    "PP: the cached property clock is not readable by an outsider EA, another chain's homeowner or anon",
    (outsiderClockRows ?? []).length === 0 && otherHomeownerClock == null && anonClock == null,
    JSON.stringify({
      outsider: (outsiderClockRows ?? []).length,
      other: otherHomeownerClock?.property_id ?? null,
      anon: anonClock?.property_id ?? null,
    })
  );

  await adminActivity(
    { property_id: fE.propertyId },
    "Estate agent branch reconnected to this property.",
    "system",
    new Date().toISOString()
  );
  const eNoticeQueue = await queueRow(fE.chainId);
  const { data: eActivityRows } = await admin
    .from("activities")
    .select("timestamp, update, updated_by")
    .eq("property_id", fE.propertyId);
  const eActivities = (eActivityRows ?? []) as Array<{ timestamp: string; update: string; updated_by?: string }>;
  const eClockAfterNotice = await loadCachedPropertyClock(ea.client, fE.propertyId);
  const eNoticeBehind = isCachedPropertyClockBehind(eClockAfterNotice, eActivities);
  await process([fE.chainId]);
  const eClockAfterNoticeRun = await loadCachedPropertyClock(ea.client, fE.propertyId);
  record(
    "PP-D: a newer system notice does not queue or reset the Property page clock, even after recalculation",
    eNoticeQueue == null &&
      eNoticeBehind &&
      sameInstant(eClockAfterNoticeRun?.activity_clock_at, eActivity.timestamp) &&
      pageAction(eaAccess, eClockAfterNoticeRun).title === "Progress Update Recommended",
    JSON.stringify({
      queue: eNoticeQueue,
      behind: eNoticeBehind,
      clock: eClockAfterNoticeRun?.activity_clock_at,
    })
  );

  const eFresh = await adminActivity(
    { property_id: fE.propertyId },
    "Searches Ordered",
    "homeowner",
    new Date().toISOString()
  );
  const eBehindBeforeRun = isCachedPropertyClockBehind(
    await loadCachedPropertyClock(ea.client, fE.propertyId),
    [...eActivities, { timestamp: eFresh.timestamp, update: "Searches Ordered", updated_by: "homeowner" }]
  );
  await process([fE.chainId]);
  const eClockAfterGenuine = await loadCachedPropertyClock(ea.client, fE.propertyId);
  const eActionAfterGenuine = pageAction(eaAccess, eClockAfterGenuine);
  record(
    "PP-E/G: genuine activity resets the Property page clock once the chain is recalculated (EA wording)",
    eBehindBeforeRun &&
      sameInstant(eClockAfterGenuine?.activity_clock_at, eFresh.timestamp) &&
      cachedPropertyClockDays(eClockAfterGenuine) === 0 &&
      eActionAfterGenuine.title === "No Immediate Actions" &&
      eActionAfterGenuine.message === "This transaction appears to be progressing normally.",
    JSON.stringify({ behind: eBehindBeforeRun, action: eActionAfterGenuine })
  );

  const fallbackClockAt = async (days: number) => {
    await admin
      .from("properties")
      .update({ stage_entered_at: new Date(Date.now() - days * DAY_MS - HOUR_MS).toISOString() })
      .eq("id", fB.propertyId);
    await process([fB.chainId]);
    return loadCachedPropertyClock(fB.client, fB.propertyId);
  };
  const b20 = await fallbackClockAt(20);
  const b20Action = pageAction(ownerAccess, b20);
  record(
    "PP-B: no activity, fallback clock 20 days → the owner's Property page shows Update Recommended without a Last updated date",
    b20?.last_update_at == null &&
      cachedPropertyClockDays(b20) === 20 &&
      b20Action.title === "Update Recommended" &&
      b20Action.message ===
        "No updates have been added for 20 days. Consider checking progress with your estate agent or conveyancer.",
    JSON.stringify({ lastUpdate: b20?.last_update_at, days: cachedPropertyClockDays(b20), action: b20Action })
  );
  const b14 = await fallbackClockAt(14);
  const b15 = await fallbackClockAt(15);
  const b10 = await fallbackClockAt(10);
  record(
    "PP-C: no activity, fallback clock 10 and 14 days → no stale alert; 15 days → Update Recommended",
    pageAction(ownerAccess, b10).title === "No Immediate Actions" &&
      pageAction(ownerAccess, b14).title === "No Immediate Actions" &&
      pageAction(ownerAccess, b15).title === "Update Recommended" &&
      pageAction(ownerAccess, b10).message === "Your transaction appears to be progressing normally.",
    JSON.stringify({
      d10: cachedPropertyClockDays(b10),
      d14: cachedPropertyClockDays(b14),
      d15: cachedPropertyClockDays(b15),
    })
  );
}

async function cleanup(ctx: Ctx): Promise<void> {
  const { admin } = ctx;
  const warn = (label: string, error: { message: string } | null) => {
    if (error) console.warn(`cleanup ${label}: ${error.message}`);
  };

  for (const chainId of ctx.chainIds) {
    const { data: props } = await admin.from("properties").select("id").eq("chain_id", chainId);
    const ids = (props ?? []).map((p) => p.id as number);
    const { data: nodes } = await admin.from("chain_nodes").select("id").eq("chain_id", chainId);
    const nodeIds = (nodes ?? []).map((n) => n.id as number);

    warn("operational_delays", (await admin.from("operational_delays").delete().eq("chain_id", chainId)).error);
    warn("chain_completion_events", (await admin.from("chain_completion_events").delete().eq("chain_id", chainId)).error);
    if (nodeIds.length > 0) {
      warn("node activities", (await admin.from("activities").delete().in("chain_node_id", nodeIds)).error);
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
        "property_lifecycle_still_active_confirmations",
        "property_lifecycle_events",
        "property_lifecycle_states",
        "property_operational_summary",
      ]) {
        warn(table, (await admin.from(table).delete().in("property_id", ids)).error);
      }
      warn("unlink", (await admin.from("properties").update({ linked_property_id: null }).in("id", ids)).error);
    }

    warn("chain_nodes", (await admin.from("chain_nodes").delete().eq("chain_id", chainId)).error);
    if (ids.length > 0) {
      warn("properties", (await admin.from("properties").delete().in("id", ids)).error);
    }
    warn("chain_operational_summary", (await admin.from("chain_operational_summary").delete().eq("chain_id", chainId)).error);
    warn("chains", (await admin.from("chains").delete().eq("id", chainId)).error);
    warn(
      "chain_operational_refresh_queue",
      (await admin.from("chain_operational_refresh_queue").delete().eq("chain_id", chainId)).error
    );
  }

  for (const branchId of ctx.branchIds) {
    warn("ea_branches", (await admin.from("ea_branches").delete().eq("id", branchId)).error);
  }
  for (const companyId of ctx.companyIds) {
    warn("ea_companies", (await admin.from("ea_companies").delete().eq("id", companyId)).error);
  }
  for (const userId of ctx.userIds) {
    warn("profiles", (await admin.from("profiles").delete().eq("id", userId)).error);
    warn("auth user", (await admin.auth.admin.deleteUser(userId)).error);
  }

  const { count } = await admin
    .from("properties")
    .select("id", { count: "exact", head: true })
    .in("chain_id", ctx.chainIds.length > 0 ? ctx.chainIds : [-1]);
  const { count: queueLeft } = await admin
    .from("chain_operational_refresh_queue")
    .select("chain_id", { count: "exact", head: true })
    .in("chain_id", ctx.chainIds.length > 0 ? ctx.chainIds : [-1]);
  console.log(`\ncleanup: fixture properties remaining = ${count ?? "unknown"}; queue rows remaining = ${queueLeft ?? "unknown"}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
