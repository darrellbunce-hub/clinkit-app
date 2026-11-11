import type {
  EaEntitlementStatus,
  EaStripeSubscriptionStatus,
} from "@/lib/billing/eaBranchSubscription";
import { TERMINAL_STRIPE_SUBSCRIPTION_STATUSES } from "@/lib/billing/eaSubscriptionAssociation";

export const EA_PAYMENT_FAILURE_GRACE_DAYS = 7 as const;

export type StripeCancellationSchedule = {
  /** A cancellation is pending; stored as cancel_at_period_end. */
  scheduled: boolean;
  /** When the pending cancellation takes effect; null when none is pending. */
  endsAt: Date | null;
};

/**
 * Stripe schedules a cancellation either with cancel_at_period_end or with a
 * cancel_at timestamp (the Customer Portal uses cancel_at, leaving
 * cancel_at_period_end false). cancel_at counts only while it is later than
 * the event, so a replayed event keeps the meaning it had when sent. Terminal
 * statuses keep the cancel_at_period_end-only mapping.
 */
export function stripeCancellationSchedule(input: {
  stripeStatus: string;
  cancelAtPeriodEnd: boolean | null | undefined;
  cancelAtUnix: number | null | undefined;
  currentPeriodEnd: Date | null;
  at: Date;
}): StripeCancellationSchedule {
  const cancelAt =
    typeof input.cancelAtUnix === "number" && input.cancelAtUnix > 0
      ? new Date(input.cancelAtUnix * 1000)
      : null;
  const futureCancelAt =
    cancelAt && cancelAt.getTime() > input.at.getTime() ? cancelAt : null;

  if (TERMINAL_STRIPE_SUBSCRIPTION_STATUSES.has(input.stripeStatus)) {
    return input.cancelAtPeriodEnd
      ? { scheduled: true, endsAt: input.currentPeriodEnd }
      : { scheduled: false, endsAt: null };
  }
  if (input.cancelAtPeriodEnd) {
    return { scheduled: true, endsAt: futureCancelAt ?? input.currentPeriodEnd };
  }
  if (futureCancelAt) {
    return { scheduled: true, endsAt: futureCancelAt };
  }
  return { scheduled: false, endsAt: null };
}

/** Cancellation fields as they appear in a Stripe event's previous_attributes. */
export type StripeCancellationPreviousAttributes = {
  cancel_at?: number | null;
  cancel_at_period_end?: boolean | null;
  canceled_at?: number | null;
};

export type StripeCancellationReversal = {
  /** canceled_at of the cancellation request that was withdrawn. */
  canceledAtUnix: number | null;
  /** cancel_at it would have taken effect at. */
  cancelAtUnix: number | null;
};

/**
 * A withdrawn cancellation, read from the event itself (previous_attributes
 * held a pending cancellation; the subscription now has none) rather than from
 * the database row, so every delivery and retry of the event reaches the same
 * answer. Terminal or ended subscriptions are never reversals.
 */
export function stripeCancellationReversal(input: {
  stripeStatus: string;
  ended: boolean;
  nowScheduled: boolean;
  previous: StripeCancellationPreviousAttributes | null | undefined;
  currentCanceledAtUnix: number | null | undefined;
}): StripeCancellationReversal | null {
  const previous = input.previous;
  if (!previous || input.nowScheduled || input.ended) return null;
  if (TERMINAL_STRIPE_SUBSCRIPTION_STATUSES.has(input.stripeStatus)) return null;

  const previousCancelAt =
    typeof previous.cancel_at === "number" && previous.cancel_at > 0
      ? previous.cancel_at
      : null;
  if (previousCancelAt === null && previous.cancel_at_period_end !== true) {
    return null;
  }

  const canceledAt =
    "canceled_at" in previous ? previous.canceled_at : input.currentCanceledAtUnix;
  return {
    canceledAtUnix: typeof canceledAt === "number" && canceledAt > 0 ? canceledAt : null,
    cancelAtUnix: previousCancelAt,
  };
}

/**
 * Row cancelled_at: when the cancellation was requested. Stripe's canceled_at
 * wins; otherwise an already-recorded time is kept so repeated updates do not
 * move it. A pending cancellation without either falls back to now; a reversal
 * (no pending cancellation, not ended) clears it.
 */
export function cancelledAtForRow(input: {
  scheduled: boolean;
  ended: boolean;
  stripeCanceledAtUnix: number | null | undefined;
  existingCancelledAt: string | null;
  now?: Date;
}): string | null {
  const fromStripe =
    typeof input.stripeCanceledAtUnix === "number" && input.stripeCanceledAtUnix > 0
      ? new Date(input.stripeCanceledAtUnix * 1000).toISOString()
      : null;
  if (input.scheduled) {
    return (
      fromStripe ??
      input.existingCancelledAt ??
      (input.now ?? new Date()).toISOString()
    );
  }
  if (input.ended) {
    return fromStripe ?? input.existingCancelledAt;
  }
  return null;
}

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

export type WebhookAuditEventType =
  | "subscription_expired"
  | "payment_failed"
  | "cancellation_scheduled";

/**
 * Lifecycle audit row for one reconciled subscription state. A status alone
 * never implies a payment: payment_succeeded is recorded only from a paid,
 * non-zero invoice (keyed by invoice id), and trial start separately as
 * trial_started (once per Stripe subscription).
 */
export function webhookAuditEventFor(
  mapped: MappedBillingState
): WebhookAuditEventType | null {
  if (mapped.ended) return "subscription_expired";
  if (mapped.enterGrace) return "payment_failed";
  if (mapped.cancelAtPeriodEnd) return "cancellation_scheduled";
  return null;
}

export function computeGraceEndsAt(
  from: Date = new Date(),
  days = EA_PAYMENT_FAILURE_GRACE_DAYS
): Date {
  return new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
}
