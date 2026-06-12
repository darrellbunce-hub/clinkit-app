export const ACCOUNT_TYPES = [
  "homeowner",
  "estate_agent",
  "solicitor",
] as const;

export type AccountType =
  (typeof ACCOUNT_TYPES)[number];

export const EA_BRANCH_MEMBER_ROLES = [
  "branch_admin",
  "agent",
] as const;

export type EaBranchMemberRole =
  (typeof EA_BRANCH_MEMBER_ROLES)[number];

/** Extended profile fields for platform account routing. Legacy `role` remains on the row until deprecation. */
export type ProfileAccountFields = {
  account_type: AccountType;
  contact_name: string | null;
  onboarding_completed_at: string | null;
  email_domain: string | null;
};

export type EaCompany = {
  id: string;
  name: string;
  email_domain: string;
  created_by_user_id: string;
  stripe_customer_id: string | null;
  created_at: string;
  updated_at: string;
};

export type EaBranch = {
  id: string;
  company_id: string;
  name: string;
  town_or_city: string;
  postcode: string;
  region_code: string;
  is_head_office: boolean;
  created_at: string;
  updated_at: string;
};

export type EaBranchMember = {
  id: string;
  branch_id: string;
  user_id: string;
  role: EaBranchMemberRole;
  joined_at: string;
};

export type EaCompanyInsert = Pick<
  EaCompany,
  "name" | "email_domain" | "created_by_user_id"
>;

export type EaBranchInsert = Pick<
  EaBranch,
  | "company_id"
  | "name"
  | "town_or_city"
  | "postcode"
  | "region_code"
  | "is_head_office"
>;

export type EaBranchMemberInsert = Pick<
  EaBranchMember,
  "branch_id" | "user_id" | "role"
>;

export function isAccountType(
  value: string
): value is AccountType {
  return (
    ACCOUNT_TYPES as readonly string[]
  ).includes(value);
}

export function isEaBranchMemberRole(
  value: string
): value is EaBranchMemberRole {
  return (
    EA_BRANCH_MEMBER_ROLES as readonly string[]
  ).includes(value);
}

export {
  isEstateAgent as isEstateAgentAccount,
  isEstateAgentOnboardingComplete,
} from "@/lib/accountType";
