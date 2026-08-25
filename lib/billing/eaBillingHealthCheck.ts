import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  assessBillingHealth,
  createMemoryBillingOpsAlertStateStore,
  createPostgresBillingOpsAlertStateStore,
  isBillingOpsAlertStateTableAvailable,
  planBillingOpsAlertActions,
  toPublicBillingHealthReport,
  type BillingHealthIncident,
  type BillingHealthSnapshot,
  type BillingOpsAlertAction,
  type BillingOpsAlertStateStore,
  type BillingOpsSeverity,
} from "@/lib/billing/eaBillingHealth";
import {
  getBillingOpsAlertEmail,
  sendBillingOpsAlertEmail,
  type BillingOpsAlertEmailResult,
} from "@/lib/billing/eaBillingOpsAlertEmail";

export type BillingHealthCheckResult = {
  snapshot: BillingHealthSnapshot;
  publicReport: ReturnType<typeof toPublicBillingHealthReport>;
  actions: BillingOpsAlertAction[];
  alertsAttempted: number;
  alertsSent: number;
  alertsDeduped: number;
  alertsFailed: number;
  alertsSkipped: number;
  recoveriesSent: number;
  /** Underlying incidents remain visible even if email delivery fails. */
  underlyingFailureVisible: boolean;
  alertStateBackend: "postgres" | "memory";
};

export type BillingHealthCheckOptions = {
  admin: SupabaseClient;
  now?: Date;
  /** Injected for tests — never send real founder mail from verifiers. */
  deliverAlert?: (input: {
    severity: BillingOpsSeverity;
    subject: string;
    bodyText: string;
    incidentKey: string;
  }) => Promise<BillingOpsAlertEmailResult>;
  sendRecoveryNotifications?: boolean;
  /** Override alert-state persistence (verifier memory store). */
  alertStateStore?: BillingOpsAlertStateStore;
  /** Verifier-only fixture scoping — never set in production cron. */
  fixtureEventIdPrefix?: string;
  fixtureFoundingVerifierTag?: string;
};

function buildAlertBody(
  incident: BillingHealthIncident,
  snapshot: BillingHealthSnapshot
): { subject: string; bodyText: string } {
  const severity = incident.severity.toUpperCase();
  const subject = `[Keynetic Billing ${severity}] ${incident.title}`;
  const lines = [
    `Severity: ${severity}`,
    `Incident: ${incident.key}`,
    `Title: ${incident.title}`,
    "",
    "Counts (no customer PII):",
    `- Failed webhook events: ${snapshot.counts.failedWebhookCount}`,
    `- Stuck processing: ${snapshot.counts.staleProcessingCount}`,
    `- Founding reconcile exceptions: ${snapshot.counts.foundingExceptionCount}`,
    `- Oldest failed age (minutes): ${snapshot.counts.oldestFailedAgeMinutes ?? "n/a"}`,
    `- Last successful webhook: ${snapshot.counts.lastProcessedAt ?? "n/a"}`,
    "",
    "Detail:",
    ...Object.entries(incident.detail).map(([k, v]) => `- ${k}: ${v}`),
    "",
    `Checked at: ${snapshot.checkedAt}`,
    "",
    "Authoritative state remains in stripe_webhook_events / ea_subscription_events.",
    "This message is operational only — alert delivery is not the source of truth.",
  ];
  return { subject, bodyText: lines.join("\n") };
}

function buildRecoveryBody(incidentKey: string, checkedAt: string): {
  subject: string;
  bodyText: string;
} {
  return {
    subject: `[Keynetic Billing RECOVERY] ${incidentKey} cleared`,
    bodyText: [
      `Incident ${incidentKey} is no longer detected by the billing health check.`,
      `Checked at: ${checkedAt}`,
      "",
      "Confirm in stripe_webhook_events / ea_subscription_events if needed.",
    ].join("\n"),
  };
}

async function resolveAlertStateStore(
  admin: SupabaseClient,
  override?: BillingOpsAlertStateStore
): Promise<{ store: BillingOpsAlertStateStore; backend: "postgres" | "memory" }> {
  if (override) {
    return { store: override, backend: "memory" };
  }
  if (await isBillingOpsAlertStateTableAvailable(admin)) {
    return {
      store: createPostgresBillingOpsAlertStateStore(admin),
      backend: "postgres",
    };
  }
  console.warn(
    "[billing-ops] billing_ops_alert_state missing — using ephemeral memory dedupe for this invocation only. Apply migration 20260816250000_billing_p1_ops_alerting.sql"
  );
  return {
    store: createMemoryBillingOpsAlertStateStore(),
    backend: "memory",
  };
}

/**
 * Assess Stripe billing health, dedupe ops alerts, and optionally email.
 * Safe to run on a schedule — silent when healthy.
 */
export async function runBillingHealthCheck(
  options: BillingHealthCheckOptions
): Promise<BillingHealthCheckResult> {
  const { admin } = options;
  const now = options.now ?? new Date();
  const snapshot = await assessBillingHealth(admin, {
    now,
    fixtureEventIdPrefix: options.fixtureEventIdPrefix,
    fixtureFoundingVerifierTag: options.fixtureFoundingVerifierTag,
  });
  const { store, backend } = await resolveAlertStateStore(
    admin,
    options.alertStateStore
  );
  const openStates = await store.loadOpen();
  const actions = planBillingOpsAlertActions({
    snapshot,
    openStates,
    now,
    sendRecoveryNotifications: options.sendRecoveryNotifications,
  });

  const deliver =
    options.deliverAlert ??
    (async (input) =>
      sendBillingOpsAlertEmail({
        severity: input.severity,
        subject: input.subject,
        bodyText: input.bodyText,
        incidentKey: input.incidentKey,
      }));

  let alertsAttempted = 0;
  let alertsSent = 0;
  let alertsDeduped = 0;
  let alertsFailed = 0;
  let alertsSkipped = 0;
  let recoveriesSent = 0;

  for (const action of actions) {
    if (action.type === "noop") continue;

    if (action.type === "deduped") {
      alertsDeduped += 1;
      await store.touchSeen(action.incident, now);
      continue;
    }

    if (action.type === "resolve") {
      if (action.sendRecovery) {
        alertsAttempted += 1;
        const body = buildRecoveryBody(action.incidentKey, snapshot.checkedAt);
        const result = await deliver({
          severity: "warning",
          subject: body.subject,
          bodyText: body.bodyText,
          incidentKey: `${action.incidentKey}:recovery`,
        });
        if (result.ok && result.sent) {
          recoveriesSent += 1;
          alertsSent += 1;
        } else if (result.ok && result.skipped) {
          alertsSkipped += 1;
        } else if (!result.ok) {
          alertsFailed += 1;
        }
      }
      await store.resolve(action.incidentKey, now);
      continue;
    }

    alertsAttempted += 1;
    const body = buildAlertBody(action.incident, snapshot);
    const result = await deliver({
      severity: action.incident.severity,
      subject: body.subject,
      bodyText: body.bodyText,
      incidentKey: action.incident.key,
    });

    if (result.ok && result.sent) {
      alertsSent += 1;
      await store.upsertOpen({
        incident: action.incident,
        deliveryStatus: "sent",
        alerted: true,
        now,
      });
    } else if (result.ok && result.skipped) {
      alertsSkipped += 1;
      await store.upsertOpen({
        incident: action.incident,
        deliveryStatus: "skipped",
        alerted: false,
        now,
      });
    } else {
      alertsFailed += 1;
      await store.upsertOpen({
        incident: action.incident,
        deliveryStatus: "failed",
        alerted: false,
        now,
      });
    }
  }

  return {
    snapshot,
    publicReport: toPublicBillingHealthReport(snapshot),
    actions,
    alertsAttempted,
    alertsSent,
    alertsDeduped,
    alertsFailed,
    alertsSkipped,
    recoveriesSent,
    underlyingFailureVisible: !snapshot.healthy,
    alertStateBackend: backend,
  };
}

export function getBillingOpsAlertRecipientConfigured(): boolean {
  return Boolean(getBillingOpsAlertEmail());
}
