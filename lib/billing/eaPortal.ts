import "server-only";

import type { AuthorisedBranchContext } from "@/lib/billing/eaBillingAuth";
import { getStripeClient } from "@/lib/billing/stripeClient";
import { getStripeServerConfig } from "@/lib/billing/stripeServerConfig";

export type PortalCreateResult =
  | { ok: true; url: string }
  | { ok: false; error: string; status: number };

/**
 * Customer Portal for a single branch Stripe Customer.
 * Day 1 isolation: one Customer per branch ⇒ Portal cannot list sibling branches.
 */
export async function createEaBillingPortalSession(
  context: AuthorisedBranchContext
): Promise<PortalCreateResult> {
  if (!context.branchStripeCustomerId) {
    return { ok: false, error: "no_stripe_customer", status: 409 };
  }

  const config = getStripeServerConfig();
  const stripe = getStripeClient();

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: context.branchStripeCustomerId,
      return_url: `${config.appUrl}/account#subscription`,
    });

    if (!session.url) {
      return { ok: false, error: "portal_url_missing", status: 500 };
    }

    return { ok: true, url: session.url };
  } catch {
    return { ok: false, error: "portal_create_failed", status: 502 };
  }
}
