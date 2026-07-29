/**
 * Estate Agent branch commercial pricing — Billing Stage 1.
 *
 * Server-authoritative constants. Browser clients must never choose Stripe prices.
 * Stripe Price IDs are intentionally absent until Billing Stage 2.
 *
 * Money uses integer minor units (pence) — never floating point for computation.
 */

/** Founding offer: £99.00 per branch / month */
export const EA_FOUNDING_BRANCH_MONTHLY_GBP_MINOR = 9900 as const;

/** Standard price: £129.00 per branch / month */
export const EA_STANDARD_BRANCH_MONTHLY_GBP_MINOR = 12900 as const;

/** First N eligible paying branches receive founding pricing */
export const EA_FOUNDING_BRANCH_LIMIT = 20 as const;

export const EA_BILLING_CURRENCY = "gbp" as const;

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

/** Marketing display helpers (labels only — not authoritative for Stripe). */
export const EA_FOUNDING_MONTHLY_LABEL = formatGbpMinorAsMonthlyLabel(
  EA_FOUNDING_BRANCH_MONTHLY_GBP_MINOR
);

export const EA_STANDARD_MONTHLY_LABEL = formatGbpMinorAsMonthlyLabel(
  EA_STANDARD_BRANCH_MONTHLY_GBP_MINOR
);

/** Approx daily framing for £129 standard (£129 / 30). Display only. */
export const EA_STANDARD_DAILY_LABEL = "Around £4.30 a day";

export const EA_FOUNDING_COHORT_LABEL = `First ${EA_FOUNDING_BRANCH_LIMIT} founding branches`;
