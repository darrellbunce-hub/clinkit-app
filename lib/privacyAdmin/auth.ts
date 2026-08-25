import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  evaluatePlatformAdminAccess,
} from "@/lib/auth/platformAdminAccess";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/serviceRole";
import type { PrivacyAdminActionResult } from "@/lib/privacyAdmin/types";

export type PrivacyAdminContext = {
  adminUserId: string;
  service: ReturnType<typeof createServiceRoleSupabaseClient>;
};

/**
 * Central privileged boundary for Privacy Admin server actions.
 * Requires authenticated platform admin with live AAL2 session.
 */
export async function requirePrivacyAdminContext(): Promise<
  PrivacyAdminActionResult<PrivacyAdminContext>
> {
  const supabase = await createServerSupabaseClient();
  const access = await evaluatePlatformAdminAccess(supabase);

  if (access.kind === "unauthenticated") {
    return { ok: false, error: "unauthenticated" };
  }
  if (access.kind === "forbidden") {
    return { ok: false, error: "forbidden" };
  }
  if (
    access.kind === "mfa_enrollment_required" ||
    access.kind === "mfa_challenge_required"
  ) {
    return { ok: false, error: "mfa_required", message: access.kind };
  }

  return {
    ok: true,
    adminUserId: access.userId,
    service: createServiceRoleSupabaseClient(),
  };
}

/** Re-evaluates assurance on every call — do not cache AAL state from page render. */
export async function assertPrivacyAdminContextForRead(): Promise<
  PrivacyAdminActionResult<{ adminUserId: string }>
> {
  const supabase = await createServerSupabaseClient();
  const access = await evaluatePlatformAdminAccess(supabase);

  if (access.kind === "unauthenticated") {
    return { ok: false, error: "unauthenticated" };
  }
  if (access.kind === "forbidden") {
    return { ok: false, error: "forbidden" };
  }
  if (
    access.kind === "mfa_enrollment_required" ||
    access.kind === "mfa_challenge_required"
  ) {
    return { ok: false, error: "mfa_required", message: access.kind };
  }

  return { ok: true, adminUserId: access.userId };
}
