import type { SupabaseClient, User } from "@supabase/supabase-js";

import {
  getAccountType,
  isEstateAgentOnboardingComplete,
  requiresEstateAgentOnboarding,
  type AccountType,
} from "@/lib/accountType";
import type { ProfileAccountFields } from "@/lib/estateAgent/types";

export type CurrentUserContext = {
  user: User;
  profile: ProfileAccountFields;
  accountType: AccountType;
  requiresEstateAgentOnboarding: boolean;
  isEstateAgentOnboardingComplete: boolean;
};

const PROFILE_ACCOUNT_FIELDS =
  "account_type, contact_name, onboarding_completed_at, email_domain";

export function buildCurrentUserContext(
  user: User,
  profile: ProfileAccountFields
): CurrentUserContext {
  const accountType =
    getAccountType(profile);

  return {
    user,
    profile: {
      ...profile,
      account_type: accountType,
    },
    accountType,
    requiresEstateAgentOnboarding:
      requiresEstateAgentOnboarding(profile),
    isEstateAgentOnboardingComplete:
      isEstateAgentOnboardingComplete(profile),
  };
}

/** Used when auth succeeds but profiles row is missing (legacy accounts). */
export function buildFallbackHomeownerContext(
  user: User
): CurrentUserContext {
  return buildCurrentUserContext(user, {
    account_type: "homeowner",
    contact_name: null,
    onboarding_completed_at: null,
    email_domain: null,
  });
}

export async function fetchProfileAccountFields(
  supabase: SupabaseClient,
  userId: string
): Promise<ProfileAccountFields | null> {
  const { data, error } =
    await supabase
      .from("profiles")
      .select(PROFILE_ACCOUNT_FIELDS)
      .eq("id", userId)
      .maybeSingle();

  if (error || !data) {
    return null;
  }

  return {
    account_type: getAccountType(data),
    contact_name: data.contact_name ?? null,
    onboarding_completed_at:
      data.onboarding_completed_at ?? null,
    email_domain: data.email_domain ?? null,
  };
}

export async function fetchCurrentUserContextFromUser(
  supabase: SupabaseClient,
  user: User
): Promise<CurrentUserContext | null> {
  const profile =
    await fetchProfileAccountFields(
      supabase,
      user.id
    );

  if (!profile) {
    return null;
  }

  return buildCurrentUserContext(
    user,
    profile
  );
}

export async function fetchCurrentUserContext(
  supabase: SupabaseClient
): Promise<CurrentUserContext | null> {
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return null;
  }

  return fetchCurrentUserContextFromUser(
    supabase,
    user
  );
}
