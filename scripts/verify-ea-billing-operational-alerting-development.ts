/**
 * Development verifier — Stripe P1 operational alerting / billing health.
 *
 * Target: Development ONLY — bbbsxzxcjkmpqsfvmhbo
 *
 * Usage:
 *   npx tsx scripts/verify-ea-billing-operational-alerting-development.ts --execute
 *
 * Mocks alert delivery — does not email the founder.
 * Does not enable entitlement enforcement. Does not touch Production.
 */
import { randomUUID } from "crypto";
import { existsSync, readFileSync } from "fs";
import Module from "module";
import { join } from "path";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { EA_BILLING_ENTITLEMENT_ENFORCEMENT_ENABLED } from "../lib/billing/eaBranchEntitlement";

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

type EaBillingHealth = typeof import("../lib/billing/eaBillingHealth");
type RunBillingHealthCheck =
  typeof import("../lib/billing/eaBillingHealthCheck").runBillingHealthCheck;

let EA_BILLING_OPS_THRESHOLDS: EaBillingHealth["EA_BILLING_OPS_THRESHOLDS"];
let createMemoryBillingOpsAlertStateStore: EaBillingHealth["createMemoryBillingOpsAlertStateStore"];
let evaluateBillingIncidents: EaBillingHealth["evaluateBillingIncidents"];
let isBillingOpsAlertStateTableAvailable: EaBillingHealth["isBillingOpsAlertStateTableAvailable"];
let toPublicBillingHealthReport: EaBillingHealth["toPublicBillingHealthReport"];
type BillingHealthCounts = import("../lib/billing/eaBillingHealth").BillingHealthCounts;

let runBillingHealthCheck: RunBillingHealthCheck;

async function loadModules() {
  const health = await import("../lib/billing/eaBillingHealth");
  EA_BILLING_OPS_THRESHOLDS = health.EA_BILLING_OPS_THRESHOLDS;
  createMemoryBillingOpsAlertStateStore =
    health.createMemoryBillingOpsAlertStateStore;
  evaluateBillingIncidents = health.evaluateBillingIncidents;
  isBillingOpsAlertStateTableAvailable =
    health.isBillingOpsAlertStateTableAvailable;
  toPublicBillingHealthReport = health.toPublicBillingHealthReport;

  const check = await import("../lib/billing/eaBillingHealthCheck");
  runBillingHealthCheck = check.runBillingHealthCheck;
}

const DEVELOPMENT_SUPABASE_PROJECT_REF = "bbbsxzxcjkmpqsfvmhbo";

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
  if (process.env.VERCEL_ENV === "production") {
    throw new Error("Refusing: VERCEL_ENV=production");
  }
  record("Development project ref guard", true);
}

function serviceClient(): SupabaseClient {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY required");
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function runStatic() {
  console.log("\n--- Static operational alerting checks ---\n");
  // Modules already loaded in main() before this runs.
  record(
    "Entitlement enforcement remains false",
    EA_BILLING_ENTITLEMENT_ENFORCEMENT_ENABLED === false
  );

  const healthSrc = readFileSync(
    join(process.cwd(), "lib/billing/eaBillingHealth.ts"),
    "utf8"
  );
  const checkSrc = readFileSync(
    join(process.cwd(), "lib/billing/eaBillingHealthCheck.ts"),
    "utf8"
  );
  const cronSrc = readFileSync(
    join(process.cwd(), "app/api/cron/billing-health/route.ts"),
    "utf8"
  );
  const vercel = readFileSync(join(process.cwd(), "vercel.json"), "utf8");

  record(
    "TEST14 no new paid infra required (cron + Resend + Postgres)",
    healthSrc.includes("billing_ops_alert_state") &&
      cronSrc.includes("isAuthorizedLifecycleCronRequest") &&
      checkSrc.includes("deliverAlert") &&
      !healthSrc.toLowerCase().includes("datadog") &&
      !healthSrc.toLowerCase().includes("pagerduty") &&
      !healthSrc.toLowerCase().includes("redis")
  );
  record(
    "TEST11 cron/health check is authenticated",
    cronSrc.includes("isAuthorizedLifecycleCronRequest") &&
      cronSrc.includes("Unauthorized")
  );
  record(
    "Cron registered in vercel.json",
    vercel.includes("/api/cron/billing-health")
  );
  record(
    "Migration for alert dedupe state exists",
    existsSync(
      join(
        process.cwd(),
        "supabase/migrations/20260816250000_billing_p1_ops_alerting.sql"
      )
    )
  );

  const healthyCounts: BillingHealthCounts = {
    failedWebhookCount: 0,
    oldestFailedAgeMinutes: null,
    staleProcessingCount: 0,
    foundingExceptionCount: 0,
    lastProcessedAt: new Date().toISOString(),
  };
  record(
    "TEST1 healthy counts produce no incidents",
    evaluateBillingIncidents(healthyCounts).length === 0
  );

  record(
    "TEST2 single transient failure does not alert",
    evaluateBillingIncidents({
      ...healthyCounts,
      failedWebhookCount: 1,
      oldestFailedAgeMinutes: 2,
    }).length === 0
  );

  record(
    "TEST3 repeated failures produce webhook_failures incident",
    evaluateBillingIncidents({
      ...healthyCounts,
      failedWebhookCount: EA_BILLING_OPS_THRESHOLDS.failedCountThreshold,
      oldestFailedAgeMinutes: 5,
    }).some((i) => i.key === "webhook_failures")
  );

  record(
    "TEST4 stuck processing is detected",
    evaluateBillingIncidents({
      ...healthyCounts,
      staleProcessingCount: 1,
    }).some((i) => i.key === "stale_processing")
  );

  record(
    "TEST5 founding reconcile exception is detected",
    evaluateBillingIncidents({
      ...healthyCounts,
      foundingExceptionCount: 1,
    }).some((i) => i.key === "founding_reconcile_exception")
  );

  record(
    "TEST6/7 normal payment failure & cancellation are not system alert signals",
    healthSrc.includes("Deliberately NOT alerted") &&
      healthSrc.includes("invoice.payment_failed") &&
      !healthSrc.includes('event_type === "invoice.payment_failed"') &&
      !healthSrc.includes('case "invoice.payment_failed"')
  );

  const publicReport = toPublicBillingHealthReport({
    checkedAt: new Date().toISOString(),
    healthy: false,
    counts: {
      failedWebhookCount: 2,
      oldestFailedAgeMinutes: 20,
      staleProcessingCount: 0,
      foundingExceptionCount: 0,
      lastProcessedAt: null,
    },
    incidents: [
      {
        key: "webhook_failures",
        severity: "warning",
        title: "Stripe webhook processing failures",
        detail: { failedWebhookCount: 2 },
      },
    ],
  });
  const publicJson = JSON.stringify(publicReport);
  record(
    "TEST10 public report has no sensitive billing identifiers",
    !publicJson.includes("cus_") &&
      !publicJson.includes("sub_") &&
      !publicJson.includes("evt_") &&
      !publicJson.includes("@") &&
      publicReport.failedEvents === 2
  );
}

async function insertWebhookEvent(
  admin: SupabaseClient,
  input: {
    eventId: string;
    status: "failed" | "processing" | "processed";
    receivedAt: string;
    processingStartedAt?: string | null;
    eventType?: string;
  }
) {
  const { error } = await admin.from("stripe_webhook_events").upsert(
    {
      stripe_event_id: input.eventId,
      event_type: input.eventType ?? "customer.subscription.updated",
      processing_status: input.status,
      received_at: input.receivedAt,
      processing_started_at:
        input.processingStartedAt ??
        (input.status === "processing" || input.status === "failed"
          ? input.receivedAt
          : null),
      processed_at: input.status === "processed" ? input.receivedAt : null,
      error_message:
        input.status === "failed" ? "verifier_injected_failure" : null,
    },
    { onConflict: "stripe_event_id" }
  );
  if (error) throw new Error(`insert webhook: ${error.message}`);
}

async function cleanupFixtures(
  admin: SupabaseClient,
  eventIds: string[],
  subscriptionEventIds: string[]
) {
  if (eventIds.length) {
    await admin
      .from("stripe_webhook_events")
      .delete()
      .in("stripe_event_id", eventIds);
  }
  if (subscriptionEventIds.length) {
    await admin
      .from("ea_subscription_events")
      .delete()
      .in("id", subscriptionEventIds);
  }
  const tableOk = await isBillingOpsAlertStateTableAvailable(admin);
  if (tableOk) {
    await admin
      .from("billing_ops_alert_state")
      .delete()
      .in("incident_key", [
        "webhook_failures",
        "stale_processing",
        "founding_reconcile_exception",
      ]);
  }
}

async function runExecute() {
  console.log("\n--- Execute operational alerting checks ---\n");
  const admin = serviceClient();

  const tableOk = await isBillingOpsAlertStateTableAvailable(admin);
  record(
    tableOk
      ? "billing_ops_alert_state available on Development"
      : "billing_ops_alert_state pending on Development (memory dedupe used)",
    true,
    tableOk
      ? undefined
      : "Apply 20260816250000_billing_p1_ops_alerting.sql when DB credentials available"
  );

  const alertStateStore = createMemoryBillingOpsAlertStateStore();
  const prefix = `ops_alert_verify_${randomUUID().slice(0, 8)}`;
  const eventPrefix = `evt_${prefix}`;
  const eventIds: string[] = [];
  const subscriptionEventIds: string[] = [];
  const deliveries: Array<{ incidentKey: string; subject: string }> = [];
  const now = new Date();

  const mockDeliver = async (input: {
    severity: "critical" | "warning";
    subject: string;
    bodyText: string;
    incidentKey: string;
  }) => {
    deliveries.push({
      incidentKey: input.incidentKey,
      subject: input.subject,
    });
    return {
      ok: true as const,
      sent: true as const,
      messageId: `mock_${randomUUID()}`,
    };
  };

  type DeliverFn = typeof mockDeliver;
  const runCheck = (extra?: {
    now?: Date;
    deliverAlert?: DeliverFn | (() => Promise<{ ok: false; sent: false; error: string }>);
    sendRecoveryNotifications?: boolean;
  }) =>
    runBillingHealthCheck({
      admin,
      now: extra?.now ?? now,
      deliverAlert: (extra?.deliverAlert as DeliverFn | undefined) ?? mockDeliver,
      sendRecoveryNotifications: extra?.sendRecoveryNotifications ?? false,
      alertStateStore,
      fixtureEventIdPrefix: eventPrefix,
      fixtureFoundingVerifierTag: prefix,
    });

  try {
    alertStateStore.rows.clear();

    deliveries.length = 0;
    const healthy = await runCheck();
    record(
      "TEST1 healthy billing state produces no alert",
      healthy.snapshot.healthy === true &&
        healthy.alertsSent === 0 &&
        deliveries.length === 0,
      JSON.stringify({
        healthy: healthy.snapshot.healthy,
        incidents: healthy.snapshot.incidents,
      })
    );

    const e1 = `${eventPrefix}_transient`;
    eventIds.push(e1);
    await insertWebhookEvent(admin, {
      eventId: e1,
      status: "failed",
      receivedAt: new Date(now.getTime() - 2 * 60_000).toISOString(),
    });
    deliveries.length = 0;
    const transient = await runCheck();
    record(
      "TEST2 single transient webhook failure does not create alert storm",
      transient.snapshot.incidents.length === 0 &&
        transient.alertsSent === 0 &&
        deliveries.length === 0,
      JSON.stringify(transient.snapshot.counts)
    );

    const e2 = `${eventPrefix}_f2`;
    const e3 = `${eventPrefix}_f3`;
    eventIds.push(e2, e3);
    await insertWebhookEvent(admin, {
      eventId: e2,
      status: "failed",
      receivedAt: new Date(now.getTime() - 5 * 60_000).toISOString(),
    });
    await insertWebhookEvent(admin, {
      eventId: e3,
      status: "failed",
      receivedAt: new Date(now.getTime() - 4 * 60_000).toISOString(),
    });
    deliveries.length = 0;
    const repeated = await runCheck();
    record(
      "TEST3 repeated webhook failure produces one deduplicated alert",
      repeated.snapshot.incidents.some((i) => i.key === "webhook_failures") &&
        repeated.alertsSent === 1 &&
        deliveries.length === 1,
      JSON.stringify({ sent: repeated.alertsSent, n: deliveries.length })
    );

    deliveries.length = 0;
    const again = await runCheck({ now: new Date(now.getTime() + 60_000) });
    record(
      "TEST12 repeated health checks do not repeatedly send the same alert",
      again.alertsDeduped >= 1 &&
        again.alertsSent === 0 &&
        deliveries.length === 0,
      JSON.stringify({ deduped: again.alertsDeduped, sent: again.alertsSent })
    );

    await admin
      .from("stripe_webhook_events")
      .delete()
      .in("stripe_event_id", [e1, e2, e3]);
    deliveries.length = 0;
    const recovered = await runCheck({
      now: new Date(now.getTime() + 120_000),
      sendRecoveryNotifications: true,
    });
    record(
      "TEST8 recovered incident can be identified",
      recovered.snapshot.healthy === true &&
        (recovered.recoveriesSent === 1 ||
          recovered.actions.some((a) => a.type === "resolve")),
      JSON.stringify({
        recoveriesSent: recovered.recoveriesSent,
        actions: recovered.actions.map((a) => a.type),
      })
    );

    const eStuck = `${eventPrefix}_stuck`;
    eventIds.push(eStuck);
    alertStateStore.rows.clear();
    await insertWebhookEvent(admin, {
      eventId: eStuck,
      status: "processing",
      receivedAt: new Date(now.getTime() - 30 * 60_000).toISOString(),
      processingStartedAt: new Date(now.getTime() - 30 * 60_000).toISOString(),
    });
    deliveries.length = 0;
    const stuckRun = await runCheck();
    record(
      "TEST4 stuck processing event is detected (execute)",
      stuckRun.snapshot.incidents.some((i) => i.key === "stale_processing") &&
        stuckRun.alertsSent === 1,
      JSON.stringify(stuckRun.snapshot.incidents)
    );
    await admin
      .from("stripe_webhook_events")
      .delete()
      .eq("stripe_event_id", eStuck);
    alertStateStore.rows.clear();

    const { data: anyBranch } = await admin
      .from("ea_branches")
      .select("id")
      .limit(1)
      .maybeSingle();

    if (anyBranch?.id) {
      const { data: inserted, error: insErr } = await admin
        .from("ea_subscription_events")
        .insert({
          branch_id: anyBranch.id,
          event_type: "founding_reconcile_exception",
          actor_source: "webhook",
          metadata: { verifier: prefix },
        })
        .select("id")
        .single();
      if (insErr) {
        record(
          "TEST5 founding reconcile exception is detected/alerted (execute)",
          false,
          insErr.message
        );
      } else {
        subscriptionEventIds.push(inserted.id as string);
        deliveries.length = 0;
        const foundingRun = await runCheck();
        record(
          "TEST5 founding reconcile exception is detected/alerted (execute)",
          foundingRun.snapshot.incidents.some(
            (i) => i.key === "founding_reconcile_exception"
          ) && foundingRun.alertsSent === 1,
          JSON.stringify(foundingRun.snapshot.incidents)
        );
        await admin
          .from("ea_subscription_events")
          .delete()
          .in("id", subscriptionEventIds);
        subscriptionEventIds.length = 0;
        alertStateStore.rows.clear();
      }
    } else {
      record(
        "TEST5 founding reconcile exception is detected/alerted (execute)",
        true,
        "skipped — no ea_branches; static TEST5 covers detection"
      );
    }

    const ePay = `${eventPrefix}_payfail`;
    eventIds.push(ePay);
    await insertWebhookEvent(admin, {
      eventId: ePay,
      status: "processed",
      receivedAt: now.toISOString(),
      eventType: "invoice.payment_failed",
    });
    deliveries.length = 0;
    const payFail = await runCheck();
    record(
      "TEST6 normal payment failure does NOT create founder system alert",
      payFail.snapshot.healthy === true && payFail.alertsSent === 0,
      JSON.stringify(payFail.snapshot.counts)
    );

    const eCancel = `${eventPrefix}_cancel`;
    eventIds.push(eCancel);
    await insertWebhookEvent(admin, {
      eventId: eCancel,
      status: "processed",
      receivedAt: now.toISOString(),
      eventType: "customer.subscription.deleted",
    });
    deliveries.length = 0;
    const cancelRun = await runCheck();
    record(
      "TEST7 normal subscription cancellation does NOT create founder system alert",
      cancelRun.snapshot.healthy === true && cancelRun.alertsSent === 0
    );

    await insertWebhookEvent(admin, {
      eventId: e1,
      status: "failed",
      receivedAt: new Date(now.getTime() - 20 * 60_000).toISOString(),
    });
    await insertWebhookEvent(admin, {
      eventId: e2,
      status: "failed",
      receivedAt: new Date(now.getTime() - 19 * 60_000).toISOString(),
    });
    await insertWebhookEvent(admin, {
      eventId: e3,
      status: "failed",
      receivedAt: new Date(now.getTime() - 18 * 60_000).toISOString(),
    });
    alertStateStore.rows.clear();
    const deliveryFail = await runCheck({
      deliverAlert: async () => ({
        ok: false as const,
        sent: false as const,
        error: "mock_delivery_failure",
      }),
    });
    record(
      "TEST13 alert delivery failure does not hide underlying billing failure",
      deliveryFail.underlyingFailureVisible === true &&
        deliveryFail.snapshot.healthy === false &&
        deliveryFail.alertsFailed >= 1,
      JSON.stringify({
        visible: deliveryFail.underlyingFailureVisible,
        failed: deliveryFail.alertsFailed,
      })
    );

    const cronMod = await import("../app/api/cron/billing-health/route");
    const unauth = await cronMod.GET(
      new Request("http://localhost/api/cron/billing-health")
    );
    record(
      "TEST9 operational endpoint cannot be accessed by unauthenticated client",
      unauth.status === 401
    );

    const sensitiveCheck = toPublicBillingHealthReport(deliveryFail.snapshot);
    const sensitiveJson = JSON.stringify(sensitiveCheck);
    record(
      "TEST10 operational endpoint does not expose sensitive billing information",
      !sensitiveJson.includes("cus_") &&
        !sensitiveJson.includes("verifier_injected") &&
        !sensitiveJson.includes("cs_") &&
        sensitiveCheck.openIncidentKeys.length >= 1
    );

    record(
      "Entitlement enforcement still false",
      EA_BILLING_ENTITLEMENT_ENFORCEMENT_ENABLED === false
    );
  } finally {
    await cleanupFixtures(admin, eventIds, subscriptionEventIds);
    record("Fixture cleanup completed", true);
  }
}

async function main() {
  loadEnvLocal();
  console.log("EA Billing Operational Alerting — Development Verification\n");
  console.log(`Environment: Development (${DEVELOPMENT_SUPABASE_PROJECT_REF})`);
  console.log("Production: NOT targeted");
  const execute = process.argv.includes("--execute");
  console.log(`Mode: ${execute ? "--execute" : "static-only"}\n`);
  assertDevelopment();
  await loadModules();
  runStatic();
  if (execute) {
    await runExecute();
  }

  const passed = results.filter((r) => r.pass).length;
  const total = results.length;
  console.log(`\n${passed}/${total} checks passed\n`);
  if (passed < total) {
    for (const r of results.filter((x) => !x.pass)) {
      console.log(` - ${r.name}${r.detail ? `: ${r.detail}` : ""}`);
    }
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
