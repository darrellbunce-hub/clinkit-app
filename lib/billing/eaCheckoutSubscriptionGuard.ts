/**
 * Pure decision logic for whether a branch may start a new Checkout, given its
 * Stripe subscription history and database state. No I/O.
 */

/**
 * Stripe subscriptions that can still bill or entitle the branch. Any of these
 * blocks a new Checkout regardless of what the database row says:
 * - active / trialing / past_due: billing now (including cancel_at_period_end).
 * - unpaid / paused: mapped to "ended" locally, but Stripe can resume them.
 * - incomplete: first payment may still succeed; Stripe moves it to
 *   incomplete_expired after ~23 hours, which unblocks Checkout.
 * canceled and incomplete_expired are terminal and never block Checkout, but
 * still count as trial history.
 */
export const CHECKOUT_BLOCKING_STRIPE_STATUSES: ReadonlySet<string> = new Set([
  "active",
  "trialing",
  "past_due",
  "unpaid",
  "paused",
  "incomplete",
]);

export type StripeSubscriptionSummary = {
  id: string;
  status: string;
  metadataSubscriptionRowId: string | null;
  metadataBranchId: string | null;
};

export type CheckoutOpenRowState = {
  id: string;
  stripe_status: string | null;
  stripe_subscription_id: string | null;
};

export type CheckoutSubscriptionDecision =
  /** This row's own completed Checkout; webhook not yet applied. */
  | { kind: "checkout_processing" }
  /**
   * A billable Stripe subscription exists. reportConflict is true when the
   * database does not already reflect it (needs reconciliation).
   */
  | {
      kind: "blocked";
      blocking: StripeSubscriptionSummary[];
      reportConflict: boolean;
    }
  | { kind: "allowed"; trialEligible: boolean };

export function decideCheckoutFromSubscriptionHistory(input: {
  stripeSubscriptions: StripeSubscriptionSummary[];
  /** Any database row for the branch ever linked to a Stripe subscription. */
  databaseHistory: boolean;
  openRow: CheckoutOpenRowState | null;
}): CheckoutSubscriptionDecision {
  const { stripeSubscriptions, databaseHistory, openRow } = input;
  const blocking = stripeSubscriptions.filter((s) =>
    CHECKOUT_BLOCKING_STRIPE_STATUSES.has(s.status)
  );

  if (blocking.length > 0) {
    const fromThisPendingCheckout =
      !!openRow &&
      openRow.stripe_status === "checkout_pending" &&
      blocking.every((s) => s.metadataSubscriptionRowId === openRow.id);
    if (fromThisPendingCheckout) {
      return { kind: "checkout_processing" };
    }

    const linkedToOpenRow =
      !!openRow?.stripe_subscription_id &&
      blocking.every((s) => s.id === openRow.stripe_subscription_id);
    return { kind: "blocked", blocking, reportConflict: !linkedToOpenRow };
  }

  return {
    kind: "allowed",
    trialEligible: stripeSubscriptions.length === 0 && !databaseHistory,
  };
}

export type CheckoutSessionOwnershipShape = {
  customer: string | { id: string } | null;
  metadata?: Record<string, string> | null;
};

/**
 * A Checkout session may only be expired by this branch when it was created
 * for this branch's own Stripe Customer and carries this branch's metadata.
 */
export function checkoutSessionBelongsToBranch(
  session: CheckoutSessionOwnershipShape,
  owner: { branchId: string; customerId: string }
): boolean {
  const sessionCustomer =
    typeof session.customer === "string"
      ? session.customer
      : (session.customer?.id ?? null);
  return (
    sessionCustomer === owner.customerId &&
    session.metadata?.keynetic_branch_id === owner.branchId
  );
}

/**
 * - expired: this call expired an open session.
 * - not_open: already expired (nothing to do).
 * - completed: already complete — a subscription is being created.
 * - foreign: open but not created for this branch; never touched.
 * - failed: open and ours, but Stripe refused or errored on expiry.
 * - linked: the session behind the subscription just linked; never touched.
 */
export type OutstandingSessionOutcome =
  | "expired"
  | "not_open"
  | "completed"
  | "foreign"
  | "failed"
  | "linked";

export type LinkedCheckoutSessionRef = {
  stripeSubscriptionId: string;
  checkoutSessionId?: string | null;
};

/** The Checkout session that created (or is the webhook source of) the linked subscription. */
export function isLinkedCheckoutSession(
  session: { id: string; subscription?: string | { id: string } | null },
  linked: LinkedCheckoutSessionRef
): boolean {
  if (linked.checkoutSessionId && session.id === linked.checkoutSessionId) {
    return true;
  }
  const sessionSubscription =
    typeof session.subscription === "string"
      ? session.subscription
      : (session.subscription?.id ?? null);
  return sessionSubscription === linked.stripeSubscriptionId;
}

export type PostLinkSessionReconcileReason =
  | "post_link_checkout_session_expiry_failed"
  | "post_link_other_checkout_session_completed";

/**
 * After a subscription is linked, other sessions for the branch were expired.
 * Ops must reconcile when one could not be expired (or listing failed), or when
 * another session already completed — a second subscription is being created.
 */
export function postLinkSessionReconcileReason(input: {
  outcomes: OutstandingSessionOutcome[];
  listingFailed: boolean;
}): PostLinkSessionReconcileReason | null {
  if (input.listingFailed || input.outcomes.includes("failed")) {
    return "post_link_checkout_session_expiry_failed";
  }
  if (input.outcomes.includes("completed")) {
    return "post_link_other_checkout_session_completed";
  }
  return null;
}

export type BlockedCheckoutResponse =
  | "checkout_session_expiry_failed"
  | "checkout_processing"
  | "stripe_subscription_exists";

/**
 * Response once outstanding sessions have been dealt with for a blocked branch.
 * An expiry failure (or failing to list sessions) wins: the branch may still
 * hold a payable session, so nothing may proceed and ops must see it.
 */
export function blockedCheckoutResponse(input: {
  outcomes: OutstandingSessionOutcome[];
  listingFailed: boolean;
}): BlockedCheckoutResponse {
  if (input.listingFailed || input.outcomes.includes("failed")) {
    return "checkout_session_expiry_failed";
  }
  if (input.outcomes.includes("completed")) {
    return "checkout_processing";
  }
  return "stripe_subscription_exists";
}
