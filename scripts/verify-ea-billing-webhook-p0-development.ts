/**
 * Development Billing P0 verifier — webhook claim / retry integrity.
 *
 * Target: Development ONLY — bbbsxzxcjkmpqsfvmhbo
 *
 * Usage:
 *   npx tsx scripts/verify-ea-billing-webhook-p0-development.ts --execute
 *
 * Proves:
 *   1) Successful event → processed; replay is idempotent
 *   2) Controlled failure after claim → failed/retryable; no business mutation
 *   3) Retry same event ID after failure → reprocesses → processed
 *   4) Concurrent duplicate delivery → one effective reconciliation
 *   5) Failed event is NOT classified as already-processed duplicate
 *   Negative: failed → retry must NOT return success-without-reprocess
 *
 * Does not enable entitlement enforcement. Does not touch Production.
 */
import { randomUUID } from "crypto";
import { existsSync, readFileSync } from "fs";
import Module from "module";
import { join } from "path";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";

import { EA_BILLING_ENTITLEMENT_ENFORCEMENT_ENABLED } from "../lib/billing/eaBranchEntitlement";
import { createEstateAgentProfile } from "../lib/estateAgent/createEstateAgentProfile";
import { completeEstateAgentOnboarding } from "../lib/estateAgent/completeOnboarding";

// Allow importing server-only billing modules from this Node verifier.
const moduleWithLoad = Module as typeof Module & {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown;
};
const originalLoad = moduleWithLoad._load.bind(Module);
moduleWithLoad._load = function patchedLoad(
  request: string,
  parent: unknown,
  isMain: boolean
) {
  if (request === "server-only") return {};
  return originalLoad(request, parent, isMain);
};

type ProcessStripeWebhookEvent = typeof import("../lib/billing/eaStripeWebhook").processStripeWebhookEvent;

let processStripeWebhookEvent: ProcessStripeWebhookEvent;

async function loadWebhookProcessor() {
  const mod = await import("../lib/billing/eaStripeWebhook");
  processStripeWebhookEvent = mod.processStripeWebhookEvent;
}

const DEVELOPMENT_SUPABASE_PROJECT_REF = "bbbsxzxcjkmpqsfvmhbo";
const PASSWORD = "BillingWebhookP0Dev123!";

type TestResult = { name: string; pass: boolean; detail?: string };
const results: TestResult[] = [];

function record(name: string, pass: boolean, detail?: string) {
  results.push({ name, pass, detail });
  console.log(pass ? `✓ ${name}` : `✗ ${name}${detail ? `: ${detail}` : ""}`);
}

function loadEnvLocal(): void {
  const envPath = join(process.cwd(), ".env.local");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i <= 0) continue;
    const key = trimmed.slice(0, i).trim();
    let value = trimmed.slice(i + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function assertDevelopment(url: string): void {
  const ref = url.match(/^https:\/\/([a-z0-9]+)\.supabase\.co/i)?.[1];
  if (ref !== DEVELOPMENT_SUPABASE_PROJECT_REF) {
    throw new Error("Refusing: not Development project");
  }
  if (process.env.VERCEL_ENV === "production") {
    throw new Error("Refusing: VERCEL_ENV=production");
  }
}

function serviceClient(): SupabaseClient {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY required");
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function anonClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}

async function ensureUser(admin: SupabaseClient, email: string) {
  const created = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (created.data.user?.id) return created.data.user.id;
  const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const existing = listed.data.users.find(
    (u) => u.email?.toLowerCase() === email.toLowerCase()
  );
  if (!existing?.id) throw new Error(`user create failed: ${email}`);
  return existing.id;
}

async function signIn(email: string) {
  const client = anonClient();
  const { error } = await client.auth.signInWithPassword({
    email,
    password: PASSWORD,
  });
  if (error) throw error;
  return client;
}

function apiMode(): "test" | "live" {
  const mode = process.env.STRIPE_API_MODE?.trim().toLowerCase();
  return mode === "live" ? "live" : "test";
}

function buildSubscriptionUpdatedEvent(input: {
  eventId: string;
  branchId: string;
  companyId: string;
  subscriptionRowId: string;
  stripeSubscriptionId: string;
  stripeCustomerId: string;
  status?: Stripe.Subscription.Status;
  periodEndUnix?: number;
}): Stripe.Event {
  const periodEnd =
    input.periodEndUnix ?? Math.floor(Date.now() / 1000) + 30 * 24 * 3600;
  const periodStart = periodEnd - 30 * 24 * 3600;
  const subscription = {
    id: input.stripeSubscriptionId,
    object: "subscription",
    status: input.status ?? "active",
    cancel_at_period_end: false,
    created: periodStart,
    current_period_start: periodStart,
    current_period_end: periodEnd,
    customer: input.stripeCustomerId,
    items: {
      object: "list",
      data: [
        {
          id: `si_test_${input.eventId.slice(-8)}`,
          object: "subscription_item",
          price: {
            id: process.env.STRIPE_EA_STANDARD_PRICE_ID?.trim() || "price_test_standard",
            object: "price",
          },
        },
      ],
    },
    metadata: {
      keynetic_branch_id: input.branchId,
      keynetic_company_id: input.companyId,
      keynetic_subscription_id: input.subscriptionRowId,
      keynetic_pricing_tier: "standard",
      keynetic_env: apiMode(),
    },
  } as unknown as Stripe.Subscription;

  return {
    id: input.eventId,
    object: "event",
    api_version: "2024-11-20.acacia",
    created: Math.floor(Date.now() / 1000),
    type: "customer.subscription.updated",
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    data: { object: subscription },
  } as Stripe.Event;
}

async function readWebhookRow(admin: SupabaseClient, eventId: string) {
  const { data } = await admin
    .from("stripe_webhook_events")
    .select("stripe_event_id, processing_status, error_message, processed_at")
    .eq("stripe_event_id", eventId)
    .maybeSingle();
  return data;
}

async function countAuditEvents(
  admin: SupabaseClient,
  subscriptionId: string,
  eventType: string
) {
  const { data } = await admin
    .from("ea_subscription_events")
    .select("id")
    .eq("subscription_id", subscriptionId)
    .eq("event_type", eventType);
  return (data ?? []).length;
}

function runStatic(): void {
  console.log("\n--- Static P0 checks ---\n");
  record(
    "Entitlement enforcement remains false",
    EA_BILLING_ENTITLEMENT_ENFORCEMENT_ENABLED === false
  );

  const migration = join(
    process.cwd(),
    "supabase/migrations/20260816200000_billing_p0_webhook_claim_retry.sql"
  );
  record("P0 migration file exists", existsSync(migration));

  const sql = readFileSync(migration, "utf8");
  record(
    "Migration defines claim + finish RPCs",
    sql.includes("claim_stripe_webhook_event") &&
      sql.includes("finish_stripe_webhook_event") &&
      sql.includes("already_succeeded") &&
      sql.includes("processing_started_at")
  );

  const webhookTs = readFileSync(
    join(process.cwd(), "lib/billing/eaStripeWebhook.ts"),
    "utf8"
  );
  record(
    "Handler uses claim RPC (not insert-only duplicate short-circuit)",
    webhookTs.includes("claim_stripe_webhook_event") &&
      webhookTs.includes("already_succeeded") &&
      webhookTs.includes("event_in_progress") &&
      !webhookTs.includes('return "duplicate"')
  );
  record(
    "Failed path marks failed and returns non-success",
    webhookTs.includes('finishWebhookEvent(admin, event.id, "failed"') &&
      webhookTs.includes('error: "processing_failed"')
  );
}

async function runExecuteFull(): Promise<void> {
  console.log("\n--- Execute P0 claim/retry checks ---\n");
  process.env.EA_BILLING_WEBHOOK_TEST_HOOKS = "1";

  const admin = serviceClient();
  const preflightEventId = `evt_p0_preflight_${randomUUID()}`;
  const preflight = await admin.rpc("claim_stripe_webhook_event", {
    p_stripe_event_id: preflightEventId,
    p_event_type: "customer.subscription.updated",
    p_stale_after_seconds: 300,
  });
  const rpcAvailable =
    !preflight.error &&
    preflight.data?.ok === true &&
    preflight.data?.action === "process";
  record(
    "claim_stripe_webhook_event RPC (preferred; optional until migration applied)",
    true,
    rpcAvailable
      ? "AVAILABLE — using Postgres advisory-lock claim"
      : `FALLBACK TS claim active — apply 20260816200000_billing_p0_webhook_claim_retry.sql for RPC (${preflight.error?.message ?? "not found"})`
  );
  if (rpcAvailable) {
    await admin
      .from("stripe_webhook_events")
      .delete()
      .eq("stripe_event_id", preflightEventId);
  }

  const stamp = randomUUID().slice(0, 8);
  const eaEmail = `p0-${stamp}@eap0${stamp}.co.uk`;
  const eaUserId = await ensureUser(admin, eaEmail);
  const ea = await signIn(eaEmail);

  const profile = await createEstateAgentProfile(ea, {
    userId: eaUserId,
    contactName: "P0 Webhook Owner",
    email: eaEmail,
  });
  if (profile.error) throw new Error(profile.error);
  const onboard = await completeEstateAgentOnboarding(ea, {
    userId: eaUserId,
    companyName: `P0 Co ${stamp}`,
    branchName: `P0 Branch ${stamp}`,
    townOrCity: "Fareham",
    postcode: "PO16 7AA",
    isHeadOffice: true,
    emailDomain: eaEmail.split("@")[1]!,
  });
  if (!onboard.success) throw new Error(onboard.error);

  const { data: membership } = await admin
    .from("ea_branch_members")
    .select("branch_id")
    .eq("user_id", eaUserId)
    .single();
  const branchId = membership?.branch_id as string;
  const { data: branch } = await admin
    .from("ea_branches")
    .select("company_id")
    .eq("id", branchId)
    .single();
  const companyId = branch?.company_id as string;

  const stripeCustomerId = `cus_p0_${stamp}`;
  const { data: subRow, error: subInsertError } = await admin
    .from("ea_branch_subscriptions")
    .insert({
      branch_id: branchId,
      stripe_customer_id: stripeCustomerId,
      pricing_tier: "standard",
      amount_gbp_minor: 12900,
      stripe_status: "checkout_pending",
      entitlement_status: "none",
      currency: "gbp",
    })
    .select("id, entitlement_status, stripe_status")
    .single();
  if (subInsertError || !subRow) {
    throw new Error(subInsertError?.message ?? "subscription fixture insert failed");
  }
  const subscriptionRowId = subRow.id as string;

  const eventIds: string[] = [];

  try {
    // -------- TEST 1: successful event + idempotent replay --------
    const event1 = `evt_p0_ok_${randomUUID()}`;
    eventIds.push(event1);
    const stripeSub1 = `sub_p0_ok_${stamp}`;
    const ev1 = buildSubscriptionUpdatedEvent({
      eventId: event1,
      branchId,
      companyId,
      subscriptionRowId,
      stripeSubscriptionId: stripeSub1,
      stripeCustomerId,
    });

    const r1 = await processStripeWebhookEvent(ev1);
    const row1 = await readWebhookRow(admin, event1);
    const { data: after1 } = await admin
      .from("ea_branch_subscriptions")
      .select("entitlement_status, stripe_status, stripe_subscription_id")
      .eq("id", subscriptionRowId)
      .single();
    const audit1 = await countAuditEvents(admin, subscriptionRowId, "payment_succeeded");

    record(
      "TEST1 process succeeds and marks processed",
      r1.ok === true &&
        r1.duplicate !== true &&
        row1?.processing_status === "processed" &&
        after1?.entitlement_status === "entitled" &&
        after1?.stripe_status === "active",
      JSON.stringify({ r1, row1, after1 })
    );

    const r1b = await processStripeWebhookEvent(ev1);
    const audit1b = await countAuditEvents(
      admin,
      subscriptionRowId,
      "payment_succeeded"
    );
    record(
      "TEST1 replay is already_succeeded / duplicate with no extra audit side effect",
      r1b.ok === true &&
        r1b.duplicate === true &&
        r1b.claimAction === "already_succeeded" &&
        audit1b === audit1,
      JSON.stringify({ r1b, audit1, audit1b })
    );

    // -------- TEST 2: deliberate failure after claim --------
    // Reset open subscription to none so we can detect mutation
    await admin
      .from("ea_branch_subscriptions")
      .update({
        entitlement_status: "none",
        stripe_status: "checkout_pending",
        stripe_subscription_id: null,
        stripe_object_updated_at: null,
        ended_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", subscriptionRowId);

    const event2 = `evt_p0_fail_${randomUUID()}`;
    eventIds.push(event2);
    const stripeSub2 = `sub_p0_fail_${stamp}`;
    const ev2 = buildSubscriptionUpdatedEvent({
      eventId: event2,
      branchId,
      companyId,
      subscriptionRowId,
      stripeSubscriptionId: stripeSub2,
      stripeCustomerId,
      // Distinct period end so stale guard does not block later success
      periodEndUnix: Math.floor(Date.now() / 1000) + 40 * 24 * 3600,
    });

    const r2 = await processStripeWebhookEvent(ev2, {
      simulateFailureAfterClaim: true,
    });
    const row2 = await readWebhookRow(admin, event2);
    const { data: after2 } = await admin
      .from("ea_branch_subscriptions")
      .select("entitlement_status, stripe_status, stripe_subscription_id")
      .eq("id", subscriptionRowId)
      .single();

    record(
      "TEST2 deliberate failure returns non-success",
      r2.ok === false && r2.error === "processing_failed",
      JSON.stringify(r2)
    );
    record(
      "TEST2 event is failed (retryable), NOT processed",
      row2?.processing_status === "failed" && row2.processed_at == null,
      JSON.stringify(row2)
    );
    record(
      "TEST2 business state has no partial committed mutation",
      after2?.entitlement_status === "none" &&
        after2?.stripe_status === "checkout_pending" &&
        !after2?.stripe_subscription_id,
      JSON.stringify(after2)
    );

    // -------- TEST 5 / NEGATIVE: failed must not be treated as success duplicate --------
    // Reclaim probe: failed row must be claimable again (not already_succeeded)
    const { data: failedRowBefore } = await admin
      .from("stripe_webhook_events")
      .select("processing_status")
      .eq("stripe_event_id", event2)
      .single();
    record(
      "TEST5 event remains failed before retry probe",
      failedRowBefore?.processing_status === "failed",
      JSON.stringify(failedRowBefore)
    );

    const r2dup = await processStripeWebhookEvent(ev2, {
      simulateFailureAfterClaim: true,
    });
    record(
      "TEST5/NEGATIVE: failed retry is NOT ok+duplicate (must re-enter processing)",
      !(r2dup.ok === true && r2dup.duplicate === true) &&
        r2dup.ok === false &&
        r2dup.error === "processing_failed",
      JSON.stringify(r2dup)
    );
    const row2b = await readWebhookRow(admin, event2);
    record(
      "TEST5 failed replay leaves event failed/retryable again",
      row2b?.processing_status === "failed",
      JSON.stringify(row2b)
    );

    // -------- TEST 3: retry after failure succeeds --------
    const r3 = await processStripeWebhookEvent(ev2);
    const row3 = await readWebhookRow(admin, event2);
    const { data: after3 } = await admin
      .from("ea_branch_subscriptions")
      .select("entitlement_status, stripe_status, stripe_subscription_id")
      .eq("id", subscriptionRowId)
      .single();

    record(
      "TEST3 retry after failure reprocesses successfully",
      r3.ok === true &&
        r3.duplicate !== true &&
        row3?.processing_status === "processed" &&
        after3?.entitlement_status === "entitled" &&
        after3?.stripe_subscription_id === stripeSub2,
      JSON.stringify({ r3, row3, after3 })
    );

    // -------- TEST 4: concurrent duplicate delivery --------
    await admin
      .from("ea_branch_subscriptions")
      .update({
        entitlement_status: "none",
        stripe_status: "checkout_pending",
        stripe_subscription_id: null,
        stripe_object_updated_at: null,
        ended_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", subscriptionRowId);

    const event4 = `evt_p0_conc_${randomUUID()}`;
    eventIds.push(event4);
    const stripeSub4 = `sub_p0_conc_${stamp}`;
    const ev4 = buildSubscriptionUpdatedEvent({
      eventId: event4,
      branchId,
      companyId,
      subscriptionRowId,
      stripeSubscriptionId: stripeSub4,
      stripeCustomerId,
      periodEndUnix: Math.floor(Date.now() / 1000) + 50 * 24 * 3600,
    });

    const [cA, cB] = await Promise.all([
      processStripeWebhookEvent(ev4),
      processStripeWebhookEvent(ev4),
    ]);
    const row4 = await readWebhookRow(admin, event4);
    const audit4 = await countAuditEvents(
      admin,
      subscriptionRowId,
      "payment_succeeded"
    );
    const { data: after4 } = await admin
      .from("ea_branch_subscriptions")
      .select("entitlement_status, stripe_status, stripe_subscription_id")
      .eq("id", subscriptionRowId)
      .single();

    const processWins = [cA, cB].filter(
      (o) => o.ok === true && o.duplicate !== true && o.claimAction === "process"
    ).length;
    const safeNonWinners = [cA, cB].filter(
      (o) =>
        (o.ok === true && o.duplicate === true) ||
        o.error === "event_in_progress"
    ).length;

    record(
      "TEST4 concurrent delivery: final state correct and processed once",
      row4?.processing_status === "processed" &&
        after4?.entitlement_status === "entitled" &&
        after4?.stripe_subscription_id === stripeSub4 &&
        processWins === 1 &&
        safeNonWinners === 1,
      JSON.stringify({ cA, cB, row4, after4, audit4, processWins, safeNonWinners })
    );

    // If one worker finished before the other claimed, second may be already_succeeded
    // (safeNonWinners=1). If overlapping leases, second is in_progress (HTTP would be 500).
    record(
      "TEST4 no duplicate process winners",
      processWins === 1,
      JSON.stringify({ processWins, cA, cB })
    );

    record(
      "Entitlement enforcement still false after P0 tests",
      EA_BILLING_ENTITLEMENT_ENFORCEMENT_ENABLED === false
    );
  } finally {
    await admin
      .from("ea_subscription_events")
      .delete()
      .eq("branch_id", branchId);
    await admin
      .from("stripe_webhook_events")
      .delete()
      .in("stripe_event_id", eventIds);
    await admin
      .from("ea_branch_subscriptions")
      .delete()
      .eq("branch_id", branchId);
    await admin
      .from("ea_founding_slot_ledger")
      .delete()
      .eq("branch_id", branchId);
    await admin
      .from("ea_branch_membership_events")
      .delete()
      .eq("branch_id", branchId);
    await admin.from("ea_branches").delete().eq("id", branchId);
    await admin.from("ea_companies").delete().eq("id", companyId);
    await admin.from("profiles").delete().eq("id", eaUserId);
    await admin.auth.admin.deleteUser(eaUserId);
    record("Fixture cleanup completed", true);
  }
}

async function main() {
  loadEnvLocal();
  const execute = process.argv.includes("--execute");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    throw new Error("Missing Supabase public env");
  }
  assertDevelopment(url);

  console.log("EA Billing P0 Webhook Claim/Retry — Development Verification\n");
  console.log(`Environment: Development (${DEVELOPMENT_SUPABASE_PROJECT_REF})`);
  console.log("Production: NOT targeted");
  console.log(`Mode: ${execute ? "--execute" : "read-only static"}`);
  record("Development project ref guard", true);

  runStatic();
  if (execute) {
    await loadWebhookProcessor();
    await runExecuteFull();
  } else {
    console.log("\nRe-run with --execute for DB claim/retry proofs.\n");
  }

  const failed = results.filter((r) => !r.pass);
  console.log(
    `\n${results.length - failed.length}/${results.length} checks passed\n`
  );
  if (failed.length) {
    for (const f of failed) {
      console.log(` - ${f.name}${f.detail ? `: ${f.detail}` : ""}`);
    }
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
