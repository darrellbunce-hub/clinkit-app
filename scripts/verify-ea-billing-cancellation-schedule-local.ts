/**
 * LOCAL verifier — Stripe scheduled cancellation (cancel_at / cancel_at_period_end),
 * cancelled_at, cancellation email and cancellation_scheduled audit idempotency,
 * cancellation reversal (previous_attributes) and re-cancellation after a reversal.
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
      sendEaSubscriptionCancellationReversed: emailSender("reversed"),
    };
  }
  return originalLoad(request, parent, isMain);
};

process.env.STRIPE_API_MODE = "test";
process.env.STRIPE_SECRET_KEY = "sk_test_local_verifier_placeholder";
process.env.STRIPE_EA_STANDARD_PRICE_ID = "price_standard_local";
process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
process.env.STRIPE_EA_FOUNDING_PRICE_ID = "price_founding_local";

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
    if (name === "confirm_ea_founding_slot") {
      const row = this.rows("ea_branch_subscriptions").find((r) => r.id === args.p_subscription_id);
      if (row?.pricing_tier === "founding" && typeof row.founding_slot_number === "number") {
        return {
          data: { ok: true, slot_number: row.founding_slot_number, already_confirmed: true },
          error: null,
        };
      }
      return { data: { ok: false, error: "no_founding_slot" }, error: null };
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
  object: Stripe.Subscription,
  previousAttributes?: Row
): Stripe.Event {
  return {
    id,
    type,
    created,
    data: previousAttributes ? { object, previous_attributes: previousAttributes } : { object },
  } as unknown as Stripe.Event;
}

const subRow = (db: FakeDb) => db.rows("ea_branch_subscriptions")[0]!;
const audits = (db: FakeDb, type: string) =>
  db.rows("ea_subscription_events").filter((e) => e.event_type === type);
const cancellationEmails = () => sentEmails.filter((e) => e.template === "cancelled");
const reversalEmails = () => sentEmails.filter((e) => e.template === "reversed");

/** Customer Portal "Don't cancel": Stripe clears all three; previous_attributes holds the old values. */
const portalReversalPrevious = { cancel_at: CANCEL_AT, canceled_at: CANCELED_AT };
const CANCELED_AT_2 = EVENT_AT + 600; // second request after the reversal
const legacyCancellationKey = (endsAt: number) => `subscription:${SUB}:cancellation:${iso(endsAt)}`;
const cancellationKey = (endsAt: number, canceledAt: number) =>
  `${legacyCancellationKey(endsAt)}:requested:${iso(canceledAt)}`;
const reversalKey = (canceledAt: number) =>
  `subscription:${SUB}:cancellation_reversed:${iso(canceledAt)}`;

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

  const { cancellationScheduledAuditEventId, cancellationReversedAuditEventId } = await import(
    "../lib/billing/eaStripeWebhook"
  );
  const uuidV8 = /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  const idA = cancellationScheduledAuditEventId(SUB, iso(CANCEL_AT), iso(CANCELED_AT));
  record(
    "AUDIT id is a stable UUID per subscription, effective date and canceled_at",
    uuidV8.test(idA) &&
      idA === cancellationScheduledAuditEventId(SUB, iso(CANCEL_AT), iso(CANCELED_AT)) &&
      idA !== cancellationScheduledAuditEventId(SUB, iso(CANCEL_AT + 86400), iso(CANCELED_AT)) &&
      idA !== cancellationScheduledAuditEventId("sub_other", iso(CANCEL_AT), iso(CANCELED_AT)) &&
      idA !== cancellationScheduledAuditEventId(SUB, iso(CANCEL_AT), iso(CANCELED_AT_2)),
    idA
  );
  record(
    "AUDIT id without canceled_at is the original subscription + date id",
    cancellationScheduledAuditEventId(SUB, iso(CANCEL_AT), null) !== idA &&
      uuidV8.test(cancellationScheduledAuditEventId(SUB, iso(CANCEL_AT), null))
  );
  const revA = cancellationReversedAuditEventId(SUB, iso(CANCELED_AT));
  record(
    "AUDIT reversal id is a stable UUID per subscription and withdrawn request",
    uuidV8.test(revA) &&
      revA === cancellationReversedAuditEventId(SUB, iso(CANCELED_AT)) &&
      revA !== cancellationReversedAuditEventId(SUB, iso(CANCELED_AT_2)) &&
      revA !== idA
  );

  const { stripeCancellationReversal } = await import("../lib/billing/mapStripeStatus");
  const reversal = (
    previous: Row | null,
    overrides: { stripeStatus?: string; ended?: boolean; nowScheduled?: boolean; current?: number | null } = {}
  ) =>
    stripeCancellationReversal({
      stripeStatus: overrides.stripeStatus ?? "trialing",
      ended: overrides.ended ?? false,
      nowScheduled: overrides.nowScheduled ?? false,
      previous,
      currentCanceledAtUnix: overrides.current ?? null,
    });
  const portalRev = reversal(portalReversalPrevious);
  record(
    "REVERSAL_RULE previous cancel_at + canceled_at, now unscheduled, is a reversal of that request",
    portalRev?.canceledAtUnix === CANCELED_AT && portalRev?.cancelAtUnix === CANCEL_AT,
    JSON.stringify(portalRev)
  );
  record(
    "REVERSAL_RULE previous cancel_at_period_end=true is a reversal",
    reversal({ cancel_at_period_end: true, canceled_at: CANCELED_AT }, { stripeStatus: "active" })
      ?.canceledAtUnix === CANCELED_AT
  );
  record(
    "REVERSAL_RULE no previous_attributes, unrelated attributes, or previously unscheduled is not a reversal",
    reversal(null) === null &&
      reversal({ trial_end: TRIAL_END }) === null &&
      reversal({ cancel_at: null, cancel_at_period_end: false }) === null
  );
  record(
    "REVERSAL_RULE still scheduled (date changed), ended or terminal is not a reversal",
    reversal(portalReversalPrevious, { nowScheduled: true }) === null &&
      reversal(portalReversalPrevious, { ended: true }) === null &&
      reversal(portalReversalPrevious, { stripeStatus: "canceled" }) === null
  );
}

async function runWebhookFlows() {
  const {
    processStripeWebhookEvent,
    cancellationScheduledAuditEventId,
    cancellationReversedAuditEventId,
  } = await import("../lib/billing/eaStripeWebhook");
  if (!stubsLoaded.serviceRole || !stubsLoaded.stripeClient || !stubsLoaded.email) {
    throw new Error(`module stubs not applied: ${JSON.stringify(stubsLoaded)}`);
  }
  const expectedKey = cancellationKey(CANCEL_AT, CANCELED_AT);
  const expectedAuditId = cancellationScheduledAuditEventId(SUB, iso(CANCEL_AT), iso(CANCELED_AT));

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
      event(
        "evt_reverse",
        "customer.subscription.updated",
        EVENT_AT + 3,
        subscription(),
        portalReversalPrevious
      )
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
      "REVERSAL adds no cancellation email or cancellation_scheduled audit row",
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
        db.dispatches.get(cancellationKey(TRIAL_END, CANCELED_AT)) === "sent" &&
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

  const expectedReversalAuditId = cancellationReversedAuditEventId(SUB, iso(CANCELED_AT));

  console.log("\n--- Reversal and re-cancellation lifecycle (trial) ---\n");
  {
    const db = freshDb();
    currentDb = db;
    sentEmails.length = 0;
    await processStripeWebhookEvent(
      event("evt_life_cancel", "customer.subscription.updated", EVENT_AT, subscription(portalCancellation))
    );
    const reversalEvent = event(
      "evt_life_reverse",
      "customer.subscription.updated",
      EVENT_AT + 10,
      subscription(),
      portalReversalPrevious
    );
    const r = await processStripeWebhookEvent(reversalEvent);
    const row = subRow(db);
    record(
      "LIFECYCLE reversal clears cancel_at_period_end and cancelled_at",
      r.ok === true && row.cancel_at_period_end === false && row.cancelled_at === null,
      JSON.stringify({ r, row })
    );
    record(
      "LIFECYCLE reversal keeps the trial entitled (no ended_at, still trialing)",
      row.entitlement_status === "entitled" && row.stripe_status === "trialing" && row.ended_at === null
    );
    const rev = audits(db, "cancellation_reversed");
    record(
      "LIFECYCLE exactly one cancellation_reversed audit row with the deterministic id",
      rev.length === 1 &&
        rev[0]!.id === expectedReversalAuditId &&
        (rev[0]!.metadata as Row).reversed_canceled_at === iso(CANCELED_AT) &&
        (rev[0]!.metadata as Row).reversed_cancel_at === iso(CANCEL_AT),
      JSON.stringify(rev)
    );
    const revEmails = reversalEmails();
    record(
      "LIFECYCLE exactly one reversal email (trial copy, first payment date, standard price)",
      revEmails.length === 1 &&
        db.dispatches.get(reversalKey(CANCELED_AT)) === "sent" &&
        revEmails[0]!.args.isTrialing === true &&
        revEmails[0]!.args.isFounding === false &&
        revEmails[0]!.args.priceLabel === "£129/month" &&
        typeof revEmails[0]!.args.nextBillingDateLabel === "string",
      JSON.stringify({ revEmails, dispatches: [...db.dispatches] })
    );

    const resend = await processStripeWebhookEvent(reversalEvent);
    await processStripeWebhookEvent(
      event(
        "evt_life_reverse_dup",
        "customer.subscription.updated",
        EVENT_AT + 11,
        subscription(),
        portalReversalPrevious
      )
    );
    record(
      "LIFECYCLE duplicate reversal deliveries (same id, and a new id with the same payload) add nothing",
      resend.duplicate === true &&
        audits(db, "cancellation_reversed").length === 1 &&
        reversalEmails().length === 1 &&
        cancellationEmails().length === 1
    );
    await processStripeWebhookEvent(
      event("evt_life_unrelated", "customer.subscription.updated", EVENT_AT + 12, subscription(), {
        metadata: {},
      })
    );
    record(
      "LIFECYCLE an unrelated later update is not treated as a reversal",
      audits(db, "cancellation_reversed").length === 1 && reversalEmails().length === 1
    );

    const recancel = { cancel_at: CANCEL_AT, canceled_at: CANCELED_AT_2 };
    await processStripeWebhookEvent(
      event(
        "evt_life_recancel",
        "customer.subscription.updated",
        CANCELED_AT_2 + 1,
        subscription(recancel),
        { cancel_at: null, canceled_at: null }
      )
    );
    const scheduled = audits(db, "cancellation_scheduled");
    record(
      "LIFECYCLE re-cancellation (same end date, new canceled_at) records a new audit row",
      scheduled.length === 2 &&
        scheduled.some(
          (a) => a.id === cancellationScheduledAuditEventId(SUB, iso(CANCEL_AT), iso(CANCELED_AT_2))
        ) &&
        subRow(db).cancel_at_period_end === true &&
        subRow(db).cancelled_at === iso(CANCELED_AT_2),
      JSON.stringify(scheduled)
    );
    record(
      "LIFECYCLE re-cancellation sends a new cancellation email under a new key",
      cancellationEmails().length === 2 &&
        db.dispatches.get(cancellationKey(CANCEL_AT, CANCELED_AT)) === "sent" &&
        db.dispatches.get(cancellationKey(CANCEL_AT, CANCELED_AT_2)) === "sent",
      JSON.stringify([...db.dispatches])
    );
    await processStripeWebhookEvent(
      event("evt_life_recancel_dup", "customer.subscription.updated", CANCELED_AT_2 + 2, subscription(recancel))
    );
    await processStripeWebhookEvent(
      event(
        "evt_life_recancel_dup2",
        "customer.subscription.updated",
        CANCELED_AT_2 + 3,
        subscription(recancel),
        { cancel_at: null, canceled_at: null }
      )
    );
    record(
      "LIFECYCLE duplicate re-cancellation deliveries add no audit row or email",
      audits(db, "cancellation_scheduled").length === 2 &&
        cancellationEmails().length === 2 &&
        reversalEmails().length === 1
    );

    await processStripeWebhookEvent(
      event(
        "evt_life_reverse_2",
        "customer.subscription.updated",
        CANCELED_AT_2 + 10,
        subscription(),
        recancel
      )
    );
    record(
      "LIFECYCLE a second reversal (of the new request) gets its own audit row and email",
      audits(db, "cancellation_reversed").length === 2 &&
        reversalEmails().length === 2 &&
        db.dispatches.get(reversalKey(CANCELED_AT_2)) === "sent"
    );
  }

  console.log("\n--- Reversal retry safety: audit insert fails after the row update ---\n");
  {
    const db = freshDb();
    currentDb = db;
    sentEmails.length = 0;
    await processStripeWebhookEvent(
      event("evt_rr_cancel", "customer.subscription.updated", EVENT_AT, subscription(portalCancellation))
    );
    db.failNextAuditInsert = "cancellation_reversed";
    const reversalEvent = event(
      "evt_rr_reverse",
      "customer.subscription.updated",
      EVENT_AT + 10,
      subscription(),
      portalReversalPrevious
    );
    const failed = await processStripeWebhookEvent(reversalEvent);
    record(
      "REVERSAL_RETRY first attempt fails after the row was cleared",
      failed.ok === false &&
        subRow(db).cancel_at_period_end === false &&
        audits(db, "cancellation_reversed").length === 0,
      JSON.stringify(failed)
    );
    const retried = await processStripeWebhookEvent(reversalEvent);
    record(
      "REVERSAL_RETRY retry re-detects the reversal from previous_attributes: one audit row, one email",
      retried.ok === true &&
        audits(db, "cancellation_reversed").length === 1 &&
        reversalEmails().length === 1,
      JSON.stringify({ retried, audits: audits(db, "cancellation_reversed").length })
    );
  }

  console.log("\n--- Paid active subscription reversal ---\n");
  {
    const db = freshDb({ stripe_status: "active" });
    currentDb = db;
    sentEmails.length = 0;
    const paid = { status: "active", trial_end: null };
    await processStripeWebhookEvent(
      event(
        "evt_paid_cancel",
        "customer.subscription.updated",
        EVENT_AT,
        subscription({ ...paid, cancel_at_period_end: true, cancel_at: TRIAL_END, canceled_at: CANCELED_AT })
      )
    );
    await processStripeWebhookEvent(
      event("evt_paid_reverse", "customer.subscription.updated", EVENT_AT + 10, subscription(paid), {
        cancel_at: TRIAL_END,
        cancel_at_period_end: true,
        canceled_at: CANCELED_AT,
      })
    );
    const row = subRow(db);
    const revEmails = reversalEmails();
    record(
      "PAID reversal clears the flags and stays active/entitled",
      row.cancel_at_period_end === false &&
        row.cancelled_at === null &&
        row.stripe_status === "active" &&
        row.entitlement_status === "entitled",
      JSON.stringify(row)
    );
    record(
      "PAID one reversal audit row and one email with renewal copy (not trialing)",
      audits(db, "cancellation_reversed").length === 1 &&
        revEmails.length === 1 &&
        revEmails[0]!.args.isTrialing === false &&
        typeof revEmails[0]!.args.nextBillingDateLabel === "string" &&
        cancellationEmails().length === 1,
      JSON.stringify(revEmails)
    );
  }

  console.log("\n--- Records created before request-scoped keys (Stage history) ---\n");
  {
    const legacyAuditId = cancellationScheduledAuditEventId(SUB, iso(CANCEL_AT), null);
    const db = freshDb({ cancel_at_period_end: true, cancelled_at: iso(CANCELED_AT) });
    db.rows("ea_subscription_events").push({
      id: legacyAuditId,
      branch_id: BRANCH,
      subscription_id: ROW,
      event_type: "cancellation_scheduled",
      actor_source: "webhook",
      created_at: iso(EVENT_AT + 1),
      metadata: { stripe_subscription_id: SUB, canceled_at: iso(CANCELED_AT), cancel_at: iso(CANCEL_AT) },
    });
    db.rows("billing_customer_email_dispatches").push({
      dispatch_key: legacyCancellationKey(CANCEL_AT),
      status: "sent",
      created_at: iso(EVENT_AT + 2),
    });
    db.dispatches.set(legacyCancellationKey(CANCEL_AT), "sent");
    currentDb = db;
    sentEmails.length = 0;
    await processStripeWebhookEvent(
      event("evt_legacy_repeat", "customer.subscription.updated", EVENT_AT + 5, subscription(portalCancellation))
    );
    record(
      "LEGACY a redelivery of the already-recorded request adds no audit row or email",
      audits(db, "cancellation_scheduled").length === 1 &&
        cancellationEmails().length === 0 &&
        !db.dispatches.has(cancellationKey(CANCEL_AT, CANCELED_AT)),
      JSON.stringify({ audits: audits(db, "cancellation_scheduled"), dispatches: [...db.dispatches] })
    );
    record(
      "LEGACY existing audit and dispatch records are left untouched",
      audits(db, "cancellation_scheduled")[0]!.id === legacyAuditId &&
        db.rows("billing_customer_email_dispatches")[0]!.status === "sent" &&
        db.rows("billing_customer_email_dispatches")[0]!.created_at === iso(EVENT_AT + 2)
    );
    await processStripeWebhookEvent(
      event("evt_legacy_reverse", "customer.subscription.updated", EVENT_AT + 10, subscription(), portalReversalPrevious)
    );
    record(
      "LEGACY reversal of the earlier request records one reversal row and email",
      audits(db, "cancellation_reversed").length === 1 && reversalEmails().length === 1
    );
    await processStripeWebhookEvent(
      event(
        "evt_legacy_recancel",
        "customer.subscription.updated",
        CANCELED_AT_2 + 1,
        subscription({ cancel_at: CANCEL_AT, canceled_at: CANCELED_AT_2 }),
        { cancel_at: null, canceled_at: null }
      )
    );
    record(
      "LEGACY a new request after the reversal (same end date) gets a new audit row and email",
      audits(db, "cancellation_scheduled").length === 2 &&
        cancellationEmails().length === 1 &&
        db.dispatches.get(cancellationKey(CANCEL_AT, CANCELED_AT_2)) === "sent"
    );
  }
  {
    // Production-format rows: random audit id, no canceled_at in metadata.
    const db = freshDb({ cancel_at_period_end: true, cancelled_at: iso(CANCELED_AT) });
    db.rows("ea_subscription_events").push({
      id: "random-legacy-audit",
      branch_id: BRANCH,
      subscription_id: ROW,
      event_type: "cancellation_scheduled",
      actor_source: "webhook",
      created_at: iso(EVENT_AT + 1),
      metadata: { stripe_subscription_id: SUB },
    });
    db.rows("billing_customer_email_dispatches").push({
      dispatch_key: legacyCancellationKey(CANCEL_AT),
      status: "sent",
      created_at: iso(EVENT_AT + 1),
    });
    currentDb = db;
    sentEmails.length = 0;
    await processStripeWebhookEvent(
      event("evt_legacy_prod", "customer.subscription.updated", EVENT_AT + 5, subscription(portalCancellation))
    );
    record(
      "LEGACY rows without canceled_at, created after the request, also cover it",
      audits(db, "cancellation_scheduled").length === 1 && cancellationEmails().length === 0
    );
  }
  {
    // Pending request already recorded; this update omits canceled_at and the
    // row stores it in Postgres text form.
    const db = freshDb({
      cancel_at_period_end: true,
      cancelled_at: iso(CANCELED_AT).replace(".000Z", "+00:00"),
    });
    currentDb = db;
    sentEmails.length = 0;
    await processStripeWebhookEvent(
      event("evt_no_canceled_at", "customer.subscription.updated", EVENT_AT + 5, subscription({ cancel_at: CANCEL_AT }))
    );
    record(
      "REQUEST without canceled_at in the payload uses the recorded cancelled_at (normalised) as the request",
      db.dispatches.get(expectedKey) === "sent" &&
        audits(db, "cancellation_scheduled").length === 1 &&
        audits(db, "cancellation_scheduled")[0]!.id === expectedAuditId,
      JSON.stringify([...db.dispatches])
    );
  }

  console.log("\n--- Historical £99 founding subscription ---\n");
  {
    const db = freshDb({
      stripe_status: "active",
      stripe_price_id: "price_founding_local",
      pricing_tier: "founding",
      founding_slot_number: 7,
      amount_gbp_minor: 9900,
    });
    currentDb = db;
    sentEmails.length = 0;
    const founding = {
      status: "active",
      trial_end: null,
      items: {
        data: [
          {
            price: { id: "price_founding_local" },
            current_period_start: PERIOD_START,
            current_period_end: TRIAL_END,
          },
        ],
      },
    };
    await processStripeWebhookEvent(
      event(
        "evt_founding_cancel",
        "customer.subscription.updated",
        EVENT_AT,
        subscription({ ...founding, cancel_at_period_end: true, canceled_at: CANCELED_AT })
      )
    );
    const scheduledRow = { ...subRow(db) };
    await processStripeWebhookEvent(
      event("evt_founding_reverse", "customer.subscription.updated", EVENT_AT + 10, subscription(founding), {
        cancel_at_period_end: true,
        canceled_at: CANCELED_AT,
      })
    );
    const row = subRow(db);
    record(
      "FOUNDING cancellation and reversal keep tier, slot and £99 amount",
      scheduledRow.pricing_tier === "founding" &&
        scheduledRow.founding_slot_number === 7 &&
        row.pricing_tier === "founding" &&
        row.founding_slot_number === 7 &&
        row.amount_gbp_minor === 9900 &&
        row.cancel_at_period_end === false &&
        row.entitlement_status === "entitled",
      JSON.stringify({ scheduledRow, row })
    );
    const revEmails = reversalEmails();
    record(
      "FOUNDING reversal email keeps founding copy and £99/month",
      revEmails.length === 1 &&
        revEmails[0]!.args.isFounding === true &&
        revEmails[0]!.args.priceLabel === "£99/month" &&
        audits(db, "cancellation_reversed").length === 1,
      JSON.stringify(revEmails)
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
