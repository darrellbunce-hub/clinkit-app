/**
 * Estate Agent branch commercial pricing.
 *
 * Server-authoritative constants. Browser clients must never choose Stripe prices.
 * Launch commercial model: one standard monthly subscription with a free trial.
 * The founding tier remains in the database schema only (never launched; no
 * grandfathered subscribers) and is not part of the active offer.
 *
 * Money uses integer minor units (pence) — never floating point for computation.
 */

/** Dormant schema constant only — founding was never launched. Not an active offer. */
export const EA_FOUNDING_BRANCH_MONTHLY_GBP_MINOR = 9900 as const;

/** Standard price: £129.00 per branch / month (including VAT). */
export const EA_STANDARD_BRANCH_MONTHLY_GBP_MINOR = 12900 as const;

/** Dormant schema constant only — founding cohort size. Not an active offer. */
export const EA_FOUNDING_BRANCH_LIMIT = 20 as const;

export const EA_BILLING_CURRENCY = "gbp" as const;

/** Free trial applied by Stripe Checkout to new branch subscriptions. */
export const EA_TRIAL_PERIOD_DAYS = 30 as const;

/**
 * Pricing tiers stored on ea_branch_subscriptions.
 * Active Checkout always writes "standard". "founding" remains only because the
 * historical schema constraint still allows it; it is not offered.
 */
export const EA_PRICING_TIERS = ["founding", "standard"] as const;
export type EaPricingTier = (typeof EA_PRICING_TIERS)[number];

export function amountGbpMinorForTier(tier: EaPricingTier): number {
  return tier === "founding"
    ? EA_FOUNDING_BRANCH_MONTHLY_GBP_MINOR
    : EA_STANDARD_BRANCH_MONTHLY_GBP_MINOR;
}

export function formatGbpMinorAsMonthlyLabel(amountGbpMinor: number): string {
  const pounds = Math.floor(amountGbpMinor / 100);
  const pence = amountGbpMinor % 100;
  if (pence === 0) {
    return `£${pounds}/month`;
  }
  return `£${pounds}.${String(pence).padStart(2, "0")}/month`;
}

/** Display labels only — not authoritative for Stripe. */
export const EA_STANDARD_MONTHLY_LABEL = formatGbpMinorAsMonthlyLabel(
  EA_STANDARD_BRANCH_MONTHLY_GBP_MINOR
);

/** Customer-facing price line including VAT. */
export const EA_STANDARD_MONTHLY_VAT_COPY = `${EA_STANDARD_MONTHLY_LABEL}, including VAT`;

/** Approx daily framing for £129 standard (£129 / 30). Display only. */
export const EA_STANDARD_DAILY_LABEL = "Around £4.30 a day";

export const EA_TRIAL_HEADLINE = `${EA_TRIAL_PERIOD_DAYS} days free`;

export const EA_TRIAL_OFFER_SUMMARY = `${EA_TRIAL_PERIOD_DAYS} days free, then ${EA_STANDARD_MONTHLY_VAT_COPY} per branch`;

export const EA_TRIAL_TERMS_COPY = `A payment card is required to start your free trial. You won't be charged during the ${EA_TRIAL_PERIOD_DAYS}-day trial. After the trial, your branch subscription continues at ${EA_STANDARD_MONTHLY_VAT_COPY} unless you cancel before the trial ends.`;

export const EA_TRIAL_REPEAT_COPY = `The ${EA_TRIAL_PERIOD_DAYS}-day free trial is available on a branch's first subscription. Resubscribing starts billing at ${EA_STANDARD_MONTHLY_VAT_COPY} straight away.`;
