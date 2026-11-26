import type { EmailOtpType } from "@supabase/supabase-js";

import { resolveLoginNextDestination } from "@/lib/auth/redirects";
import { ROUTES, normalizePathname } from "@/lib/auth/routes";
import { buildPostSignupVerifiedPath } from "@/lib/auth/signupConfirm";

/** OTP types accepted by /auth/confirm for password recovery. */
export const AUTH_CONFIRM_RECOVERY_TYPE =
  "recovery" satisfies EmailOtpType;

/** OTP types accepted by /auth/confirm for signup email confirmation. */
export const AUTH_CONFIRM_SIGNUP_TYPE =
  "signup" satisfies EmailOtpType;

/**
 * Internal destinations permitted for the `next` query parameter on
 * /auth/confirm during password recovery. Reject everything else to
 * prevent open redirects.
 */
export const AUTH_CONFIRM_ALLOWED_DESTINATIONS = [
  ROUTES.resetPassword,
  ROUTES.homeownerDashboard,
  ROUTES.agentHome,
  ROUTES.estateAgentOnboarding,
  ROUTES.estateAgentOnboardingBilling,
] as const;

const AUTH_CONFIRM_STRIPPED_PARAMS = [
  "token_hash",
  "type",
  "code",
  "next",
  "error",
  "error_code",
  "error_description",
] as const;

export type AuthConfirmFailureCode =
  | "missing_token"
  | "unsupported_type"
  | "expired"
  | "invalid_or_expired"
  | "reused"
  | "no_session"
  | "provider_error";

export type AuthConfirmFlow = "recovery" | "signup";

export function isAllowedAuthConfirmDestination(
  pathname: string
): boolean {
  const normalized = normalizePathname(pathname);

  if (
    !normalized.startsWith("/") ||
    normalized.startsWith("//") ||
    normalized.includes("://")
  ) {
    return false;
  }

  return AUTH_CONFIRM_ALLOWED_DESTINATIONS.some(
    (allowed) => {
      if (normalized === allowed) {
        return true;
      }

      if (
        allowed === ROUTES.agentHome ||
        allowed === ROUTES.estateAgentOnboarding
      ) {
        return normalized.startsWith(`${allowed}/`);
      }

      return false;
    }
  );
}

/**
 * Resolve a safe post-confirmation path for password recovery.
 * Falls back to /reset-password.
 */
export function resolveAuthConfirmDestination(
  nextPath: string | null | undefined
): string {
  const candidate = normalizePathname(
    nextPath?.trim() || ROUTES.resetPassword
  );

  if (isAllowedAuthConfirmDestination(candidate)) {
    return candidate;
  }

  return ROUTES.resetPassword;
}

/**
 * Resolve the client bridge path after signup confirmation.
 * Revalidates `next` as a safe internal destination.
 */
export function resolveSignupConfirmDestination(
  nextPath: string | null | undefined
): string {
  return buildPostSignupVerifiedPath(
    resolveLoginNextDestination(
      nextPath,
      ROUTES.homeownerDashboard
    )
  );
}

export function isAuthConfirmRecoveryType(
  type: string | null | undefined
): type is typeof AUTH_CONFIRM_RECOVERY_TYPE {
  return type === AUTH_CONFIRM_RECOVERY_TYPE;
}

export function isAuthConfirmSignupType(
  type: string | null | undefined
): type is typeof AUTH_CONFIRM_SIGNUP_TYPE {
  return type === AUTH_CONFIRM_SIGNUP_TYPE;
}

export function isSupportedAuthConfirmType(
  type: string | null | undefined
): type is
  | typeof AUTH_CONFIRM_RECOVERY_TYPE
  | typeof AUTH_CONFIRM_SIGNUP_TYPE {
  return (
    isAuthConfirmRecoveryType(type) ||
    isAuthConfirmSignupType(type)
  );
}

/**
 * Map GoTrue `error_code` query values to internal recovery error codes.
 * Does not expose provider-specific detail to end users.
 */
export function mapGoTrueErrorCode(
  errorCode: string | null | undefined
): AuthConfirmFailureCode | null {
  if (!errorCode?.trim()) {
    return null;
  }

  const normalized = errorCode.trim().toLowerCase();

  switch (normalized) {
    case "otp_expired":
      return "expired";
    case "otp_disabled":
    case "validation_failed":
    case "invalid_request":
      return "invalid_or_expired";
    case "access_denied":
      return "reused";
    default:
      return "provider_error";
  }
}

/**
 * Map verifyOtp() failures to internal recovery error codes.
 */
export function mapVerifyOtpFailure(
  error: {
    message?: string;
    code?: string;
  } | null
): AuthConfirmFailureCode {
  if (!error) {
    return "provider_error";
  }

  const message = (error.message ?? "").toLowerCase();
  const code = (error.code ?? "").toLowerCase();

  if (
    message.includes("invalid") ||
    code === "validation_failed"
  ) {
    return "invalid_or_expired";
  }

  if (
    message.includes("already been used") ||
    message.includes("already used")
  ) {
    return "reused";
  }

  if (
    code === "otp_expired" ||
    message.includes("expired")
  ) {
    return "expired";
  }

  return "provider_error";
}

export function resolveAuthConfirmFailureCode(params: {
  tokenHash: string | null;
  type: string | null;
  providerErrorCode?: string | null;
  verifyError?: {
    message?: string;
    code?: string;
  } | null;
}): AuthConfirmFailureCode {
  const mappedProviderError = mapGoTrueErrorCode(
    params.providerErrorCode
  );

  if (mappedProviderError) {
    return mappedProviderError;
  }

  if (!params.tokenHash || !params.type) {
    return "missing_token";
  }

  if (!isSupportedAuthConfirmType(params.type)) {
    return "unsupported_type";
  }

  if (params.verifyError) {
    return mapVerifyOtpFailure(params.verifyError);
  }

  return "invalid_or_expired";
}

/**
 * Resolve password-recovery error query params from the reset-password URL.
 * Accepts both app `error` codes and GoTrue `error_code` values.
 */
export function resolvePasswordRecoveryQueryError(
  error: string | null | undefined,
  errorCode: string | null | undefined
): AuthConfirmFailureCode | null {
  const appError = error?.trim();

  if (appError) {
    return normalizePasswordRecoveryErrorCode(appError);
  }

  return mapGoTrueErrorCode(errorCode);
}

function normalizePasswordRecoveryErrorCode(
  code: string
): AuthConfirmFailureCode {
  switch (code) {
    case "missing_token":
    case "unsupported_type":
    case "expired":
    case "invalid_or_expired":
    case "reused":
    case "no_session":
    case "provider_error":
      return code;
    default:
      return "provider_error";
  }
}

export function stripAuthConfirmQueryParams(
  url: URL
): void {
  for (const param of AUTH_CONFIRM_STRIPPED_PARAMS) {
    url.searchParams.delete(param);
  }
}

/**
 * Decide whether a PKCE `code` exchange without an explicit OTP type should
 * follow the recovery success path or the signup verified bridge.
 */
export function resolveAuthConfirmCodeFlow(
  nextPath: string | null | undefined
): AuthConfirmFlow {
  const normalized = normalizePathname(
    (nextPath ?? "").trim() || ROUTES.resetPassword
  );

  if (
    normalized === ROUTES.resetPassword ||
    !nextPath?.trim()
  ) {
    return "recovery";
  }

  return "signup";
}
