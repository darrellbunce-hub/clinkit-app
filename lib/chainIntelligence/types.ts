import type { OperationalActivity } from "@/lib/activityIntelligence";

export type IntelligenceProperty = {
  id: number;
  chainPosition: number;
  stage: string;
  status: string;
  address: string | null;
  lastUpdatedDays: number;
  activities: OperationalActivity[];
  /** Authoritative DB clock when available. */
  stageEnteredAt?: string | null;
  /**
   * Authoritative operational delay lifecycle.
   * When true/false, timing_v1 uses this instead of parsing activity text.
   * When undefined/null, falls back to legacy latest-activity delay detection.
   */
  hasActiveOperationalDelay?: boolean | null;
};

export type StageDefinition = {
  value: string;
  progress: number;
};

export type ChainHealthStatus =
  | "Stable"
  | "Active"
  | "At Risk"
  | "Replacement Buyer Required";
