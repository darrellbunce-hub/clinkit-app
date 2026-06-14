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
};

export type AgentDashboardTab = "active" | "archived";
