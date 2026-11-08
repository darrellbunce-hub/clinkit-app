/**
 * LOCAL verifier — duplicate-subscription guard, one-trial-per-branch decision,
 * outstanding Checkout session expiry, webhook subscription association,
 * trial_started / payment_succeeded audit events and reconciliation surfacing.
 *
 * Usage:
 *   npx tsx scripts/verify-ea-billing-subscription-guard-local.ts
 *
 * Pure logic, an in-memory fake database for invoice payment recording, and
 * source/migration checks. No network, no database, no Stripe.
 */
import { readFileSync } from "fs";
import Module from "module";
import { join } from "path";

import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  blockedCheckoutResponse,
  CHECKOUT_BLOCKING_STRIPE_STATUSES,
  checkoutSessionBelongsToBranch,
  decideCheckoutFromSubscriptionHistory,
  isLinkedCheckoutSession,
  postLinkSessionReconcileReason,
  type CheckoutOpenRowState,
  type StripeSubscriptionSummary,
} from "../lib/billing/eaCheckoutSubscriptionGuard";
import { decideSubscriptionAssociation } from "../lib/billing/eaSubscriptionAssociation";
import {
  mapStripeSubscriptionToKeynetic,
  webhookAuditEventFor,
} from "../lib/billing/mapStripeStatus";

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

const ROOT = join(import.meta.dirname, "..");
type TestResult = { name: string; pass: boolean; detail?: string };
const results: TestResult[] = [];

function record(name: string, pass: boolean, detail?: string) {
  results.push({ name, pass, detail });
  console.log(pass ? `✓ ${name}` : `✗ ${name}${detail ? `: ${detail}` : ""}`);
}

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

const ROW_ID = "row-open";

function sub(
  status: string,
  overrides: Partial<StripeSubscriptionSummary> = {}
): StripeSubscriptionSummary {
  return {
    id: `sub_${status}`,
    status,
    metadataSubscriptionRowId: null,
    metadataBranchId: "branch-1",
    ...overrides,
  };
}

function decide(
  stripeSubscriptions: StripeSubscriptionSummary[],
  openRow: CheckoutOpenRowState | null = null,
  databaseHistory = false
) {
  return decideCheckoutFromSubscriptionHistory({
    stripeSubscriptions,
    databaseHistory,
    openRow,
  });
}

function runGuardDecisions() {
  console.log("\n--- Checkout guard decisions ---\n");

  const blockingStatuses = [
    "active",
    "trialing",
    "past_due",
    "unpaid",
    "paused",
    "incomplete",
  ];
  for (const status of blockingStatuses) {
    const d = decide([sub(status)]);
    record(
      `GUARD ${status} in Stripe with no open DB row blocks Checkout and reports conflict`,
      d.kind === "blocked" && d.reportConflict === true,
      JSON.stringify(d)
    );
  }

  for (const status of ["canceled", "incomplete_expired"]) {
    const d = decide([sub(status)]);
    record(
      `GUARD ${status} does not block Checkout but uses up the trial`,
      d.kind === "allowed" && d.trialEligible === false,
      JSON.stringify(d)
    );
  }

  record(
    "GUARD blocking set is exactly active/trialing/past_due/unpaid/paused/incomplete",
    CHECKOUT_BLOCKING_STRIPE_STATUSES.size === blockingStatuses.length &&
      blockingStatuses.every((s) => CHECKOUT_BLOCKING_STRIPE_STATUSES.has(s))
  );

  const reported = decide([sub("active")], {
    id: ROW_ID,
    stripe_status: "canceled",
    stripe_subscription_id: "sub_old_ended",
  });
  record(
    "GUARD reported scenario: active Stripe sub while DB row shows ended → blocked + conflict",
    reported.kind === "blocked" && reported.reportConflict === true,
    JSON.stringify(reported)
  );

  const linked = decide([sub("incomplete", { id: "sub_linked" })], {
    id: ROW_ID,
    stripe_status: "incomplete",
    stripe_subscription_id: "sub_linked",
  });
  record(
    "GUARD subscription already linked to the open DB row → blocked without conflict alert",
    linked.kind === "blocked" && linked.reportConflict === false,
    JSON.stringify(linked)
  );

  const delayedWebhook = decide(
    [sub("trialing", { metadataSubscriptionRowId: ROW_ID })],
    { id: ROW_ID, stripe_status: "checkout_pending", stripe_subscription_id: null }
  );
  record(
    "RECOVERY delayed webhook for this row's own completed Checkout → checkout_processing",
    delayedWebhook.kind === "checkout_processing",
    JSON.stringify(delayedWebhook)
  );

  const otherRowSub = decide(
    [sub("active", { metadataSubscriptionRowId: "row-other" })],
    { id: ROW_ID, stripe_status: "checkout_pending", stripe_subscription_id: null }
  );
  record(
    "RECOVERY pending row but Stripe sub belongs to another row → blocked + conflict",
    otherRowSub.kind === "blocked" && otherRowSub.reportConflict === true,
    JSON.stringify(otherRowSub)
  );

  const mixed = decide(
    [
      sub("trialing", { id: "sub_mine", metadataSubscriptionRowId: ROW_ID }),
      sub("active", { id: "sub_extra", metadataSubscriptionRowId: null }),
    ],
    { id: ROW_ID, stripe_status: "checkout_pending", stripe_subscription_id: null }
  );
  record(
    "RECOVERY own pending sub plus an unrelated billable sub → blocked + conflict",
    mixed.kind === "blocked" && mixed.reportConflict === true,
    JSON.stringify(mixed)
  );

  const fresh = decide([]);
  record(
    "TRIAL new branch (no Stripe or DB history) is trial-eligible",
    fresh.kind === "allowed" && fresh.trialEligible === true,
    JSON.stringify(fresh)
  );

  const dbOnly = decide([], null, true);
  record(
    "TRIAL database history alone (no Stripe history) denies the trial",
    dbOnly.kind === "allowed" && dbOnly.trialEligible === false,
    JSON.stringify(dbOnly)
  );

  const historicalCancelled = decide([
    sub("canceled", { id: "sub_2025" }),
    sub("canceled", { id: "sub_2026" }),
  ]);
  record(
    "TRIAL historical cancelled subscriptions allow paid Checkout without a trial",
    historicalCancelled.kind === "allowed" &&
      historicalCancelled.trialEligible === false,
    JSON.stringify(historicalCancelled)
  );
}

function runAuditEventRules() {
  console.log("\n--- Webhook audit event rules ---\n");
  const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const map = (stripeStatus: string, cancelAtPeriodEnd = false) =>
    mapStripeSubscriptionToKeynetic({
      stripeStatus,
      cancelAtPeriodEnd,
      currentPeriodEnd: future,
    });

  record(
    "AUDIT trialing update logs no generic event (no payment during trial)",
    webhookAuditEventFor(map("trialing")) === null
  );
  record(
    "AUDIT subscription status update to active logs no payment_succeeded",
    webhookAuditEventFor(map("active")) === null
  );
  record(
    "AUDIT no subscription status maps to payment_succeeded",
    ["active", "trialing", "past_due", "canceled", "unpaid", "paused", "incomplete"]
      .map((s) => webhookAuditEventFor(map(s)))
      .every((t) => (t as string | null) !== "payment_succeeded")
  );
  record(
    "AUDIT cancellation during trial logs cancellation_scheduled",
    webhookAuditEventFor(map("trialing", true)) === "cancellation_scheduled"
  );
  record(
    "AUDIT past_due logs payment_failed",
    webhookAuditEventFor(map("past_due")) === "payment_failed"
  );
  record(
    "AUDIT canceled logs subscription_expired",
    webhookAuditEventFor(map("canceled")) === "subscription_expired"
  );
}

function runOutstandingSessionRules() {
  console.log("\n--- Outstanding Checkout session handling ---\n");
  const owner = { branchId: "branch-1", customerId: "cus_branch1" };

  record(
    "SESSION belongs to branch only with matching Customer and branch metadata",
    checkoutSessionBelongsToBranch(
      { customer: "cus_branch1", metadata: { keynetic_branch_id: "branch-1" } },
      owner
    ) &&
      checkoutSessionBelongsToBranch(
        { customer: { id: "cus_branch1" }, metadata: { keynetic_branch_id: "branch-1" } },
        owner
      )
  );
  record(
    "SESSION from another branch on the same Customer is never expired",
    !checkoutSessionBelongsToBranch(
      { customer: "cus_branch1", metadata: { keynetic_branch_id: "branch-2" } },
      owner
    )
  );
  record(
    "SESSION for another Customer is never expired",
    !checkoutSessionBelongsToBranch(
      { customer: "cus_other", metadata: { keynetic_branch_id: "branch-1" } },
      owner
    ) &&
      !checkoutSessionBelongsToBranch({ customer: null, metadata: null }, owner)
  );

  record(
    "SESSION open session expired while subscription exists → 409 stripe_subscription_exists",
    blockedCheckoutResponse({ outcomes: ["expired"], listingFailed: false }) ===
      "stripe_subscription_exists"
  );
  record(
    "SESSION expiry failure → checkout_session_expiry_failed (no new Checkout)",
    blockedCheckoutResponse({ outcomes: ["expired", "failed"], listingFailed: false }) ===
      "checkout_session_expiry_failed"
  );
  record(
    "SESSION listing failure → checkout_session_expiry_failed",
    blockedCheckoutResponse({ outcomes: [], listingFailed: true }) ===
      "checkout_session_expiry_failed"
  );
  record(
    "SESSION already complete → checkout_processing",
    blockedCheckoutResponse({ outcomes: ["completed"], listingFailed: false }) ===
      "checkout_processing"
  );
  record(
    "SESSION already expired / foreign only → stripe_subscription_exists",
    blockedCheckoutResponse({ outcomes: ["not_open", "foreign"], listingFailed: false }) ===
      "stripe_subscription_exists"
  );

  const linked = { stripeSubscriptionId: "sub_A", checkoutSessionId: "cs_A" };
  record(
    "POSTLINK session that created the linked subscription is recognised (by session id)",
    isLinkedCheckoutSession({ id: "cs_A", subscription: null }, linked)
  );
  record(
    "POSTLINK session carrying the linked subscription is recognised (string or object)",
    isLinkedCheckoutSession({ id: "cs_x", subscription: "sub_A" }, linked) &&
      isLinkedCheckoutSession({ id: "cs_y", subscription: { id: "sub_A" } }, linked)
  );
  record(
    "POSTLINK unrelated open session is not protected",
    !isLinkedCheckoutSession({ id: "cs_B", subscription: null }, linked) &&
      !isLinkedCheckoutSession(
        { id: "cs_B", subscription: null },
        { stripeSubscriptionId: "sub_A" }
      )
  );
  record(
    "POSTLINK all other sessions expired / foreign / linked → no reconcile",
    postLinkSessionReconcileReason({
      outcomes: ["expired", "not_open", "foreign", "linked"],
      listingFailed: false,
    }) === null
  );
  record(
    "POSTLINK expiry or listing failure → post_link_checkout_session_expiry_failed",
    postLinkSessionReconcileReason({ outcomes: ["expired", "failed"], listingFailed: false }) ===
      "post_link_checkout_session_expiry_failed" &&
      postLinkSessionReconcileReason({ outcomes: [], listingFailed: true }) ===
        "post_link_checkout_session_expiry_failed"
  );
  record(
    "POSTLINK another session already completed → post_link_other_checkout_session_completed",
    postLinkSessionReconcileReason({ outcomes: ["completed"], listingFailed: false }) ===
      "post_link_other_checkout_session_completed"
  );
  record(
    "SESSION 'linked' outcome never blocks a Checkout response on its own",
    blockedCheckoutResponse({ outcomes: ["linked"], listingFailed: false }) ===
      "stripe_subscription_exists"
  );
}

function runAssociationRules() {
  console.log("\n--- Webhook subscription association ---\n");
  const base = {
    incomingStripeSubscriptionId: "sub_new",
    incomingStatus: "active",
    rowIsConfirmedFounding: false,
  };

  record(
    "ASSOC unlinked row links the subscription",
    decideSubscriptionAssociation({ ...base, rowStripeSubscriptionId: null }).kind === "link"
  );
  record(
    "ASSOC row already linked to the same subscription links (normal update)",
    decideSubscriptionAssociation({ ...base, rowStripeSubscriptionId: "sub_new" }).kind ===
      "link"
  );
  record(
    "ASSOC row linked to another subscription requires a Stripe status lookup first",
    decideSubscriptionAssociation({ ...base, rowStripeSubscriptionId: "sub_old" }).kind ===
      "lookup_previous"
  );
  const live = decideSubscriptionAssociation({
    ...base,
    rowStripeSubscriptionId: "sub_old",
    previousLinkedStatus: "active",
  });
  record(
    "ASSOC row linked to another LIVE subscription → conflict (no overwrite)",
    live.kind === "conflict" && live.reason === "row_linked_to_other_live_subscription",
    JSON.stringify(live)
  );
  for (const previous of ["unpaid", "paused", "past_due", "trialing", "incomplete"]) {
    const d = decideSubscriptionAssociation({
      ...base,
      rowStripeSubscriptionId: "sub_old",
      previousLinkedStatus: previous,
    });
    record(
      `ASSOC previously linked ${previous} subscription is treated as live → conflict`,
      d.kind === "conflict",
      JSON.stringify(d)
    );
  }
  record(
    "ASSOC previously linked subscription canceled/incomplete_expired/missing → replace",
    ["canceled", "incomplete_expired", null].every(
      (previous) =>
        decideSubscriptionAssociation({
          ...base,
          rowStripeSubscriptionId: "sub_old",
          previousLinkedStatus: previous,
        }).kind === "replace_terminal"
    )
  );
  const founding = decideSubscriptionAssociation({
    ...base,
    rowStripeSubscriptionId: "sub_founding",
    rowIsConfirmedFounding: true,
    previousLinkedStatus: "canceled",
  });
  record(
    "ASSOC confirmed historical founding row is never re-pointed → conflict",
    founding.kind === "conflict" &&
      founding.reason === "founding_row_linked_to_other_subscription",
    JSON.stringify(founding)
  );
  record(
    "ASSOC historical founding subscription's own events still link",
    decideSubscriptionAssociation({
      ...base,
      incomingStripeSubscriptionId: "sub_founding",
      rowStripeSubscriptionId: "sub_founding",
      rowIsConfirmedFounding: true,
    }).kind === "link"
  );
  record(
    "ASSOC late terminal event for a superseded subscription is ignored",
    decideSubscriptionAssociation({
      ...base,
      incomingStatus: "canceled",
      rowStripeSubscriptionId: "sub_old",
    }).kind === "ignore_superseded"
  );
  const otherOpen = decideSubscriptionAssociation({
    ...base,
    rowStripeSubscriptionId: "sub_new",
    otherOpenRow: { id: "row-2" },
  });
  record(
    "ASSOC live subscription for an ended row while the branch has another open row → conflict",
    otherOpen.kind === "conflict" && otherOpen.reason === "branch_has_other_open_row",
    JSON.stringify(otherOpen)
  );
}

type FakeEventRow = {
  branch_id: string;
  subscription_id: string | null;
  event_type: string;
  metadata: Record<string, unknown>;
};

/** Minimal in-memory stand-in for the Supabase query builder used by recordInvoicePaymentSucceeded. */
function createFakeAdmin(options: {
  subscriptionRows: {
    id: string;
    branch_id: string;
    stripe_subscription_id: string;
    ended_at?: string | null;
  }[];
  /** Simulate the concurrent-delivery race: the lookup never sees existing rows. */
  lookupMisses?: boolean;
  /** Every audit insert fails (database unavailable). */
  failInserts?: boolean;
}) {
  const events: FakeEventRow[] = [];
  const admin = {
    from(table: string) {
      const filters: ((row: Record<string, unknown>) => boolean)[] = [];
      let insertRow: FakeEventRow | null = null;
      const run = () => {
        if (insertRow && options.failInserts) {
          return { data: null, error: { code: "08006", message: "connection failure" } };
        }
        if (insertRow) {
          const invoiceId = insertRow.metadata.stripe_invoice_id;
          const duplicate =
            insertRow.event_type === "payment_succeeded" &&
            invoiceId !== undefined &&
            events.some(
              (e) =>
                e.event_type === "payment_succeeded" &&
                e.metadata.stripe_invoice_id === invoiceId
            );
          if (duplicate) {
            return { data: null, error: { code: "23505", message: "duplicate key" } };
          }
          events.push(insertRow);
          return { data: null, error: null };
        }
        const source: Record<string, unknown>[] =
          table === "ea_subscription_events"
            ? options.lookupMisses
              ? []
              : (events as unknown as Record<string, unknown>[])
            : (options.subscriptionRows as unknown as Record<string, unknown>[]);
        return { data: source.filter((r) => filters.every((f) => f(r))), error: null };
      };
      const builder = {
        select: () => builder,
        eq: (column: string, value: unknown) => {
          filters.push((r) => r[column] === value);
          return builder;
        },
        is: (column: string, value: unknown) => {
          filters.push((r) => (r[column] ?? null) === value);
          return builder;
        },
        gte: () => builder,
        contains: (column: string, value: Record<string, unknown>) => {
          filters.push((r) =>
            Object.entries(value).every(
              ([k, v]) => (r[column] as Record<string, unknown>)?.[k] === v
            )
          );
          return builder;
        },
        limit: () => builder,
        insert: (row: FakeEventRow) => {
          insertRow = row;
          return builder;
        },
        maybeSingle: async () => {
          const result = run();
          const rows = (result.data as unknown[] | null) ?? [];
          return { data: rows[0] ?? null, error: result.error };
        },
        then: (resolve: (value: unknown) => unknown, reject?: (e: unknown) => unknown) =>
          Promise.resolve(run()).then(resolve, reject),
      };
      return builder;
    },
  };
  return { admin: admin as unknown as SupabaseClient, events };
}

async function runInvoicePaymentRules() {
  console.log("\n--- Invoice payment audit (in-memory fake database) ---\n");
  const { recordInvoicePaymentSucceeded } = await import(
    "../lib/billing/eaStripeWebhook"
  );
  const subscription = {
    id: "sub_paid",
    metadata: { keynetic_branch_id: "branch-1" },
  } as unknown as Stripe.Subscription;
  const rows = [{ id: "row-1", branch_id: "branch-1", stripe_subscription_id: "sub_paid" }];
  const invoice = (id: string, amountPaid: number) =>
    ({
      id,
      amount_paid: amountPaid,
      currency: "gbp",
      billing_reason: "subscription_cycle",
    }) as unknown as Stripe.Invoice;
  const payments = (events: FakeEventRow[]) =>
    events.filter((e) => e.event_type === "payment_succeeded");

  const trial = createFakeAdmin({ subscriptionRows: rows });
  await recordInvoicePaymentSucceeded(trial.admin, invoice("in_trial", 0), subscription);
  record(
    "PAYMENT £0 trial invoice records no payment_succeeded",
    payments(trial.events).length === 0
  );

  const paid = createFakeAdmin({ subscriptionRows: rows });
  await recordInvoicePaymentSucceeded(paid.admin, invoice("in_paid", 12900), subscription);
  const recorded = payments(paid.events);
  record(
    "PAYMENT paid invoice records exactly one payment_succeeded keyed by invoice id",
    recorded.length === 1 &&
      recorded[0]!.metadata.stripe_invoice_id === "in_paid" &&
      recorded[0]!.metadata.amount_paid === 12900 &&
      recorded[0]!.subscription_id === "row-1",
    JSON.stringify(recorded)
  );

  await recordInvoicePaymentSucceeded(paid.admin, invoice("in_paid", 12900), subscription);
  record(
    "PAYMENT duplicate invoice delivery is idempotent (lookup path)",
    payments(paid.events).length === 1
  );

  const race = createFakeAdmin({ subscriptionRows: rows, lookupMisses: true });
  await recordInvoicePaymentSucceeded(race.admin, invoice("in_race", 12900), subscription);
  let raceThrew = false;
  try {
    await recordInvoicePaymentSucceeded(race.admin, invoice("in_race", 12900), subscription);
  } catch {
    raceThrew = true;
  }
  record(
    "PAYMENT concurrent duplicate hits the unique index and is treated as recorded",
    payments(race.events).length === 1 && !raceThrew
  );

  await recordInvoicePaymentSucceeded(paid.admin, invoice("in_next", 12900), subscription);
  record(
    "PAYMENT a different invoice (next renewal) records its own payment_succeeded",
    payments(paid.events).length === 2
  );

  const unlinked = createFakeAdmin({ subscriptionRows: [] });
  await recordInvoicePaymentSucceeded(
    unlinked.admin,
    invoice("in_conflict", 12900),
    subscription
  );
  const unlinkedPayments = payments(unlinked.events);
  record(
    "PAYMENT for a subscription not linked to any row is still recorded against the branch",
    unlinkedPayments.length === 1 &&
      unlinkedPayments[0]!.subscription_id === null &&
      unlinkedPayments[0]!.branch_id === "branch-1",
    JSON.stringify(unlinkedPayments)
  );
}

type FakeSession = {
  id: string;
  status: "open" | "complete" | "expired";
  customer: string;
  metadata: Record<string, string>;
  subscription: string | null;
};

/** In-memory Stripe Checkout sessions API. No subscriptions API: any call would throw. */
function createFakeStripe(
  sessions: FakeSession[],
  options: {
    listFails?: boolean;
    /** expire() throws for these ids; retrieve() then reports `afterFailure`. */
    expireFails?: Record<string, "open" | "complete">;
  } = {}
) {
  const expireCalls: string[] = [];
  const listCalls: { customer: string; status: string }[] = [];
  const stripe = {
    checkout: {
      sessions: {
        list(params: { customer: string; status: "open"; limit: number }) {
          listCalls.push({ customer: params.customer, status: params.status });
          const snapshot = sessions.filter(
            (s) => s.customer === params.customer && s.status === params.status
          );
          return {
            async *[Symbol.asyncIterator]() {
              if (options.listFails) throw new Error("stripe_unavailable");
              for (const s of snapshot) yield s as unknown as Stripe.Checkout.Session;
            },
          };
        },
        async expire(id: string) {
          expireCalls.push(id);
          const failure = options.expireFails?.[id];
          const session = sessions.find((s) => s.id === id)!;
          if (failure) {
            session.status = failure;
            throw new Error("stripe_expire_failed");
          }
          if (session.status !== "open") throw new Error("session_not_open");
          session.status = "expired";
          return session;
        },
        async retrieve(id: string) {
          return sessions.find((s) => s.id === id) as unknown as Stripe.Checkout.Session;
        },
      },
    },
  };
  return { stripe, expireCalls, listCalls };
}

async function runPostLinkSessionExpiry() {
  console.log("\n--- Webhook post-link Checkout session expiry (in-memory fakes) ---\n");
  const { expireOtherCheckoutSessionsAfterLink } = await import(
    "../lib/billing/eaStripeWebhook"
  );
  const branchMeta = { keynetic_branch_id: "branch-1" };
  const linkedSub = (status = "trialing", id = "sub_A") =>
    ({ id, status, customer: "cus_1", metadata: branchMeta }) as unknown as Stripe.Subscription;
  const rows = [{ id: "row-1", branch_id: "branch-1", stripe_subscription_id: "sub_A" }];
  const at = { eventChronologyAt: new Date("2026-11-08T12:00:00Z") };
  const reconcile = (events: FakeEventRow[]) =>
    events.filter((e) => e.event_type === "billing_reconcile_required");
  const raceSessions = (): FakeSession[] => [
    { id: "cs_A", status: "complete", customer: "cus_1", metadata: branchMeta, subscription: "sub_A" },
    { id: "cs_B", status: "open", customer: "cus_1", metadata: branchMeta, subscription: null },
    { id: "cs_other_branch", status: "open", customer: "cus_1", metadata: { keynetic_branch_id: "branch-2" }, subscription: null },
    { id: "cs_other_customer", status: "open", customer: "cus_2", metadata: branchMeta, subscription: null },
  ];

  const race = createFakeStripe(raceSessions());
  const raceDb = createFakeAdmin({ subscriptionRows: rows });
  const report = await expireOtherCheckoutSessionsAfterLink(raceDb.admin, race.stripe, linkedSub(), {
    ...at,
    completedCheckoutSessionId: "cs_A",
  });
  record(
    "POSTLINK concurrent second open session (same Customer + branch) is expired",
    race.expireCalls.length === 1 && race.expireCalls[0] === "cs_B",
    JSON.stringify(race.expireCalls)
  );
  record(
    "POSTLINK listing is scoped to the subscription's Customer, open sessions only",
    race.listCalls.length === 1 &&
      race.listCalls[0]!.customer === "cus_1" &&
      race.listCalls[0]!.status === "open"
  );
  record(
    "POSTLINK other branch's session on the same Customer is never expired",
    report?.sessions.some(
      (s) => s.checkout_session_id === "cs_other_branch" && s.outcome === "foreign"
    ) === true && !race.expireCalls.includes("cs_other_branch")
  );
  record(
    "POSTLINK successful expiry records no billing_reconcile_required",
    reconcile(raceDb.events).length === 0
  );

  await expireOtherCheckoutSessionsAfterLink(raceDb.admin, race.stripe, linkedSub(), {
    ...at,
    completedCheckoutSessionId: "cs_A",
  });
  record(
    "POSTLINK webhook retry / redelivery is idempotent (nothing left to expire)",
    race.expireCalls.length === 1 && reconcile(raceDb.events).length === 0
  );

  const protectedSessions = createFakeStripe([
    { id: "cs_A", status: "open", customer: "cus_1", metadata: branchMeta, subscription: null },
    { id: "cs_carrier", status: "open", customer: "cus_1", metadata: branchMeta, subscription: "sub_A" },
  ]);
  const protectedReport = await expireOtherCheckoutSessionsAfterLink(
    createFakeAdmin({ subscriptionRows: rows }).admin,
    protectedSessions.stripe,
    linkedSub(),
    { ...at, completedCheckoutSessionId: "cs_A" }
  );
  record(
    "POSTLINK session behind the linked subscription is never expired",
    protectedSessions.expireCalls.length === 0 &&
      protectedReport?.sessions.every((s) => s.outcome === "linked") === true
  );

  const failing = createFakeStripe(raceSessions(), { expireFails: { cs_B: "open" } });
  const failingDb = createFakeAdmin({ subscriptionRows: rows });
  let failingThrew = false;
  try {
    await expireOtherCheckoutSessionsAfterLink(failingDb.admin, failing.stripe, linkedSub(), at);
  } catch {
    failingThrew = true;
  }
  const failedEvents = reconcile(failingDb.events);
  record(
    "POSTLINK expiry failure records billing_reconcile_required and does not fail the event",
    !failingThrew &&
      failedEvents.length === 1 &&
      failedEvents[0]!.metadata.reason === "post_link_checkout_session_expiry_failed" &&
      failedEvents[0]!.metadata.stripe_subscription_id === "sub_A" &&
      failedEvents[0]!.subscription_id === "row-1",
    JSON.stringify(failedEvents)
  );
  await expireOtherCheckoutSessionsAfterLink(failingDb.admin, failing.stripe, linkedSub(), at);
  record(
    "POSTLINK repeated failure retries expiry but dedupes the reconcile record",
    failing.expireCalls.filter((id) => id === "cs_B").length === 2 &&
      reconcile(failingDb.events).length === 1
  );

  const listingDown = createFakeStripe(raceSessions(), { listFails: true });
  const listingDb = createFakeAdmin({ subscriptionRows: rows });
  await expireOtherCheckoutSessionsAfterLink(listingDb.admin, listingDown.stripe, linkedSub(), at);
  record(
    "POSTLINK listing failure records billing_reconcile_required",
    reconcile(listingDb.events).length === 1 &&
      reconcile(listingDb.events)[0]!.metadata.reason ===
        "post_link_checkout_session_expiry_failed"
  );

  const completedRace = createFakeStripe(raceSessions(), { expireFails: { cs_B: "complete" } });
  const completedDb = createFakeAdmin({ subscriptionRows: rows });
  await expireOtherCheckoutSessionsAfterLink(completedDb.admin, completedRace.stripe, linkedSub(), at);
  record(
    "POSTLINK other session completing in the race window is reported for reconcile",
    reconcile(completedDb.events)[0]?.metadata.reason ===
      "post_link_other_checkout_session_completed"
  );

  const insertDown = createFakeStripe(raceSessions(), { expireFails: { cs_B: "open" } });
  let insertThrew = false;
  try {
    await expireOtherCheckoutSessionsAfterLink(
      createFakeAdmin({ subscriptionRows: rows, failInserts: true }).admin,
      insertDown.stripe,
      linkedSub(),
      at
    );
  } catch {
    insertThrew = true;
  }
  record("POSTLINK failed reconcile insert throws so Stripe retries the event", insertThrew);

  const conflict = createFakeStripe(raceSessions());
  await expireOtherCheckoutSessionsAfterLink(
    createFakeAdmin({ subscriptionRows: rows }).admin,
    conflict.stripe,
    linkedSub("trialing", "sub_conflicting"),
    at
  );
  record(
    "POSTLINK subscription not linked to a row (association conflict) touches no session",
    conflict.listCalls.length === 0 && conflict.expireCalls.length === 0
  );

  const terminal = createFakeStripe(raceSessions());
  await expireOtherCheckoutSessionsAfterLink(
    createFakeAdmin({ subscriptionRows: rows }).admin,
    terminal.stripe,
    linkedSub("canceled"),
    at
  );
  const endedRow = createFakeStripe(raceSessions());
  await expireOtherCheckoutSessionsAfterLink(
    createFakeAdmin({
      subscriptionRows: [{ ...rows[0]!, ended_at: "2026-11-01T00:00:00Z" }],
    }).admin,
    endedRow.stripe,
    linkedSub(),
    at
  );
  record(
    "POSTLINK terminal subscription or ended row touches no session",
    terminal.listCalls.length === 0 &&
      endedRow.listCalls.length === 0 &&
      terminal.expireCalls.length === 0 &&
      endedRow.expireCalls.length === 0
  );
}

function runSourceChecks() {
  console.log("\n--- Source and migration checks ---\n");
  const checkout = read("lib/billing/eaCheckout.ts");
  const webhook = read("lib/billing/eaStripeWebhook.ts");
  const health = read("lib/billing/eaBillingHealth.ts");
  const migration = read(
    "supabase/migrations/20261108160000_ea_billing_trial_started_audit_event.sql"
  );

  const stripeCheckAt = checkout.search(
    /stripeSubscriptions = await loadStripeSubscriptionHistory\(/
  );
  const firstReuseAt = checkout.indexOf(
    "checkoutSessionMatchesOffer(existingSession, offer)"
  );
  const createAt = checkout.indexOf("stripe.checkout.sessions.create(");
  record(
    "CHECKOUT Stripe subscription check runs before any session reuse or create",
    stripeCheckAt > 0 &&
      firstReuseAt > stripeCheckAt &&
      createAt > stripeCheckAt
  );
  record(
    "CHECKOUT Stripe/database errors fail closed with 503 subscription_check_unavailable",
    checkout.includes('error: "subscription_check_unavailable"') &&
      checkout.includes("status: 503")
  );
  record(
    "CHECKOUT conflict returns 409 stripe_subscription_exists and is reported",
    checkout.includes('error: "stripe_subscription_exists"') &&
      checkout.includes("reportStripeSubscriptionConflict") &&
      checkout.includes('event_type: "billing_reconcile_required"') &&
      checkout.includes("[billing-reconcile]")
  );
  record(
    "CHECKOUT never cancels or modifies existing Stripe subscriptions",
    !checkout.includes("stripe.subscriptions.cancel") &&
      !checkout.includes("stripe.subscriptions.update") &&
      !checkout.includes("stripe.subscriptions.del")
  );
  record(
    "CHECKOUT completed-session protection kept in both reuse paths",
    (checkout.match(/status === "complete"/g) ?? []).length >= 2 &&
      checkout.includes("checkoutProcessingResult()")
  );

  record(
    "MIGRATION adds trial_started and billing_reconcile_required, keeps existing types",
    migration.includes("'trial_started'") &&
      migration.includes("'billing_reconcile_required'") &&
      [
        "subscription_started",
        "payment_succeeded",
        "payment_failed",
        "cancellation_scheduled",
        "cancellation_reversed",
        "subscription_expired",
        "resubscribed",
        "entitlement_changed",
        "founding_slot_reserved",
        "founding_slot_confirmed",
        "founding_slot_released",
        "founding_reconcile_exception",
      ].every((t) => migration.includes(`'${t}'`))
  );
  record(
    "MIGRATION unique index makes trial_started once per Stripe subscription",
    migration.includes("create unique index if not exists ea_subscription_events_trial_started_once_idx") &&
      migration.includes("((metadata ->> 'stripe_subscription_id'))") &&
      migration.includes("where event_type = 'trial_started'") &&
      migration.includes("ea_subscription_events_trial_started_subscription_check")
  );

  record(
    "WEBHOOK records trial_started via recordTrialStartedOnce (unique violation = already recorded)",
    webhook.includes("recordTrialStartedOnce") &&
      webhook.includes('event_type: "trial_started"') &&
      webhook.includes("uniqueViolationMeansRecorded") &&
      webhook.includes('error.code === "23505"')
  );
  record(
    "WEBHOOK audit insert failures are logged and fail the event",
    webhook.includes("[billing-audit]") &&
      webhook.includes("audit_event_insert_failed:") &&
      !/await admin\.from\("ea_subscription_events"\)\.insert\(\{\s*branch_id: branchId,\s*subscription_id: existing\.id/.test(
        webhook
      )
  );
  record(
    "WEBHOOK audit rows written after customer email dispatch",
    webhook.indexOf("dispatchBillingCustomerEmailsForTransition(admin") <
      webhook.indexOf("recordTrialStartedOnce(admin")
  );
  record(
    "HEALTH billing_reconcile_required raises an ops incident",
    health.includes('key: "billing_reconcile_required"') &&
      health.includes('.eq("event_type", "billing_reconcile_required")')
  );

  const blockedAt = checkout.indexOf('if (decision.kind === "blocked")');
  const blockedBlock = checkout.slice(blockedAt, checkout.indexOf("const trialEligible", blockedAt));
  record(
    "CHECKOUT blocked path expires outstanding sessions before responding",
    blockedAt > 0 &&
      blockedBlock.includes("expireOutstandingCheckoutSessions(") &&
      blockedBlock.includes("blockedCheckoutResponse(") &&
      blockedBlock.includes('error: "checkout_session_expiry_failed"') &&
      !blockedBlock.includes("stripe.checkout.sessions.create")
  );
  const expiry = read("lib/billing/eaCheckoutSessionExpiry.ts");
  record(
    "CHECKOUT outstanding sessions listed only for the branch's own Customer",
    expiry.includes("stripe.checkout.sessions.list({") &&
      expiry.includes("customer: owner.customerId") &&
      expiry.includes('status: "open"') &&
      expiry.includes("checkoutSessionBelongsToBranch(session, owner)") &&
      checkout.includes('from "@/lib/billing/eaCheckoutSessionExpiry"') &&
      webhook.includes('from "@/lib/billing/eaCheckoutSessionExpiry"')
  );
  record(
    "EXPIRY module never cancels or modifies subscriptions",
    !/subscriptions\.(cancel|update|del)/.test(expiry)
  );
  const completedCase = webhook.slice(
    webhook.indexOf('case "checkout.session.completed"'),
    webhook.indexOf('case "customer.subscription.created"')
  );
  const subscriptionCase = webhook.slice(
    webhook.indexOf('case "customer.subscription.created"'),
    webhook.indexOf('case "customer.subscription.deleted"')
  );
  const deletedCase = webhook.slice(
    webhook.indexOf('case "customer.subscription.deleted"'),
    webhook.indexOf('case "invoice.paid"')
  );
  record(
    "WEBHOOK expires other sessions after reconcile on checkout.session.completed (protecting its own session)",
    completedCase.indexOf("reconcileStripeSubscription(admin") >= 0 &&
      completedCase.indexOf("expireOtherCheckoutSessionsAfterLink(") >
        completedCase.indexOf("reconcileStripeSubscription(admin") &&
      completedCase.includes("completedCheckoutSessionId: session.id")
  );
  record(
    "WEBHOOK expires other sessions after reconcile on subscription created/updated, not on deleted",
    subscriptionCase.indexOf("expireOtherCheckoutSessionsAfterLink(") >
      subscriptionCase.indexOf("reconcileStripeSubscription(admin") &&
      !deletedCase.includes("expireOtherCheckoutSessionsAfterLink(")
  );
  record(
    "WEBHOOK post-link expiry only for a live subscription linked to an open row",
    /CHECKOUT_BLOCKING_STRIPE_STATUSES\.has\(subscription\.status\)/.test(webhook) &&
      /\.eq\("stripe_subscription_id", subscription\.id\)\s*\.is\("ended_at", null\)/.test(webhook)
  );
  record(
    "CHECKOUT replacing a stale session fails closed when expiry fails",
    /outcome === "failed" \|\| outcome === "foreign"/.test(checkout) &&
      !checkout.includes("expireOpenCheckoutSession(")
  );

  const reconcileStart = webhook.indexOf("async function reconcileStripeSubscription(");
  const conflictAt = webhook.indexOf("recordWebhookAssociationConflict(admin", reconcileStart);
  const foundingConfirmAt = webhook.indexOf('admin.rpc("confirm_ea_founding_slot"', reconcileStart);
  const staleAt = webhook.indexOf('reason: "stale_event"', reconcileStart);
  record(
    "WEBHOOK association check runs before the stale guard and founding confirmation",
    conflictAt > reconcileStart &&
      conflictAt < staleAt &&
      conflictAt < foundingConfirmAt
  );
  record(
    "WEBHOOK row write is compare-and-swap on the association; a lost race retries",
    webhook.includes('write.eq("stripe_subscription_id", rowLinkedId)') &&
      webhook.includes('write.is("stripe_subscription_id", null)') &&
      webhook.includes('throw new Error("subscription_association_changed")')
  );
  record(
    "WEBHOOK conflict records billing_reconcile_required with both subscriptions and the branch",
    webhook.includes('reason: "webhook_subscription_association_conflict"') &&
      webhook.includes("incoming_stripe_subscription_id:") &&
      webhook.includes("existing_stripe_subscription_id:") &&
      webhook.includes('event_type: "billing_reconcile_required"')
  );
  record(
    "WEBHOOK payment_succeeded only from invoice.paid via recordInvoicePaymentSucceeded",
    (webhook.match(/"payment_succeeded"/g) ?? []).length === 2 &&
      /case "invoice\.paid"[\s\S]*?recordInvoicePaymentSucceeded\(admin, invoice, subscription\)/.test(
        webhook
      ) &&
      webhook.includes("invoice.amount_paid > 0")
  );

  const paymentMigration = read(
    "supabase/migrations/20261108170000_ea_billing_payment_succeeded_invoice_dedupe.sql"
  );
  record(
    "MIGRATION unique index makes payment_succeeded once per Stripe invoice",
    paymentMigration.includes(
      "create unique index if not exists ea_subscription_events_payment_invoice_once_idx"
    ) &&
      paymentMigration.includes("((metadata ->> 'stripe_invoice_id'))") &&
      paymentMigration.includes("where event_type = 'payment_succeeded'") &&
      paymentMigration.includes("metadata ? 'stripe_invoice_id'")
  );
}

async function main() {
  console.log("EA Billing subscription guard — LOCAL verification\n");
  runGuardDecisions();
  runAuditEventRules();
  runOutstandingSessionRules();
  runAssociationRules();
  await runInvoicePaymentRules();
  await runPostLinkSessionExpiry();
  runSourceChecks();

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
  console.error(error);
  process.exitCode = 1;
});
