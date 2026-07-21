import { CHAIN_INTELLIGENCE_CONFIG } from "@/lib/chainIntelligence/config";

export type ConfidenceBand =
  | "Strong"
  | "Good"
  | "Monitor"
  | "Needs attention"
  | "Unavailable";

export function roundDisplayScore(
  score: number | null
): number | null {
  if (score == null) {
    return null;
  }

  return Math.round(score / 5) * 5;
}

/** Cap customer-facing numeric confidence (internal score may be higher). */
export function capCustomerDisplayScore(
  score: number | null
): number | null {
  if (score == null) {
    return null;
  }

  return Math.min(
    score,
    CHAIN_INTELLIGENCE_CONFIG.customerDisplayMaxScore
  );
}

/** Derive customer-facing score from cached internal confidence_score. */
export function toCustomerFacingConfidenceScore(
  internalScore: number | null
): number | null {
  if (internalScore == null) {
    return null;
  }

  return capCustomerDisplayScore(
    roundDisplayScore(internalScore)
  );
}

export function confidenceBand(
  score: number | null
): ConfidenceBand {
  if (score == null) {
    return "Unavailable";
  }

  const bands = CHAIN_INTELLIGENCE_CONFIG.bands;

  if (score >= bands.strongMin) {
    return "Strong";
  }

  if (score >= bands.goodMin) {
    return "Good";
  }

  if (score >= bands.monitorMin) {
    return "Monitor";
  }

  return "Needs attention";
}

/** Product rule: active explicit delay must not display Strong band. */
export function applyExplicitDelayBandCap(
  score: number | null,
  hasExplicitDelay: boolean
): number | null {
  if (score == null || !hasExplicitDelay) {
    return score;
  }

  const maxScore =
    CHAIN_INTELLIGENCE_CONFIG.bands.strongMin - 1;

  return Math.min(score, maxScore);
}

export function mapBandLabels(band: ConfidenceBand): {
  homeowner: string;
  estateAgent: string;
} {
  switch (band) {
    case "Strong":
      return { homeowner: "Strong", estateAgent: "Strong" };
    case "Good":
      return { homeowner: "Good", estateAgent: "Good" };
    case "Monitor":
      return {
        homeowner: "Keep an eye on",
        estateAgent: "Monitor",
      };
    case "Needs attention":
      return {
        homeowner: "Needs attention",
        estateAgent: "Needs attention",
      };
    default:
      return {
        homeowner: "Unavailable",
        estateAgent: "Unavailable",
      };
  }
}

export function confidencePresentation(params: {
  score: number | null;
  band: ConfidenceBand;
}): {
  colour: string;
  bg: string;
  label: string;
} {
  if (params.band === "Unavailable" || params.score == null) {
    return {
      label: "Unavailable",
      colour: "text-text-muted",
      bg: "bg-surface-stone",
    };
  }

  switch (params.band) {
    case "Strong":
      return {
        label: "Strong",
        colour: "text-green-700",
        bg: "bg-green-100",
      };
    case "Good":
      return {
        label: "Good",
        colour: "text-emerald-700",
        bg: "bg-emerald-50",
      };
    case "Monitor":
      return {
        label: "Keep an eye on",
        colour: "text-amber-700",
        bg: "bg-amber-100",
      };
    default:
      return {
        label: "Needs attention",
        colour: "text-amber-800",
        bg: "bg-amber-100",
      };
  }
}

export const CHAIN_CONFIDENCE_TOOLTIP =
  "Keynetic calculates Chain Confidence using the timing and chain information available for your property chain. It reflects whether visible steps are progressing within expected timescales — not how far through the chain you are. It is a system-generated indication and is not independently verified or a guarantee that your move will complete.";

export const CHAIN_CONFIDENCE_UNAVAILABLE_MESSAGE =
  "We don't yet have enough timing information to calculate Chain Confidence for this chain.";

export const CHAIN_PROGRESS_TOOLTIP =
  "Chain Progress is an average of stage completion across visible chain steps. It is separate from Chain Confidence, which reflects timing health for steps where reliable timing data is available.";

export const ESTIMATED_COMPLETION_TOOLTIP =
  "Estimated completion window is a system-generated indication based on expected stage timings and the information visible on Keynetic. It is not independently verified or a guaranteed completion date.";

export const ESTIMATED_COMPLETION_DISCLAIMER =
  "This is a system-generated estimate based on expected stage timings and the information visible on Keynetic. It is not independently verified or a guaranteed completion date.";

export const ESTIMATED_COMPLETION_DISCLAIMER_WITH_LIMITED_COVERAGE =
  "This is a system-generated estimate. It is not independently verified or a guaranteed completion date.";

export const ESTIMATED_COMPLETION_LIMITED_COVERAGE_SUFFIX =
  "Based on timing information currently available in Keynetic.";

export type EstimatedCompletionPresentation = {
  primaryValue: string;
  limitedCoverageQualifier: string | null;
  delayNote: string | null;
  disclaimer: string;
};

/** Split canonical ETA string into display hierarchy (does not alter calculation output). */
export function parseEstimatedCompletionPresentation(
  raw: string | null | undefined
): EstimatedCompletionPresentation {
  const fallback = "Unable to estimate";

  if (!raw?.trim()) {
    return {
      primaryValue: fallback,
      limitedCoverageQualifier: null,
      delayNote: null,
      disclaimer: ESTIMATED_COMPLETION_DISCLAIMER,
    };
  }

  let remainder = raw.trim();
  let limitedCoverageQualifier: string | null = null;

  if (remainder.includes(ESTIMATED_COMPLETION_LIMITED_COVERAGE_SUFFIX)) {
    limitedCoverageQualifier =
      ESTIMATED_COMPLETION_LIMITED_COVERAGE_SUFFIX;
    remainder = remainder
      .replace(
        `. ${ESTIMATED_COMPLETION_LIMITED_COVERAGE_SUFFIX}`,
        ""
      )
      .replace(ESTIMATED_COMPLETION_LIMITED_COVERAGE_SUFFIX, "")
      .trim();
  }

  let delayNote: string | null = null;
  const delayPattern = /\s+\(reported delays may extend this\)$/;

  if (delayPattern.test(remainder)) {
    remainder = remainder.replace(delayPattern, "").trim();
    delayNote = "Reported delays may extend this estimate.";
  }

  const primaryValue =
    remainder.replace(/\.$/, "").trim() || fallback;

  return {
    primaryValue,
    limitedCoverageQualifier,
    delayNote,
    disclaimer: limitedCoverageQualifier
      ? ESTIMATED_COMPLETION_DISCLAIMER_WITH_LIMITED_COVERAGE
      : ESTIMATED_COMPLETION_DISCLAIMER,
  };
}
