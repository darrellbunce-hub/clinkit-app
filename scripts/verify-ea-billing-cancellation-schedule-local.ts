/**
 * LOCAL verifier — Stripe scheduled cancellation (cancel_at / cancel_at_period_end),
 * cancelled_at, cancellation email and cancellation_scheduled audit idempotency.
 *
 * Usage:
 *   npx tsx scripts/verify-ea-billing-cancellation-schedule-local.ts
 *
 * Runs the real processStripeWebhookEvent path against an in-memory database.
 * Supabase, Stripe and email sending are stubbed modules: no network, no
 * database, no Stripe, no email.
 */
import Module from "module";

import type Stripe from "stripe";

const moduleWithLoad = Module as typeof Module & {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown;
};
const originalLoad = moduleWithLoad._load.bind(Module);

type SentEmail = { template: string; args: Record<string, unknown> };
const sentEmails: SentEmail[] = [];
const stubsLoaded = { serviceRole: false, stripeClient: false, email: false };
let currentDb: FakeDb | null = null;

const fakeStripe = {
  checkout: {
    sessions: {
      list() {
        return { async *[Symbol.asyncIterator]() {} };
      },
      async expire() {
        throw new Error("unexpected_stripe_call");
      },
      async retrieve() {
        throw new Error("unexpected_stripe_call");
      },
    },
  },
  subscriptions: {
    async retrieve() {
      throw new Error("unexpected_stripe_call");
    },
    async update() {
      throw new Error("unexpected_stripe_call");
    },
    async cancel() {
      throw new Error("unexpected_stripe_call");
    },
  },
};

function emailSender(template: string) {
  return async (args: Record<string, unknown>) => {
    sentEmails.push({ template, args });
    return { ok: true, sent: true, eventId: `email_${sentEmails.length}` };
  };
}

const matches = (request: string, suffix: string) =>
  new RegExp(`(^|[\\\\/])${suffix.replace(/\//g, "[\\\\/]")}(\\.ts)?$`).test(request);

moduleWithLoad._load = function patchedLoad(
  request: string,
  parent: unknown,
  isMain: boolean
) {
  if (request === "server-only") return {};
  if (matches(request, "lib/supabase/serviceRole")) {
    stubsLoaded.serviceRole = true;
    return {
      createServiceRoleSupabaseClient: () => {
        if (!currentDb) throw new Error("fake_db_not_set");
        return currentDb.client;
      },
    };
  }
  if (matches(request, "lib/billing/stripeClient")) {
    stubsLoaded.stripeClient = true;
    return { getStripeClient: () => fakeStripe };
  }
  if (matches(request, "lib/communications/email")) {
    stubsLoaded.email = true;
    return {
      sendEaSubscriptionConfirmation: emailSender("confirmation"),
      sendEaPaymentFailed: emailSender("payment_failed"),
      sendEaGraceReminder: emailSender("grace_reminder"),
      sendEaGraceFinalWarning: emailSender("grace_final"),
      sendEaSubscriptionCancelled: emailSender("cancelled"),
    };
  }
  return originalLoad(request, parent, isMain);
};

process.env.STRIPE_API_MODE = "test";
process.env.STRIPE_SECRET_KEY = "sk_test_local_verifier_placeholder";
process.env.STRIPE_EA_STANDARD_PRICE_ID = "price_standard_local";
process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
delete process.env.STRIPE_EA_FOUNDING_PRICE_ID;

type TestResult = { name: string; pass: boolean; detail?: string };
const results: TestResult[] = [];

function record(name: string, pass: boolean, detail?: string) {
  results.push({ name, pass, detail });
  console.log(pass ? `✓ ${name}` : `✗ ${name}${detail ? `: ${detail}` : ""}`);
}

type Row = Record<string, unknown>;

/** In-memory stand-in for the Supabase client calls made by the webhook path. */
class FakeDb {
  tables: Record<string, Row[]> = {};
  webhookEvents = new Map<string, string>();
  dispatches = new Map<string, string>();
  /** The next insert of this audit event type fails (database unavailable). */
  failNextAuditInsert: string | null = null;
  private nextId = 1;

  constructor(seed: Record<string, Row[]>) {
    for (const [table, rows] of Object.entries(seed)) {
      this.tables[table] = rows.map((r) => ({ ...r }));
    }
  }

  rows(table: string): Row[] {
    return (this.tables[table] ??= []);
  }

  insert(table: string, row: Row): { data: null; error: { code: string; message: string } | null } {
    const rows = this.rows(table);
    if (table === "ea_subscription_events") {
      if (this.failNextAuditInsert === row.event_type) {
        this.failNextAuditInsert = null;
        return { data: null, error: { code: "08006", message: "connection failure" } };
      }
      if (row.id && rows.some((r) => r.id === row.id)) {
        return { data: null, error: { code: "23505", message: "duplicate key (pkey)" } };
      }
      const subId = (row.metadata as Row | undefined)?.stripe_subscription_id;
      if (
        row.event_type === "trial_started" &&
        rows.some(
          (r) =>
            r.event_type === "trial_started" &&
            (r.metadata as Row | undefined)?.stripe_subscription_id === subId
        )
      ) {
        return { data: null, error: { code: "23505", message: "duplicate key (trial)" } };
      }
    }
    rows.push({ id: row.id ?? `generated-${this.nextId++}`, ...row });
    return { data: null, error: null };
  }

  rpc(name: string, args: Row): { data: unknown; error: unknown } {
    if (name === "claim_stripe_webhook_event") {
      const id = args.p_stripe_event_id as string;
      const status = this.webhookEvents.get(id);
      if (status === "processed" || status === "ignored") {
        return { data: { ok: true, action: "already_succeeded", status }, error: null };
      }
      if (status === "processing") {
        return { data: { ok: true, action: "in_progress", status }, error: null };
      }
      this.webhookEvents.set(id, "processing");
      return { data: { ok: true, action: "process", status: "processing" }, error: null };
    }
    if (name === "finish_stripe_webhook_event") {
      this.webhookEvents.set(args.p_stripe_event_id as string, args.p_status as string);
      return { data: { ok: true }, error: null };
    }
    if (name === "claim_billing_customer_email_dispatch") {
      const key = args.p_dispatch_key as string;
      const status = this.dispatches.get(key);
      if (status === undefined) {
        this.dispatches.set(key, "claimed");
        return { data: { ok: true, action: "claimed" }, error: null };
      }
      if (status === "failed") {
        this.dispatches.set(key, "claimed");
        return { data: { ok: true, action: "reclaimed" }, error: null };
      }
      return { data: { ok: true, action: "already_claimed" }, error: null };
    }
    if (name === "complete_billing_customer_email_dispatch") {
      this.dispatches.set(args.p_dispatch_key as string, args.p_status as string);
      return { data: { ok: true }, error: null };
    }
    return { data: null, error: { message: `unexpected_rpc:${name}` } };
  }

  get client() {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const db = this;
    return {
      from: (table: string) => db.builder(table),
      rpc: async (name: string, args: Row) => db.rpc(name, args),
      auth: {
        admin: {
          getUserById: async () => ({
            data: { user: { email: "owner@example.test", user_metadata: { full_name: "Owner" } } },
            error: null,
          }),
        },
      },
    } as never;
  }

  private builder(table: string) {
    let mode: "select" | "insert" | "update" = "select";
    let payload: Row | null = null;
    let limit: number | null = null;
    const filters: ((r: Row) => boolean)[] = [];
    const exec = (): { data: Row[] | null; error: unknown } => {
      if (mode === "insert") return this.insert(table, payload!);
      const matched = this.rows(table).filter((r) => filters.every((f) => f(r)));
      if (mode === "update") {
        for (const r of matched) Object.assign(r, payload);
        return { data: matched.map((r) => ({ ...r })), error: null };
      }
      const limited = limit === null ? matched : matched.slice(0, limit);
      return { data: limited.map((r) => ({ ...r })), error: null };
    };
    const time = (v: unknown) => new Date(String(v)).getTime();
    const b = {
      select: () => b,
      eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), b),
      neq: (c: string, v: unknown) => (filters.push((r) => r[c] !== v), b),
      is: (c: string, v: unknown) => (filters.push((r) => (r[c] ?? null) === v), b),
      in: (c: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[c])), b),
      gte: (c: string, v: unknown) => (filters.push((r) => time(r[c]) >= time(v)), b),
      contains: (c: string, v: Row) => (
        filters.push((r) =>
          Object.entries(v).every(([k, val]) => (r[c] as Row | undefined)?.[k] === val)
        ),
        b
      ),
      or: (expr: string) => {
        const clauses = expr.split(",").map((part) => {
          const [column, op, ...rest] = part.split(".");
          const value = rest.join(".").replace(/^"|"$/g, "");
          return { column: column!, op: op!, value };
        });
        filters.push((r) =>
          clauses.some(({ column, op, value }) => {
            if (op === "is" && value === "null") return (r[column] ?? null) === null;
            if (op === "lte") return r[column] != null && time(r[column]) <= time(value);
            throw new Error(`unsupported_or_clause:${op}`);
          })
        );
        return b;
      },
      order: () => b,
      limit: (n: number) => ((limit = n), b),
      insert: (row: Row) => ((mode = "insert"), (payload = row), b),
      update: (patch: Row) => ((mode = "update"), (payload = patch), b),
      maybeSingle: async () => {
        const result = exec();
        if (result.error) return { data: null, error: result.error };
        return { data: result.data?.[0] ?? null, error: null };
      },
      then: (resolve: (value: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve(exec()).then(resolve, reject),
    };
    return b;
  }
}

const BRANCH = "branch-test-company-2";
const ROW = "row-test-company-2";
const SUB = "sub_local_cancellation";
const PERIOD_START = 1794255893; // 2026-11-09T20:24:53Z
const TRIAL_END = 1796847893; // 2026-12-09T20:24:53Z
const CANCEL_AT = TRIAL_END;
const CANCELED_AT = 1794258339; // 2026-11-09T21:05:39Z
const EVENT_AT = 1794258341;

const iso = (unix: number) => new Date(unix * 1000).toISOString();

function freshDb(rowOverrides: Row = {}): FakeDb {
  return new FakeDb({
    ea_branches: [{ id: BRANCH, name: "Test Company 2", stripe_customer_id: "cus_local" }],
    ea_branch_members: [
      { branch_id: BRANCH, user_id: "user-owner", role: "branch_admin", joined_at: iso(PERIOD_START - 100) },
    ],
    ea_branch_subscriptions: [
      {
        id: ROW,
        branch_id: BRANCH,
        stripe_customer_id: "cus_local",
        stripe_subscription_id: SUB,
        stripe_price_id: "price_standard_local",
        stripe_status: "trialing",
        entitlement_status: "entitled",
        pricing_tier: "standard",
        founding_slot_number: null,
        current_period_start: iso(PERIOD_START),
        current_period_end: iso(TRIAL_END),
        cancel_at_period_end: false,
        cancelled_at: null,
        ended_at: null,
        grace_ends_at: null,
        stripe_object_updated_at: iso(PERIOD_START + 2),
        ...rowOverrides,
      },
    ],
    ea_subscription_events: [
      {
        id: "trial-started-1",
        branch_id: BRANCH,
        subscription_id: ROW,
        event_type: "trial_started",
        actor_source: "webhook",
        metadata: { stripe_subscription_id: SUB },
      },
    ],
  });
}

function subscription(overrides: Row = {}): Stripe.Subscription {
  return {
    id: SUB,
    object: "subscription",
    status: "trialing",
    customer: "cus_local",
    metadata: {
      keynetic_branch_id: BRANCH,
      keynetic_subscription_id: ROW,
      keynetic_env: "test",
    },
    items: {
      data: [
        {
          price: { id: "price_standard_local" },
          current_period_start: PERIOD_START,
          current_period_end: TRIAL_END,
        },
      ],
    },
    cancel_at: null,
    cancel_at_period_end: false,
    canceled_at: null,
    ended_at: null,
    trial_end: TRIAL_END,
    ...overrides,
  } as unknown as Stripe.Subscription;
}

const portalCancellation = { cancel_at: CANCEL_AT, canceled_at: CANCELED_AT };

function event(
  id: string,
  type: string,
  created: number,
  object: Stripe.Subscription
): Stripe.Event {
  return { id, type, created, data: { object } } as unknown as Stripe.Event;
}

const subRow = (db: FakeDb) => db.rows("ea_branch_subscriptions")[0]!;
const audits = (db: FakeDb, type: string) =>
  db.rows("ea_subscription_events").filter((e) => e.event_type === type);
const cancellationEmails = () => sentEmails.filter((e) => e.template === "cancelled");

async function runPureRules() {
  console.log("\n--- Cancellation schedule interpretation (pure) ---\n");
  const { stripeCancellationSchedule, cancelledAtForRow, mapStripeSubscriptionToKeynetic } =
    await import("../lib/billing/mapStripeStatus");
  const at = new Date(EVENT_AT * 1000);
  const periodEnd = new Date(TRIAL_END * 1000);
  const schedule = (stripeStatus: string, cancelAtPeriodEnd: boolean, cancelAtUnix: number | null) =>
    stripeCancellationSchedule({ stripeStatus, cancelAtPeriodEnd, cancelAtUnix, currentPeriodEnd: periodEnd, at });

  const portal = schedule("trialing", false, CANCEL_AT);
  record(
    "SCHEDULE future cancel_at with cancel_at_period_end=false is a pending cancellation at cancel_at",
    portal.scheduled && portal.endsAt?.toISOString() === iso(CANCEL_AT),
    JSON.stringify(portal)
  );
  const legacy = schedule("active", true, null);
  record(
    "SCHEDULE cancel_at_period_end=true without cancel_at ends at current_period_end",
    legacy.scheduled && legacy.endsAt?.toISOString() === iso(TRIAL_END)
  );
  const custom = schedule("active", false, TRIAL_END - 86400);
  record(
    "SCHEDULE custom future cancel_at ends at cancel_at, not the period end",
    custom.scheduled && custom.endsAt?.toISOString() === iso(TRIAL_END - 86400)
  );
  record("SCHEDULE null cancel_at is not a cancellation", !schedule("trialing", false, null).scheduled);
  record(
    "SCHEDULE past cancel_at (before the event) is not a future cancellation",
    !schedule("trialing", false, EVENT_AT - 60).scheduled
  );
  record(
    "SCHEDULE cancel_at equal to the event time is not a future cancellation",
    !schedule("trialing", false, EVENT_AT).scheduled
  );
  record(
    "SCHEDULE terminal canceled + future cancel_at keeps the cancel_at_period_end-only mapping",
    !schedule("canceled", false, CANCEL_AT).scheduled &&
      schedule("canceled", true, null).scheduled
  );
  const ended = mapStripeSubscriptionToKeynetic({
    stripeStatus: "canceled",
    cancelAtPeriodEnd: schedule("canceled", false, CANCEL_AT).scheduled,
    currentPeriodEnd: periodEnd,
  });
  record(
    "SCHEDULE terminal canceled still maps to ended",
    ended.ended && ended.entitlementStatus === "ended"
  );
  const trialing = mapStripeSubscriptionToKeynetic({
    stripeStatus: "trialing",
    cancelAtPeriodEnd: portal.scheduled,
    currentPeriodEnd: periodEnd,
  });
  record(
    "SCHEDULE pending cancellation during trial stays entitled",
    trialing.entitlementStatus === "entitled" && !trialing.ended && trialing.cancelAtPeriodEnd
  );

  const now = new Date("2026-11-09T22:00:00.000Z");
  record(
    "CANCELLED_AT pending cancellation stores Stripe canceled_at",
    cancelledAtForRow({ scheduled: true, ended: false, stripeCanceledAtUnix: CANCELED_AT, existingCancelledAt: null, now }) ===
      iso(CANCELED_AT)
  );
  record(
    "CANCELLED_AT pending without canceled_at keeps the recorded time",
    cancelledAtForRow({ scheduled: true, ended: false, stripeCanceledAtUnix: null, existingCancelledAt: iso(CANCELED_AT), now }) ===
      iso(CANCELED_AT)
  );
  record(
    "CANCELLED_AT pending with neither falls back to now",
    cancelledAtForRow({ scheduled: true, ended: false, stripeCanceledAtUnix: null, existingCancelledAt: null, now }) ===
      now.toISOString()
  );
  record(
    "CANCELLED_AT reversal clears it",
    cancelledAtForRow({ scheduled: false, ended: false, stripeCanceledAtUnix: null, existingCancelledAt: iso(CANCELED_AT), now }) ===
      null
  );
  record(
    "CANCELLED_AT ended subscription records Stripe canceled_at, never now",
    cancelledAtForRow({ scheduled: false, ended: true, stripeCanceledAtUnix: CANCELED_AT, existingCancelledAt: null, now }) ===
      iso(CANCELED_AT) &&
      cancelledAtForRow({ scheduled: false, ended: true, stripeCanceledAtUnix: null, existingCancelledAt: null, now }) === null
  );

  const { cancellationScheduledAuditEventId } = await import("../lib/billing/eaStripeWebhook");
  const idA = cancellationScheduledAuditEventId(SUB, iso(CANCEL_AT));
  record(
    "AUDIT id is a stable UUID per subscription and effective date",
    /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(idA) &&
      idA === cancellationScheduledAuditEventId(SUB, iso(CANCEL_AT)) &&
      idA !== cancellationScheduledAuditEventId(SUB, iso(CANCEL_AT + 86400)) &&
      idA !== cancellationScheduledAuditEventId("sub_other", iso(CANCEL_AT)),
    idA
  );
}

async function runWebhookFlows() {
  const { processStripeWebhookEvent, cancellationScheduledAuditEventId } = await import(
    "../lib/billing/eaStripeWebhook"
  );
  if (!stubsLoaded.serviceRole || !stubsLoaded.stripeClient || !stubsLoaded.email) {
    throw new Error(`module stubs not applied: ${JSON.stringify(stubsLoaded)}`);
  }
  const expectedKey = `subscription:${SUB}:cancellation:${iso(CANCEL_AT)}`;
  const expectedAuditId = cancellationScheduledAuditEventId(SUB, iso(CANCEL_AT));

  console.log("\n--- Portal cancellation (cancel_at, cancel_at_period_end=false) ---\n");
  {
    const db = freshDb();
    currentDb = db;
    sentEmails.length = 0;
    const first = event("evt_portal_1", "customer.subscription.updated", EVENT_AT, subscription(portalCancellation));
    const r1 = await processStripeWebhookEvent(first);
    const row = subRow(db);
    record(
      "PORTAL update is processed and marks the cancellation scheduled",
      r1.ok === true &&
        row.cancel_at_period_end === true &&
        row.stripe_status === "trialing" &&
        row.entitlement_status === "entitled" &&
        row.ended_at === null,
      JSON.stringify({ r1, row })
    );
    record(
      "PORTAL cancelled_at is Stripe canceled_at",
      row.cancelled_at === iso(CANCELED_AT),
      String(row.cancelled_at)
    );
    const emails = cancellationEmails();
    record(
      "PORTAL cancellation email sent once, keyed and dated by cancel_at",
      emails.length === 1 &&
        db.dispatches.get(expectedKey) === "sent" &&
        typeof emails[0]!.args.accessEndsAtLabel === "string" &&
        (emails[0]!.args.accessEndsAtLabel as string).includes("2026") &&
        emails[0]!.args.isTrialing === true,
      JSON.stringify({ emails, dispatches: [...db.dispatches] })
    );
    const scheduled = audits(db, "cancellation_scheduled");
    record(
      "PORTAL cancellation_scheduled audit recorded once with the deterministic id",
      scheduled.length === 1 &&
        scheduled[0]!.id === expectedAuditId &&
        (scheduled[0]!.metadata as Row).cancel_at === iso(CANCEL_AT) &&
        (scheduled[0]!.metadata as Row).cancellation_effective_at === iso(CANCEL_AT),
      JSON.stringify(scheduled)
    );

    await processStripeWebhookEvent(
      event("evt_portal_2", "customer.subscription.updated", EVENT_AT + 1, subscription(portalCancellation))
    );
    await processStripeWebhookEvent(
      event("evt_portal_3", "customer.subscription.updated", EVENT_AT + 2, subscription({ cancel_at: CANCEL_AT }))
    );
    record(
      "REPEAT later updates add no audit row and no email",
      audits(db, "cancellation_scheduled").length === 1 && cancellationEmails().length === 1
    );
    record(
      "REPEAT cancelled_at is not reset by later updates (even without canceled_at)",
      subRow(db).cancelled_at === iso(CANCELED_AT),
      String(subRow(db).cancelled_at)
    );

    const watermark = subRow(db).stripe_object_updated_at;
    const resend = await processStripeWebhookEvent(first);
    record(
      "RESEND of an already-processed event id is skipped as a duplicate (no reconcile)",
      resend.ok === true &&
        resend.duplicate === true &&
        subRow(db).stripe_object_updated_at === watermark &&
        audits(db, "cancellation_scheduled").length === 1 &&
        cancellationEmails().length === 1,
      JSON.stringify(resend)
    );

    await processStripeWebhookEvent(
      event("evt_reverse", "customer.subscription.updated", EVENT_AT + 3, subscription())
    );
    const reversed = subRow(db);
    record(
      "REVERSAL with both indicators cleared clears the scheduled state",
      reversed.cancel_at_period_end === false &&
        reversed.cancelled_at === null &&
        reversed.entitlement_status === "entitled" &&
        reversed.stripe_status === "trialing",
      JSON.stringify(reversed)
    );
    record(
      "REVERSAL adds no cancellation email or audit row",
      audits(db, "cancellation_scheduled").length === 1 && cancellationEmails().length === 1
    );

    await processStripeWebhookEvent(
      event(
        "evt_deleted",
        "customer.subscription.deleted",
        TRIAL_END + 1,
        subscription({ status: "canceled", cancel_at: CANCEL_AT, canceled_at: CANCELED_AT, ended_at: TRIAL_END })
      )
    );
    const ended = subRow(db);
    record(
      "TERMINAL deletion at trial end ends the row exactly as before",
      ended.stripe_status === "canceled" &&
        ended.entitlement_status === "ended" &&
        typeof ended.ended_at === "string" &&
        ended.cancel_at_period_end === false &&
        audits(db, "subscription_expired").length === 1,
      JSON.stringify(ended)
    );
    record(
      "TERMINAL deletion records Stripe canceled_at and sends no cancellation email",
      ended.cancelled_at === iso(CANCELED_AT) && cancellationEmails().length === 1
    );
  }

  console.log("\n--- cancel_at_period_end=true (existing behaviour) ---\n");
  {
    const db = freshDb({ stripe_status: "active" });
    currentDb = db;
    sentEmails.length = 0;
    await processStripeWebhookEvent(
      event(
        "evt_period_end",
        "customer.subscription.updated",
        EVENT_AT,
        subscription({ status: "active", cancel_at_period_end: true, canceled_at: CANCELED_AT })
      )
    );
    await processStripeWebhookEvent(
      event(
        "evt_period_end_2",
        "customer.subscription.updated",
        EVENT_AT + 1,
        subscription({ status: "active", cancel_at_period_end: true, canceled_at: CANCELED_AT })
      )
    );
    const row = subRow(db);
    const emails = cancellationEmails();
    record(
      "PERIOD_END cancel_at_period_end=true is scheduled, entitled, cancelled_at from Stripe",
      row.cancel_at_period_end === true &&
        row.entitlement_status === "entitled" &&
        row.cancelled_at === iso(CANCELED_AT),
      JSON.stringify(row)
    );
    record(
      "PERIOD_END one email (dated by current_period_end) and one audit row across repeats",
      emails.length === 1 &&
        emails[0]!.args.isTrialing === false &&
        db.dispatches.get(`subscription:${SUB}:cancellation:${iso(TRIAL_END)}`) === "sent" &&
        audits(db, "cancellation_scheduled").length === 1
    );
  }

  console.log("\n--- Not a cancellation ---\n");
  {
    const db = freshDb();
    currentDb = db;
    sentEmails.length = 0;
    await processStripeWebhookEvent(
      event("evt_null", "customer.subscription.updated", EVENT_AT, subscription())
    );
    await processStripeWebhookEvent(
      event(
        "evt_past",
        "customer.subscription.updated",
        EVENT_AT + 120,
        subscription({ cancel_at: EVENT_AT + 60 })
      )
    );
    const row = subRow(db);
    record(
      "NOT null and past cancel_at leave the row unscheduled with no email or audit",
      row.cancel_at_period_end === false &&
        row.cancelled_at === null &&
        row.entitlement_status === "entitled" &&
        cancellationEmails().length === 0 &&
        audits(db, "cancellation_scheduled").length === 0,
      JSON.stringify(row)
    );
  }

  console.log("\n--- Retry safety: audit insert fails after the row update ---\n");
  {
    const db = freshDb();
    currentDb = db;
    sentEmails.length = 0;
    db.failNextAuditInsert = "cancellation_scheduled";
    const portal = event("evt_retry", "customer.subscription.updated", EVENT_AT, subscription(portalCancellation));
    const failed = await processStripeWebhookEvent(portal);
    record(
      "RETRY first attempt fails the event after the row was already updated",
      failed.ok === false &&
        db.webhookEvents.get("evt_retry") === "failed" &&
        subRow(db).cancel_at_period_end === true &&
        audits(db, "cancellation_scheduled").length === 0,
      JSON.stringify(failed)
    );
    const retried = await processStripeWebhookEvent(portal);
    record(
      "RETRY Stripe retry records the audit row although the row was already scheduled",
      retried.ok === true &&
        db.webhookEvents.get("evt_retry") === "processed" &&
        audits(db, "cancellation_scheduled").length === 1 &&
        cancellationEmails().length === 1,
      JSON.stringify(retried)
    );
  }

  console.log("\n--- Concurrent deliveries ---\n");
  {
    const db = freshDb();
    currentDb = db;
    sentEmails.length = 0;
    await Promise.all([
      processStripeWebhookEvent(
        event("evt_concurrent_1", "customer.subscription.updated", EVENT_AT, subscription(portalCancellation))
      ),
      processStripeWebhookEvent(
        event("evt_concurrent_2", "customer.subscription.updated", EVENT_AT + 1, subscription(portalCancellation))
      ),
    ]);
    record(
      "CONCURRENT two overlapping updates yield one audit row and one email",
      audits(db, "cancellation_scheduled").length === 1 && cancellationEmails().length === 1,
      JSON.stringify({
        audits: audits(db, "cancellation_scheduled").length,
        emails: cancellationEmails().length,
        events: [...db.webhookEvents],
      })
    );
  }

  console.log("\n--- Immediate cancellation (unchanged) ---\n");
  {
    const db = freshDb();
    currentDb = db;
    sentEmails.length = 0;
    await processStripeWebhookEvent(
      event(
        "evt_immediate",
        "customer.subscription.deleted",
        EVENT_AT,
        subscription({ status: "canceled", canceled_at: EVENT_AT - 1, ended_at: EVENT_AT - 1 })
      )
    );
    const row = subRow(db);
    record(
      "IMMEDIATE deletion ends entitlement at once with no cancellation email or scheduled audit",
      row.entitlement_status === "ended" &&
        row.stripe_status === "canceled" &&
        typeof row.ended_at === "string" &&
        row.cancel_at_period_end === false &&
        row.cancelled_at === iso(EVENT_AT - 1) &&
        cancellationEmails().length === 0 &&
        audits(db, "cancellation_scheduled").length === 0 &&
        audits(db, "subscription_expired").length === 1,
      JSON.stringify(row)
    );
  }
}

async function main() {
  await runPureRules();
  await runWebhookFlows();
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
