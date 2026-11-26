/**
 * Customer-facing soft-skip / pre-trial expectations for EA billing.
 *
 * Must stay aligned with directory entitlement (Rule 25.16): branches without
 * commercial entitlement are excluded from homeowner search. Agent feature
 * enforcement may still be off — do not claim dashboard lockout.
 */

import { ROUTES } from "@/lib/auth/routes";
import { EA_TRIAL_PERIOD_DAYS } from "@/lib/billing/eaBranchPricing";

/** Existing Account settings subscription anchor — start trial later. */
export const EA_ACCOUNT_SUBSCRIPTION_HREF = `${ROUTES.accountSettings}#subscription`;

export const EA_SOFT_SKIP_BUTTON_LABEL =
  "Continue to dashboard without starting a trial";

/**
 * Accurate consequences of skipping Checkout / trial setup.
 * Directory invisibility is already enforced; agent dashboard remains usable
 * while paid-feature enforcement is off.
 */
export const EA_SOFT_SKIP_CONSEQUENCES_COPY =
  "Skipping does not start billing. Your branch will not appear in homeowner search until a free trial or paid subscription is active. You can still use your agent dashboard now.";

export const EA_SOFT_SKIP_START_LATER_COPY =
  "Start the trial later from Account → Subscription.";

/** Shown under Account “No subscription” so late starters see the same rule. */
export const EA_NO_SUBSCRIPTION_DETAIL = `Start your ${EA_TRIAL_PERIOD_DAYS}-day free trial for this Branch when you are ready. Until a free trial or paid subscription is active, your branch will not appear in homeowner search. Recurring monthly billing is handled through Stripe. This environment may use Stripe test (Sandbox) mode before Production charging is enabled.`;

export const EA_CHECKOUT_CONFIRMING_TITLE =
  "Confirming your free trial with Stripe…";

export const EA_CHECKOUT_CONFIRMING_DETAIL =
  "Checkout completed — please wait a few seconds while we recognise your subscription. Do not leave this page yet.";

export const EA_CHECKOUT_CONFIRMATION_TIMEOUT_NOTICE =
  "We're still confirming your subscription with Stripe. You can check again, refresh this page, start Checkout again if you never finished payment, or continue to the dashboard and open Account → Subscription shortly.";
