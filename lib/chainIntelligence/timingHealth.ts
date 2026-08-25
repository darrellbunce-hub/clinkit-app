import { CHAIN_INTELLIGENCE_CONFIG } from "@/lib/chainIntelligence/config";

export type TimingZone =
  | "within"
  | "grace"
  | "overdue"
  | "severely_overdue"
  | "not_applicable";

export function computeHybridGraceDays(expectedMaxDays: number): number {
  const { ratioOfExpectedMax, minDays, maxDays } =
    CHAIN_INTELLIGENCE_CONFIG.grace;

  return Math.max(
    minDays,
    Math.min(
      maxDays,
      Math.round(expectedMaxDays * ratioOfExpectedMax)
    )
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

export function computeTimingHealthScore(params: {
  elapsedDays: number;
  expectedMaxDays: number;
  graceDays?: number;
  referenceDate?: Date;
}): {
  score: number;
  zone: TimingZone;
  graceDays: number;
} {
  const { elapsedDays, expectedMaxDays } = params;
  const graceDays =
    params.graceDays ?? computeHybridGraceDays(expectedMaxDays);
  const cfg = CHAIN_INTELLIGENCE_CONFIG.degradation;

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
      score: Math.round(100 - cfg.graceMaxPenalty * ratio),
      zone: "grace",
      graceDays: G,
    };
  }

  const overdueDays = T - E - G;
  const moderateWindow = Math.max(E, 7);

  if (overdueDays <= moderateWindow) {
    const ratio = overdueDays / moderateWindow;
    return {
      score: Math.round(
        cfg.overdueStartScore - cfg.overdueMaxPenalty * ratio
      ),
      zone: "overdue",
      graceDays: G,
    };
  }

  const severeExtraWeeks = Math.floor(
    (overdueDays - moderateWindow) / 7
  );
  const severeScore = Math.max(
    cfg.floorScore,
    cfg.severeStartScore - severeExtraWeeks * cfg.severeWeeklyPenalty
  );

  return {
    score: severeScore,
    zone: "severely_overdue",
    graceDays: G,
  };
}

export function computeNextRecalculationAt(params: {
  stageEnteredAt: string;
  expectedMaxDays: number;
  referenceDate?: Date;
}): string {
  const graceDays = computeHybridGraceDays(params.expectedMaxDays);
  const entered = new Date(params.stageEnteredAt).getTime();
  const boundaryMs =
    entered +
    (params.expectedMaxDays + graceDays) * 24 * 60 * 60 * 1000;

  return new Date(boundaryMs).toISOString();
}
