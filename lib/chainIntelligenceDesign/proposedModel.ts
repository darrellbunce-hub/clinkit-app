/**
 * Stage 3.5 — Chain Intelligence redesign (DESIGN ONLY).
 *
 * Pure modelling functions for simulation and founder review.
 * NOT imported by application runtime — must not change product behaviour.
 *
 * Algorithm version label for future implementation tracking.
 */
export const PROPOSED_CONFIDENCE_ALGORITHM_VERSION =
  "timing_v1_proposal_2026_06";

export type ParsedTimeframe = {
  minDays: number | null;
  maxDays: number | null;
  unit: "days" | "weeks" | "variable" | "complete" | "unknown";
  raw: string;
};

export type StageTimingDefinition = {
  value: string;
  label: string;
  nextStep: string;
  expectedTimeframe: ParsedTimeframe;
};

export type TimingClockQuality =
  | "reliable"
  | "derived"
  | "approximate"
  | "unavailable";

export type DataCoverageStatus =
  | "full"
  | "limited"
  | "insufficient";

export type PropertyTimingInput = {
  id: number;
  stage: string;
  status: string;
  stageEnteredAt: string | null;
  clockQuality: TimingClockQuality;
  hasActiveDelay: boolean;
  activities: Array<{ timestamp: string; update: string }>;
};

export type ProposedPropertyResult = {
  propertyId: number;
  timingHealthScore: number;
  operationalModifier: number;
  propertyConfidence: number;
  clockQuality: TimingClockQuality;
  elapsedDays: number | null;
  expectedMaxDays: number | null;
  graceDays: number | null;
  zone:
    | "within"
    | "grace"
    | "overdue"
    | "severely_overdue"
    | "not_applicable";
};

export type ProposedChainResult = {
  algorithmVersion: typeof PROPOSED_CONFIDENCE_ALGORITHM_VERSION;
  score: number | null;
  band: string;
  dataCoverage: DataCoverageStatus;
  coverageLabel: string;
  propertyResults: ProposedPropertyResult[];
  aggregationNote: string;
  estimatedCompletionWindow: string | null;
};

/** Parse display strings such as "1–2 weeks" into day bounds. */
export function parseExpectedTimeframe(raw: string): ParsedTimeframe {
  const normalized = raw.trim();

  if (normalized === "Variable") {
    return {
      minDays: null,
      maxDays: null,
      unit: "variable",
      raw,
    };
  }

  if (normalized === "Complete") {
    return {
      minDays: 0,
      maxDays: 0,
      unit: "complete",
      raw,
    };
  }

  const match = normalized.match(
    /^(\d+)(?:–(\d+))?\s+(day|days|week|weeks)$/i
  );

  if (!match) {
    return {
      minDays: null,
      maxDays: null,
      unit: "unknown",
      raw,
    };
  }

  const min = Number(match[1]);
  const max = Number(match[2] ?? match[1]);
  const unitWord = match[3].toLowerCase();
  const multiplier =
    unitWord.startsWith("week") ? 7 : 1;

  return {
    minDays: min * multiplier,
    maxDays: max * multiplier,
    unit: unitWord.startsWith("week") ? "weeks" : "days",
    raw,
  };
}

/** Model A — fixed grace period. */
export function computeFixedGraceDays(_expectedMaxDays: number): number {
  return 7;
}

/** Model B — proportional grace (50% of expected max). */
export function computeProportionalGraceDays(
  expectedMaxDays: number
): number {
  return Math.max(1, Math.round(expectedMaxDays * 0.5));
}

/** Model C — hybrid grace with minimum/maximum caps (recommended). */
export function computeHybridGraceDays(
  expectedMaxDays: number
): number {
  return Math.max(
    3,
    Math.min(14, Math.round(expectedMaxDays * 0.5))
  );
}

export function elapsedWholeDays(
  fromIso: string,
  referenceDate: Date = new Date()
): number {
  const start = new Date(fromIso).getTime();

  if (Number.isNaN(start)) {
    return 0;
  }

  return Math.floor(
    (referenceDate.getTime() - start) / (1000 * 60 * 60 * 24)
  );
}

/**
 * Timing health score (0–100) before operational modifiers.
 * Uses hybrid grace (Model C) and progressive degradation (Model 3).
 */
export function computeTimingHealthScore(params: {
  elapsedDays: number;
  expectedMaxDays: number;
  graceDays?: number;
}): {
  score: number;
  zone: ProposedPropertyResult["zone"];
  graceDays: number;
} {
  const { elapsedDays, expectedMaxDays } = params;
  const graceDays =
    params.graceDays ??
    computeHybridGraceDays(expectedMaxDays);

  if (expectedMaxDays <= 0) {
    return { score: 100, zone: "not_applicable", graceDays: 0 };
  }

  const T = elapsedDays;
  const E = expectedMaxDays;
  const G = graceDays;

  if (T <= E) {
    return { score: 100, zone: "within", graceDays: G };
  }

  if (T <= E + G) {
    const ratio = (T - E) / G;
    return {
      score: Math.round(100 - 15 * ratio),
      zone: "grace",
      graceDays: G,
    };
  }

  const overdueDays = T - E - G;
  const moderateWindow = Math.max(E, 7);

  if (overdueDays <= moderateWindow) {
    const ratio = overdueDays / moderateWindow;
    return {
      score: Math.round(85 - 35 * ratio),
      zone: "overdue",
      graceDays: G,
    };
  }

  const severeExtraWeeks = Math.floor(
    (overdueDays - moderateWindow) / 7
  );
  const severeScore = Math.max(
    5,
    50 - severeExtraWeeks * 8
  );

  return {
    score: severeScore,
    zone: "severely_overdue",
    graceDays: G,
  };
}

export function computeOperationalModifier(params: {
  status: string;
  hasActiveDelay: boolean;
}): number {
  let modifier = 0;

  if (params.hasActiveDelay) {
    modifier -= 12;
  }

  if (params.status === "blocked") {
    modifier -= 30;
  } else if (params.status === "broken_connection") {
    modifier -= 35;
  } else if (params.status === "pending_connection") {
    modifier -= 8;
  }

  return modifier;
}

export function computePropertyConfidence(
  property: PropertyTimingInput,
  stageTimingByValue: Map<string, StageTimingDefinition>,
  referenceDate: Date = new Date()
): ProposedPropertyResult {
  const stageDef = stageTimingByValue.get(property.stage);
  const expectedMaxDays =
    stageDef?.expectedTimeframe.maxDays ?? null;

  if (
    !stageDef ||
    stageDef.expectedTimeframe.unit === "variable" ||
    stageDef.expectedTimeframe.unit === "complete" ||
    expectedMaxDays == null ||
    property.clockQuality === "unavailable" ||
    !property.stageEnteredAt
  ) {
    return {
      propertyId: property.id,
      timingHealthScore: 0,
      operationalModifier: computeOperationalModifier(property),
      propertyConfidence: 0,
      clockQuality: property.clockQuality,
      elapsedDays: null,
      expectedMaxDays,
      graceDays: null,
      zone: "not_applicable",
    };
  }

  const elapsedDays = elapsedWholeDays(
    property.stageEnteredAt,
    referenceDate
  );

  const { score: timingHealthScore, zone, graceDays } =
    computeTimingHealthScore({
      elapsedDays,
      expectedMaxDays,
    });

  const operationalModifier =
    computeOperationalModifier(property);

  let propertyConfidence = Math.max(
    0,
    Math.min(100, timingHealthScore + operationalModifier)
  );

  if (property.clockQuality === "approximate") {
    propertyConfidence = Math.min(propertyConfidence, 85);
  }

  return {
    propertyId: property.id,
    timingHealthScore,
    operationalModifier,
    propertyConfidence,
    clockQuality: property.clockQuality,
    elapsedDays,
    expectedMaxDays,
    graceDays,
    zone,
  };
}

/** Bottleneck-weighted hybrid aggregation (recommended). */
export function aggregatePropertyConfidences(
  propertyResults: ProposedPropertyResult[]
): {
  score: number | null;
  note: string;
} {
  const scored = propertyResults.filter(
    (result) =>
      result.zone !== "not_applicable" &&
      result.clockQuality !== "unavailable"
  );

  if (scored.length === 0) {
    return {
      score: null,
      note: "No properties with timing-applicable data",
    };
  }

  const scores = scored.map(
    (result) => result.propertyConfidence
  );
  const minScore = Math.min(...scores);
  const avgScore =
    scores.reduce((total, value) => total + value, 0) /
    scores.length;

  const chainScore = Math.round(minScore * 0.6 + avgScore * 0.4);

  return {
    score: chainScore,
    note: `60% bottleneck (${minScore}) + 40% average (${Math.round(avgScore)})`,
  };
}

export function classifyDataCoverage(
  propertyResults: ProposedPropertyResult[]
): {
  status: DataCoverageStatus;
  label: string;
} {
  if (propertyResults.length === 0) {
    return {
      status: "insufficient",
      label: "No connected properties in scope",
    };
  }

  const reliableCount = propertyResults.filter(
    (result) =>
      result.clockQuality === "reliable" ||
      result.clockQuality === "derived"
  ).length;

  const unavailableCount = propertyResults.filter(
    (result) =>
      result.clockQuality === "unavailable" ||
      result.zone === "not_applicable"
  ).length;

  const connectedCount = propertyResults.length;

  if (unavailableCount === connectedCount) {
    return {
      status: "insufficient",
      label: "Timing data unavailable for connected properties",
    };
  }

  if (reliableCount < connectedCount) {
    return {
      status: "limited",
      label: `Based on ${reliableCount} of ${connectedCount} connected properties`,
    };
  }

  return {
    status: "full",
    label: `Based on ${connectedCount} connected properties`,
  };
}

export function confidenceBand(score: number | null): string {
  if (score == null) {
    return "Unavailable";
  }

  if (score >= 85) {
    return "Strong";
  }

  if (score >= 70) {
    return "Good";
  }

  if (score >= 50) {
    return "Monitor";
  }

  return "Needs attention";
}

export function roundDisplayScore(score: number | null): number | null {
  if (score == null) {
    return null;
  }

  return Math.round(score / 5) * 5;
}

export function computeProposedChainConfidence(params: {
  properties: PropertyTimingInput[];
  stageTimingByValue: Map<string, StageTimingDefinition>;
  referenceDate?: Date;
}): ProposedChainResult {
  const referenceDate = params.referenceDate ?? new Date();

  const propertyResults = params.properties.map((property) =>
    computePropertyConfidence(
      property,
      params.stageTimingByValue,
      referenceDate
    )
  );

  const { score, note } =
    aggregatePropertyConfidences(propertyResults);

  const coverage = classifyDataCoverage(propertyResults);

  const displayScore = roundDisplayScore(score);

  return {
    algorithmVersion: PROPOSED_CONFIDENCE_ALGORITHM_VERSION,
    score: displayScore,
    band: confidenceBand(displayScore),
    dataCoverage: coverage.status,
    coverageLabel: coverage.label,
    propertyResults,
    aggregationNote: note,
    estimatedCompletionWindow: null,
  };
}

/** Compare buffer models for design documentation. */
export function compareBufferModels(expectedMaxDays: number): {
  fixed: number;
  proportional: number;
  hybrid: number;
} {
  return {
    fixed: computeFixedGraceDays(expectedMaxDays),
    proportional: computeProportionalGraceDays(expectedMaxDays),
    hybrid: computeHybridGraceDays(expectedMaxDays),
  };
}
