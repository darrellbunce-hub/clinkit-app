import type { OperationalAlert } from "@/lib/operationalAlerts/types";

export type StoredOperationalAlert = Pick<
  OperationalAlert,
  "code" | "severity"
>;

export type OperationalRecommendedAction =
  StoredOperationalAlert | null;

export type ChainOperationalSummaryRecord = {
  chain_id: number;
  confidence_score: number;
  health_status: string;
  blocked_count: number;
  delay_count: number;
  stale_count: number;
  buyer_ready_stale: boolean;
  requires_replacement_buyer: boolean;
  computed_at: string;
  summary_version: number;
};

export type PropertyOperationalSummaryRecord = {
  property_id: number;
  chain_id: number;
  current_stage: string;
  property_status: string;
  last_update_at: string | null;
  days_since_last_update: number;
  stale_update: boolean;
  buyer_ready_stage: string | null;
  buyer_ready_status: string | null;
  buyer_ready_last_update: string | null;
  buyer_ready_delayed: boolean;
  buyer_ready_stale: boolean;
  completion_status: string | null;
  completion_scheduled: boolean;
  completion_confirmed: boolean;
  operational_alerts: StoredOperationalAlert[];
  needs_attention: boolean;
  next_recommended_action: OperationalRecommendedAction;
  computed_at: string;
  summary_version: number;
  derived_from_activity_at: string | null;
};

export type OperationalRefreshProperty = {
  id: number;
  chainId: number;
  chainPosition: number;
  stage: string;
  status: string;
  address: string | null;
  activities: {
    id?: number;
    timestamp: string;
    update: string;
    updated_by?: string;
  }[];
};

export type OperationalRefreshChainNode = {
  id: number;
  chain_id: number;
  node_type: string;
  linked_property_id: number | null;
  stage: string | null;
  status: string;
  progress: number;
  activities: {
    id?: number;
    timestamp: string;
    update: string;
    updated_by?: string;
  }[];
};

export type OperationalRefreshChain = {
  id: number;
  completionLifecycleStatus: string | null;
  completionScheduledDate: string | null;
  completionConfirmedAt: string | null;
  completedAt: string | null;
};

export type OperationalRefreshDataset = {
  chain: OperationalRefreshChain;
  properties: OperationalRefreshProperty[];
  chainNodes: OperationalRefreshChainNode[];
};
