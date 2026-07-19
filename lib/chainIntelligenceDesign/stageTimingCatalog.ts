/**
 * Stage 3.5 — build canonical stage timing map from data/stages.ts (design only).
 */
import { STAGES } from "@/data/stages";
import {
  parseExpectedTimeframe,
  type StageTimingDefinition,
} from "@/lib/chainIntelligenceDesign/proposedModel";

export function buildCanonicalStageTimingMap(): Map<
  string,
  StageTimingDefinition
> {
  const map = new Map<string, StageTimingDefinition>();

  for (const stage of STAGES) {
    map.set(stage.value, {
      value: stage.value,
      label: stage.label,
      nextStep: stage.nextStep,
      expectedTimeframe: parseExpectedTimeframe(
        stage.expectedTimeframe
      ),
    });
  }

  return map;
}

export const CANONICAL_SALE_STAGE_TIMING = buildCanonicalStageTimingMap();

export const SALE_STAGE_ORDER = STAGES.map((stage) => stage.value);
