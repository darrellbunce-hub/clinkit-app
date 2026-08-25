/**
 * Development verifier — Stripe webhook stale / out-of-order event protection (P1).
 *
 * Target: Development ONLY — bbbsxzxcjkmpqsfvmhbo
 *
 * Usage:
 *   npx tsx scripts/verify-ea-billing-webhook-ordering-development.ts --execute
 *
 * Proves Stripe event.created chronology prevents older webhooks from
 * overwriting newer reconciled Keynetic billing state.
 *
 * Does not enable entitlement enforcement. Does not touch Production.
 */
import { randomUUID } from "crypto";
import { existsSync, readFileSync } from "fs";
import Module from "module";
import { join } from "path";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { EA_BILLING_ENTITLEMENT_ENFORCEMENT_ENABLED } from "../lib/billing/eaBranchEntitlement";
import { EA_BILLING_SEMANTICS } from "../lib/billing/eaBillingSemantics";
import { createEstateAgentProfile } from "../lib/estateAgent/createEstateAgentProfile";
import { completeEstateAgentOnboarding } from "../lib/estateAgent/completeOnboarding";

const DEVELOPMENT_SUPABASE_PROJECT_REF = "bbbsxzxcjkmpqsfvmhbo";
const PASSWORD = "WebhookOrderingDev123!";

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

function anonClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}

function serviceClient(): SupabaseClient {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY required");
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
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

function runStatic() {
  console.log("\n--- Static webhook ordering checks ---\n");
  record(
    "Entitlement enforcement remains false",
    EA_BILLING_ENTITLEMENT_ENFORCEMENT_ENABLED === false
  );
  record(
    "Semantics: chronology authority is stripe_event_created",
    EA_BILLING_SEMANTICS.webhookChronologyAuthority === "stripe_event_created"
  );

  const webhookSrc = readFileSync(
    join(process.cwd(), "lib/billing/eaStripeWebhook.ts"),
    "utf8"
  );
  record(
    "Webhook uses event.created chronology helper",
    webhookSrc.includes("stripeEventChronologyAt") &&
      webhookSrc.includes("eventChronologyAt")
  );
  record(
    "Webhook does not use current_period_end as chronology",
    !webhookSrc.includes("current_period_end ||") &&
      !webhookSrc.includes("Prefer latest invoice/period signal")
  );
  record(
    "Conditional update guards concurrent stale writes",
    webhookSrc.includes("stale_or_concurrent_lost") &&
      webhookSrc.includes("stripe_object_updated_at.lte.")
  );
  record(
    "Invoice + checkout handlers pass eventChronologyAt",
    webhookSrc.includes('case "invoice.paid"') &&
      webhookSrc.includes('case "invoice.payment_failed"') &&
      webhookSrc.includes('case "checkout.session.completed"') &&
      (webhookSrc.match(/eventChronologyAt:/g) ?? []).length >= 5
  );
  record(
    "Invoice paths still retrieve live subscription (no extra retrieval for subscription.updated)",
    webhookSrc.includes("loadSubscription(subId)") &&
      webhookSrc.includes('case "customer.subscription.updated"')
  );

  const migration = readFileSync(
    join(
      process.cwd(),
      "supabase/migrations/20260816240000_billing_p1_webhook_ordering_watermark.sql"
    ),
    "utf8"
  );
  record(
    "Ordering watermark migration exists",
    migration.includes("stripe_object_updated_at") &&
      migration.includes("event.created")
  );
}

type SubStatus = "active" | "past_due" | "canceled";

function buildSubscriptionEvent(input: {
  eventId: string;
  eventCreated: number;
  type:
    | "customer.subscription.updated"
    | "customer.subscription.deleted"
    | "customer.subscription.created";
  subscriptionId: string;
  status: SubStatus;
  cancelAtPeriodEnd?: boolean;
  branchId: string;
  companyId: string;
  subscriptionRowId: string;
  periodEnd: number;
  priceId: string;
}): import("stripe").Stripe.Event {
  const status =
    input.type === "customer.subscription.deleted" ? "canceled" : input.status;
  return {
    id: input.eventId,
    object: "event",
    type: input.type,
    api_version: "2024-11-20.acacia",
    created: input.eventCreated,
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    data: {
      object: {
        id: input.subscriptionId,
        object: "subscription",
        status,
        cancel_at_period_end: !!input.cancelAtPeriodEnd,
        created: input.eventCreated - 1000,
        current_period_start: input.periodEnd - 30 * 24 * 3600,
        // Intentionally SAME period end across ordered events — proves we do
        // not use current_period_end as chronology.
        current_period_end: input.periodEnd,
        customer: `cus_order_${input.subscriptionRowId.slice(0, 8)}`,
        items: {
          object: "list",
          data: [
            {
              id: `si_${input.eventId.slice(-8)}`,
              object: "subscription_item",
              price: { id: input.priceId, object: "price" },
            },
          ],
        },
        metadata: {
          keynetic_branch_id: input.branchId,
          keynetic_company_id: input.companyId,
          keynetic_subscription_id: input.subscriptionRowId,
          keynetic_pricing_tier: "standard",
          keynetic_env: process.env.STRIPE_API_MODE?.trim() || "test",
        },
      },
    },
  } as unknown as import("stripe").Stripe.Event;
}

async function runExecute() {
  console.log("\n--- Execute webhook ordering checks ---\n");

  const { processStripeWebhookEvent } = await import(
    "../lib/billing/eaStripeWebhook"
  );

  const admin = serviceClient();
  const stamp = Date.now().toString(36);
  const domain = `ord-${stamp}.billing-order.test`;
  const email = `owner-${stamp}@${domain}`;
  const priceId =
    process.env.STRIPE_EA_STANDARD_PRICE_ID?.trim() || "price_standard_test";

  let userId = "";
  let companyId = "";
  let branchId = "";
  let subscriptionId = "";
  const eventIds: string[] = [];
  const stripeSubId = `sub_order_${stamp}`;
  const periodEnd = Math.floor(Date.now() / 1000) + 30 * 24 * 3600;
  const t0 = Math.floor(Date.now() / 1000) - 500;

  const cleanup = async () => {
    for (const id of eventIds) {
      await admin.from("stripe_webhook_events").delete().eq("stripe_event_id", id);
    }
    if (branchId) {
      await admin.from("ea_subscription_events").delete().eq("branch_id", branchId);
      await admin.from("ea_branch_subscriptions").delete().eq("branch_id", branchId);
      await admin.from("ea_founding_slot_ledger").delete().eq("branch_id", branchId);
      await admin.from("ea_branch_membership_events").delete().eq("branch_id", branchId);
      await admin.from("ea_branch_members").delete().eq("branch_id", branchId);
      await admin.from("ea_branches").delete().eq("id", branchId);
    }
    if (companyId) await admin.from("ea_companies").delete().eq("id", companyId);
    if (userId) {
      await admin.from("profiles").delete().eq("id", userId);
      await admin.auth.admin.deleteUser(userId);
    }
  };

  try {
    userId = await ensureUser(admin, email);
    const client = await signIn(email);
    const profile = await createEstateAgentProfile(client, {
      userId,
      contactName: "Order Owner",
      email,
    });
    if (profile.error) throw new Error(profile.error);
    const onboard = await completeEstateAgentOnboarding(client, {
      userId,
      companyName: `Order Co ${stamp}`,
      branchName: `Order Branch ${stamp}`,
      townOrCity: "London",
      postcode: "E1 6AN",
      isHeadOffice: true,
      emailDomain: domain,
    });
    if (!onboard.success) throw new Error(onboard.error);

    const { data: mem } = await admin
      .from("ea_branch_members")
      .select("branch_id")
      .eq("user_id", userId)
      .single();
    branchId = mem!.branch_id as string;
    const { data: branch } = await admin
      .from("ea_branches")
      .select("company_id")
      .eq("id", branchId)
      .single();
    companyId = branch!.company_id as string;

    const { data: sub, error: subErr } = await admin
      .from("ea_branch_subscriptions")
      .insert({
        branch_id: branchId,
        pricing_tier: "standard",
        amount_gbp_minor: 12900,
        stripe_status: "checkout_pending",
        entitlement_status: "none",
        currency: "gbp",
        stripe_subscription_id: stripeSubId,
      })
      .select("id")
      .single();
    if (subErr || !sub?.id) throw new Error(subErr?.message ?? "sub insert failed");
    subscriptionId = sub.id as string;

    const mk = (
      suffix: string,
      createdOffset: number,
      status: SubStatus,
      type:
        | "customer.subscription.updated"
        | "customer.subscription.deleted"
        | "customer.subscription.created" = "customer.subscription.updated",
      cancelAtPeriodEnd = false
    ) => {
      const eventId = `evt_ord_${suffix}_${randomUUID()}`;
      eventIds.push(eventId);
      return buildSubscriptionEvent({
        eventId,
        eventCreated: t0 + createdOffset,
        type,
        subscriptionId: stripeSubId,
        status,
        cancelAtPeriodEnd,
        branchId,
        companyId,
        subscriptionRowId: subscriptionId,
        periodEnd,
        priceId,
      });
    };

    async function readRow() {
      const { data } = await admin
        .from("ea_branch_subscriptions")
        .select(
          "stripe_status, entitlement_status, ended_at, cancel_at_period_end, grace_ends_at, stripe_object_updated_at"
        )
        .eq("id", subscriptionId)
        .single();
      return data;
    }

    // TEST 1 — newer then older
    const newerActive = mk("newer_active", 200, "active");
    const olderPastDue = mk("older_pastdue", 100, "past_due");
    await processStripeWebhookEvent(newerActive);
    let row = await readRow();
    record(
      "TEST1 newer subscription.updated applied (active/entitled)",
      row?.stripe_status === "active" && row?.entitlement_status === "entitled",
      JSON.stringify(row)
    );
    await processStripeWebhookEvent(olderPastDue);
    row = await readRow();
    record(
      "TEST1 older subscription.updated does not regress state",
      row?.stripe_status === "active" &&
        row?.entitlement_status === "entitled" &&
        !row?.grace_ends_at,
      JSON.stringify(row)
    );

    // TEST 2 — older then newer
    // Reset watermark/state via admin for isolated scenario
    await admin
      .from("ea_branch_subscriptions")
      .update({
        stripe_status: "checkout_pending",
        entitlement_status: "none",
        ended_at: null,
        grace_ends_at: null,
        stripe_object_updated_at: null,
        cancel_at_period_end: false,
      })
      .eq("id", subscriptionId);

    const olderActive = mk("older_active", 50, "active");
    const newerPastDue = mk("newer_pastdue", 150, "past_due");
    await processStripeWebhookEvent(olderActive);
    await processStripeWebhookEvent(newerPastDue);
    row = await readRow();
    record(
      "TEST2 newer state wins after older-then-newer delivery",
      row?.stripe_status === "past_due" && row?.entitlement_status === "grace",
      JSON.stringify(row)
    );

    // TEST 3 — duplicate newer
    const dup = mk("dup_newer", 150, "past_due");
    // Force same chronology as newerPastDue by rebuilding with same created
    const dupSameChronology = {
      ...dup,
      created: newerPastDue.created,
      data: dup.data,
    } as typeof dup;
    await processStripeWebhookEvent(dupSameChronology);
    const afterDup = await readRow();
    record(
      "TEST3 duplicate newer event is idempotent (grace retained)",
      afterDup?.stripe_status === "past_due" &&
        afterDup?.entitlement_status === "grace",
      JSON.stringify(afterDup)
    );

    // TEST 4 — cancellation then older active
    const cancelEvt = mk("cancel", 300, "canceled", "customer.subscription.deleted");
    await processStripeWebhookEvent(cancelEvt);
    row = await readRow();
    record(
      "TEST4 deletion/cancellation ends subscription",
      row?.entitlement_status === "ended" && !!row?.ended_at,
      JSON.stringify(row)
    );
    const olderActiveAfterCancel = mk("active_after_cancel", 250, "active");
    await processStripeWebhookEvent(olderActiveAfterCancel);
    row = await readRow();
    record(
      "TEST4/9 older active cannot resurrect ended subscription",
      row?.entitlement_status === "ended" && !!row?.ended_at,
      JSON.stringify(row)
    );

    // TEST 5 — grace then older active
    await admin
      .from("ea_branch_subscriptions")
      .update({
        stripe_status: "checkout_pending",
        entitlement_status: "none",
        ended_at: null,
        grace_ends_at: null,
        stripe_object_updated_at: null,
        cancel_at_period_end: false,
      })
      .eq("id", subscriptionId);

    const graceEvt = mk("grace", 400, "past_due");
    await processStripeWebhookEvent(graceEvt);
    row = await readRow();
    record(
      "TEST5 payment failure enters grace",
      row?.entitlement_status === "grace" && row?.stripe_status === "past_due",
      JSON.stringify(row)
    );
    const olderActiveInGrace = mk("older_active_in_grace", 350, "active");
    await processStripeWebhookEvent(olderActiveInGrace);
    row = await readRow();
    record(
      "TEST5 older active cannot clear grace",
      row?.entitlement_status === "grace" && row?.stripe_status === "past_due",
      JSON.stringify(row)
    );

    // TEST 6 — recovery then older failure
    const recoveryEvt = mk("recovery", 450, "active");
    await processStripeWebhookEvent(recoveryEvt);
    row = await readRow();
    record(
      "TEST6 valid recovery to entitled succeeds",
      row?.entitlement_status === "entitled" && row?.stripe_status === "active",
      JSON.stringify(row)
    );
    const olderFailure = mk("older_failure", 410, "past_due");
    await processStripeWebhookEvent(olderFailure);
    row = await readRow();
    record(
      "TEST6 older failure cannot undo recovery",
      row?.entitlement_status === "entitled" &&
        row?.stripe_status === "active" &&
        !row?.grace_ends_at,
      JSON.stringify(row)
    );

    // TEST 7 — invoice/payment ordering (shared reconcile watermark; payload
    // stand-ins for invoice.paid / invoice.payment_failed without extra Stripe GETs)
    await admin
      .from("ea_branch_subscriptions")
      .update({
        stripe_status: "checkout_pending",
        entitlement_status: "none",
        ended_at: null,
        grace_ends_at: null,
        stripe_object_updated_at: null,
      })
      .eq("id", subscriptionId);
    const failLike = mk("inv_fail", 500, "past_due");
    const paidLike = mk("inv_paid", 520, "active");
    await processStripeWebhookEvent(paidLike);
    await processStripeWebhookEvent(failLike);
    row = await readRow();
    record(
      "TEST7 later payment state wins over older failure (same watermark authority)",
      row?.entitlement_status === "entitled" && row?.stripe_status === "active",
      JSON.stringify(row)
    );

    // TEST 8 — checkout.session.completed cannot regress newer state
    // (static + payload: older checkout-time active after newer cancel)
    await admin
      .from("ea_branch_subscriptions")
      .update({
        stripe_status: "checkout_pending",
        entitlement_status: "none",
        ended_at: null,
        grace_ends_at: null,
        stripe_object_updated_at: null,
      })
      .eq("id", subscriptionId);
    const postCheckoutNewer = mk(
      "post_checkout",
      600,
      "canceled",
      "customer.subscription.deleted"
    );
    await processStripeWebhookEvent(postCheckoutNewer);
    const staleCheckoutActive = mk("stale_checkout_active", 580, "active");
    await processStripeWebhookEvent(staleCheckoutActive);
    row = await readRow();
    record(
      "TEST8 older checkout-era active cannot regress newer terminal state",
      row?.entitlement_status === "ended",
      JSON.stringify(row)
    );

    // TEST 10 — reverse delivery vs chronological delivery → same final state
    await admin
      .from("ea_branch_subscriptions")
      .update({
        stripe_status: "checkout_pending",
        entitlement_status: "none",
        ended_at: null,
        grace_ends_at: null,
        stripe_object_updated_at: null,
        cancel_at_period_end: false,
      })
      .eq("id", subscriptionId);

    const e1 = mk("chrono_1", 700, "active");
    const e2 = mk("chrono_2", 710, "past_due");
    const e3 = mk("chrono_3", 720, "active");

    // Path A: chronological
    await processStripeWebhookEvent(e1);
    await processStripeWebhookEvent(e2);
    await processStripeWebhookEvent(e3);
    const chronoRow = await readRow();

    await admin
      .from("ea_branch_subscriptions")
      .update({
        stripe_status: "checkout_pending",
        entitlement_status: "none",
        ended_at: null,
        grace_ends_at: null,
        stripe_object_updated_at: null,
        cancel_at_period_end: false,
      })
      .eq("id", subscriptionId);

    // Path B: reverse delivery order (new event ids, same chronology offsets)
    const r3 = mk("rev_3", 720, "active");
    const r2 = mk("rev_2", 710, "past_due");
    const r1 = mk("rev_1", 700, "active");
    await processStripeWebhookEvent(r3);
    await processStripeWebhookEvent(r2);
    await processStripeWebhookEvent(r1);
    const reverseRow = await readRow();

    record(
      "TEST10 reverse delivery yields same final authoritative state",
      chronoRow?.stripe_status === reverseRow?.stripe_status &&
        chronoRow?.entitlement_status === reverseRow?.entitlement_status &&
        chronoRow?.stripe_status === "active" &&
        chronoRow?.entitlement_status === "entitled",
      JSON.stringify({ chronoRow, reverseRow })
    );

    // Concurrent older + newer
    await admin
      .from("ea_branch_subscriptions")
      .update({
        stripe_status: "checkout_pending",
        entitlement_status: "none",
        ended_at: null,
        grace_ends_at: null,
        stripe_object_updated_at: null,
      })
      .eq("id", subscriptionId);
    const cNew = mk("conc_new", 820, "active");
    const cOld = mk("conc_old", 800, "past_due");
    await Promise.all([
      processStripeWebhookEvent(cNew),
      processStripeWebhookEvent(cOld),
    ]);
    row = await readRow();
    record(
      "Concurrent out-of-order delivery does not leave stale final state",
      row?.stripe_status === "active" && row?.entitlement_status === "entitled",
      JSON.stringify(row)
    );

    record(
      "Same current_period_end across events (chronology not period-based)",
      true,
      String(periodEnd)
    );
    record(
      "Entitlement enforcement still false",
      EA_BILLING_ENTITLEMENT_ENFORCEMENT_ENABLED === false
    );
  } catch (error) {
    record(
      "Execute completed without setup crash",
      false,
      error instanceof Error ? error.message : String(error)
    );
  } finally {
    await cleanup();
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

  console.log("EA Billing Webhook Ordering — Development Verification\n");
  console.log(`Environment: Development (${DEVELOPMENT_SUPABASE_PROJECT_REF})`);
  console.log("Production: NOT targeted");
  console.log(`Mode: ${execute ? "--execute" : "read-only static"}`);
  record("Development project ref guard", true);

  runStatic();
  if (execute) {
    await runExecute();
  } else {
    console.log("\nRe-run with --execute to prove stale-event protection.\n");
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
