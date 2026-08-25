import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Day 1 Stripe billing operational health.
 *
 * Authoritative failure state: stripe_webhook_events + ea_subscription_events.
 * billing_ops_alert_state is dedupe/notification tracking only.
 *
 * Thresholds (architecture-derived Day 1 defaults):
 * - Single failed webhook younger than FAILED_MIN_AGE → no alert (transient / Stripe retry)
 * - ≥ FAILED_COUNT_THRESHOLD distinct failed events → WARNING (or CRITICAL if many)
 * - One failed event older than FAILED_MIN_AGE → WARNING
 * - processing older than STALE_PROCESSING (≫ P0 300s lease) → CRITICAL
 * - founding_reconcile_exception in lookback → CRITICAL (immediate)
 * - Re-alert cooldown: DEDUPE_COOLDOWN after last alert for same incident_key
 *
 * Deliberately NOT alerted: normal invoice.payment_failed, cancellations,
 * Checkout abandonment, Portal use, founding cohort exhaustion.
 */

export const EA_BILLING_OPS_THRESHOLDS = {
  /** Minutes a failed row must persist before a single failure alerts. */
  failedMinAgeMinutes: 15,
  /** Distinct failed events in the scan window that escalate to an alert. */
  failedCountThreshold: 3,
  /** Distinct failed events treated as CRITICAL (not just WARNING). */
  failedCriticalCount: 10,
  /** Minutes a `processing` lease may run before considered stuck (P0 reclaim = 5m). */
  staleProcessingMinutes: 10,
  /** Lookback for founding reconcile exceptions. */
  foundingExceptionLookbackHours: 72,
  /** Do not re-email the same open incident within this window. */
  dedupeCooldownHours: 6,
  /** Scan window for failed webhook rows. */
  failedScanHours: 24,
} as const;

export type BillingOpsSeverity = "critical" | "warning";

export type BillingOpsIncidentKey =
  | "webhook_failures"
  | "stale_processing"
  | "founding_reconcile_exception";

export type BillingHealthCounts = {
  failedWebhookCount: number;
  oldestFailedAgeMinutes: number | null;
  staleProcessingCount: number;
  foundingExceptionCount: number;
  lastProcessedAt: string | null;
};

export type BillingHealthIncident = {
  key: BillingOpsIncidentKey;
  severity: BillingOpsSeverity;
  title: string;
  /** Counts / ages only — no Stripe IDs, emails, or branch PII. */
  detail: Record<string, number | string | null>;
};

export type BillingHealthSnapshot = {
  checkedAt: string;
  healthy: boolean;
  counts: BillingHealthCounts;
  incidents: BillingHealthIncident[];
};

export type BillingOpsAlertAction =
  | {
      type: "alert";
      incident: BillingHealthIncident;
      reason: "new" | "escalated" | "cooldown_expired";
    }
  | {
      type: "deduped";
      incident: BillingHealthIncident;
      lastAlertedAt: string | null;
    }
  | {
      type: "resolve";
      incidentKey: BillingOpsIncidentKey;
      sendRecovery: boolean;
    }
  | {
      type: "noop";
      reason: string;
    };

function ageMinutes(iso: string | null | undefined, nowMs: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((nowMs - t) / 60_000));
}

export function evaluateBillingIncidents(
  counts: BillingHealthCounts,
  thresholds: typeof EA_BILLING_OPS_THRESHOLDS = EA_BILLING_OPS_THRESHOLDS
): BillingHealthIncident[] {
  const incidents: BillingHealthIncident[] = [];

  if (counts.staleProcessingCount > 0) {
    incidents.push({
      key: "stale_processing",
      severity: "critical",
      title: "Stripe webhook event(s) stuck in processing",
      detail: {
        staleProcessingCount: counts.staleProcessingCount,
        thresholdMinutes: thresholds.staleProcessingMinutes,
      },
    });
  }

  if (counts.foundingExceptionCount > 0) {
    incidents.push({
      key: "founding_reconcile_exception",
      severity: "critical",
      title: "Founding slot reconciliation exception",
      detail: {
        foundingExceptionCount: counts.foundingExceptionCount,
        lookbackHours: thresholds.foundingExceptionLookbackHours,
      },
    });
  }

  const failedCount = counts.failedWebhookCount;
  const oldest = counts.oldestFailedAgeMinutes;
  const persistentSingle =
    failedCount >= 1 &&
    oldest != null &&
    oldest >= thresholds.failedMinAgeMinutes;
  const manyFailures = failedCount >= thresholds.failedCountThreshold;

  if (persistentSingle || manyFailures) {
    const severity: BillingOpsSeverity =
      failedCount >= thresholds.failedCriticalCount ? "critical" : "warning";
    incidents.push({
      key: "webhook_failures",
      severity,
      title: "Stripe webhook processing failures",
      detail: {
        failedWebhookCount: failedCount,
        oldestFailedAgeMinutes: oldest,
        failedMinAgeMinutes: thresholds.failedMinAgeMinutes,
        failedCountThreshold: thresholds.failedCountThreshold,
      },
    });
  }

  return incidents;
}

export async function collectBillingHealthCounts(
  admin: SupabaseClient,
  options?: {
    now?: Date;
    thresholds?: typeof EA_BILLING_OPS_THRESHOLDS;
    /**
     * Verifier-only: restrict webhook/exception scans to fixture ids.
     * Production cron must never set this.
     */
    fixtureEventIdPrefix?: string;
    fixtureFoundingVerifierTag?: string;
  }
): Promise<BillingHealthCounts> {
  const now = options?.now ?? new Date();
  const thresholds = options?.thresholds ?? EA_BILLING_OPS_THRESHOLDS;
  const nowMs = now.getTime();
  const fixturePrefix = options?.fixtureEventIdPrefix;

  const failedSince = new Date(
    nowMs - thresholds.failedScanHours * 60 * 60 * 1000
  ).toISOString();
  const staleBefore = new Date(
    nowMs - thresholds.staleProcessingMinutes * 60 * 1000
  ).toISOString();
  const foundingSince = new Date(
    nowMs - thresholds.foundingExceptionLookbackHours * 60 * 60 * 1000
  ).toISOString();

  let failedQuery = admin
    .from("stripe_webhook_events")
    .select("received_at, processing_started_at")
    .eq("processing_status", "failed")
    .gte("received_at", failedSince)
    .order("received_at", { ascending: true })
    .limit(200);
  if (fixturePrefix) {
    failedQuery = failedQuery.like("stripe_event_id", `${fixturePrefix}%`);
  }

  const { data: failedRows } = await failedQuery;

  const failed = failedRows ?? [];
  const oldestFailedAt =
    failed.length > 0
      ? ((failed[0]?.received_at as string | null) ?? null)
      : null;

  let staleQuery = admin
    .from("stripe_webhook_events")
    .select("stripe_event_id", { count: "exact", head: true })
    .eq("processing_status", "processing")
    .lt("processing_started_at", staleBefore);
  if (fixturePrefix) {
    staleQuery = staleQuery.like("stripe_event_id", `${fixturePrefix}%`);
  }
  const { count: staleCount } = await staleQuery;

  let foundingQuery = admin
    .from("ea_subscription_events")
    .select("id", { count: "exact", head: true })
    .eq("event_type", "founding_reconcile_exception")
    .gte("created_at", foundingSince);
  if (options?.fixtureFoundingVerifierTag) {
    foundingQuery = foundingQuery.contains("metadata", {
      verifier: options.fixtureFoundingVerifierTag,
    });
  }
  const { count: foundingCount } = await foundingQuery;

  let foundingMetaQuery = admin
    .from("ea_subscription_events")
    .select("id", { count: "exact", head: true })
    .eq("event_type", "entitlement_changed")
    .contains("metadata", {
      founding_reconcile_exception: true,
      ...(options?.fixtureFoundingVerifierTag
        ? { verifier: options.fixtureFoundingVerifierTag }
        : {}),
    })
    .gte("created_at", foundingSince);
  const { count: foundingMetaCount } = await foundingMetaQuery;

  let lastProcessedQuery = admin
    .from("stripe_webhook_events")
    .select("processed_at")
    .eq("processing_status", "processed")
    .order("processed_at", { ascending: false })
    .limit(1);
  if (fixturePrefix) {
    lastProcessedQuery = lastProcessedQuery.like(
      "stripe_event_id",
      `${fixturePrefix}%`
    );
  }
  const { data: lastProcessed } = await lastProcessedQuery.maybeSingle();

  return {
    failedWebhookCount: failed.length,
    oldestFailedAgeMinutes: ageMinutes(oldestFailedAt, nowMs),
    staleProcessingCount: staleCount ?? 0,
    foundingExceptionCount:
      (foundingCount ?? 0) + (foundingMetaCount ?? 0),
    lastProcessedAt:
      (lastProcessed?.processed_at as string | null | undefined) ?? null,
  };
}

export async function assessBillingHealth(
  admin: SupabaseClient,
  options?: {
    now?: Date;
    thresholds?: typeof EA_BILLING_OPS_THRESHOLDS;
    fixtureEventIdPrefix?: string;
    fixtureFoundingVerifierTag?: string;
  }
): Promise<BillingHealthSnapshot> {
  const now = options?.now ?? new Date();
  const counts = await collectBillingHealthCounts(admin, options);
  const incidents = evaluateBillingIncidents(
    counts,
    options?.thresholds ?? EA_BILLING_OPS_THRESHOLDS
  );

  return {
    checkedAt: now.toISOString(),
    healthy: incidents.length === 0,
    counts,
    incidents,
  };
}

/**
 * Public cron response: counts + incident titles only.
 * Never includes Stripe IDs, customer emails, branch IDs, or error message bodies.
 */
export function toPublicBillingHealthReport(snapshot: BillingHealthSnapshot): {
  ok: boolean;
  healthy: boolean;
  checkedAt: string;
  webhookProcessing: "healthy" | "degraded";
  failedEvents: number;
  stuckProcessing: number;
  reconciliationExceptions: number;
  oldestFailedAgeMinutes: number | null;
  lastSuccessfulWebhook: string | null;
  openIncidentKeys: BillingOpsIncidentKey[];
} {
  return {
    ok: true,
    healthy: snapshot.healthy,
    checkedAt: snapshot.checkedAt,
    webhookProcessing: snapshot.healthy ? "healthy" : "degraded",
    failedEvents: snapshot.counts.failedWebhookCount,
    stuckProcessing: snapshot.counts.staleProcessingCount,
    reconciliationExceptions: snapshot.counts.foundingExceptionCount,
    oldestFailedAgeMinutes: snapshot.counts.oldestFailedAgeMinutes,
    lastSuccessfulWebhook: snapshot.counts.lastProcessedAt,
    openIncidentKeys: snapshot.incidents.map((i) => i.key),
  };
}

type AlertStateRow = {
  incident_key: string;
  severity: BillingOpsSeverity;
  status: "open" | "resolved";
  last_alerted_at: string | null;
  alert_send_count: number;
};

export type BillingOpsAlertStateRow = AlertStateRow;

export type BillingOpsAlertStateStore = {
  loadOpen: () => Promise<AlertStateRow[]>;
  upsertOpen: (input: {
    incident: BillingHealthIncident;
    deliveryStatus: "sent" | "skipped" | "failed" | "deduped";
    alerted: boolean;
    now?: Date;
  }) => Promise<void>;
  resolve: (
    incidentKey: BillingOpsIncidentKey,
    now?: Date
  ) => Promise<void>;
  touchSeen: (
    incident: BillingHealthIncident,
    now?: Date
  ) => Promise<void>;
};

function severityRank(s: BillingOpsSeverity): number {
  return s === "critical" ? 2 : 1;
}

export function planBillingOpsAlertActions(input: {
  snapshot: BillingHealthSnapshot;
  openStates: AlertStateRow[];
  now?: Date;
  thresholds?: typeof EA_BILLING_OPS_THRESHOLDS;
  /** When true, recovery emails are planned for cleared incidents. */
  sendRecoveryNotifications?: boolean;
}): BillingOpsAlertAction[] {
  const now = input.now ?? new Date();
  const thresholds = input.thresholds ?? EA_BILLING_OPS_THRESHOLDS;
  const cooldownMs = thresholds.dedupeCooldownHours * 60 * 60 * 1000;
  const sendRecovery = input.sendRecoveryNotifications !== false;

  const openByKey = new Map(
    input.openStates
      .filter((s) => s.status === "open")
      .map((s) => [s.incident_key, s] as const)
  );

  const actions: BillingOpsAlertAction[] = [];
  const activeKeys = new Set(input.snapshot.incidents.map((i) => i.key));

  for (const incident of input.snapshot.incidents) {
    const existing = openByKey.get(incident.key);
    if (!existing) {
      actions.push({ type: "alert", incident, reason: "new" });
      continue;
    }

    const lastAlertedMs = existing.last_alerted_at
      ? Date.parse(existing.last_alerted_at)
      : NaN;
    const withinCooldown =
      Number.isFinite(lastAlertedMs) &&
      now.getTime() - lastAlertedMs < cooldownMs;

    const escalated =
      severityRank(incident.severity) > severityRank(existing.severity);

    if (escalated) {
      actions.push({ type: "alert", incident, reason: "escalated" });
      continue;
    }

    if (!withinCooldown) {
      // Still open after cooldown — one reminder, not a storm.
      actions.push({ type: "alert", incident, reason: "cooldown_expired" });
      continue;
    }

    actions.push({
      type: "deduped",
      incident,
      lastAlertedAt: existing.last_alerted_at,
    });
  }

  for (const [key, state] of openByKey) {
    if (!activeKeys.has(key as BillingOpsIncidentKey)) {
      actions.push({
        type: "resolve",
        incidentKey: key as BillingOpsIncidentKey,
        sendRecovery,
      });
      void state;
    }
  }

  if (actions.length === 0) {
    actions.push({ type: "noop", reason: "healthy_or_unchanged" });
  }

  return actions;
}

export async function loadOpenBillingOpsAlertStates(
  admin: SupabaseClient
): Promise<AlertStateRow[]> {
  const { data, error } = await admin
    .from("billing_ops_alert_state")
    .select(
      "incident_key, severity, status, last_alerted_at, alert_send_count"
    )
    .eq("status", "open");

  if (error) {
    // Table may not be applied yet — treat as empty so detection still works.
    console.error(
      "[billing-ops] failed to load alert state:",
      error.message
    );
    return [];
  }

  return (data ?? []) as AlertStateRow[];
}

export async function upsertOpenBillingOpsAlert(
  admin: SupabaseClient,
  input: {
    incident: BillingHealthIncident;
    deliveryStatus: "sent" | "skipped" | "failed" | "deduped";
    alerted: boolean;
    now?: Date;
  }
): Promise<void> {
  const nowIso = (input.now ?? new Date()).toISOString();
  const { data: existing } = await admin
    .from("billing_ops_alert_state")
    .select("alert_send_count, first_seen_at, last_alerted_at")
    .eq("incident_key", input.incident.key)
    .maybeSingle();

  const prevCount = (existing?.alert_send_count as number | undefined) ?? 0;
  const preservedLastAlerted =
    (existing?.last_alerted_at as string | null | undefined) ?? null;

  const row = {
    incident_key: input.incident.key,
    severity: input.incident.severity,
    status: "open" as const,
    title: input.incident.title,
    detail: input.incident.detail,
    first_seen_at: (existing?.first_seen_at as string | undefined) ?? nowIso,
    last_seen_at: nowIso,
    last_alerted_at: input.alerted ? nowIso : preservedLastAlerted,
    resolved_at: null,
    alert_send_count: input.alerted ? prevCount + 1 : prevCount,
    last_delivery_status: input.deliveryStatus,
    updated_at: nowIso,
  };

  const { error } = await admin
    .from("billing_ops_alert_state")
    .upsert(row, { onConflict: "incident_key" });

  if (error) {
    console.error("[billing-ops] upsert alert state failed:", error.message);
  }
}

export async function resolveBillingOpsAlert(
  admin: SupabaseClient,
  incidentKey: BillingOpsIncidentKey,
  now?: Date
): Promise<void> {
  const nowIso = (now ?? new Date()).toISOString();
  const { error } = await admin
    .from("billing_ops_alert_state")
    .update({
      status: "resolved",
      resolved_at: nowIso,
      last_seen_at: nowIso,
      updated_at: nowIso,
      last_delivery_status: "sent",
    })
    .eq("incident_key", incidentKey)
    .eq("status", "open");

  if (error) {
    console.error("[billing-ops] resolve alert state failed:", error.message);
  }
}

/** Touch open incident without sending (dedupe path). */
export async function touchBillingOpsAlertSeen(
  admin: SupabaseClient,
  incident: BillingHealthIncident,
  now?: Date
): Promise<void> {
  const nowIso = (now ?? new Date()).toISOString();
  const { error } = await admin
    .from("billing_ops_alert_state")
    .update({
      severity: incident.severity,
      title: incident.title,
      detail: incident.detail,
      last_seen_at: nowIso,
      updated_at: nowIso,
      last_delivery_status: "deduped",
    })
    .eq("incident_key", incident.key)
    .eq("status", "open");

  if (error) {
    console.error("[billing-ops] touch alert state failed:", error.message);
  }
}

export function createPostgresBillingOpsAlertStateStore(
  admin: SupabaseClient
): BillingOpsAlertStateStore {
  return {
    loadOpen: () => loadOpenBillingOpsAlertStates(admin),
    upsertOpen: (input) => upsertOpenBillingOpsAlert(admin, input),
    resolve: (key, now) => resolveBillingOpsAlert(admin, key, now),
    touchSeen: (incident, now) =>
      touchBillingOpsAlertSeen(admin, incident, now),
  };
}

/** In-memory store for verifiers / when migration is not yet applied. */
export function createMemoryBillingOpsAlertStateStore(): BillingOpsAlertStateStore & {
  rows: Map<string, AlertStateRow & { title?: string; detail?: Record<string, unknown> }>;
} {
  const rows = new Map<
    string,
    AlertStateRow & { title?: string; detail?: Record<string, unknown> }
  >();

  return {
    rows,
    async loadOpen() {
      return [...rows.values()].filter((r) => r.status === "open");
    },
    async upsertOpen(input) {
      const nowIso = (input.now ?? new Date()).toISOString();
      const existing = rows.get(input.incident.key);
      const prevCount = existing?.alert_send_count ?? 0;
      rows.set(input.incident.key, {
        incident_key: input.incident.key,
        severity: input.incident.severity,
        status: "open",
        last_alerted_at: input.alerted
          ? nowIso
          : (existing?.last_alerted_at ?? null),
        alert_send_count: input.alerted ? prevCount + 1 : prevCount,
        title: input.incident.title,
        detail: input.incident.detail,
      });
    },
    async resolve(incidentKey, now) {
      const existing = rows.get(incidentKey);
      if (!existing || existing.status !== "open") return;
      rows.set(incidentKey, {
        ...existing,
        status: "resolved",
        last_alerted_at: existing.last_alerted_at,
      });
      void now;
    },
    async touchSeen(incident, now) {
      const existing = rows.get(incident.key);
      if (!existing || existing.status !== "open") return;
      rows.set(incident.key, {
        ...existing,
        severity: incident.severity,
        title: incident.title,
        detail: incident.detail,
      });
      void now;
    },
  };
}

export async function isBillingOpsAlertStateTableAvailable(
  admin: SupabaseClient
): Promise<boolean> {
  const { error } = await admin
    .from("billing_ops_alert_state")
    .select("incident_key")
    .limit(1);
  return !error;
}
