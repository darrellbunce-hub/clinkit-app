import {
  BUYER_READY_STAGE_TIMING,
  SALE_STAGE_TIMING,
} from "@/lib/chainIntelligence/catalog";
import type { DependencyOperationalState } from "@/lib/chainIntelligence/dependencyScoring";
import type { ChainDependencyInput } from "@/lib/chainIntelligence/dependencyScoring";
import { computeEstimatedCompletionWindow } from "@/lib/chainIntelligence/estimatedCompletion";
import type { StageClockQuality } from "@/lib/chainIntelligence/stageClock";

export function computeScopeEstimatedCompletionWindow(params: {
  propertyStage: string;
  propertyStageEnteredAt?: string | null;
  propertyClockQuality?: StageClockQuality;
  propertyOperationalState?: DependencyOperationalState;
  buyerReadyStage?: string | null;
  buyerReadyStageEnteredAt?: string | null;
  buyerReadyClockQuality?: StageClockQuality;
  buyerReadyOperationalState?: DependencyOperationalState;
  includeBuyerReady?: boolean;
}): string {
  const propertyClockQuality =
    params.propertyClockQuality ??
    (params.propertyStageEnteredAt ? "reliable" : "unavailable");

  const dependencies: ChainDependencyInput[] = [
    {
      id: "property",
      kind: "property",
      label: "Property",
      stage: params.propertyStage,
      status: "healthy",
      stageEnteredAt: params.propertyStageEnteredAt ?? null,
      clockQuality: propertyClockQuality,
      operationalState:
        params.propertyOperationalState ?? "normal",
      isCritical: true,
    },
  ];

  if (params.includeBuyerReady && params.buyerReadyStage) {
    const buyerClockQuality =
      params.buyerReadyClockQuality ??
      (params.buyerReadyStageEnteredAt
        ? "reliable"
        : "unavailable");

    dependencies.push({
      id: "buyer-ready",
      kind: "buyer_ready",
      label: "Buyer Ready",
      stage: params.buyerReadyStage,
      status: "healthy",
      stageEnteredAt:
        params.buyerReadyStageEnteredAt ?? null,
      clockQuality: buyerClockQuality,
      operationalState:
        params.buyerReadyOperationalState ?? "normal",
      isCritical: true,
    });
  }

  const results = dependencies.map((dependency) => ({
    dependencyId: dependency.id,
    kind: dependency.kind,
    label: dependency.label,
    timingHealthScore: 100,
    operationalAdjustment: 0,
    dependencyScore: 100,
    zone: "within" as const,
    elapsedDays: 0,
    expectedMaxDays: null,
    clockQuality: dependency.clockQuality,
    operationalState: dependency.operationalState,
    scored: dependency.clockQuality !== "unavailable",
  }));

  return computeEstimatedCompletionWindow({
    dependencies,
    results,
    saleTiming: SALE_STAGE_TIMING,
    buyerReadyTiming: BUYER_READY_STAGE_TIMING,
    confidenceUnavailable: results.every(
      (result) => !result.scored
    ),
  });
}
