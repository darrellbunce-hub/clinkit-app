/**
 * Development-only verification of the EA dashboard "Last updated" rule
 * (supabase/migrations/20261005170000_dashboard_genuine_last_update.sql).
 *
 * "Last updated" is the most recent genuine operational activity on the
 * property, read from activity history by agent_branch_property_summaries.
 *
 *   C   is_genuine_property_activity classifies the agreed types only
 *   A   no activity                      -> NULL, "No updates recorded"
 *   B   genuine activity today           -> "Updated today"
 *   B2  client-chosen activity timestamps are replaced by the server time
 *   C2  genuine activity yesterday       -> "Updated yesterday" (calendar day)
 *   D   older genuine activity           -> London calendar-day age
 *   E   system notice newer than genuine -> the genuine activity
 *   E2  system notices only              -> NULL
 *   M   genuine activity with no summary row is shown
 *   F   a homeowner summary request only queues the chain
 *   G   chain-intelligence refresh (service role) changes nothing; the
 *       cache agrees with the dashboard and the chain leaves the queue
 *   K   a client-written summary last_update_at is ignored
 *   H   lifecycle transition + archive changes nothing; a revoked branch
 *       does not see activity after its revocation
 *   I   repeated dashboard loads change nothing and write nothing
 *   J   sorting: no genuine activity sorts oldest
 *   S   outsider EA / homeowner / anon see nothing
 *
 * Fixtures are created with real auth users (admin API) and removed at the end.
 *
 * Usage (after the migration is applied to Development):
 *   npx tsx scripts/verify-dashboard-genuine-last-update-development.ts
 */
import { readFileSync } from "fs";
import { join } from "path";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { AgentBranchPropertySummary } from "../lib/estateAgent/assignmentTypes";
import {
  assignPropertyToBranch,
  loadAgentBranchPropertySummaries,
} from "../lib/estateAgent/assignments";
import {
  compareLeastRecentlyUpdatedFirst,
  formatDaysSinceLastUpdate,
  resolveDaysSinceLastUpdate,
} from "../lib/estateAgent/commandCentrePresentation";
import { refreshOperationalSummaryForWorker } from "../lib/operationalSummary/refreshOperationalSummary";

const DEVELOPMENT_SUPABASE_PROJECT_REF = "bbbsxzxcjkmpqsfvmhbo";
const PASSWORD = "DashLastUpdateVerify123!";
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const REASON = "dashboard_last_update_verifier";

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

/** Independent of the app helper: London calendar date as a day number. */
function londonDay(date: Date): number {
  const [year, month, day] = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" })
    .format(date)
    .split("-")
    .map(Number);
  return Date.UTC(year, month - 1, day) / DAY_MS;
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
  console.log("=== EA dashboard 'Last updated' verification (Development only) ===\n");
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
    const email = `dash-lu-${label}-${stamp}@keynetic-test.dev`;
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
    const domain = `dash-lu-${label}-${stamp}.dev`;
    const { client, userId } = await user(`ea-${label}`);
    await client.from("profiles").upsert({
      id: userId,
      role: "homeowner",
      account_type: "estate_agent",
      contact_name: `EA Dash ${label}`,
      email_domain: domain,
      onboarding_completed_at: new Date().toISOString(),
    });
    const { data: company, error: companyError } = await client
      .from("ea_companies")
      .insert({ name: `Dash Agency ${label} ${stamp}`, email_domain: domain, created_by_user_id: userId })
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

  async function homeownerSale(label: string, branchId: string): Promise<Fixture> {
    const n = ++seq;
    const { client, userId } = await user(`ho-${label}`);
    await client.from("profiles").upsert({
      id: userId,
      role: "homeowner",
      account_type: "homeowner",
      contact_name: `HO Dash ${label}`,
      onboarding_completed_at: new Date().toISOString(),
    });
    const { data: chain, error: chainError } = await client.rpc("create_chain_for_onboarding", {
      p_name: `Dash ${label} ${stamp}`,
      p_access_code: `KN-DL${n}-${stamp}`,
    });
    if (chainError || !chain?.chain_id) throw new Error(`chain failed (${label}): ${chainError?.message}`);
    const chainId = chain.chain_id as number;
    ctx.chainIds.push(chainId);
    const { data: sale, error: saleError } = await client
      .from("properties")
      .insert({
        chain_id: chainId,
        chain_position: 1,
        address: `Dash ${label} ${stamp}`,
        postcode: "E2 2DL",
        stage: "property_listed",
        status: "pending_connection",
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
    const assigned = await assignPropertyToBranch(client, { propertyId, branchId, homeownerOnlyUpdates: false });
    if (assigned.error) throw new Error(`assign failed (${label}): ${assigned.error}`);
    return { client, userId, propertyId, chainId };
  }

  async function adminActivity(propertyId: number, update: string, updatedBy: string | null, timestamp: string) {
    const { data, error } = await admin
      .from("activities")
      .insert({ property_id: propertyId, update, updated_by: updatedBy, timestamp })
      .select("id, timestamp")
      .single();
    if (error || !data) throw new Error(`activity insert failed: ${error?.message}`);
    return data as { id: number; timestamp: string };
  }

  const sameInstant = (a: string | null | undefined, b: string | null | undefined) =>
    a != null && b != null && new Date(a).getTime() === new Date(b).getTime();

  // -------------------------------------------------------------------------
  // C: classification
  // -------------------------------------------------------------------------
  const nl = "\n";
  const cases: Array<[string, string | null, boolean]> = [
    ["Solicitors Instructed", "homeowner", true],
    ["Survey Booked", "estate_agent", true],
    ["Completed", "homeowner", true],
    ["Delay reported \u2014 Awaiting Searches", "homeowner", true],
    ["Delay resolved \u2014 Awaiting Searches", "estate_agent", true],
    ["Delay Reported: Awaiting Searches", "homeowner", true],
    ["Onward purchase added", "estate_agent", true],
    ["Onward purchase added", null, true],
    ["Chain Connection Broken - Seller Side", "homeowner", true],
    [`Completion date updated${nl}${nl}From 1 Nov to 8 Nov${nl}${nl}Reason:${nl}Administrative correction`, "homeowner", true],
    ["Solicitors Instructed", "system", false],
    ["Chain Connection Broken - Buyer Side", "system", false],
    ["Estate agent branch reconnected to this property.", "system", false],
    ["Property operational participation archived by lifecycle automation.", "system", false],
    ["Property released for future transactions. Historic chain data retained.", "system", false],
    ["Homeowner left this transaction. The estate agent continues to manage the property.", "system", false],
    ["Estate agent branch released operational management of this property.", "system", false],
    ["Homeowner removed the estate agent branch from this property.", "homeowner", false],
    [`Completion Confirmed${nl}${nl}Transaction marked as completed.`, "homeowner", false],
    ["Awaiting Documents", "homeowner", false],
    ["Reconcile test", "homeowner", false],
    ["", "homeowner", false],
  ];
  const misclassified: string[] = [];
  for (const [text, by, expected] of cases) {
    const { data, error } = await admin.rpc("is_genuine_property_activity", { p_update: text, p_updated_by: by });
    if (error || data !== expected) misclassified.push(`${JSON.stringify(text.slice(0, 40))}/${by}=${error?.message ?? data}`);
  }
  record(
    "C: is_genuine_property_activity counts only the agreed types and never a system author",
    misclassified.length === 0,
    misclassified.join("; ")
  );
  const { error: anonFnError } = await anonClient().rpc("is_genuine_property_activity", {
    p_update: "Solicitors Instructed",
    p_updated_by: "homeowner",
  });
  record("S: anon cannot execute is_genuine_property_activity", Boolean(anonFnError), anonFnError?.code ?? "no error");

  // -------------------------------------------------------------------------
  // Fixtures
  // -------------------------------------------------------------------------
  const ea = await setupEa("main");
  const outsider = await setupEa("outsider");
  const pNone = await homeownerSale("none", ea.branchId);
  const pToday = await homeownerSale("today", ea.branchId);
  const pYesterday = await homeownerSale("yesterday", ea.branchId);
  const pOlder = await homeownerSale("older", ea.branchId);
  const pSystemNewer = await homeownerSale("sysnewer", ea.branchId);
  const pSystemOnly = await homeownerSale("sysonly", ea.branchId);
  const pLifecycle = await homeownerSale("lifecycle", ea.branchId);
  const all = [pNone, pToday, pYesterday, pOlder, pSystemNewer, pSystemOnly, pLifecycle];
  const ids = all.map((f) => f.propertyId);

  const now = Date.now();

  // B / B2: genuine homeowner updates today, with forged client timestamps.
  const { error: pastForgeError } = await pToday.client.from("activities").insert({
    property_id: pToday.propertyId,
    update: "Solicitors Instructed",
    updated_by: "homeowner",
    timestamp: "2020-01-01T00:00:00.000Z",
  });
  const { error: futureForgeError } = await pToday.client.from("activities").insert({
    property_id: pToday.propertyId,
    update: "Searches Ordered",
    updated_by: "homeowner",
    timestamp: new Date(now + 400 * DAY_MS).toISOString(),
  });
  const { data: todayRows } = await admin
    .from("activities")
    .select("timestamp")
    .eq("property_id", pToday.propertyId);
  const todayStamps = (todayRows ?? []).map((r) => new Date(r.timestamp as string).getTime());
  record(
    "B2: client-chosen activity timestamps (past and future) are replaced by the server time",
    !pastForgeError &&
      !futureForgeError &&
      todayStamps.length === 2 &&
      todayStamps.every((t) => Math.abs(t - Date.now()) < 10 * 60_000),
    JSON.stringify({ pastForgeError: pastForgeError?.message, futureForgeError: futureForgeError?.message, todayStamps })
  );

  // C2: yesterday by the London calendar, inside 24 hours when possible.
  let yesterdayAt = now - 23.5 * HOUR_MS;
  const withinRolling24h = londonDay(new Date(now)) - londonDay(new Date(yesterdayAt)) === 1;
  if (!withinRolling24h) yesterdayAt = now - 25 * HOUR_MS;
  const yesterdayActivity = await adminActivity(
    pYesterday.propertyId,
    "Survey Booked",
    "homeowner",
    new Date(yesterdayAt).toISOString()
  );

  // D: older.
  const olderAt = now - 10 * DAY_MS;
  const olderActivity = await adminActivity(pOlder.propertyId, "Searches Ordered", "estate_agent", new Date(olderAt).toISOString());
  const olderExpectedDays = londonDay(new Date(now)) - londonDay(new Date(olderAt));
  const calendarDaysAgo = (days: number) => londonDay(new Date(now)) - londonDay(new Date(now - days * DAY_MS));

  // E: genuine five days ago, then a newer system notice.
  const systemNewerGenuine = await adminActivity(
    pSystemNewer.propertyId,
    "Offer Accepted",
    "homeowner",
    new Date(now - 5 * DAY_MS).toISOString()
  );
  const systemNewerNotice = await adminActivity(
    pSystemNewer.propertyId,
    "Estate agent branch reconnected to this property.",
    "system",
    new Date(now).toISOString()
  );

  // E2: system notices only.
  await adminActivity(
    pSystemOnly.propertyId,
    "Homeowner left this transaction. The estate agent continues to manage the property.",
    "system",
    new Date(now - DAY_MS).toISOString()
  );
  await adminActivity(pSystemOnly.propertyId, "Estate agent branch reconnected to this property.", "system", new Date(now).toISOString());

  // H: genuine four days ago before lifecycle processing.
  const lifecycleGenuine = await adminActivity(
    pLifecycle.propertyId,
    "Solicitors Instructed",
    "homeowner",
    new Date(now - 4 * DAY_MS).toISOString()
  );

  async function dashboard(client: SupabaseClient = ea.client) {
    const rows = await loadAgentBranchPropertySummaries(client);
    const byProperty = new Map<number, AgentBranchPropertySummary>();
    for (const r of rows) if (ids.includes(r.property_id)) byProperty.set(r.property_id, r);
    return byProperty;
  }
  const label = (r: AgentBranchPropertySummary | undefined) =>
    r ? formatDaysSinceLastUpdate(resolveDaysSinceLastUpdate(r)) : "missing";
  const snapshot = (m: Map<number, AgentBranchPropertySummary>) =>
    JSON.stringify(ids.map((id) => [id, m.get(id)?.last_update_at ?? null, m.get(id)?.days_since_last_update ?? null]));

  const { data: summariesBefore } = await admin
    .from("property_operational_summary")
    .select("property_id")
    .in("property_id", ids);
  const v0 = await dashboard();

  record("Fixture: the EA sees all seven fixture properties", v0.size === 7, `seen=${v0.size}`);
  record(
    "A: no activity → last_update_at NULL, days NULL, 'No updates recorded'",
    v0.get(pNone.propertyId)?.last_update_at == null &&
      v0.get(pNone.propertyId)?.days_since_last_update == null &&
      label(v0.get(pNone.propertyId)) === "No updates recorded",
    JSON.stringify(v0.get(pNone.propertyId))
  );
  record(
    "B: genuine activity today → 'Updated today'",
    label(v0.get(pToday.propertyId)) === "Updated today" && v0.get(pToday.propertyId)?.days_since_last_update === 0,
    label(v0.get(pToday.propertyId))
  );
  record(
    `C2: genuine activity yesterday (London) → 'Updated yesterday'${withinRolling24h ? " although under 24 hours ago" : ""}`,
    sameInstant(v0.get(pYesterday.propertyId)?.last_update_at, yesterdayActivity.timestamp) &&
      label(v0.get(pYesterday.propertyId)) === "Updated yesterday" &&
      v0.get(pYesterday.propertyId)?.days_since_last_update === 1,
    `${label(v0.get(pYesterday.propertyId))} / db=${v0.get(pYesterday.propertyId)?.days_since_last_update}`
  );
  record(
    `D: older genuine activity → ${olderExpectedDays} London calendar days (view and UI agree)`,
    sameInstant(v0.get(pOlder.propertyId)?.last_update_at, olderActivity.timestamp) &&
      v0.get(pOlder.propertyId)?.days_since_last_update === olderExpectedDays &&
      label(v0.get(pOlder.propertyId)) === `${olderExpectedDays} days since last update`,
    `${label(v0.get(pOlder.propertyId))} / db=${v0.get(pOlder.propertyId)?.days_since_last_update}`
  );
  record(
    "E: a newer system notice is ignored; the older genuine activity is used (5 days)",
    sameInstant(v0.get(pSystemNewer.propertyId)?.last_update_at, systemNewerGenuine.timestamp) &&
      !sameInstant(v0.get(pSystemNewer.propertyId)?.last_update_at, systemNewerNotice.timestamp) &&
      label(v0.get(pSystemNewer.propertyId)) === `${calendarDaysAgo(5)} days since last update`,
    label(v0.get(pSystemNewer.propertyId))
  );
  record(
    "E2: system notices only → 'No updates recorded'",
    v0.get(pSystemOnly.propertyId)?.last_update_at == null && label(v0.get(pSystemOnly.propertyId)) === "No updates recorded",
    JSON.stringify(v0.get(pSystemOnly.propertyId)?.last_update_at)
  );
  record(
    "M: genuine activity shows without any summary row (the 'No updates recorded' false negative)",
    (summariesBefore ?? []).length === 0 && label(v0.get(pToday.propertyId)) === "Updated today",
    `summary rows before refresh=${(summariesBefore ?? []).length}`
  );

  // -------------------------------------------------------------------------
  // F: a homeowner-client summary request only queues the chain
  // -------------------------------------------------------------------------
  const refreshErrors: string[] = [];
  for (const f of all) {
    const { error } = await f.client.rpc("upsert_operational_summaries", {
      p_chain_summary: { chain_id: f.chainId },
      p_property_summaries: [],
    });
    if (error) refreshErrors.push(`${f.propertyId}:${error.message}`);
  }
  const { data: cacheAfterClient } = await admin
    .from("property_operational_summary")
    .select("property_id")
    .in("property_id", ids);
  const { data: queuedAfterClient } = await admin
    .from("chain_operational_refresh_queue")
    .select("chain_id")
    .in("chain_id", all.map((f) => f.chainId));
  const v1 = await dashboard();
  record(
    "F: a homeowner summary request queues the chain, writes no summary and changes no Last updated",
    refreshErrors.length === 0 &&
      (cacheAfterClient ?? []).length === 0 &&
      (queuedAfterClient ?? []).length === all.length &&
      snapshot(v1) === snapshot(v0),
    refreshErrors.join("; ") ||
      JSON.stringify({ cache: (cacheAfterClient ?? []).length, queued: (queuedAfterClient ?? []).length })
  );

  // -------------------------------------------------------------------------
  // G: chain-intelligence refresh (the worker's per-chain path, service role)
  // -------------------------------------------------------------------------
  const workerErrors: string[] = [];
  for (const f of all) {
    const result = await refreshOperationalSummaryForWorker(admin, f.chainId);
    if (!result.ok) workerErrors.push(`${f.propertyId}:${result.error}`);
  }
  const v2 = await dashboard();
  record(
    "G: chain-intelligence refresh does not change Last updated for any fixture",
    workerErrors.length === 0 && snapshot(v2) === snapshot(v0),
    workerErrors.join("; ") || undefined
  );
  const { data: cache } = await admin
    .from("property_operational_summary")
    .select("property_id, last_update_at, activity_clock_source, summary_version")
    .in("property_id", ids);
  const cacheOf = (id: number) => (cache ?? []).find((c) => c.property_id === id);
  record(
    "G: the cached summary agrees with the dashboard (no activity → null; system notice ignored)",
    cacheOf(pNone.propertyId)?.last_update_at == null &&
      cacheOf(pNone.propertyId)?.activity_clock_source !== "genuine_activity" &&
      sameInstant(cacheOf(pSystemNewer.propertyId)?.last_update_at, systemNewerGenuine.timestamp) &&
      cacheOf(pSystemOnly.propertyId)?.last_update_at == null &&
      sameInstant(cacheOf(pOlder.propertyId)?.last_update_at, olderActivity.timestamp) &&
      (cache ?? []).every((c) => c.summary_version === 3),
    JSON.stringify({ none: cacheOf(pNone.propertyId), sysNewer: cacheOf(pSystemNewer.propertyId) })
  );
  const { data: v2Queue } = await admin
    .from("chain_operational_refresh_queue")
    .select("chain_id")
    .in("chain_id", all.map((f) => f.chainId));
  record(
    "G: a processed chain leaves the refresh queue",
    (v2Queue ?? []).length === 0,
    `queued=${(v2Queue ?? []).length}`
  );

  // -------------------------------------------------------------------------
  // K: a client-written summary last_update_at
  // -------------------------------------------------------------------------
  const forged = new Date().toISOString();
  const { data: chainSummary } = await admin
    .from("chain_operational_summary")
    .select("health_status")
    .eq("chain_id", pOlder.chainId)
    .maybeSingle();
  const { error: forgeError } = await pOlder.client.rpc("upsert_operational_summaries", {
    p_chain_summary: { chain_id: pOlder.chainId, health_status: chainSummary?.health_status ?? null },
    p_property_summaries: [
      {
        property_id: pOlder.propertyId,
        current_stage: "property_listed",
        property_status: "pending_connection",
        last_update_at: forged,
        days_since_last_update: 0,
      },
    ],
  });
  const { data: forgedCache } = await admin
    .from("property_operational_summary")
    .select("last_update_at")
    .eq("property_id", pOlder.propertyId)
    .maybeSingle();
  const v3 = await dashboard();
  record(
    "K: a client-written summary last_update_at is ignored (not cached) and does not reach the dashboard",
    !forgeError &&
      !sameInstant(forgedCache?.last_update_at as string | undefined, forged) &&
      sameInstant(forgedCache?.last_update_at as string | undefined, olderActivity.timestamp) &&
      label(v3.get(pOlder.propertyId)) === `${olderExpectedDays} days since last update` &&
      snapshot(v3) === snapshot(v0),
    JSON.stringify({ forgeError: forgeError?.message, cache: forgedCache?.last_update_at })
  );

  // -------------------------------------------------------------------------
  // H: lifecycle processing
  // -------------------------------------------------------------------------
  const { data: transition, error: transitionError } = await admin.rpc("record_property_lifecycle_transition_worker", {
    p_property_id: pLifecycle.propertyId,
    p_to_state: "dormancy_warning",
    p_trigger: "manual",
    p_scenario: null,
    p_reason: REASON,
    p_metadata: {},
  });
  const { data: archive, error: archiveError } = await admin.rpc("execute_property_lifecycle_archive", {
    p_property_id: pLifecycle.propertyId,
    p_reason: REASON,
    p_metadata: {},
  });
  await refreshOperationalSummaryForWorker(admin, pLifecycle.chainId);
  const { data: lifecycleNotices } = await admin
    .from("activities")
    .select("id")
    .eq("property_id", pLifecycle.propertyId)
    .eq("updated_by", "system");
  const v4 = await dashboard();
  const lifecycleRow = v4.get(pLifecycle.propertyId);
  record(
    "H: lifecycle transition + archive (system notice, assignment revoked) + refresh leave Last updated at the genuine activity",
    !transitionError &&
      transition?.ok === true &&
      !archiveError &&
      archive?.ok === true &&
      (lifecycleNotices ?? []).length >= 1 &&
      lifecycleRow?.assignment_status === "revoked" &&
      sameInstant(lifecycleRow?.last_update_at, lifecycleGenuine.timestamp) &&
      label(lifecycleRow) === `${calendarDaysAgo(4)} days since last update`,
    JSON.stringify({ transition, archive, transitionError: transitionError?.message, archiveError: archiveError?.message, row: lifecycleRow?.last_update_at, status: lifecycleRow?.assignment_status })
  );
  await adminActivity(pLifecycle.propertyId, "Survey Booked", "homeowner", new Date().toISOString());
  const v5 = await dashboard();
  record(
    "H: a revoked branch does not see genuine activity after its revocation",
    sameInstant(v5.get(pLifecycle.propertyId)?.last_update_at, lifecycleGenuine.timestamp),
    v5.get(pLifecycle.propertyId)?.last_update_at ?? "null"
  );

  // -------------------------------------------------------------------------
  // I: repeated dashboard loads
  // -------------------------------------------------------------------------
  const writeState = async () => {
    const { data: summaries } = await admin
      .from("property_operational_summary")
      .select("property_id, computed_at")
      .in("property_id", ids)
      .order("property_id");
    const { count } = await admin.from("activities").select("id", { count: "exact", head: true }).in("property_id", ids);
    return JSON.stringify({ summaries, count });
  };
  const beforeLoads = await writeState();
  const loads = [await dashboard(), await dashboard(), await dashboard()];
  const afterLoads = await writeState();
  record(
    "I: three dashboard loads return identical Last updated values and write nothing",
    loads.every((m) => snapshot(m) === snapshot(v5)) && beforeLoads === afterLoads
  );

  // -------------------------------------------------------------------------
  // J: sorting on live rows
  // -------------------------------------------------------------------------
  const sorted = [...v5.values()].sort(compareLeastRecentlyUpdatedFirst).map((r) => r.property_id);
  const firstTwo = new Set(sorted.slice(0, 2));
  record(
    "J: properties without genuine activity sort oldest; today's update sorts freshest",
    firstTwo.has(pNone.propertyId) &&
      firstTwo.has(pSystemOnly.propertyId) &&
      sorted[2] === pOlder.propertyId &&
      sorted[sorted.length - 1] === pToday.propertyId,
    JSON.stringify(sorted)
  );

  // -------------------------------------------------------------------------
  // S: visibility
  // -------------------------------------------------------------------------
  const outsiderRows = await dashboard(outsider.client);
  const homeownerRows = await dashboard(pToday.client);
  const { data: anonRows, error: anonViewError } = await anonClient()
    .from("agent_branch_property_summaries")
    .select("property_id")
    .limit(1);
  record(
    "S: an outsider EA and a homeowner see none of the fixture rows; anon is refused",
    outsiderRows.size === 0 && homeownerRows.size === 0 && Boolean(anonViewError) && !anonRows,
    JSON.stringify({ outsider: outsiderRows.size, homeowner: homeownerRows.size, anon: anonViewError?.code })
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

    warn("operational_delays", (await admin.from("operational_delays").delete().eq("chain_id", chainId)).error);
    warn("chain_completion_events", (await admin.from("chain_completion_events").delete().eq("chain_id", chainId)).error);

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
      warn("properties", (await admin.from("properties").delete().in("id", ids)).error);
    }

    warn("chain_nodes", (await admin.from("chain_nodes").delete().eq("chain_id", chainId)).error);
    warn("chain_operational_summary", (await admin.from("chain_operational_summary").delete().eq("chain_id", chainId)).error);
    warn("chains", (await admin.from("chains").delete().eq("id", chainId)).error);
    warn(
      "chain_operational_refresh_queue",
      (await admin.from("chain_operational_refresh_queue").delete().eq("chain_id", chainId)).error
    );
  }

  // Deleting the branch cascades its members (the owner invariant forbids removing them first).
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
  console.log(`\ncleanup: fixture properties remaining = ${count ?? "unknown"}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
