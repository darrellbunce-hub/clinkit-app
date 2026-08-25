import type { SupabaseClient } from "@supabase/supabase-js";

import { validateBusinessEmail } from "@/lib/businessEmail";

export type CreateEstateAgentProfileInput = {
  userId: string;
  contactName: string;
  email: string;
};

export async function createEstateAgentProfile(
  supabase: SupabaseClient,
  input: CreateEstateAgentProfileInput
): Promise<{ error: string | null }> {
  const emailValidation =
    validateBusinessEmail(input.email);

  if (!emailValidation.valid) {
    return {
      error: emailValidation.message,
    };
  }

  const trimmedContactName =
    input.contactName.trim();

  if (trimmedContactName.length < 2) {
    return {
      error:
        "Enter your contact name to continue.",
    };
  }

  const { error } = await supabase
    .from("profiles")
    .upsert(
      {
        id: input.userId,
        role: "homeowner",
        account_type: "estate_agent",
        contact_name: trimmedContactName,
        email_domain: emailValidation.domain,
        onboarding_completed_at: null,
      },
      { onConflict: "id" }
    );

  if (error) {
    return {
      error: error.message,
    };
  }

  return { error: null };
}
