/**
 * EA branch subscription domain types — Billing Stage 1.
 *
 * No Stripe SDK. No client-authoritative entitlement enforcement.
 */

import type { EaPricingTier } from "@/lib/billing/eaBranchPricing";

/** Stripe-mirrored lifecycle (subset + Keynetic checkout staging). */
export const EA_STRIPE_SUBSCRIPTION_STATUSES = [
  "not_started",
  "checkout_pending",
  "incomplete",
  "incomplete_expired",
  "trialing",
  "active",
  "past_due",
  "unpaid",
  "canceled",
  "paused",
] as const;

export type EaStripeSubscriptionStatus =
  (typeof EA_STRIPE_SUBSCRIPTION_STATUSES)[number];

/**
 * Keynetic commercial entitlement — intentionally separate from Stripe status.
 * - none: no open entitled subscription
 * - entitled: paid access allowed
 * - grace: payment recovery / past_due grace window (unexpired)
 * - ended: access revoked after period end / unrecovered failure / expired grace
 */
export const EA_ENTITLEMENT_STATUSES = [
  "none",
  "entitled",
  "grace",
  "ended",
] as const;

export type EaEntitlementStatus = (typeof EA_ENTITLEMENT_STATUSES)[number];

export const EA_FOUNDING_SLOT_STATES = [
  "reserved",
  "confirmed",
  "released",
] as const;

export type EaFoundingSlotState = (typeof EA_FOUNDING_SLOT_STATES)[number];

export type EaBranchSubscription = {
  id: string;
  branch_id: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  stripe_price_id: string | null;
  pricing_tier: EaPricingTier;
  amount_gbp_minor: number;
  currency: "gbp";
  founding_slot_number: number | null;
  stripe_status: EaStripeSubscriptionStatus;
  entitlement_status: EaEntitlementStatus;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  cancelled_at: string | null;
  ended_at: string | null;
  stripe_status_updated_at: string | null;
  created_at: string;
  updated_at: string;
};

export type EaBranchSubscriptionSummary = {
  ok: boolean;
  error?: string;
  branch_id?: string;
  has_subscription?: boolean;
  subscription_id?: string;
  pricing_tier?: EaPricingTier;
  amount_gbp_minor?: number;
  currency?: string;
  founding_slot_number?: number | null;
  stripe_status?: EaStripeSubscriptionStatus;
  /** Effective entitlement (expired grace → ended). */
  entitlement_status?: EaEntitlementStatus;
  /** Raw persisted column when summary RPC provides it. */
  persisted_entitlement_status?: EaEntitlementStatus;
  current_period_start?: string | null;
  current_period_end?: string | null;
  cancel_at_period_end?: boolean;
  cancelled_at?: string | null;
  grace_ends_at?: string | null;
  ended_at?: string | null;
  /** Remains false through Stage 2 — paid gates must not deny EA access yet. */
  enforcement_enabled?: boolean;
};

/**
 * Authoritative read-time mapping.
 * Expired grace is ended even if the persisted row still says grace.
 */
export function resolveEffectiveEntitlementStatus(input: {
  entitlementStatus: EaEntitlementStatus | null | undefined;
  graceEndsAt?: string | null;
  now?: Date;
}): EaEntitlementStatus {
  const status = input.entitlementStatus ?? "none";
  if (
    status === "grace" &&
    input.graceEndsAt &&
    new Date(input.graceEndsAt).getTime() <=
      (input.now ?? new Date()).getTime()
  ) {
    return "ended";
  }
  return status;
}

export function isCommerciallyEntitledStatus(
  status: EaEntitlementStatus | null | undefined,
  graceEndsAt?: string | null,
  now?: Date
): boolean {
  const effective = resolveEffectiveEntitlementStatus({
    entitlementStatus: status,
    graceEndsAt,
    now,
  });
  return effective === "entitled" || effective === "grace";
}
