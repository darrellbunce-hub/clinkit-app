import { redirect } from "next/navigation";

import PlatformAdminMfaEnrollPanel from "@/components/privacyAdmin/PlatformAdminMfaEnrollPanel";
import {
  evaluatePlatformAdminAccess,
  isPrivilegedPlatformAdminAccess,
  requiresMfaEnrollment,
} from "@/lib/auth/platformAdminAccess";
import { sanitizeAdminNextPath } from "@/lib/auth/safeAdminRedirect";
import { createServerSupabaseClient } from "@/lib/supabase/server";

type PlatformAdminMfaEnrollPageProps = {
  searchParams: Promise<{ next?: string }>;
};

export default async function PlatformAdminMfaEnrollPage({
  searchParams,
}: PlatformAdminMfaEnrollPageProps) {
  const params = await searchParams;
  const nextPath = sanitizeAdminNextPath(params.next);
  const supabase = await createServerSupabaseClient();
  const access = await evaluatePlatformAdminAccess(supabase);

  if (isPrivilegedPlatformAdminAccess(access)) {
    redirect(nextPath ?? "/admin/privacy");
  }

  if (!requiresMfaEnrollment(access)) {
    redirect("/admin/mfa/challenge");
  }

  return (
    <PlatformAdminMfaEnrollPanel
      nextPath={nextPath}
      abandonedFactorCount={access.unverifiedFactorIds.length}
    />
  );
}
