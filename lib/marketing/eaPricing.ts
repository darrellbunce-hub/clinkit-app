/**
 * Public marketing pricing labels for estate agents.
 * Authoritative commercial constants live in lib/billing/eaBranchPricing.ts.
 */

export {
  EA_FOUNDING_BRANCH_LIMIT,
  EA_FOUNDING_BRANCH_MONTHLY_GBP_MINOR,
  EA_FOUNDING_COHORT_LABEL,
  EA_FOUNDING_MONTHLY_LABEL,
  EA_STANDARD_BRANCH_MONTHLY_GBP_MINOR,
  EA_STANDARD_DAILY_LABEL,
  EA_STANDARD_MONTHLY_LABEL,
  formatGbpMinorAsMonthlyLabel,
} from "@/lib/billing/eaBranchPricing";

/** @deprecated Prefer EA_STANDARD_BRANCH_MONTHLY_GBP_MINOR / 100 */
export const EA_STANDARD_MONTHLY_PRICE_GBP = 129;

/** @deprecated Display-only daily framing */
export const EA_STANDARD_DAILY_PRICE_GBP = 4.3;
