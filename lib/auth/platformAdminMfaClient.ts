"use client";

import {
  buildTotpEnrollPresentation,
  partitionTotpFactorsFromMfaList,
} from "@/lib/auth/platformAdminMfaCore";
import { sanitizeAdminNextPath } from "@/lib/auth/safeAdminRedirect";
import { supabase } from "@/lib/supabase";

const TOTP_FRIENDLY_NAME = "Keynetic Privacy Admin";
const TOTP_ISSUER = "Keynetic";

export type PlatformAdminMfaClientResult<T = Record<string, unknown>> =
  | ({ ok: true } & T)
  | { ok: false; error: string };

async function cleanupUnverifiedTotpFactors(): Promise<void> {
  const { data: factors, error } = await supabase.auth.mfa.listFactors();
  if (error) {
    throw new Error(error.message);
  }

  const { unverifiedTotpFactorIds } = partitionTotpFactorsFromMfaList(factors);
  for (const factorId of unverifiedTotpFactorIds) {
    const { error: unenrollError } = await supabase.auth.mfa.unenroll({
      factorId,
    });
    if (unenrollError) {
      throw new Error(unenrollError.message);
    }
  }
}

/**
 * Starts first-time TOTP enrolment using the browser Supabase session.
 * Supabase MFA enrolment must run in the authenticated user context; the browser
 * client holds the live session and persists AAL2 cookie updates after verify.
 */
export async function startPlatformAdminMfaEnrollClient(): Promise<
  PlatformAdminMfaClientResult<{
    factorId: string;
    qrCode: string;
    secret: string;
  }>
> {
  try {
    await cleanupUnverifiedTotpFactors();
  } catch {
    return { ok: false, error: "cleanup_failed" };
  }

  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: TOTP_FRIENDLY_NAME,
    issuer: TOTP_ISSUER,
  });

  if (error || !data?.totp?.qr_code || !data.totp.secret) {
    return { ok: false, error: "enroll_failed" };
  }

  let presentation;
  try {
    presentation = buildTotpEnrollPresentation({
      qrCode: data.totp.qr_code,
      secret: data.totp.secret,
    });
  } catch {
    return { ok: false, error: "enroll_failed" };
  }

  return {
    ok: true,
    factorId: data.id,
    qrCode: presentation.qrCodeSrc,
    secret: presentation.manualSetupKey,
  };
}

export async function regeneratePlatformAdminMfaEnrollClient(): Promise<
  PlatformAdminMfaClientResult<{
    factorId: string;
    qrCode: string;
    secret: string;
  }>
> {
  return startPlatformAdminMfaEnrollClient();
}

export async function restartPlatformAdminMfaEnrollClient(): Promise<
  PlatformAdminMfaClientResult
> {
  try {
    await cleanupUnverifiedTotpFactors();
    return { ok: true };
  } catch {
    return { ok: false, error: "cleanup_failed" };
  }
}

export async function verifyPlatformAdminMfaEnrollClient(input: {
  factorId: string;
  code: string;
  nextPath?: string | null;
}): Promise<PlatformAdminMfaClientResult<{ redirectTo: string }>> {
  const code = input.code.trim();
  if (!/^\d{6}$/.test(code)) {
    return { ok: false, error: "invalid_code" };
  }

  const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({
    factorId: input.factorId,
  });

  if (challengeError || !challenge) {
    return { ok: false, error: "challenge_failed" };
  }

  const { error: verifyError } = await supabase.auth.mfa.verify({
    factorId: input.factorId,
    challengeId: challenge.id,
    code,
  });

  if (verifyError) {
    return { ok: false, error: "verify_failed" };
  }

  const { data: assurance, error: assuranceError } =
    await supabase.auth.mfa.getAuthenticatorAssuranceLevel();

  if (assuranceError || assurance?.currentLevel !== "aal2") {
    return { ok: false, error: "verify_failed" };
  }

  return {
    ok: true,
    redirectTo: sanitizeAdminNextPath(input.nextPath) ?? "/admin/privacy",
  };
}

export async function verifyPlatformAdminMfaChallengeClient(input: {
  factorId: string;
  code: string;
  nextPath?: string | null;
}): Promise<PlatformAdminMfaClientResult<{ redirectTo: string }>> {
  const code = input.code.trim();
  if (!/^\d{6}$/.test(code)) {
    return { ok: false, error: "invalid_code" };
  }

  const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({
    factorId: input.factorId,
  });

  if (challengeError || !challenge) {
    return { ok: false, error: "challenge_failed" };
  }

  const { error: verifyError } = await supabase.auth.mfa.verify({
    factorId: input.factorId,
    challengeId: challenge.id,
    code,
  });

  if (verifyError) {
    return { ok: false, error: "verify_failed" };
  }

  const { data: assurance, error: assuranceError } =
    await supabase.auth.mfa.getAuthenticatorAssuranceLevel();

  if (assuranceError || assurance?.currentLevel !== "aal2") {
    return { ok: false, error: "verify_failed" };
  }

  return {
    ok: true,
    redirectTo: sanitizeAdminNextPath(input.nextPath) ?? "/admin/privacy",
  };
}
