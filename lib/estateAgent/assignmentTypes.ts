export const PROPERTY_EA_ASSIGNMENT_STATUSES = [
  "pending",
  "active",
  "declined",
  "revoked",
] as const;

export type PropertyEaAssignmentStatus =
  (typeof PROPERTY_EA_ASSIGNMENT_STATUSES)[number];

export type PropertyEaAssignment = {
  id: string;
  property_id: number;
  branch_id: string;
  status: PropertyEaAssignmentStatus;
  homeowner_only_updates: boolean;
  assigned_at: string;
  assigned_by_user_id: string;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
};

export type EaBranchDirectoryEntry = {
  branch_id: string;
  branch_name: string;
  town_or_city: string;
  postcode: string;
  company_id: string;
  company_name: string;
};

export type AgentBranchPropertySummary = {
  assignment_id: string;
  property_id: number;
  branch_id: string;
  assignment_status: PropertyEaAssignmentStatus;
  homeowner_only_updates: boolean;
  assigned_at: string;
  chain_id: number;
  address: string | null;
  postcode: string | null;
  stage: string;
  property_status: string;
  completion_lifecycle_status: string | null;
  completion_scheduled_date: string | null;
  completed_at: string | null;
  needs_attention?: boolean | null;
  stale_update?: boolean | null;
  days_since_last_update?: number | null;
  operational_alerts?:
    | {
        code: string;
        severity: string;
      }[]
    | null;
  next_recommended_action?: {
    code: string;
    severity: string;
  } | null;
  confidence_score?: number | null;
  health_status?: string | null;
  claim_status?: string | null;
  origin_type?: string | null;
  invitation_lifecycle_status?:
    | "claimed"
    | "awaiting_claim"
    | "invitation_active"
    | "invitation_expired"
    | "invitation_deferred"
    | null;
  invitation_expires_at?: string | null;
  invitation_version?: number | null;
};

export type AgentDashboardTab = "active" | "archived";
