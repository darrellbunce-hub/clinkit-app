import { redirect } from "next/navigation";

import PlatformAdminMfaChallengePanel from "@/components/privacyAdmin/PlatformAdminMfaChallengePanel";
import {
  evaluatePlatformAdminAccess,
  isPrivilegedPlatformAdminAccess,
  requiresMfaChallenge,
  requiresMfaEnrollment,
} from "@/lib/auth/platformAdminAccess";
import { sanitizeAdminNextPath } from "@/lib/auth/safeAdminRedirect";
import { createServerSupabaseClient } from "@/lib/supabase/server";

type PlatformAdminMfaChallengePageProps = {
  searchParams: Promise<{ next?: string }>;
};

export default async function PlatformAdminMfaChallengePage({
  searchParams,
}: PlatformAdminMfaChallengePageProps) {
  const params = await searchParams;
  const nextPath = sanitizeAdminNextPath(params.next);
  const supabase = await createServerSupabaseClient();
  const access = await evaluatePlatformAdminAccess(supabase);

  if (isPrivilegedPlatformAdminAccess(access)) {
    redirect(nextPath ?? "/admin/privacy");
  }

  if (requiresMfaEnrollment(access)) {
    redirect("/admin/mfa/enroll");
  }

  if (!requiresMfaChallenge(access)) {
    redirect("/admin/privacy");
  }

  return (
    <PlatformAdminMfaChallengePanel
      factorId={access.verifiedFactorId}
      nextPath={nextPath}
    />
  );
}
