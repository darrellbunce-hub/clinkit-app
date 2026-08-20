import { CHAIN_INTELLIGENCE_CONFIG } from "@/lib/chainIntelligence/config";
import type { StageTimingDefinition } from "@/lib/chainIntelligence/parseTimeframe";
import {
  computeTimingHealthScore,
  type TimingZone,
} from "@/lib/chainIntelligence/timingHealth";
import type { StageClockQuality } from "@/lib/chainIntelligence/stageClock";

export type DependencyOperationalState =
  | "normal"
  | "explicit_delay"
  | "blocked"
  | "lost"
  | "broken_connection"
  | "pending_connection";

export type ChainDependencyKind = "property" | "buyer_ready";

export type ChainDependencyInput = {
  id: string;
  kind: ChainDependencyKind;
  label: string;
  stage: string;
  status: string;
  stageEnteredAt: string | null;
  clockQuality: StageClockQuality;
  operationalState: DependencyOperationalState;
  isCritical: boolean;
};

export type DependencyScoreResult = {
  dependencyId: string;
  kind: ChainDependencyKind;
  label: string;
  timingHealthScore: number;
  operationalAdjustment: number;
  dependencyScore: number;
  zone: TimingZone;
  elapsedDays: number | null;
  expectedMaxDays: number | null;
  clockQuality: StageClockQuality;
  operationalState: DependencyOperationalState;
  scored: boolean;
};

function getStageDefinition(
  stage: string,
  saleTiming: Map<string, StageTimingDefinition>,
  buyerReadyTiming: Map<string, StageTimingDefinition>
): StageTimingDefinition | undefined {
  return saleTiming.get(stage) ?? buyerReadyTiming.get(stage);
}

function computeOperationalAdjustment(
  state: DependencyOperationalState,
  timingZone: TimingZone
): number {
  const mods = CHAIN_INTELLIGENCE_CONFIG.operationalModifiers;

  switch (state) {
    case "explicit_delay":
      // Option 2: delay remains an operational state for health/bottleneck/ETA
      // but does not adjust Chain Confidence (timing_v1 owns score movement).
      void timingZone;
      return mods.explicitDelayWithinGrace;
    case "blocked":
      return mods.blocked;
    case "lost":
      return mods.lostCritical;
    case "broken_connection":
      return mods.brokenConnection;
    case "pending_connection":
      return mods.pendingConnection;
    default:
      return 0;
  }
}

export function computeDependencyScore(params: {
  dependency: ChainDependencyInput;
  saleTiming: Map<string, StageTimingDefinition>;
  buyerReadyTiming: Map<string, StageTimingDefinition>;
  referenceDate?: Date;
}): DependencyScoreResult {
  const { dependency } = params;
  const referenceDate = params.referenceDate ?? new Date();
  const stageDef = getStageDefinition(
    dependency.stage,
    params.saleTiming,
    params.buyerReadyTiming
  );
  const expectedMaxDays =
    stageDef?.expectedTimeframe.maxDays ?? null;

  if (
    dependency.operationalState === "lost" ||
    !stageDef ||
    stageDef.expectedTimeframe.unit === "variable" ||
    stageDef.expectedTimeframe.unit === "complete" ||
    expectedMaxDays == null ||
    dependency.clockQuality === "unavailable" ||
    !dependency.stageEnteredAt
  ) {
    const adjustment = computeOperationalAdjustment(
      dependency.operationalState,
      "not_applicable"
    );

    return {
      dependencyId: dependency.id,
      kind: dependency.kind,
      label: dependency.label,
      timingHealthScore: 0,
      operationalAdjustment: adjustment,
      dependencyScore: Math.max(0, adjustment),
      zone: "not_applicable",
      elapsedDays: null,
      expectedMaxDays,
      clockQuality: dependency.clockQuality,
      operationalState: dependency.operationalState,
      scored: false,
    };
  }

  const elapsedDays = Math.floor(
    (referenceDate.getTime() -
      new Date(dependency.stageEnteredAt).getTime()) /
      (1000 * 60 * 60 * 24)
  );

  const { score: timingHealthScore, zone } =
    computeTimingHealthScore({
      elapsedDays,
      expectedMaxDays,
    });

  const operationalAdjustment = computeOperationalAdjustment(
    dependency.operationalState,
    zone
  );

  let dependencyScore = Math.max(
    0,
    Math.min(100, timingHealthScore + operationalAdjustment)
  );

  if (dependency.clockQuality === "approximate") {
    dependencyScore = Math.min(
      dependencyScore,
      CHAIN_INTELLIGENCE_CONFIG.caps.approximateClockMaxScore
    );
  }

  if (dependency.operationalState === "blocked") {
    dependencyScore = Math.min(
      dependencyScore,
      CHAIN_INTELLIGENCE_CONFIG.operationalModifiers.blockedDependencyMaxScore
    );
  }

  return {
    dependencyId: dependency.id,
    kind: dependency.kind,
    label: dependency.label,
    timingHealthScore,
    operationalAdjustment,
    dependencyScore,
    zone,
    elapsedDays,
    expectedMaxDays,
    clockQuality: dependency.clockQuality,
    operationalState: dependency.operationalState,
    scored: true,
  };
}

export function scoreAllDependencies(params: {
  dependencies: ChainDependencyInput[];
  saleTiming: Map<string, StageTimingDefinition>;
  buyerReadyTiming: Map<string, StageTimingDefinition>;
  referenceDate?: Date;
}): DependencyScoreResult[] {
  return params.dependencies.map((dependency) =>
    computeDependencyScore({
      dependency,
      saleTiming: params.saleTiming,
      buyerReadyTiming: params.buyerReadyTiming,
      referenceDate: params.referenceDate,
    })
  );
}
