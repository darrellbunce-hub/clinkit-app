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
};

export type CompleteEstateAgentOnboardingResult =
  | {
      success: true;
      summary: EstateAgentOnboardingSummary;
    }
  | { success: false; error: string };

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

  const regionCode =
    deriveRegionCodeFromPostcode(postcode);

  const {
    data: company,
    error: companyError,
  } = await supabase
    .from("ea_companies")
    .insert({
      name: companyName,
      email_domain: emailDomain,
      created_by_user_id: input.userId,
    })
    .select("id")
    .single();

  if (companyError || !company) {
    if (companyError?.code === "23505") {
      return {
        success: false,
        error:
          "An agency with this email domain is already registered. Contact support if you need access.",
      };
    }

    return {
      success: false,
      error:
        companyError?.message ??
        "Could not create your company.",
    };
  }

  const {
    data: branch,
    error: branchError,
  } = await supabase
    .from("ea_branches")
    .insert({
      company_id: company.id,
      name: branchName,
      town_or_city: townOrCity,
      postcode,
      region_code: regionCode,
      is_head_office: input.isHeadOffice,
    })
    .select("id")
    .single();

  if (branchError || !branch) {
    return {
      success: false,
      error:
        branchError?.message ??
        "Could not create your first branch.",
    };
  }

  const { error: membershipError } =
    await supabase
      .from("ea_branch_members")
      .insert({
        branch_id: branch.id,
        user_id: input.userId,
        role: "branch_admin",
      });

  if (membershipError) {
    return {
      success: false,
      error: membershipError.message,
    };
  }

  const completedAt =
    new Date().toISOString();

  const { error: profileError } =
    await supabase
      .from("profiles")
      .update({
        onboarding_completed_at: completedAt,
      })
      .eq("id", input.userId)
      .eq("account_type", "estate_agent");

  if (profileError) {
    return {
      success: false,
      error: profileError.message,
    };
  }

  return {
    success: true,
    summary: {
      companyName,
      branchName,
      townOrCity,
      postcode,
    },
  };
}
