import type { AccountType } from "@/lib/accountType";
import type { ProfileAccountFields } from "@/lib/estateAgent/types";

const ACCOUNT_TYPE_LABELS: Record<
  AccountType,
  string
> = {
  homeowner: "Homeowner",
  estate_agent: "Estate Agent",
  solicitor: "Solicitor",
};

export function formatAccountTypeLabel(
  accountType: AccountType
): string {
  return ACCOUNT_TYPE_LABELS[accountType];
}

export function resolveDisplayName(
  profile: Pick<
    ProfileAccountFields,
    "contact_name"
  >,
  email: string | null | undefined
): string {
  if (profile.contact_name?.trim()) {
    return profile.contact_name.trim();
  }

  if (email?.includes("@")) {
    return email.split("@")[0] ?? "Not set";
  }

  return "Not set";
}
