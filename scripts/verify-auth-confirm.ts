/**
 * Policy tests for /auth/confirm helpers (recovery + signup confirmation).
 * Run: npx tsx scripts/verify-auth-confirm.ts
 */
import {
  AUTH_CONFIRM_ALLOWED_DESTINATIONS,
  isAllowedAuthConfirmDestination,
  isAuthConfirmSignupType,
  isSupportedAuthConfirmType,
  mapGoTrueErrorCode,
  mapVerifyOtpFailure,
  resolveAuthConfirmCodeFlow,
  resolveAuthConfirmDestination,
  resolveAuthConfirmFailureCode,
  resolvePasswordRecoveryQueryError,
  resolveSignupConfirmDestination,
} from "../lib/auth/authConfirm";
import { ROUTES } from "../lib/auth/routes";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

// --- resolveAuthConfirmDestination ---

assert(
  resolveAuthConfirmDestination("/reset-password") ===
    "/reset-password",
  "allows /reset-password"
);

assert(
  resolveAuthConfirmDestination("/dashboard") ===
    "/dashboard",
  "allows /dashboard"
);

assert(
  resolveAuthConfirmDestination("/agent") === "/agent",
  "allows /agent"
);

assert(
  resolveAuthConfirmDestination("/agent/originate") ===
    "/agent/originate",
  "allows /agent subpaths"
);

assert(
  resolveAuthConfirmDestination(
    "/estate-agents/onboarding"
  ) === "/estate-agents/onboarding",
  "allows /estate-agents/onboarding"
);

assert(
  resolveAuthConfirmDestination(
    "/estate-agents/onboarding/billing"
  ) === "/estate-agents/onboarding/billing",
  "allows /estate-agents/onboarding/billing"
);

assert(
  resolveAuthConfirmDestination(
    "https://evil.example/phish"
  ) === "/reset-password",
  "rejects absolute URLs"
);

assert(
  resolveAuthConfirmDestination("//evil.example") ===
    "/reset-password",
  "rejects protocol-relative URLs"
);

assert(
  resolveAuthConfirmDestination("/login") ===
    "/reset-password",
  "rejects non-allow-listed paths for recovery"
);

assert(
  resolveAuthConfirmDestination(null) ===
    "/reset-password",
  "defaults missing next to /reset-password"
);

// --- signup confirm destination ---

assert(
  resolveSignupConfirmDestination("/claim?token=ABC") ===
    "/verify-email?verified=1&next=%2Fclaim%3Ftoken%3DABC",
  "signup confirm bridges via verify-email with sanitised next"
);

assert(
  resolveSignupConfirmDestination(
    "https://evil.example/phish"
  ) ===
    `/verify-email?verified=1&next=${encodeURIComponent(ROUTES.homeownerDashboard)}`,
  "signup confirm rejects absolute next"
);

assert(
  resolveSignupConfirmDestination("//evil.example") ===
    `/verify-email?verified=1&next=${encodeURIComponent(ROUTES.homeownerDashboard)}`,
  "signup confirm rejects protocol-relative next"
);

assert(
  isAuthConfirmSignupType("signup") &&
    !isAuthConfirmSignupType("recovery"),
  "signup type helper"
);

assert(
  isSupportedAuthConfirmType("signup") &&
    isSupportedAuthConfirmType("recovery") &&
    !isSupportedAuthConfirmType("magiclink"),
  "supported confirm types"
);

assert(
  resolveAuthConfirmCodeFlow("/reset-password") ===
    "recovery",
  "code flow treats reset-password as recovery"
);

assert(
  resolveAuthConfirmCodeFlow("/dashboard") === "signup",
  "code flow treats non-recovery next as signup"
);

assert(
  resolveAuthConfirmCodeFlow(null) === "recovery",
  "code flow defaults missing next to recovery"
);

// --- failure code resolution ---

assert(
  resolveAuthConfirmFailureCode({
    tokenHash: null,
    type: null,
  }) === "missing_token",
  "missing token_hash and type"
);

assert(
  resolveAuthConfirmFailureCode({
    tokenHash: "abc",
    type: "magiclink",
  }) === "unsupported_type",
  "rejects unsupported OTP type"
);

assert(
  resolveAuthConfirmFailureCode({
    tokenHash: "abc",
    type: "signup",
  }) === "invalid_or_expired",
  "signup type is supported (no verify error yet)"
);

assert(
  resolveAuthConfirmFailureCode({
    tokenHash: null,
    type: null,
    providerErrorCode: "otp_expired",
  }) === "expired",
  "maps GoTrue otp_expired"
);

assert(
  mapVerifyOtpFailure({
    message: "Email link is invalid or has expired",
  }) === "invalid_or_expired",
  "maps verifyOtp invalid message"
);

assert(
  mapVerifyOtpFailure({
    message: "Token has expired",
    code: "otp_expired",
  }) === "expired",
  "maps verifyOtp expired"
);

// --- client query error resolution ---

assert(
  resolvePasswordRecoveryQueryError(
    "missing_token",
    null
  ) === "missing_token",
  "prefers app error param"
);

assert(
  resolvePasswordRecoveryQueryError(
    null,
    "otp_expired"
  ) === "expired",
  "maps error_code when error absent"
);

assert(
  resolvePasswordRecoveryQueryError(null, null) ===
    null,
  "returns null when no error params"
);

assert(
  AUTH_CONFIRM_ALLOWED_DESTINATIONS.length === 5,
  "allow-list has five destinations"
);

assert(
  isAllowedAuthConfirmDestination("/dashboard") &&
    !isAllowedAuthConfirmDestination("/account"),
  "isAllowedAuthConfirmDestination matches policy"
);

console.log(
  "verify-auth-confirm: all assertions passed"
);
