/**
 * Policy tests for /auth/confirm helpers (Phase 1 password recovery).
 * Run: npx tsx scripts/verify-auth-confirm.ts
 */
import {
  AUTH_CONFIRM_ALLOWED_DESTINATIONS,
  isAllowedAuthConfirmDestination,
  mapGoTrueErrorCode,
  mapVerifyOtpFailure,
  resolveAuthConfirmDestination,
  resolveAuthConfirmFailureCode,
  resolvePasswordRecoveryQueryError,
} from "../lib/auth/authConfirm";

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
  "rejects non-allow-listed paths"
);

assert(
  resolveAuthConfirmDestination(null) ===
    "/reset-password",
  "defaults missing next to /reset-password"
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
    type: "signup",
  }) === "unsupported_type",
  "rejects non-recovery type"
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
  AUTH_CONFIRM_ALLOWED_DESTINATIONS.length === 4,
  "allow-list has four destinations"
);

assert(
  isAllowedAuthConfirmDestination("/dashboard") &&
    !isAllowedAuthConfirmDestination("/account"),
  "isAllowedAuthConfirmDestination matches policy"
);

console.log(
  "verify-auth-confirm: all assertions passed"
);
