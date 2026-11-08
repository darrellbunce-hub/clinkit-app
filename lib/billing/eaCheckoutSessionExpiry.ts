import "server-only";

import type Stripe from "stripe";

import {
  checkoutSessionBelongsToBranch,
  isLinkedCheckoutSession,
  type LinkedCheckoutSessionRef,
  type OutstandingSessionOutcome,
} from "@/lib/billing/eaCheckoutSubscriptionGuard";

/** The Stripe Checkout calls used here; the real client satisfies it. */
export type CheckoutSessionsClient = {
  checkout: {
    sessions: {
      list(params: {
        customer: string;
        status: "open";
        limit: number;
      }): AsyncIterable<Stripe.Checkout.Session>;
      expire(id: string): Promise<unknown>;
      retrieve(id: string): Promise<Stripe.Checkout.Session>;
    };
  };
};

export type CheckoutSessionOwner = { branchId: string; customerId: string };

/**
 * Expire one Checkout session, only if it is open and belongs to this branch's
 * own Customer and metadata. Never touches subscriptions. Safe to repeat: an
 * already-expired session reports not_open.
 */
export async function expireBranchCheckoutSession(
  stripe: CheckoutSessionsClient,
  session: Stripe.Checkout.Session,
  owner: CheckoutSessionOwner,
  logPrefix = "[billing-checkout]"
): Promise<OutstandingSessionOutcome> {
  if (session.status === "complete") return "completed";
  if (session.status !== "open") return "not_open";
  if (!checkoutSessionBelongsToBranch(session, owner)) return "foreign";
  try {
    await stripe.checkout.sessions.expire(session.id);
    return "expired";
  } catch (error) {
    try {
      const latest = await stripe.checkout.sessions.retrieve(session.id);
      if (latest.status === "complete") return "completed";
      if (latest.status === "expired") return "not_open";
    } catch {
      /* fall through to failed */
    }
    console.error(`${logPrefix} Checkout session expiry failed`, {
      branch_id: owner.branchId,
      checkout_session_id: session.id,
      message: error instanceof Error ? error.message : "unknown_error",
    });
    return "failed";
  }
}

export type OutstandingSessionReport = {
  listing_failed: boolean;
  sessions: { checkout_session_id: string; outcome: OutstandingSessionOutcome }[];
};

/**
 * Expire every open Checkout session for this branch: the stored one (if any)
 * plus any other open session on the branch's own Customer. Sessions matching
 * `linked` (the one that created the subscription now linked to the branch)
 * are reported as "linked" and never touched.
 */
export async function expireOutstandingCheckoutSessions(
  stripe: CheckoutSessionsClient,
  owner: CheckoutSessionOwner,
  options: {
    storedSession?: Stripe.Checkout.Session | null;
    linked?: LinkedCheckoutSessionRef;
    logPrefix?: string;
  } = {}
): Promise<OutstandingSessionReport> {
  const logPrefix = options.logPrefix ?? "[billing-checkout]";
  const candidates = new Map<string, Stripe.Checkout.Session>();
  if (options.storedSession) {
    candidates.set(options.storedSession.id, options.storedSession);
  }

  let listingFailed = false;
  try {
    for await (const session of stripe.checkout.sessions.list({
      customer: owner.customerId,
      status: "open",
      limit: 100,
    })) {
      candidates.set(session.id, session);
    }
  } catch (error) {
    listingFailed = true;
    console.error(`${logPrefix} listing open Checkout sessions failed`, {
      branch_id: owner.branchId,
      message: error instanceof Error ? error.message : "unknown_error",
    });
  }

  const sessions: OutstandingSessionReport["sessions"] = [];
  for (const session of candidates.values()) {
    sessions.push({
      checkout_session_id: session.id,
      outcome:
        options.linked && isLinkedCheckoutSession(session, options.linked)
          ? "linked"
          : await expireBranchCheckoutSession(stripe, session, owner, logPrefix),
    });
  }
  return { listing_failed: listingFailed, sessions };
}
