import "server-only";

import { createServerSupabaseClient } from "@/lib/supabase/server";

import {
  evaluatePlatformAdminAccess,
  isPrivilegedPlatformAdminAccess,
} from "@/lib/auth/platformAdminAccess";
import {
  isPlatformAdminUserId,
  type PlatformAdminSession,
} from "@/lib/auth/platformAdminCore";

export type { PlatformAdminSession } from "@/lib/auth/platformAdminCore";
export { isPlatformAdminUserId } from "@/lib/auth/platformAdminCore";

/** Platform-admin membership only (AAL1 allowed). For MFA setup/challenge pages. */
export async function getPlatformAdminMembershipSession(): Promise<PlatformAdminSession | null> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  const isAdmin = await isPlatformAdminUserId(user.id);
  if (!isAdmin) {
    return null;
  }

  return { userId: user.id };
}

/** @deprecated Use getPlatformAdminMembershipSession or getPrivilegedPlatformAdminSession explicitly. */
export async function getPlatformAdminSession(): Promise<PlatformAdminSession | null> {
  return getPrivilegedPlatformAdminSession();
}

/** Requires platform-admin membership and verified AAL2 session. */
export async function getPrivilegedPlatformAdminSession(): Promise<PlatformAdminSession | null> {
  const supabase = await createServerSupabaseClient();
  const access = await evaluatePlatformAdminAccess(supabase);

  if (!isPrivilegedPlatformAdminAccess(access)) {
    return null;
  }

  return { userId: access.userId };
}

export async function requirePlatformAdminMembershipSession(): Promise<
  | { ok: true; session: PlatformAdminSession }
  | { ok: false; error: "unauthenticated" | "forbidden" }
> {
  const session = await getPlatformAdminMembershipSession();
  if (!session) {
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { ok: false, error: "unauthenticated" };
    }

    return { ok: false, error: "forbidden" };
  }

  return { ok: true, session };
}

export async function requirePrivilegedPlatformAdminSession(): Promise<
  | { ok: true; session: PlatformAdminSession }
  | {
      ok: false;
      error: "unauthenticated" | "forbidden" | "mfa_enrollment_required" | "mfa_challenge_required";
    }
> {
  const supabase = await createServerSupabaseClient();
  const access = await evaluatePlatformAdminAccess(supabase);

  switch (access.kind) {
    case "unauthenticated":
      return { ok: false, error: "unauthenticated" };
    case "forbidden":
      return { ok: false, error: "forbidden" };
    case "mfa_enrollment_required":
      return { ok: false, error: "mfa_enrollment_required" };
    case "mfa_challenge_required":
      return { ok: false, error: "mfa_challenge_required" };
    case "privileged_allowed":
      return { ok: true, session: { userId: access.userId } };
  }
}

/** @deprecated Use requirePrivilegedPlatformAdminSession for privileged operations. */
export async function requirePlatformAdminSession(): Promise<
  | { ok: true; session: PlatformAdminSession }
  | { ok: false; error: "unauthenticated" | "forbidden" }
> {
  const gate = await requirePrivilegedPlatformAdminSession();
  if (!gate.ok) {
    if (
      gate.error === "mfa_enrollment_required" ||
      gate.error === "mfa_challenge_required"
    ) {
      return { ok: false, error: "forbidden" };
    }
    return { ok: false, error: gate.error };
  }
  return gate;
}
