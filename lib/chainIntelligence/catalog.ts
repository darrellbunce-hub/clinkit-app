import { STAGES } from "@/data/stages";
import { BUYER_READY_STAGES } from "@/data/buyerReadyStages";
import {
  parseExpectedTimeframe,
  type StageTimingDefinition,
} from "@/lib/chainIntelligence/parseTimeframe";

/** Legacy join stage — kept distinct from mortgage_in_principle in intelligence. */
export const LEGACY_BUYER_READY_STAGE = "mortgage_preparation" as const;

const LEGACY_BUYER_READY_TIMING: StageTimingDefinition = {
  value: LEGACY_BUYER_READY_STAGE,
  label: "Mortgage Preparation",
  nextStep: "Mortgage In Principle",
  expectedTimeframe: parseExpectedTimeframe("1–2 weeks"),
};

export function buildSaleStageTimingMap(): Map<string, StageTimingDefinition> {
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

export function buildBuyerReadyStageTimingMap(): Map<
  string,
  StageTimingDefinition
> {
  const map = new Map<string, StageTimingDefinition>();

  for (const stage of BUYER_READY_STAGES) {
    map.set(stage.value, {
      value: stage.value,
      label: stage.label,
      nextStep: stage.nextStep,
      expectedTimeframe: parseExpectedTimeframe(
        stage.expectedTimeframe
      ),
    });
  }

  map.set(
    LEGACY_BUYER_READY_STAGE,
    LEGACY_BUYER_READY_TIMING
  );

  return map;
}

export const SALE_STAGE_TIMING = buildSaleStageTimingMap();
export const BUYER_READY_STAGE_TIMING = buildBuyerReadyStageTimingMap();
export const SALE_STAGE_ORDER = STAGES.map((stage) => stage.value);
export const BUYER_READY_STAGE_ORDER = [
  ...BUYER_READY_STAGES.map((stage) => stage.value),
];

/** Stages where purchase and sale conveyancing commonly overlap. */
export const PARALLEL_ELIGIBLE_STAGES = new Set([
  "searches_ordered",
  "survey_booked",
  "survey_completed",
  "searches_returned",
  "enquiries_raised",
  "enquiries_fully_answered",
  "enquiries_reviewed",
  "mortgage_offer_received",
  "mortgage_offer",
  "solicitor_instructed",
]);
