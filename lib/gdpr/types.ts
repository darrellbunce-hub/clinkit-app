/**
 * GDPR read-only erasure impact report types.
 * Matches generate_erasure_impact_report() JSON output (report_version 1).
 */

export type ErasureAddressTreatment =
  | "already_anonymised"
  | "no_address"
  | "retain_shared_operationally_review_required"
  | "eligible_for_redaction_review"
  | "legal_review_required";

export type ErasureImpactReportError = {
  ok: false;
  error: "user_id_required" | "user_not_found" | string;
  subject_user_id?: string;
};

export type ErasurePropertyRelationship = {
  property_id: number;
  chain_id: number | null;
  roles: string[];
  operational_state: string;
  is_searching: boolean;
  buyer_connected: boolean;
  seller_connected: boolean;
  other_active_homeowners: number;
  other_active_counterparties: number;
  other_active_delegates: number;
  active_ea_assignments: number;
  other_properties_on_chain: number;
  other_legacy_members: number;
  shared_dependency_score: number;
  address_treatment: ErasureAddressTreatment;
  is_sole_participant_candidate: boolean;
  affects_other_participants: boolean;
};

export type ErasureProposedAction = {
  category: string;
  target_type: string;
  count: number;
  requires_manual_review: boolean;
  reason_code: string;
};

export type ErasureImpactReportSuccess = {
  ok: true;
  generated_at: string;
  report_version: number;
  subject_user_id: string;
  subject: {
    user_exists: boolean;
    has_auth_identity: boolean;
    has_profile: boolean;
    account_type: string | null;
    email_verified: boolean;
  };
  direct_personal_data: Record<string, number>;
  email_correlated_records: Record<string, number | string>;
  property_relationships: ErasurePropertyRelationship[];
  shared_transaction_dependencies: {
    has_active_shared_transaction: boolean;
    sole_participant_property_count: number;
    sole_participant_property_ids: number[];
    requires_partial_erasure: boolean;
  };
  estate_agent_relationships: Record<string, unknown>;
  invitations_and_claims: Record<string, number>;
  communications: Record<string, unknown>;
  audit_and_history: Record<string, unknown>;
  analytics: Record<string, unknown>;
  jsonb_unknown_pii: Record<string, unknown>;
  external_processor_actions: Record<string, boolean>;
  risk_flags: string[];
  proposed_actions: ErasureProposedAction[];
  execution_readiness: {
    ready_for_auto_execution: boolean;
    requires_manual_review: boolean;
    blocking_reasons: string[];
  };
  read_only_guarantee: {
    mutations_performed: false;
    scope: string;
    note: string;
  };
};

export type ErasureImpactReport =
  | ErasureImpactReportSuccess
  | ErasureImpactReportError;

export type ErasureRequestSource =
  | "admin_manual"
  | "privacy_email"
  | "internal_dev_fixture"
  | "support_ticket";

export type ErasureRequestStatus =
  | "requested"
  | "identity_verified"
  | "scope_assessed"
  | "awaiting_approval"
  | "approved"
  | "processing"
  | "database_processed"
  | "awaiting_external_processors"
  | "awaiting_auth_deletion"
  | "partially_completed"
  | "completed"
  | "rejected"
  | "manual_review_required"
  | "failed";

export type GdprRpcResult = {
  ok: boolean;
  error?: string;
  request_id?: string;
  status?: ErasureRequestStatus | string;
  [key: string]: unknown;
};

export type ErasureExecutionResult = GdprRpcResult & {
  actions?: {
    completed: number;
    skipped_idempotent: number;
    blocked: number;
    failed: number;
    pending_external: number;
  };
  blocking_reasons?: string[];
  next_required_steps?: string[];
};
