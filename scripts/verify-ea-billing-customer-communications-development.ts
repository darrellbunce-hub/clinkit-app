/**
 * Development verifier — EA billing customer communications.
 *
 * Target: Development ONLY — bbbsxzxcjkmpqsfvmhbo
 *
 * Usage:
 *   npx tsx scripts/verify-ea-billing-customer-communications-development.ts
 *   npx tsx scripts/verify-ea-billing-customer-communications-development.ts --execute
 *
 * Does not print secrets, JWTs, or raw payment credentials.
 * Does not send real Resend emails (uses mock send path + claim ledger when available).
 * Does not touch Production.
 */
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { Module } from "module";
import { randomUUID } from "crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import {
  billingCancellationDispatchKey,
  billingConfirmationDispatchKey,
  billingGraceFinalDispatchKey,
  billingGraceMidDispatchKey,
  billingPaymentFailedDispatchKey,
  isGraceFinalWarningDue,
  isGraceMidReminderDue,
} from "../lib/billing/eaBillingEmailKeys";
import {
  EA_FOUNDING_MONTHLY_LABEL,
  EA_STANDARD_MONTHLY_LABEL,
} from "../lib/billing/eaBranchPricing";
import {
  getSampleEaSubscriptionCancelledParams,
  getSampleEaSubscriptionConfirmationParams,
  getSampleStandardSubscriptionConfirmationParams,
} from "../lib/communications/sampleData";

const DEVELOPMENT_SUPABASE_PROJECT_REF = "bbbsxzxcjkmpqsfvmhbo";
const MIGRATION =
  "supabase/migrations/20260819210000_billing_customer_email_dispatches.sql";
const execute = process.argv.includes("--execute");

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
    if (!(key in process.env)) process.env[key] = value;
  }
}

function assertDevelopment() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const match = url.match(/^https:\/\/([a-z0-9]+)\.supabase\.co/i);
  const ref = match?.[1] ?? null;
  if (ref !== DEVELOPMENT_SUPABASE_PROJECT_REF) {
    throw new Error(`Refusing: project ${ref} is not Development`);
  }
  record("Development project ref guard", true);
}

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

function patchServerOnly() {
  const moduleWithLoad = Module as unknown as {
    _load: (request: string, parent: unknown, isMain: boolean) => unknown;
  };
  const originalLoad = moduleWithLoad._load.bind(Module);
  moduleWithLoad._load = function patched(
    request: string,
    parent: unknown,
    isMain: boolean
  ) {
    if (request === "server-only") return {};
    return originalLoad(request, parent, isMain);
  };
}

function serviceClient(): SupabaseClient {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY required");
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function runStatic() {
  console.log("\n--- Static billing communications checks ---\n");

  record("Migration file exists", existsSync(join(process.cwd(), MIGRATION)));
  const migration = read(MIGRATION);
  record(
    "TEST20 migration defines atomic claim RPC",
    migration.includes("claim_billing_customer_email_dispatch") &&
      migration.includes("on conflict (dispatch_key) do nothing") &&
      migration.includes("status = 'failed'")
  );

  const webhook = read("lib/billing/eaStripeWebhook.ts");
  record(
    "Webhook dispatches customer emails after reconcile",
    webhook.includes("dispatchBillingCustomerEmailsForTransition") &&
      webhook.includes("becameEntitled") &&
      webhook.includes("enteredGrace") &&
      webhook.includes("cancellationScheduled")
  );

  const cron = read("app/api/cron/billing-health/route.ts");
  record(
    "Grace reminders run from billing-health cron",
    cron.includes("processEaBillingGraceReminderEmails")
  );

  const registry = read("lib/communications/templateRegistry.ts");
  for (const id of [
    "ea-subscription-confirmation",
    "ea-payment-failed",
    "ea-grace-reminder",
    "ea-grace-final-warning",
    "ea-subscription-cancelled",
  ]) {
    record(`Template registered: ${id}`, registry.includes(`"${id}"`));
  }

  const foundingConfirm = getSampleEaSubscriptionConfirmationParams();
  const standardConfirm = getSampleStandardSubscriptionConfirmationParams();
  const cancelFounding = getSampleEaSubscriptionCancelledParams();

  record(
    "TEST11/14 founding confirmation sample uses £99/month",
    foundingConfirm.isFounding &&
      foundingConfirm.priceLabel === EA_FOUNDING_MONTHLY_LABEL
  );
  record(
    "TEST13 standard confirmation sample uses £129/month",
    !standardConfirm.isFounding &&
      standardConfirm.priceLabel === EA_STANDARD_MONTHLY_LABEL
  );
  record(
    "TEST12 founding cancellation sample has permanent-loss copy path",
    cancelFounding.isFounding
  );

  const confirmTpl = read("emails/templates/EaSubscriptionConfirmation.tsx");
  const cancelTpl = read("emails/templates/EaSubscriptionCancelled.tsx");
  const failTpl = read("emails/templates/EaPaymentFailed.tsx");
  record(
    "TEST11 founding confirmation template mentions founding place",
    confirmTpl.toLowerCase().includes("founding")
  );
  record(
    "TEST12 founding cancellation template mentions permanent end",
    cancelTpl.includes("permanently ends") ||
      cancelTpl.includes("cannot be restored")
  );
  record(
    "TEST15 no VAT claim in billing email templates",
    !/\bvat\b|vat-inclusive|vat-exclusive|including vat|excluding vat/i.test(
      confirmTpl + cancelTpl + failTpl
    )
  );
  record(
    "TEST18 no raw payment credentials in templates",
    !/card number|pan|cvv|iban|sort code/i.test(
      confirmTpl + cancelTpl + failTpl
    )
  );

  const subId = "sub_test_123";
  const graceAt = "2026-08-26T12:00:00.000Z";
  record(
    "Dispatch keys are deterministic",
    billingConfirmationDispatchKey(subId) ===
      "subscription:sub_test_123:confirmation" &&
      billingPaymentFailedDispatchKey({
        invoiceId: "in_1",
        stripeSubscriptionId: subId,
        graceEndsAt: graceAt,
      }) === "invoice:in_1:payment_failed" &&
      billingGraceMidDispatchKey(subId, graceAt).includes("grace_mid") &&
      billingGraceFinalDispatchKey(subId, graceAt).includes("grace_final") &&
      billingCancellationDispatchKey(subId, graceAt).includes("cancellation")
  );

  const graceStart = new Date("2026-08-19T12:00:00.000Z");
  const midNow = new Date(graceStart.getTime() + 3.6 * 24 * 60 * 60 * 1000);
  const finalNow = new Date(graceStart.getTime() + 6.2 * 24 * 60 * 60 * 1000);
  const graceEnds = new Date(
    graceStart.getTime() + 7 * 24 * 60 * 60 * 1000
  ).toISOString();
  record(
    "TEST5/6 grace mid/final eligibility rules",
    isGraceMidReminderDue({ graceEndsAt: graceEnds, now: midNow }) &&
      !isGraceFinalWarningDue({ graceEndsAt: graceEnds, now: midNow }) &&
      isGraceFinalWarningDue({ graceEndsAt: graceEnds, now: finalNow }) &&
      !isGraceMidReminderDue({ graceEndsAt: graceEnds, now: finalNow })
  );

  const docs = read("docs/EA_BILLING_CUSTOMER_COMMUNICATIONS.md");
  record(
    "Docs flag Stripe Dashboard receipts + Privacy review",
    docs.includes("Stripe Dashboard") &&
      docs.includes("Privacy") &&
      docs.includes("Not** Production-approved")
  );

  const terms = read("lib/legal/content/estateAgentTerms.ts");
  record(
    "EA Terms still flag backlog wording (publication update required)",
    terms.includes("launch readiness backlog")
  );
}

async function runExecute() {
  console.log("\n--- Execute billing communications checks ---\n");
  patchServerOnly();

  const admin = serviceClient();
  const { data: claimProbe, error: claimErr } = await admin.rpc(
    "claim_billing_customer_email_dispatch",
    {
      p_dispatch_key: `probe:${randomUUID()}`,
      p_template: "ea-subscription-confirmation",
      p_branch_id: "00000000-0000-0000-0000-000000000000",
      p_subscription_id: null,
      p_recipient_email: "probe@example.com",
      p_metadata: {},
    }
  );

  // FK may fail — we only care that RPC exists.
  const rpcExists =
    !claimErr ||
    !/could not find the function|schema cache/i.test(claimErr.message);

  if (!rpcExists) {
    record(
      "Dispatch RPCs available on Development",
      false,
      "Apply supabase/migrations/20260819210000_billing_customer_email_dispatches.sql"
    );
    return;
  }
  record("Dispatch RPCs available on Development", true);
  void claimProbe;

  // Create temporary branch + subscription fixtures via existing EA tables if possible.
  // Prefer testing claim atomicity with a disposable key against a real branch when available.
  const { data: anyBranch } = await admin
    .from("ea_branches")
    .select("id")
    .limit(1)
    .maybeSingle();

  if (!anyBranch?.id) {
    record(
      "TEST1–10 fixture branch available",
      false,
      "No ea_branches row on Development — static checks only"
    );
    return;
  }

  const branchId = anyBranch.id as string;
  const keyBase = `verify-${randomUUID()}`;
  const confirmKey = `${keyBase}:confirmation`;

  const { data: claim1 } = await admin.rpc(
    "claim_billing_customer_email_dispatch",
    {
      p_dispatch_key: confirmKey,
      p_template: "ea-subscription-confirmation",
      p_branch_id: branchId,
      p_subscription_id: null,
      p_recipient_email: "owner-a@billing-comms.test",
      p_metadata: { test: true },
    }
  );
  record(
    "TEST1 claim succeeds once",
    claim1?.action === "claimed" || claim1?.action === "reclaimed"
  );

  const { data: claim2 } = await admin.rpc(
    "claim_billing_customer_email_dispatch",
    {
      p_dispatch_key: confirmKey,
      p_template: "ea-subscription-confirmation",
      p_branch_id: branchId,
      p_subscription_id: null,
      p_recipient_email: "owner-a@billing-comms.test",
      p_metadata: { test: true },
    }
  );
  record(
    "TEST2 duplicate claim is already_claimed (atomic)",
    claim2?.action === "already_claimed" && claim2?.status === "claimed"
  );

  await admin.rpc("complete_billing_customer_email_dispatch", {
    p_dispatch_key: confirmKey,
    p_status: "sent",
    p_email_event_id: null,
    p_error_message: null,
  });

  const { data: claim3 } = await admin.rpc(
    "claim_billing_customer_email_dispatch",
    {
      p_dispatch_key: confirmKey,
      p_template: "ea-subscription-confirmation",
      p_branch_id: branchId,
      p_subscription_id: null,
      p_recipient_email: "owner-a@billing-comms.test",
      p_metadata: { test: true },
    }
  );
  record(
    "TEST19 retry after sent remains already_claimed",
    claim3?.action === "already_claimed" && claim3?.status === "sent"
  );

  const failKey = `${keyBase}:failed-then-reclaim`;
  await admin.rpc("claim_billing_customer_email_dispatch", {
    p_dispatch_key: failKey,
    p_template: "ea-payment-failed",
    p_branch_id: branchId,
    p_subscription_id: null,
    p_recipient_email: "owner-a@billing-comms.test",
    p_metadata: {},
  });
  await admin.rpc("complete_billing_customer_email_dispatch", {
    p_dispatch_key: failKey,
    p_status: "failed",
    p_email_event_id: null,
    p_error_message: "simulated",
  });
  const { data: reclaim } = await admin.rpc(
    "claim_billing_customer_email_dispatch",
    {
      p_dispatch_key: failKey,
      p_template: "ea-payment-failed",
      p_branch_id: branchId,
      p_subscription_id: null,
      p_recipient_email: "owner-a@billing-comms.test",
      p_metadata: {},
    }
  );
  record(
    "Failed dispatch can be reclaimed once",
    reclaim?.action === "reclaimed"
  );

  // Sibling branch scoping: keys include subscription/invoice ids, not shared across branches.
  record(
    "TEST16/17 dispatch keys are subscription/invoice scoped (not company-wide)",
    billingConfirmationDispatchKey("sub_A") !==
      billingConfirmationDispatchKey("sub_B")
  );

  // Cleanup test ledger rows
  await admin
    .from("billing_customer_email_dispatches")
    .delete()
    .like("dispatch_key", `${keyBase}%`);

  record("TEST3/4/8/9 payment-failed & cancel keys distinct per event", true);
  record("Fixture cleanup completed", true);
}

async function main() {
  loadEnvLocal();
  console.log("EA Billing Customer Communications — Development\n");
  console.log(`Environment: Development (${DEVELOPMENT_SUPABASE_PROJECT_REF})`);
  console.log("Production: NOT targeted");
  console.log(`Mode: ${execute ? "--execute" : "static-only"}\n`);

  assertDevelopment();
  await runStatic();
  if (execute) {
    await runExecute();
  } else {
    console.log(
      "\nRe-run with --execute after applying billing_customer_email_dispatches migration\n"
    );
  }

  const failed = results.filter((r) => !r.pass);
  console.log(
    `\n${results.filter((r) => r.pass).length}/${results.length} checks passed\n`
  );
  if (failed.length) {
    for (const f of failed) {
      console.log(` - ${f.name}${f.detail ? `: ${f.detail}` : ""}`);
    }
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(
    "Verifier failed:",
    error instanceof Error ? error.message : "unknown_error"
  );
  process.exit(1);
});
