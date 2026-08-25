import { createServiceRoleSupabaseClient } from "@/lib/supabase/serviceRole";

export type PlatformAdminSession = {
  userId: string;
};

function parseEnvPlatformAdminUserIds(): Set<string> {
  const raw = process.env.PLATFORM_ADMIN_USER_IDS?.trim();
  if (!raw) {
    return new Set();
  }

  return new Set(
    raw
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
  );
}

/**
 * Checks explicit platform-admin authority via DB allowlist, with optional
 * Development bootstrap IDs from PLATFORM_ADMIN_USER_IDS (comma-separated UUIDs).
 */
export async function isPlatformAdminUserId(userId: string): Promise<boolean> {
  if (!userId) {
    return false;
  }

  if (parseEnvPlatformAdminUserIds().has(userId)) {
    return true;
  }

  const service = createServiceRoleSupabaseClient();
  const { data, error } = await service.rpc("is_platform_admin", {
    p_user_id: userId,
  });

  if (error) {
    if (
      error.message.includes("is_platform_admin") ||
      error.message.includes("platform_admins")
    ) {
      return parseEnvPlatformAdminUserIds().has(userId);
    }
    throw new Error(error.message);
  }

  return data === true;
}

export async function grantPlatformAdminForVerification(params: {
  userId: string;
  reasonCode?: "verification_fixture" | "manual_bootstrap";
}): Promise<void> {
  const service = createServiceRoleSupabaseClient();
  const { error } = await service.from("platform_admins").upsert(
    {
      user_id: params.userId,
      grant_reason_code: params.reasonCode ?? "verification_fixture",
    },
    { onConflict: "user_id" }
  );

  if (error) {
    throw new Error(error.message);
  }
}
