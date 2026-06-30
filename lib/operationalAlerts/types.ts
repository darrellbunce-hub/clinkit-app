export type OperationalAlertCode =
  | "stale_update"
  | "delay_reported"
  | "buyer_ready_stale"
  | "buyer_ready_delayed"
  | "completion_awaiting_confirmation"
  | "chain_confidence_low"
  | "broken_connection"
  | "property_blocked";

export type OperationalAlertSeverity =
  | "info"
  | "warning"
  | "critical";

export type OperationalAlert = {
  code: OperationalAlertCode;
  severity: OperationalAlertSeverity;
};

export type PropertyAlertEvaluationContext = {
  propertyStatus: string;
  daysSinceLastUpdate: number;
  staleUpdate: boolean;
  hasActivePropertyDelay: boolean;
  buyerReadyDelayed: boolean;
  buyerReadyStale: boolean;
  completionAwaitingConfirmation: boolean;
  chainConfidenceScore: number;
  requiresReplacementBuyer: boolean;
  scheduledCompletionMode: boolean;
};
