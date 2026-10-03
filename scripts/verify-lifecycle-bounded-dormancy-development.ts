/**
 * Development-only verification of the bounded placeholder lifecycle
 * (20261005130000_lifecycle_bounded_dormancy.sql + lib/lifecycle changes).
 *
 *   L1  EA-only sale is managed: sellerSide ea, no clock, no plan after long inactivity
 *   L2  homeowner sale is managed: no clock, not scheduled, no plan
 *   L3  purchase with no seller side is a placeholder: clock started and scheduled
 *   L4  dispatcher refuses dormancy steps on a managed row left in a legacy warning
 *   L5  warning / dormancy not due inside the window (skipped with a reason)
 *   L6  placeholder warning recipient is its buyer (buyer email variant, mock send)
 *   L7  EA operating a linking sale: recipient, sees and confirms the warning,
 *       gains no authority over the placeholder; an outsider cannot
 *   L8  activity by the placeholder's dependent side on the row resets its warning
 *   L9  activity on the linking sale resets the placeholder's warning
 *   L10 system activity does not reset a warning
 *   L11 unrelated activity elsewhere in the chain does not reset a warning
 *   L12 Buyer Ready progress resets the linked placeholder; the owner may confirm;
 *       the chain touch writes the chains row only
 *   L13 placeholder gaining a seller side becomes managed and leaves its warning
 *   L14 expire_dormancy_warning: skipped before the deadline, dormant after it
 *   L15 recipient = confirmer on a linking sale: an EA on a homeowner-only sale
 *       (seller unverified) gets no actionable warning and cannot confirm, and
 *       gains no authority; with updates enabled it is the recipient, confirms,
 *       gains no ownership or authority, is audited once, repeat is idempotent
 *   L16 genuine activity on A touches A and the chains row only (B / C keep
 *       their timestamps); a system notice touches nothing; clients cannot
 *       call the touch
 *
 * Usage (Development ONLY — bbbsxzxcjkmpqsfvmhbo), after applying 20261005130000:
 *   npx tsx --conditions react-server scripts/verify-lifecycle-bounded-dormancy-development.ts --execute
 */
import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import { join } from "path";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { DormancyWarningEmailParams, SendEmailResult } from "../lib/communications/types";
import { completeEstateAgentOnboarding } from "../lib/estateAgent/completeOnboarding";
import { createEstateAgentProfile } from "../lib/estateAgent/createEstateAgentProfile";
import { processDormancyWarningNotifications } from "../lib/lifecycle/dormancyWarningNotifications";
import { evaluatePropertyLifecycleFromContext } from "../lib/lifecycle/evaluate";
import { PropertyLifecycleService } from "../lib/lifecycle/service";

const DEVELOPMENT_SUPABASE_PROJECT_REF = "bbbsxzxcjkmpqsfvmhbo";
const PASSWORD = "BoundedDormancyDev123!";
const TEST_EMAIL_PREFIX = "bounded-dormancy";
const TEST_DOMAIN_SUFFIX = ".bounded-dormancy.test";
const DAY_MS = 86_400_000;

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

async function signIn(ctx: Ctx, email: string): Promise<SupabaseClient> {
  const client = createClient(ctx.url, ctx.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`Sign in failed: ${error.message}`);
  return client;
}

async function createAuthUser(
  ctx: Ctx,
  email: string,
  options: { emailConfirmed?: boolean } = {}
): Promise<string> {
  const { data, error } = await ctx.admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: options.emailConfirmed ?? true,
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
    companyName: `Bounded Dormancy Co ${label} ${ctx.stamp}`,
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

async function eaChain(ctx: Ctx, ea: EaActor): Promise<number> {
  counter += 1;
  const suffix = `${ctx.stamp.slice(-6)}-${counter}`;
  const { data, error } = await ea.client.rpc("create_ea_operational_chain", {
    p_name: `BD EA ${suffix}`,
    p_access_code: `KN-BDE-${suffix}`.toUpperCase(),
  });
  if (error || !data?.ok) throw new Error(`create_ea_operational_chain: ${error?.message ?? data?.error}`);
  ctx.chainIds.push(data.chain_id as number);
  return data.chain_id as number;
}

async function eaSale(ea: EaActor, chainId: number, address: string): Promise<number> {
  const { data, error } = await ea.client.rpc("create_ea_operational_property", {
    p_chain_id: chainId,
    p_relationship_type: "sale",
    p_address: address,
    p_postcode: "PO16 7BD",
    p_branch_id: ea.branchId,
    p_homeowner_only_updates: false,
    p_invite_email: null,
    p_awaiting_buyer: false,
  });
  if (error || !data?.ok) throw new Error(`create_ea_operational_property: ${error?.message ?? data?.error}`);
  return data.property_id as number;
}

async function homeownerChain(ctx: Ctx, ho: Actor): Promise<number> {
  counter += 1;
  const suffix = `${ctx.stamp.slice(-6)}-${counter}`;
  const { data, error } = await ho.client.rpc("create_chain_for_onboarding", {
    p_name: `BD HO ${suffix}`,
    p_access_code: `KN-BDH-${suffix}`.toUpperCase(),
  });
  if (error || data?.chain_id == null) {
    throw new Error(`create_chain_for_onboarding: ${error?.message ?? data?.error}`);
  }
  ctx.chainIds.push(data.chain_id as number);
  return data.chain_id as number;
}

/** Inserts a row through the service role; optionally grants the creator its identity. */
async function insertRow(
  ctx: Ctx,
  params: {
    chainId: number;
    createdBy: string;
    relationship: "sale" | "purchase";
    address: string;
    position: number;
    identityFor?: string;
  }
): Promise<number> {
  const { data, error } = await ctx.admin
    .from("properties")
    .insert({
      chain_id: params.chainId,
      chain_position: params.position,
      address: params.address,
      postcode: "PO16 7BD",
      stage: "property_listed",
      status: "pending_connection",
      relationship_type: params.relationship,
      created_by_user_id: params.createdBy,
      buyer_connected: false,
      seller_connected: false,
      is_searching: false,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`property insert: ${error?.message}`);

  if (params.identityFor) {
    const { error: identityError } = await ctx.admin.from("property_operational_identities").insert({
      property_id: data.id,
      homeowner_user_id: params.identityFor,
      operational_role: params.relationship === "sale" ? "seller" : "buyer",
      granted_via: "start_move",
      status: "active",
      granted_at: new Date().toISOString(),
    });
    if (identityError) throw new Error(`identity insert: ${identityError.message}`);
  }

  return data.id as number;
}

async function simulateInactivity(ctx: Ctx, chainId: number, days: number): Promise<void> {
  const at = new Date(Date.now() - days * DAY_MS).toISOString();
  await ctx.admin.from("properties").update({ last_operational_activity_at: at }).eq("chain_id", chainId);
  await ctx.admin.from("chains").update({ last_operational_activity_at: at }).eq("id", chainId);
}

type LifecycleRow = {
  operational_state?: string;
  lifecycle_reason?: string | null;
  seller_side_unrepresented_since?: string | null;
  placeholder_activity_at?: string | null;
  last_still_active_confirmed_at?: string | null;
  next_evaluation_at?: string | null;
};

async function lifecycleRow(ctx: Ctx, propertyId: number): Promise<LifecycleRow | null> {
  const { data } = await ctx.admin
    .from("property_lifecycle_states")
    .select(
      "operational_state, lifecycle_reason, seller_side_unrepresented_since, placeholder_activity_at, last_still_active_confirmed_at, next_evaluation_at"
    )
    .eq("property_id", propertyId)
    .maybeSingle();
  return (data as LifecycleRow | null) ?? null;
}

async function lifecycleState(ctx: Ctx, propertyId: number): Promise<string | null> {
  return (await lifecycleRow(ctx, propertyId))?.operational_state ?? null;
}

async function lifecycleAction(ctx: Ctx, propertyId: number, action: string): Promise<Rpc> {
  const { data, error } = await ctx.admin.rpc("execute_property_lifecycle_action", {
    p_property_id: propertyId,
    p_action: action,
    p_scenario: "connected_dormant",
    p_reason: "verify_bounded_dormancy",
    p_worker_run_id: randomUUID(),
    p_snapshot_payload: null,
  });
  return error ? { ok: false, error: error.message } : (data as Rpc);
}

/** Fixture: puts a row into a pending dormancy warning (deadline relative to now). */
async function setWarning(
  ctx: Ctx,
  propertyId: number,
  options: { deadlineInDays: number; placeholder: boolean }
): Promise<void> {
  const now = Date.now();
  const { error } = await ctx.admin.from("property_lifecycle_states").upsert(
    {
      property_id: propertyId,
      operational_state: "dormancy_warning",
      lifecycle_reason: "verify_bounded_dormancy",
      entered_state_at: new Date(now).toISOString(),
      seller_side_unrepresented_since: options.placeholder
        ? new Date(now - 200 * DAY_MS).toISOString()
        : null,
      dormancy_warning_at: new Date(now - (30 - options.deadlineInDays) * DAY_MS).toISOString(),
      dormancy_confirmation_deadline_at: new Date(now + options.deadlineInDays * DAY_MS).toISOString(),
      dormancy_warning_notified_at: null,
      dormancy_warning_notification_claimed_at: null,
    },
    { onConflict: "property_id" }
  );
  if (error) throw new Error(`warning fixture: ${error.message}`);
}

async function lastResetSource(ctx: Ctx, propertyId: number): Promise<string | null> {
  const { data } = await ctx.admin
    .from("property_lifecycle_events")
    .select("metadata")
    .eq("property_id", propertyId)
    .eq("from_state", "dormancy_warning")
    .eq("to_state", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const metadata = data?.metadata as { source?: string } | null | undefined;
  return metadata?.source ?? null;
}

async function recentEvents(ctx: Ctx, propertyId: number) {
  const { data } = await ctx.admin
    .from("property_lifecycle_events")
    .select("id, from_state, to_state, trigger, metadata, created_at")
    .eq("property_id", propertyId)
    .order("created_at", { ascending: false })
    .limit(4);
  return data ?? [];
}

async function recipient(ctx: Ctx, propertyId: number) {
  const { data } = await ctx.admin.rpc("get_dormancy_warning_email_recipient", {
    p_property_id: propertyId,
  });
  return ((data ?? []) as Array<{ recipient_user_id?: string; recipient_kind?: string }>)[0];
}

async function status(client: SupabaseClient, propertyId: number): Promise<Rpc> {
  const { data } = await client.rpc("get_property_lifecycle_status", { p_property_id: propertyId });
  return data as Rpc;
}

async function confirm(client: SupabaseClient, propertyId: number): Promise<Rpc> {
  const { data } = await client.rpc("confirm_transaction_still_active", { p_property_id: propertyId });
  return data as Rpc;
}

async function activity(
  ctx: Ctx,
  row: { property_id?: number; chain_node_id?: number },
  updatedBy: string
): Promise<string | null> {
  const { error } = await ctx.admin.from("activities").insert({
    ...row,
    update: "Solicitors Instructed",
    updated_by: updatedBy,
  });
  return error?.message ?? null;
}

async function runScenarios(ctx: Ctx): Promise<void> {
  const service = new PropertyLifecycleService(ctx.admin);
  const ea = await setupEstateAgent(ctx, "ea");
  const outsider = await setupHomeowner(ctx, "outsider");
  const ho = await setupHomeowner(ctx, "ho");
  const buyer = await setupHomeowner(ctx, "buyer");

  // L1 — EA-only sale
  const eaChainId = await eaChain(ctx, ea);
  const eaOnlyId = await eaSale(ea, eaChainId, `1 Bounded Dormancy EA ${ctx.stamp}`);
  await simulateInactivity(ctx, eaChainId, 400);
  const eaContext = await service.loadContext(eaOnlyId);
  const eaPlan = eaContext ? evaluatePropertyLifecycleFromContext(eaContext).plannedActions : null;
  record(
    "L1 EA-only sale is managed: sellerSide ea, no clock, no plan after 400 days",
    eaContext?.sellerSide === "ea" &&
      eaContext?.isManaged === true &&
      !eaContext?.sellerSideUnrepresentedSince &&
      eaPlan?.length === 0,
    JSON.stringify({ sellerSide: eaContext?.sellerSide, eaPlan })
  );

  // L2 — homeowner sale
  const hoChain = await homeownerChain(ctx, ho);
  const hoSale = await insertRow(ctx, {
    chainId: hoChain,
    createdBy: ho.userId,
    relationship: "sale",
    address: `2 Bounded Dormancy Sale ${ctx.stamp}`,
    position: 1,
    identityFor: ho.userId,
  });
  await simulateInactivity(ctx, hoChain, 400);
  const hoContext = await service.loadContext(hoSale);
  const hoRow = await lifecycleRow(ctx, hoSale);
  record(
    "L2 homeowner sale is managed: no clock, not scheduled, no plan",
    hoContext?.sellerSide === "homeowner" &&
      !hoRow?.seller_side_unrepresented_since &&
      !hoRow?.next_evaluation_at &&
      (hoContext ? evaluatePropertyLifecycleFromContext(hoContext).plannedActions.length : -1) === 0,
    JSON.stringify(hoRow)
  );

  // L3 — purchase placeholder with no dependants
  const quiet = await insertRow(ctx, {
    chainId: hoChain,
    createdBy: ho.userId,
    relationship: "purchase",
    address: `3 Bounded Dormancy Quiet ${ctx.stamp}`,
    position: 2,
  });
  const quietContext = await service.loadContext(quiet);
  const quietRow = await lifecycleRow(ctx, quiet);
  record(
    "L3 purchase with no seller side is a placeholder: clock started and scheduled",
    quietContext?.sellerSide === "none" &&
      quietContext?.isManaged === false &&
      Boolean(quietRow?.seller_side_unrepresented_since) &&
      Boolean(quietRow?.next_evaluation_at),
    JSON.stringify(quietRow)
  );

  // L4 — managed row left in a legacy warning
  await setWarning(ctx, eaOnlyId, { deadlineInDays: -1, placeholder: false });
  const managedExpire = await lifecycleAction(ctx, eaOnlyId, "expire_dormancy_warning");
  record(
    "L4 dispatcher refuses expire on a managed row and returns it to active",
    managedExpire?.skipped === true &&
      managedExpire?.reason === "seller_side_represented" &&
      (await lifecycleState(ctx, eaOnlyId)) === "active",
    JSON.stringify(managedExpire)
  );

  // L5 — not due inside the window
  const quietDormant = await lifecycleAction(ctx, quiet, "mark_dormant");
  const quietWarn = await lifecycleAction(ctx, quiet, "enter_dormancy_warning");
  record(
    "L5 mark_dormant / enter_dormancy_warning are skipped before the window",
    quietDormant?.skipped === true &&
      quietDormant?.reason === "dormancy_not_due" &&
      quietWarn?.skipped === true &&
      quietWarn?.reason === "warning_not_due" &&
      (await lifecycleState(ctx, quiet)) === "active",
    JSON.stringify({ quietDormant, quietWarn })
  );

  // L6 — buyer recipient
  const buyerChain = await homeownerChain(ctx, buyer);
  const onward = await insertRow(ctx, {
    chainId: buyerChain,
    createdBy: buyer.userId,
    relationship: "purchase",
    address: `6 Bounded Dormancy Onward ${ctx.stamp}`,
    position: 1,
    identityFor: buyer.userId,
  });
  await setWarning(ctx, onward, { deadlineInDays: 20, placeholder: true });
  const onwardRecipient = await recipient(ctx, onward);
  const sent: DormancyWarningEmailParams[] = [];
  const mockSend = async (params: DormancyWarningEmailParams): Promise<SendEmailResult> => {
    sent.push(params);
    return { ok: true, sent: true, provider: "mock-bounded-dormancy", messageId: "mock", eventId: null };
  };
  await processDormancyWarningNotifications({
    supabase: ctx.admin,
    sourcePropertyId: onward,
    workerRunId: randomUUID(),
    sendEmail: mockSend,
  });
  record(
    "L6 placeholder warning goes to its buyer (buyer email variant, once)",
    onwardRecipient?.recipient_user_id === buyer.userId &&
      onwardRecipient?.recipient_kind === "buyer" &&
      sent.length === 1 &&
      sent[0]?.audience === "buyer",
    JSON.stringify({ kind: onwardRecipient?.recipient_kind, sent: sent.length })
  );

  // L7 — EA operating a linking sale
  const linked = await insertRow(ctx, {
    chainId: eaChainId,
    createdBy: ea.userId,
    relationship: "purchase",
    address: `7 Bounded Dormancy Linked ${ctx.stamp}`,
    position: 2,
  });
  await ctx.admin.from("properties").update({ linked_property_id: linked }).eq("id", eaOnlyId);
  await setWarning(ctx, linked, { deadlineInDays: 20, placeholder: true });
  const linkedRecipient = await recipient(ctx, linked);
  const eaStatus = await status(ea.client, linked);
  const outsiderStatus = await status(outsider.client, linked);
  const outsiderConfirm = await confirm(outsider.client, linked);
  const eaConfirm = await confirm(ea.client, linked);
  const { count: linkedAssignments } = await ctx.admin
    .from("property_ea_assignments")
    .select("id", { count: "exact", head: true })
    .eq("property_id", linked)
    .eq("status", "active");
  const linkedContext = await service.loadContext(linked);
  record(
    "L7 linking-sale EA is the recipient, sees and confirms the warning; an outsider cannot",
    linkedRecipient?.recipient_user_id === ea.userId &&
      linkedRecipient?.recipient_kind === "estate_agent" &&
      eaStatus?.in_warning === true &&
      outsiderStatus?.in_warning === false &&
      outsiderConfirm?.error === "not_authorised" &&
      eaConfirm?.ok === true &&
      (await lifecycleState(ctx, linked)) === "active",
    JSON.stringify({ eaStatus, outsiderStatus, outsiderConfirm, eaConfirm })
  );
  record(
    "L7 confirming grants the EA no authority over the placeholder",
    (linkedAssignments ?? 0) === 0 && linkedContext?.sellerSide === "none",
    JSON.stringify({ linkedAssignments, sellerSide: linkedContext?.sellerSide })
  );

  // L8 — activity on the placeholder by its dependent side
  await setWarning(ctx, onward, { deadlineInDays: 20, placeholder: true });
  const l8Error = await activity(ctx, { property_id: onward }, "homeowner");
  record(
    "L8 dependent-side activity on the placeholder resets its warning",
    !l8Error &&
      (await lifecycleState(ctx, onward)) === "active" &&
      (await lastResetSource(ctx, onward)) === "placeholder_activity",
    l8Error ?? undefined
  );

  // L9 — activity on the linking sale
  await setWarning(ctx, linked, { deadlineInDays: 20, placeholder: true });
  const l9Before = await lifecycleRow(ctx, linked);
  const l9Error = await activity(ctx, { property_id: eaOnlyId }, "estate_agent");
  const l9State = await lifecycleState(ctx, linked);
  const l9Source = await lastResetSource(ctx, linked);
  record(
    "L9 activity on the linking sale resets the placeholder's warning",
    !l9Error && l9State === "active" && l9Source === "linked_sale_activity",
    l9Error ??
      JSON.stringify({
        before: l9Before?.operational_state,
        state: l9State,
        source: l9Source,
        events: await recentEvents(ctx, linked),
      })
  );

  // L10 — system activity
  await setWarning(ctx, linked, { deadlineInDays: 20, placeholder: true });
  const l10Error = await activity(ctx, { property_id: eaOnlyId }, "system");
  const l10Placeholder = await activity(ctx, { property_id: linked }, "system");
  record(
    "L10 system activity (updated_by system) does not reset a warning",
    !l10Error && !l10Placeholder && (await lifecycleState(ctx, linked)) === "dormancy_warning",
    l10Error ?? l10Placeholder ?? undefined
  );

  // L11 — unrelated activity elsewhere in the chain
  const unrelated = await insertRow(ctx, {
    chainId: eaChainId,
    createdBy: ea.userId,
    relationship: "sale",
    address: `11 Bounded Dormancy Unrelated ${ctx.stamp}`,
    position: 3,
    identityFor: ho.userId,
  });
  const l11Error = await activity(ctx, { property_id: unrelated }, "homeowner");
  await ctx.admin.from("properties").update({ stage: "solicitors_instructed" }).eq("id", unrelated);
  record(
    "L11 activity on an unrelated chain row does not reset the placeholder",
    !l11Error && (await lifecycleState(ctx, linked)) === "dormancy_warning",
    l11Error ?? undefined
  );

  // L12 — Buyer Ready owner
  const brTarget = await insertRow(ctx, {
    chainId: hoChain,
    createdBy: ho.userId,
    relationship: "purchase",
    address: `12 Bounded Dormancy Buyer Ready ${ctx.stamp}`,
    position: 3,
  });
  const { data: node, error: nodeError } = await ctx.admin
    .from("chain_nodes")
    .insert({
      chain_id: hoChain,
      linked_property_id: brTarget,
      node_type: "buyer_ready",
      user_id: buyer.userId,
      position: 0,
      stage: "mortgage_in_principle",
      status: "healthy",
      progress: 10,
    })
    .select("id")
    .single();
  const nodeId = node?.id as number;
  await setWarning(ctx, brTarget, { deadlineInDays: 20, placeholder: true });
  const { data: saleBefore } = await ctx.admin
    .from("properties")
    .select("last_operational_activity_at")
    .eq("id", hoSale)
    .single();
  const { error: stageError } = await ctx.admin
    .from("chain_nodes")
    .update({ stage: "mortgage_application", progress: 20 })
    .eq("id", nodeId);
  const { data: saleAfter } = await ctx.admin
    .from("properties")
    .select("last_operational_activity_at")
    .eq("id", hoSale)
    .single();
  const { data: chainAfter } = await ctx.admin
    .from("chains")
    .select("last_operational_activity_at")
    .eq("id", hoChain)
    .single();
  record(
    "L12 Buyer Ready progress resets the linked placeholder; the chain touch writes the chains row only",
    !nodeError &&
      !stageError &&
      (await lifecycleState(ctx, brTarget)) === "active" &&
      (await lastResetSource(ctx, brTarget)) === "buyer_ready_progress" &&
      saleBefore?.last_operational_activity_at === saleAfter?.last_operational_activity_at &&
      Date.now() - new Date(chainAfter?.last_operational_activity_at as string).getTime() < 10 * 60_000,
    nodeError?.message ?? stageError?.message
  );
  await setWarning(ctx, brTarget, { deadlineInDays: 20, placeholder: true });
  const brStatus = await status(buyer.client, brTarget);
  const brConfirm = await confirm(buyer.client, brTarget);
  record(
    "L12 Buyer Ready owner sees the warning and confirms it",
    brStatus?.in_warning === true && brConfirm?.ok === true && (await lifecycleState(ctx, brTarget)) === "active",
    JSON.stringify({ brStatus, brConfirm })
  );

  // L13 — placeholder gains a seller side
  await setWarning(ctx, linked, { deadlineInDays: 20, placeholder: true });
  const { error: sellerJoinError } = await ctx.admin.from("property_counterparty_participants").insert({
    property_id: linked,
    user_id: outsider.userId,
    counterparty_role: "seller",
    granted_via: "join_chain_property",
    status: "active",
  });
  const linkedAfterSeller = await lifecycleRow(ctx, linked);
  const l13Source = await lastResetSource(ctx, linked);
  record(
    "L13 placeholder gaining a seller side becomes managed and leaves its warning",
    !sellerJoinError &&
      linkedAfterSeller?.operational_state === "active" &&
      !linkedAfterSeller?.seller_side_unrepresented_since &&
      l13Source === "seller_side_represented",
    sellerJoinError?.message ??
      JSON.stringify({ row: linkedAfterSeller, source: l13Source, events: await recentEvents(ctx, linked) })
  );

  // L14 — expiry
  await setWarning(ctx, onward, { deadlineInDays: 5, placeholder: true });
  const earlyExpire = await lifecycleAction(ctx, onward, "expire_dormancy_warning");
  const earlyArchive = await lifecycleAction(ctx, onward, "archive_operational");
  await setWarning(ctx, onward, { deadlineInDays: -1, placeholder: true });
  const lateExpire = await lifecycleAction(ctx, onward, "expire_dormancy_warning");
  record(
    "L14 expire skipped before the deadline; after it the placeholder becomes dormant",
    earlyExpire?.skipped === true &&
      earlyExpire?.reason === "warning_not_expired" &&
      earlyArchive?.skipped === true &&
      lateExpire?.ok === true &&
      lateExpire?.skipped !== true &&
      (await lifecycleState(ctx, onward)) === "dormant",
    JSON.stringify({ earlyExpire, earlyArchive, lateExpire })
  );

  // L15 — warning recipient and confirmer agree on a homeowner-only linking sale
  const hoOnlyChain = await eaChain(ctx, ea);
  const hoOnlySale = await eaSale(ea, hoOnlyChain, `15 Bounded Dormancy HO Only ${ctx.stamp}`);
  const unverifiedSellerId = await createAuthUser(
    ctx,
    `${TEST_EMAIL_PREFIX}-unverified-${ctx.stamp}@ho-${ctx.stamp}${TEST_DOMAIN_SUFFIX}`,
    { emailConfirmed: false }
  );
  await ctx.admin.from("property_operational_identities").insert({
    property_id: hoOnlySale,
    homeowner_user_id: unverifiedSellerId,
    operational_role: "seller",
    granted_via: "start_move",
    status: "active",
    granted_at: new Date().toISOString(),
  });
  await ctx.admin
    .from("property_ea_assignments")
    .update({ homeowner_only_updates: true })
    .eq("property_id", hoOnlySale)
    .eq("status", "active");
  const hoOnlyPlaceholder = await insertRow(ctx, {
    chainId: hoOnlyChain,
    createdBy: ea.userId,
    relationship: "purchase",
    address: `15 Bounded Dormancy HO Only Onward ${ctx.stamp}`,
    position: 2,
  });
  await ctx.admin.from("properties").update({ linked_property_id: hoOnlyPlaceholder }).eq("id", hoOnlySale);
  await setWarning(ctx, hoOnlyPlaceholder, { deadlineInDays: 20, placeholder: true });

  const hoOnlyRecipient = await recipient(ctx, hoOnlyPlaceholder);
  const hoOnlySent: DormancyWarningEmailParams[] = [];
  await processDormancyWarningNotifications({
    supabase: ctx.admin,
    sourcePropertyId: hoOnlyPlaceholder,
    workerRunId: randomUUID(),
    sendEmail: async (params) => {
      hoOnlySent.push(params);
      return { ok: true, sent: true, provider: "mock-bounded-dormancy", messageId: "mock", eventId: null };
    },
  });
  const hoOnlyEaStatus = await status(ea.client, hoOnlyPlaceholder);
  const hoOnlyEaConfirm = await confirm(ea.client, hoOnlyPlaceholder);
  record(
    "L15-B EA on a homeowner-only sale (seller unverified) is not sent an actionable warning and cannot confirm",
    hoOnlyRecipient === undefined &&
      hoOnlySent.length === 0 &&
      hoOnlyEaStatus?.in_warning === false &&
      hoOnlyEaConfirm?.error === "not_authorised" &&
      (await lifecycleState(ctx, hoOnlyPlaceholder)) === "dormancy_warning",
    JSON.stringify({ hoOnlyRecipient, sent: hoOnlySent.length, hoOnlyEaStatus, hoOnlyEaConfirm })
  );
  const { data: hoOnlyOperate } = await ea.client.rpc("can_operate_property", { p_property_id: hoOnlySale });
  record(
    "L15-C homeowner-only updates grants the EA no operational authority over the sale or the placeholder",
    hoOnlyOperate === false &&
      (await ea.client.rpc("can_operate_property", { p_property_id: hoOnlyPlaceholder })).data === false,
    JSON.stringify({ hoOnlyOperate })
  );

  await ctx.admin
    .from("property_ea_assignments")
    .update({ homeowner_only_updates: false })
    .eq("property_id", hoOnlySale)
    .eq("status", "active");
  const updatesRecipient = await recipient(ctx, hoOnlyPlaceholder);
  const updatesConfirm = await confirm(ea.client, hoOnlyPlaceholder);
  const updatesRepeat = await confirm(ea.client, hoOnlyPlaceholder);
  const { count: confirmationRows } = await ctx.admin
    .from("property_lifecycle_still_active_confirmations")
    .select("id", { count: "exact", head: true })
    .eq("property_id", hoOnlyPlaceholder)
    .eq("user_id", ea.userId);
  const { count: placeholderAssignments } = await ctx.admin
    .from("property_ea_assignments")
    .select("id", { count: "exact", head: true })
    .eq("property_id", hoOnlyPlaceholder);
  const { count: placeholderIdentities } = await ctx.admin
    .from("property_operational_identities")
    .select("property_id", { count: "exact", head: true })
    .eq("property_id", hoOnlyPlaceholder)
    .eq("status", "active");
  const placeholderContext = await service.loadContext(hoOnlyPlaceholder);
  record(
    "L15-A EA that may update the sale is the recipient and can confirm",
    updatesRecipient?.recipient_user_id === ea.userId &&
      updatesRecipient?.recipient_kind === "estate_agent" &&
      updatesConfirm?.ok === true &&
      (await lifecycleState(ctx, hoOnlyPlaceholder)) === "active",
    JSON.stringify({ updatesRecipient, updatesConfirm })
  );
  record(
    "L15-D confirmation grants no ownership or EA authority over the placeholder",
    (placeholderAssignments ?? 0) === 0 &&
      (placeholderIdentities ?? 0) === 0 &&
      placeholderContext?.sellerSide === "none" &&
      (await ea.client.rpc("can_operate_property", { p_property_id: hoOnlyPlaceholder })).data === false,
    JSON.stringify({ placeholderAssignments, placeholderIdentities, sellerSide: placeholderContext?.sellerSide })
  );
  record(
    "L15-E/F confirmation is audited once; a repeat within 24 hours is idempotent",
    confirmationRows === 1 && updatesRepeat?.ok === true && updatesRepeat?.idempotent === true,
    JSON.stringify({ confirmationRows, updatesRepeat })
  );

  // L16 — activity touches stay on the row where the activity happened
  const touchChainId = await homeownerChain(ctx, ho);
  const touchA = await insertRow(ctx, {
    chainId: touchChainId,
    createdBy: ho.userId,
    relationship: "sale",
    address: `16A Bounded Dormancy ${ctx.stamp}`,
    position: 1,
    identityFor: ho.userId,
  });
  const touchB = await insertRow(ctx, {
    chainId: touchChainId,
    createdBy: ho.userId,
    relationship: "sale",
    address: `16B Bounded Dormancy ${ctx.stamp}`,
    position: 2,
  });
  const touchC = await insertRow(ctx, {
    chainId: touchChainId,
    createdBy: ho.userId,
    relationship: "purchase",
    address: `16C Bounded Dormancy ${ctx.stamp}`,
    position: 3,
  });
  const touchedAt = async () => {
    const { data: rows } = await ctx.admin
      .from("properties")
      .select("id, last_operational_activity_at")
      .in("id", [touchA, touchB, touchC]);
    const { data: chainRow } = await ctx.admin
      .from("chains")
      .select("last_operational_activity_at")
      .eq("id", touchChainId)
      .single();
    const at = (id: number) =>
      Date.parse((rows ?? []).find((r) => r.id === id)?.last_operational_activity_at ?? "") || 0;
    return {
      a: at(touchA),
      b: at(touchB),
      c: at(touchC),
      chain: Date.parse(chainRow?.last_operational_activity_at ?? "") || 0,
    };
  };

  await simulateInactivity(ctx, touchChainId, 30);
  const beforeGenuine = await touchedAt();
  const genuineError = await activity(ctx, { property_id: touchA }, "homeowner");
  const afterGenuine = await touchedAt();
  record(
    "L16-A genuine activity on A touches A and the chains row only; B and C keep their timestamps",
    !genuineError &&
      afterGenuine.a > beforeGenuine.a &&
      afterGenuine.chain > beforeGenuine.chain &&
      afterGenuine.b === beforeGenuine.b &&
      afterGenuine.c === beforeGenuine.c,
    JSON.stringify({ genuineError, beforeGenuine, afterGenuine })
  );

  await simulateInactivity(ctx, touchChainId, 30);
  const beforeSystem = await touchedAt();
  const systemError = await activity(ctx, { property_id: touchA }, "system");
  const afterSystem = await touchedAt();
  record(
    "L16-B a system notice touches nothing (no fake activity anywhere)",
    !systemError && JSON.stringify(afterSystem) === JSON.stringify(beforeSystem),
    JSON.stringify({ systemError, beforeSystem, afterSystem })
  );

  const { error: clientTouchError } = await ho.client.rpc("touch_property_operational_activity", {
    p_property_id: touchB,
    p_touch_chain: true,
  });
  record(
    "L16-C clients cannot call the touch directly",
    Boolean(clientTouchError) && JSON.stringify(await touchedAt()) === JSON.stringify(afterSystem),
    clientTouchError?.message
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
        "property_lifecycle_still_active_confirmations",
        "property_lifecycle_events",
        "property_lifecycle_states",
      ]) {
        warn(table, (await ctx.admin.from(table).delete().in("property_id", ids)).error);
      }
      warn(
        "property_analytics_snapshots",
        (await ctx.admin.from("property_analytics_snapshots").delete().in("source_property_id", ids)).error
      );
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
  for (const userId of ctx.userIds) {
    warn("profiles", (await ctx.admin.from("profiles").delete().eq("id", userId)).error);
    const { error } = await ctx.admin.auth.admin.deleteUser(userId);
    warn("auth user", error);
  }
}

async function main() {
  if (!process.argv.includes("--execute")) {
    console.log("Live Development scenarios only. Re-run with --execute after applying 20261005130000.");
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
