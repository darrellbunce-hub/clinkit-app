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
