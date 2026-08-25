import { BUYER_READY_STAGES } from "@/data/buyerReadyStages";

/** Customer-facing Buyer Ready stage label from catalogue (never internal IDs). */
export function resolveBuyerReadyStageLabel(params: {
  stage?: string | null;
  publicStageLabel?: string | null;
}): string {
  if (params.publicStageLabel?.trim()) {
    return params.publicStageLabel.trim();
  }

  const stageDefinition = BUYER_READY_STAGES.find(
    (stage) => stage.value === params.stage
  );

  if (stageDefinition) {
    return stageDefinition.label;
  }

  if (params.stage) {
    return params.stage
      .replaceAll("_", " ")
      .replace(/\b\w/g, (character) => character.toUpperCase());
  }

  return "In progress";
}
