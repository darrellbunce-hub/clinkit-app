import { EA_FOUNDING_BRANCH_LIMIT } from "@/lib/billing/eaBranchPricing";

/** Locked Day 1 founding reservation / Checkout window (seconds). */
export const EA_FOUNDING_RESERVATION_SECONDS = 1800 as const;

/** Public marketing cache TTL — informational only; never used for pricing. */
export const EA_FOUNDING_PUBLIC_AVAILABILITY_TTL_SECONDS = 600 as const;

export type EaFoundingAvailability = {
  ok: true;
  limit: number;
  confirmedCount: number;
  reservedCount: number;
  availableCount: number;
  cohortSecured: boolean;
  foundingOfferOpen: boolean;
  reservationSeconds: number;
};

export type EaFoundingPublicDisplay =
  | {
      mode: "founding_available";
      priceLabel: "founding";
      placesRemaining: number;
      headline: string;
      detail: string;
    }
  | {
      mode: "founding_securing";
      priceLabel: "founding";
      placesRemaining: 0;
      headline: string;
      detail: string;
    }
  | {
      mode: "founding_secured";
      priceLabel: "standard";
      placesRemaining: 0;
      headline: string;
      detail: string;
    };

export function describeFoundingPublicDisplay(
  availability: EaFoundingAvailability
): EaFoundingPublicDisplay {
  if (availability.cohortSecured) {
    return {
      mode: "founding_secured",
      priceLabel: "standard",
      placesRemaining: 0,
      headline: "Our 20 founding places have now been secured.",
      detail:
        "Keynetic Professional is £129/month per branch. Founding Member pricing is no longer available for new subscriptions.",
    };
  }

  if (availability.availableCount > 0) {
    const n = availability.availableCount;
    return {
      mode: "founding_available",
      priceLabel: "founding",
      placesRemaining: n,
      headline: "£99/month — Founding Member Price",
      detail:
        n === 1
          ? "1 founding place remaining. Your place is secured when you start Checkout — not by viewing this page."
          : `${n} founding places remaining. Your place is secured when you start Checkout — not by viewing this page.`,
    };
  }

  return {
    mode: "founding_securing",
    priceLabel: "founding",
    placesRemaining: 0,
    headline: "Founding places are being secured.",
    detail:
      "The remaining founding places are currently reserved for customers completing Checkout. If a reservation expires, a place may become available again.",
  };
}

export function mapFoundingAvailabilityPayload(
  raw: Record<string, unknown> | null
): EaFoundingAvailability {
  const confirmedCount = Number(raw?.confirmed_count ?? 0);
  const reservedCount = Number(raw?.reserved_count ?? 0);
  const availableCount = Number(raw?.available_count ?? 0);
  const cohortSecured =
    raw?.cohort_secured === true || confirmedCount >= EA_FOUNDING_BRANCH_LIMIT;

  return {
    ok: true,
    limit: Number(raw?.limit ?? EA_FOUNDING_BRANCH_LIMIT),
    confirmedCount,
    reservedCount,
    availableCount,
    cohortSecured,
    foundingOfferOpen:
      raw?.founding_offer_open === true || availableCount > 0,
    reservationSeconds: Number(
      raw?.reservation_seconds ?? EA_FOUNDING_RESERVATION_SECONDS
    ),
  };
}
