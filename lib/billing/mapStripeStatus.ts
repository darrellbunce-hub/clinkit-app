import type {
  EaEntitlementStatus,
  EaStripeSubscriptionStatus,
} from "@/lib/billing/eaBranchSubscription";

export const EA_PAYMENT_FAILURE_GRACE_DAYS = 7 as const;

export type MappedBillingState = {
  stripeStatus: EaStripeSubscriptionStatus;
  entitlementStatus: EaEntitlementStatus;
  cancelAtPeriodEnd: boolean;
  ended: boolean;
  enterGrace: boolean;
};

/**
 * Deterministic Stripe → Keynetic mapping (Stage 2).
 * Entitlement enforcement remains OFF in application gates.
 */
export function mapStripeSubscriptionToKeynetic(input: {
  stripeStatus: string;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: Date | null;
  now?: Date;
}): MappedBillingState {
  const now = input.now ?? new Date();
  const status = input.stripeStatus as EaStripeSubscriptionStatus | string;
  const periodEnd = input.currentPeriodEnd;
  const stillInPaidPeriod =
    !!periodEnd && periodEnd.getTime() > now.getTime();

  switch (status) {
    case "incomplete":
      return {
        stripeStatus: "incomplete",
        entitlementStatus: "none",
        cancelAtPeriodEnd: false,
        ended: false,
        enterGrace: false,
      };
    case "incomplete_expired":
      return {
        stripeStatus: "incomplete_expired",
        entitlementStatus: "ended",
        cancelAtPeriodEnd: false,
        ended: true,
        enterGrace: false,
      };
    case "trialing":
      return {
        stripeStatus: "trialing",
        entitlementStatus: "entitled",
        cancelAtPeriodEnd: input.cancelAtPeriodEnd,
        ended: false,
        enterGrace: false,
      };
    case "active":
      return {
        stripeStatus: "active",
        entitlementStatus: "entitled",
        cancelAtPeriodEnd: input.cancelAtPeriodEnd,
        ended: false,
        enterGrace: false,
      };
    case "past_due":
      return {
        stripeStatus: "past_due",
        entitlementStatus: "grace",
        cancelAtPeriodEnd: input.cancelAtPeriodEnd,
        ended: false,
        enterGrace: true,
      };
    case "unpaid":
      return {
        stripeStatus: "unpaid",
        entitlementStatus: "ended",
        cancelAtPeriodEnd: input.cancelAtPeriodEnd,
        ended: true,
        enterGrace: false,
      };
    case "canceled":
      if (input.cancelAtPeriodEnd && stillInPaidPeriod) {
        return {
          stripeStatus: "canceled",
          entitlementStatus: "entitled",
          cancelAtPeriodEnd: true,
          ended: false,
          enterGrace: false,
        };
      }
      return {
        stripeStatus: "canceled",
        entitlementStatus: "ended",
        cancelAtPeriodEnd: input.cancelAtPeriodEnd,
        ended: true,
        enterGrace: false,
      };
    case "paused":
      return {
        stripeStatus: "paused",
        entitlementStatus: "ended",
        cancelAtPeriodEnd: input.cancelAtPeriodEnd,
        ended: true,
        enterGrace: false,
      };
    default:
      return {
        stripeStatus: "not_started",
        entitlementStatus: "none",
        cancelAtPeriodEnd: false,
        ended: false,
        enterGrace: false,
      };
  }
}

export function computeGraceEndsAt(
  from: Date = new Date(),
  days = EA_PAYMENT_FAILURE_GRACE_DAYS
): Date {
  return new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
}
