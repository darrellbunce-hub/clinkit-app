/**
 * Billing domain semantics.
 *
 * Ownership
 * ---------
 * Billing unit: ea_branches (not user, not homeowner, not company-as-price-unit).
 * Day 1 Stripe Customer: ea_branches.stripe_customer_id (one Customer per branch).
 * Day 1 Stripe Subscription: ea_branch_subscriptions (one open subscription per branch).
 * Company Stripe Customer (ea_companies.stripe_customer_id): reserved for FUTURE
 * organisation-tier billing only — not used by Day 1 Checkout/Portal.
 *
 * Cancellation
 * ------------
 * active → cancel_at_period_end → remain entitled until current_period_end → ended.
 * Do NOT delete chains, properties, homeowner membership, or shared history.
 *
 * Payment failure
 * ---------------
 * active → past_due → entitlement grace → recover to entitled OR end if unrecovered.
 *
 * Resubscription
 * --------------
 * End open subscription (ended_at set) then insert a new open row.
 * Unique partial index enforces one open subscription per branch.
 */

export const EA_BILLING_STAGE = 2 as const;

export const EA_BILLING_SEMANTICS = {
  billingUnit: "ea_branch",
  stripeCustomerOwnerDay1: "ea_branch",
  stripeCustomerOwnerFutureOrg: "ea_company",
  stripeSubscriptionOwner: "ea_branch",
  cancelMode: "cancel_at_period_end",
  paymentFailureMode: "grace_then_end",
  paymentFailureGraceDays: 7,
  graceExpiryAuthority: "lazy_read_time_effective_status",
  foundingReservationSeconds: 1800,
  foundingCheckoutAlignedToReservation: true,
  foundingWebhookAuthority: "confirm_ea_founding_slot",
  webhookChronologyAuthority: "stripe_event_created",
  webhookStaleGuardField: "stripe_object_updated_at",
  dataOnExpiry: "retain_shared_chain_state_revoke_ea_paid_access",
  entitlementEnforcement: false,
} as const;
