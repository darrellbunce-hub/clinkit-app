import {
  ACCOUNT_TYPES,
  type AccountType,
  type ProfileAccountFields,
} from "@/lib/estateAgent/types";

export type { AccountType };

export const DEFAULT_ACCOUNT_TYPE: AccountType =
  "homeowner";

export function getAccountType(
  profile:
    | Pick<
        ProfileAccountFields,
        "account_type"
      >
    | null
    | undefined
): AccountType {
  if (
    profile?.account_type &&
    isKnownAccountType(profile.account_type)
  ) {
    return profile.account_type;
  }

  return DEFAULT_ACCOUNT_TYPE;
}

export function isKnownAccountType(
  value: string
): value is AccountType {
  return (
    ACCOUNT_TYPES as readonly string[]
  ).includes(value);
}

export function isHomeowner(
  profile:
    | Pick<
        ProfileAccountFields,
        "account_type"
      >
    | null
    | undefined
): boolean {
  return (
    getAccountType(profile) === "homeowner"
  );
}

export function isEstateAgent(
  profile:
    | Pick<
        ProfileAccountFields,
        "account_type"
      >
    | null
    | undefined
): boolean {
  return (
    getAccountType(profile) === "estate_agent"
  );
}

export function isSolicitor(
  profile:
    | Pick<
        ProfileAccountFields,
        "account_type"
      >
    | null
    | undefined
): boolean {
  return (
    getAccountType(profile) === "solicitor"
  );
}

export function isEstateAgentOnboardingComplete(
  profile:
    | Pick<
        ProfileAccountFields,
        "account_type" | "onboarding_completed_at"
      >
    | null
    | undefined
): boolean {
  return (
    isEstateAgent(profile) &&
    profile?.onboarding_completed_at != null
  );
}

export function requiresEstateAgentOnboarding(
  profile:
    | Pick<
        ProfileAccountFields,
        "account_type" | "onboarding_completed_at"
      >
    | null
    | undefined
): boolean {
  return (
    isEstateAgent(profile) &&
    !isEstateAgentOnboardingComplete(profile)
  );
}
