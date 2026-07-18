import type { SupabaseClient } from "@supabase/supabase-js";

import { isPlatformAdminUserId } from "@/lib/auth/platformAdminCore";
import {
  resolvePlatformAdminAccess,
  type PlatformAdminAccessState,
} from "@/lib/auth/platformAdminAccessCore";
import { partitionTotpFactorsFromMfaList } from "@/lib/auth/platformAdminMfaCore";

export type { PlatformAdminAccessState } from "@/lib/auth/platformAdminAccessCore";
export {
  isPrivilegedPlatformAdminAccess,
  requiresMfaChallenge,
  requiresMfaEnrollment,
  resolvePlatformAdminAccess,
  type PlatformAdminAccessSignals,
} from "@/lib/auth/platformAdminAccessCore";

export async function evaluatePlatformAdminAccess(
  supabase: SupabaseClient
): Promise<PlatformAdminAccessState> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { kind: "unauthenticated" };
  }

  const isPlatformAdmin = await isPlatformAdminUserId(user.id);
  if (!isPlatformAdmin) {
    return { kind: "forbidden" };
  }

  const { data: assurance, error: assuranceError } =
    await supabase.auth.mfa.getAuthenticatorAssuranceLevel();

  if (assuranceError) {
    throw new Error(assuranceError.message);
  }

  const { data: factors, error: factorsError } =
    await supabase.auth.mfa.listFactors();

  if (factorsError) {
    throw new Error(factorsError.message);
  }

  const { verifiedTotpFactorId, unverifiedTotpFactorIds } =
    partitionTotpFactorsFromMfaList(factors);

  return resolvePlatformAdminAccess({
    userId: user.id,
    isPlatformAdmin: true,
    currentLevel: (assurance?.currentLevel as "aal1" | "aal2" | null) ?? null,
    nextLevel: (assurance?.nextLevel as "aal1" | "aal2" | null) ?? null,
    verifiedTotpFactorId,
    unverifiedTotpFactorIds,
  });
}
