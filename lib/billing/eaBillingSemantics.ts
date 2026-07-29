/**
 * Billing Stage 1 domain semantics (documentation as code comments).
 *
 * Ownership
 * ---------
 * Billing unit: ea_branches (not user, not homeowner, not company-as-price-unit).
 * Stripe Customer (Stage 2 recommendation): ea_companies — one Customer may hold
 * multiple Subscriptions (one per branch). Subscription row lives on the branch.
 *
 * Cancellation
 * ------------
 * active → cancel_at_period_end → remain entitled until current_period_end → ended.
 * Do NOT delete chains, properties, homeowner membership, or shared history.
 * Prefer revoking EA paid operational access / inactive assignment semantics.
 *
 * Payment failure
 * ---------------
 * active → past_due → entitlement grace → recover to entitled OR end if unrecovered.
 * Do not destroy data on first failure.
 *
 * Resubscription
 * --------------
 * End open subscription (ended_at set) then insert a new open row.
 * Unique partial index enforces one open subscription per branch.
 */

export const EA_BILLING_STAGE = 2 as const;

export const EA_BILLING_SEMANTICS = {
  billingUnit: "ea_branch",
  stripeCustomerOwnerRecommendation: "ea_company",
  stripeSubscriptionOwner: "ea_branch",
  cancelMode: "cancel_at_period_end",
  paymentFailureMode: "grace_then_end",
  paymentFailureGraceDays: 7,
  dataOnExpiry: "retain_shared_chain_state_revoke_ea_paid_access",
  entitlementEnforcement: false,
} as const;
