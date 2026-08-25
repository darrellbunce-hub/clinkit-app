import type { SupabaseClient } from "@supabase/supabase-js";

import type { PrivacyAdminActionResult } from "@/lib/privacyAdmin/types";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function lookupSubjectUserIdByExactEmail(params: {
  service: SupabaseClient;
  email: string;
}): Promise<
  PrivacyAdminActionResult<{ subjectUserId: string }> | { ok: true; subjectUserId: null }
> {
  const normalizedEmail = params.email.trim().toLowerCase();

  if (!EMAIL_PATTERN.test(normalizedEmail)) {
    return { ok: false, error: "invalid_input", message: "invalid_email_format" };
  }

  const { data, error } = await params.service.rpc(
    "lookup_auth_user_id_by_exact_email",
    { p_email: normalizedEmail }
  );

  if (error) {
    if (error.message.includes("lookup_auth_user_id_by_exact_email")) {
      return { ok: false, error: "backend_error", message: "subject_lookup_unavailable" };
    }
    return { ok: false, error: "backend_error", message: "subject_lookup_failed" };
  }

  if (!data) {
    return { ok: true, subjectUserId: null };
  }

  return { ok: true, subjectUserId: String(data) };
}
