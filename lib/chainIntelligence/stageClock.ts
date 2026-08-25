import type { OperationalActivity } from "@/lib/activityIntelligence";
import { STAGES } from "@/data/stages";
import { BUYER_READY_STAGES } from "@/data/buyerReadyStages";
import { LEGACY_BUYER_READY_STAGE } from "@/lib/chainIntelligence/catalog";

export type StageClockQuality =
  | "reliable"
  | "derived"
  | "approximate"
  | "unavailable";

export type ResolvedStageClock = {
  stageEnteredAt: string | null;
  clockQuality: StageClockQuality;
};

function formatStageLabel(stageValue: string): string {
  const saleStage = STAGES.find(
    (stage) => stage.value === stageValue
  );
  if (saleStage) {
    return saleStage.label;
  }

  const buyerStage = BUYER_READY_STAGES.find(
    (stage) => stage.value === stageValue
  );
  if (buyerStage) {
    return buyerStage.label;
  }

  if (stageValue === LEGACY_BUYER_READY_STAGE) {
    return "Mortgage Preparation";
  }

  return stageValue
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function findNewestMatchingActivity(
  activities: OperationalActivity[],
  stageValue: string
): OperationalActivity | null {
  const label = formatStageLabel(stageValue);

  for (const activity of activities) {
    if (activity.update.trim() === label) {
      return activity;
    }
  }

  return null;
}

export function resolvePropertyStageClock(params: {
  stage: string;
  persistedStageEnteredAt?: string | null;
  activities: OperationalActivity[];
}): ResolvedStageClock {
  if (params.persistedStageEnteredAt) {
    return {
      stageEnteredAt: params.persistedStageEnteredAt,
      clockQuality: "reliable",
    };
  }

  const matched = findNewestMatchingActivity(
    params.activities,
    params.stage
  );

  if (matched?.timestamp) {
    return {
      stageEnteredAt: matched.timestamp,
      clockQuality: "derived",
    };
  }

  return {
    stageEnteredAt: null,
    clockQuality: "unavailable",
  };
}

export function resolveBuyerReadyStageClock(params: {
  stage: string | null | undefined;
  persistedStageEnteredAt?: string | null;
  activities: OperationalActivity[];
}): ResolvedStageClock {
  if (!params.stage) {
    return {
      stageEnteredAt: null,
      clockQuality: "unavailable",
    };
  }

  if (params.persistedStageEnteredAt) {
    return {
      stageEnteredAt: params.persistedStageEnteredAt,
      clockQuality: "reliable",
    };
  }

  const matched = findNewestMatchingActivity(
    params.activities,
    params.stage
  );

  if (matched?.timestamp) {
    return {
      stageEnteredAt: matched.timestamp,
      clockQuality: "derived",
    };
  }

  return {
    stageEnteredAt: null,
    clockQuality: "unavailable",
  };
}

export function stageTransitionTimestamp(
  referenceDate: Date = new Date()
): string {
  return referenceDate.toISOString();
}
