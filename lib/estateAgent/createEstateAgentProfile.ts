import type { SupabaseClient } from "@supabase/supabase-js";

import { validateBusinessEmail } from "@/lib/businessEmail";

export type CreateEstateAgentProfileInput = {
  /** Must match the authenticated user; rejected if it differs from auth.uid(). */
  userId: string;
  contactName: string;
  email: string;
};

export async function createEstateAgentProfile(
  supabase: SupabaseClient,
  input: CreateEstateAgentProfileInput
): Promise<{ error: string | null }> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      error: "not_authenticated",
    };
  }

  if (input.userId !== user.id) {
    return {
      error: "profile_user_mismatch",
    };
  }

  const emailValidation = validateBusinessEmail(input.email);

  if (!emailValidation.valid) {
    return {
      error: emailValidation.message,
    };
  }

  const trimmedContactName = input.contactName.trim();

  if (trimmedContactName.length < 2) {
    return {
      error: "Enter your contact name to continue.",
    };
  }

  const { data: existing, error: existingError } = await supabase
    .from("profiles")
    .select("id, account_type, onboarding_completed_at, contact_name")
    .eq("id", user.id)
    .maybeSingle();

  if (existingError) {
    return {
      error: existingError.message,
    };
  }

  if (existing?.account_type === "estate_agent") {
    return { error: null };
  }

  const { error } = await supabase.from("profiles").upsert(
    {
      id: user.id,
      role: "homeowner",
      account_type: "estate_agent",
      contact_name: trimmedContactName,
      email_domain: emailValidation.domain,
      onboarding_completed_at:
        existing?.onboarding_completed_at ?? null,
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
