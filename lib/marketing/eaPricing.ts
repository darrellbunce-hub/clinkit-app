/**
 * Public marketing pricing labels for estate agents.
 * Authoritative commercial constants live in lib/billing/eaBranchPricing.ts.
 */

export {
  EA_STANDARD_BRANCH_MONTHLY_GBP_MINOR,
  EA_STANDARD_DAILY_LABEL,
  EA_STANDARD_MONTHLY_LABEL,
  EA_TRIAL_HEADLINE,
  EA_TRIAL_OFFER_SUMMARY,
  EA_TRIAL_PERIOD_DAYS,
  EA_TRIAL_TERMS_COPY,
  formatGbpMinorAsMonthlyLabel,
} from "@/lib/billing/eaBranchPricing";

/** @deprecated Prefer EA_STANDARD_BRANCH_MONTHLY_GBP_MINOR / 100 */
export const EA_STANDARD_MONTHLY_PRICE_GBP = 129;

/** @deprecated Display-only daily framing */
export const EA_STANDARD_DAILY_PRICE_GBP = 4.3;
