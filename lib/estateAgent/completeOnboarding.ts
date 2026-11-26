import type { SupabaseClient } from "@supabase/supabase-js";

import {
  deriveRegionCodeFromPostcode,
  isValidUkPostcode,
  normalizeUkPostcode,
} from "@/lib/ukRegionFromPostcode";

export type CompleteEstateAgentOnboardingInput = {
  userId: string;
  companyName: string;
  branchName: string;
  townOrCity: string;
  postcode: string;
  isHeadOffice: boolean;
  emailDomain: string;
};

export type EstateAgentOnboardingSummary = {
  companyName: string;
  branchName: string;
  townOrCity: string;
  postcode: string;
  /** First branch id — used to start Stripe Checkout after onboarding. */
  branchId: string;
};

export type CompleteEstateAgentOnboardingResult =
  | {
      success: true;
      summary: EstateAgentOnboardingSummary;
    }
  | { success: false; error: string };

type CompleteEstateAgentOnboardingRpc = {
  ok?: boolean;
  error?: string;
  branch_id?: string;
  company_name?: string;
  branch_name?: string;
  town_or_city?: string;
  postcode?: string;
};

const DOMAIN_ALREADY_REGISTERED_MESSAGE =
  "An agency with this email domain is already registered. Ask a branch owner at that agency to invite you to their branch.";

export function mapCompleteEstateAgentOnboardingError(
  code: string | null | undefined
): string {
  switch (code) {
    case "not_authenticated":
      return "Please log in to finish setting up your agency.";
    case "profile_required":
    case "estate_agent_account_required":
      return "Your estate agent profile is missing. Sign out and sign up again with a business email.";
    case "email_domain_required":
      return "Your business email domain is missing from your profile. Sign out and sign up again with a business email.";
    case "invalid_company_name":
      return "Enter your company name to continue.";
    case "invalid_branch_name":
      return "Enter a branch name to continue.";
    case "invalid_town_or_city":
      return "Enter the branch town or city to continue.";
    case "invalid_postcode":
      return "Enter a valid UK postcode for this branch.";
    case "domain_already_registered":
      return DOMAIN_ALREADY_REGISTERED_MESSAGE;
    case "profile_update_failed":
      return "We could not finish onboarding. Nothing was saved, so you can try again.";
    default:
      return "Could not complete onboarding. Try again.";
  }
}

/**
 * Map a raised RPC exception. profile_update_failed aborts the transaction,
 * so the user-facing copy must not say onboarding records were kept.
 */
export function mapCompleteEstateAgentOnboardingTransportError(
  message: string | null | undefined
): string {
  const text = message?.trim() ?? "";

  if (text.includes("profile_update_failed")) {
    return mapCompleteEstateAgentOnboardingError(
      "profile_update_failed"
    );
  }

  return text || "Could not complete onboarding. Try again.";
}

/**
 * Completes founder company/branch onboarding via an atomic RPC.
 * Domain ownership is taken from profiles.email_domain server-side.
 */
export async function completeEstateAgentOnboarding(
  supabase: SupabaseClient,
  input: CompleteEstateAgentOnboardingInput
): Promise<CompleteEstateAgentOnboardingResult> {
  const companyName =
    input.companyName.trim();
  const branchName =
    input.branchName.trim();
  const townOrCity =
    input.townOrCity.trim();
  const postcode =
    normalizeUkPostcode(input.postcode);
  const emailDomain =
    input.emailDomain.trim().toLowerCase();

  if (companyName.length < 2) {
    return {
      success: false,
      error:
        "Enter your company name to continue.",
    };
  }

  if (branchName.length < 2) {
    return {
      success: false,
      error:
        "Enter a branch name to continue.",
    };
  }

  if (townOrCity.length < 2) {
    return {
      success: false,
      error:
        "Enter the branch town or city to continue.",
    };
  }

  if (!isValidUkPostcode(postcode)) {
    return {
      success: false,
      error:
        "Enter a valid UK postcode for this branch.",
    };
  }

  if (!emailDomain) {
    return {
      success: false,
      error:
        "Your business email domain is missing from your profile. Sign out and sign up again with a business email.",
    };
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || user.id !== input.userId) {
    return {
      success: false,
      error: mapCompleteEstateAgentOnboardingError("not_authenticated"),
    };
  }

  const regionCode =
    deriveRegionCodeFromPostcode(postcode);

  // Profile-update failure raises and rolls back. A later retry is a new
  // attempt: fresh insert, or resume only when a previously committed
  // incomplete company still belongs to this user.
  const { data, error } = await supabase.rpc(
    "complete_estate_agent_onboarding",
    {
      p_company_name: companyName,
      p_branch_name: branchName,
      p_town_or_city: townOrCity,
      p_postcode: postcode,
      p_is_head_office: input.isHeadOffice,
      p_region_code: regionCode,
    }
  );

  if (error) {
    return {
      success: false,
      error: mapCompleteEstateAgentOnboardingTransportError(
        error.message
      ),
    };
  }

  const result = data as CompleteEstateAgentOnboardingRpc | null;

  if (!result?.ok) {
    return {
      success: false,
      error: mapCompleteEstateAgentOnboardingError(result?.error),
    };
  }

  if (!result.branch_id) {
    return {
      success: false,
      error: "Could not complete onboarding. Try again.",
    };
  }

  return {
    success: true,
    summary: {
      companyName: result.company_name ?? companyName,
      branchName: result.branch_name ?? branchName,
      townOrCity: result.town_or_city ?? townOrCity,
      postcode: result.postcode ?? postcode,
      branchId: result.branch_id,
    },
  };
}
