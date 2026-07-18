import { notFound, redirect } from "next/navigation";

import PrivacyAdminShell from "@/components/privacyAdmin/PrivacyAdminShell";
import { getPrivilegedPlatformAdminSession } from "@/lib/auth/platformAdmin";
import {
  evaluatePlatformAdminAccess,
  isPrivilegedPlatformAdminAccess,
} from "@/lib/auth/platformAdminAccess";
import {
  buildAdminMfaChallengePath,
  buildAdminMfaEnrollPath,
} from "@/lib/auth/safeAdminRedirect";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export default async function PrivacyAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createServerSupabaseClient();
  const access = await evaluatePlatformAdminAccess(supabase);

  if (access.kind === "forbidden" || access.kind === "unauthenticated") {
    notFound();
  }

  if (access.kind === "mfa_enrollment_required") {
    redirect(buildAdminMfaEnrollPath("/admin/privacy"));
  }

  if (access.kind === "mfa_challenge_required") {
    redirect(buildAdminMfaChallengePath("/admin/privacy"));
  }

  const session = await getPrivilegedPlatformAdminSession();
  if (!session || !isPrivilegedPlatformAdminAccess(access)) {
    notFound();
  }

  return <PrivacyAdminShell>{children}</PrivacyAdminShell>;
}
