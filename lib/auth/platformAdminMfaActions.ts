"use server";

import { redirect } from "next/navigation";

import {
  evaluatePlatformAdminAccess,
  isPrivilegedPlatformAdminAccess,
  requiresMfaEnrollment,
} from "@/lib/auth/platformAdminAccess";
import { partitionTotpFactorsFromMfaList } from "@/lib/auth/platformAdminMfaCore";
import { requirePlatformAdminMembershipSession } from "@/lib/auth/platformAdmin";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export type PlatformAdminMfaActionResult<T = Record<string, unknown>> =
  | ({ ok: true } & T)
  | { ok: false; error: string; message?: string };

async function requirePlatformAdminMfaMembership(): Promise<
  | { ok: true; supabase: Awaited<ReturnType<typeof createServerSupabaseClient>> }
  | { ok: false; error: string }
> {
  const gate = await requirePlatformAdminMembershipSession();
  if (!gate.ok) {
    return { ok: false, error: gate.error };
  }

  return { ok: true, supabase: await createServerSupabaseClient() };
}

export async function getPlatformAdminMfaStatusAction(): Promise<
  PlatformAdminMfaActionResult<{
    hasVerifiedTotp: boolean;
    verifiedFactorId: string | null;
    assuranceLevel: string | null;
    nextAssuranceLevel: string | null;
    unverifiedFactorCount: number;
  }>
> {
  const gate = await requirePlatformAdminMfaMembership();
  if (!gate.ok) {
    return gate;
  }

  const access = await evaluatePlatformAdminAccess(gate.supabase);
  const { data: assurance } =
    await gate.supabase.auth.mfa.getAuthenticatorAssuranceLevel();

  if (requiresMfaEnrollment(access)) {
    return {
      ok: true,
      hasVerifiedTotp: false,
      verifiedFactorId: null,
      assuranceLevel: assurance?.currentLevel ?? null,
      nextAssuranceLevel: assurance?.nextLevel ?? null,
      unverifiedFactorCount: access.unverifiedFactorIds.length,
    };
  }

  if (access.kind === "mfa_challenge_required") {
    return {
      ok: true,
      hasVerifiedTotp: true,
      verifiedFactorId: access.verifiedFactorId,
      assuranceLevel: assurance?.currentLevel ?? null,
      nextAssuranceLevel: assurance?.nextLevel ?? null,
      unverifiedFactorCount: 0,
    };
  }

  return {
    ok: true,
    hasVerifiedTotp: true,
    verifiedFactorId: null,
    assuranceLevel: assurance?.currentLevel ?? "aal2",
    nextAssuranceLevel: assurance?.nextLevel ?? null,
    unverifiedFactorCount: 0,
  };
}

export async function unenrollPlatformAdminMfaFactorAction(input: {
  factorId: string;
}): Promise<PlatformAdminMfaActionResult> {
  const supabase = await createServerSupabaseClient();
  const access = await evaluatePlatformAdminAccess(supabase);

  if (!isPrivilegedPlatformAdminAccess(access)) {
    return { ok: false, error: "mfa_required", message: access.kind };
  }

  const { data: factors, error: listError } = await supabase.auth.mfa.listFactors();
  if (listError) {
    return { ok: false, error: "list_failed", message: "list_failed" };
  }

  const { verifiedTotpFactorId } = partitionTotpFactorsFromMfaList(factors);
  if (!verifiedTotpFactorId || verifiedTotpFactorId !== input.factorId) {
    return { ok: false, error: "invalid_factor", message: "invalid_factor" };
  }

  const { error: unenrollError } = await supabase.auth.mfa.unenroll({
    factorId: input.factorId,
  });

  if (unenrollError) {
    return { ok: false, error: "unenroll_failed", message: "unenroll_failed" };
  }

  redirect("/admin/mfa/enroll");
}
