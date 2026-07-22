import { isSentryEnabled, resolveKeyneticEnvironment } from "@/lib/observability/environment";

export const SENTRY_CLIENT_VERIFICATION_MESSAGE =
  "KEYNETIC_SENTRY_CLIENT_VERIFICATION";

export const SENTRY_SERVER_VERIFICATION_MESSAGE =
  "KEYNETIC_SENTRY_SERVER_VERIFICATION";

/**
 * Non-Production Sentry verification surface gate.
 *
 * Blocked on Production even if Sentry is configured. Requires explicit
 * Sentry enablement so the route cannot be used as an accidental public trap.
 */
export function isSentryVerificationSurfaceAllowed(): boolean {
  if (process.env.VERCEL_ENV?.trim() === "production") {
    return false;
  }

  if (process.env.NEXT_PUBLIC_VERCEL_ENV?.trim() === "production") {
    return false;
  }

  if (resolveKeyneticEnvironment() === "production") {
    return false;
  }

  return isSentryEnabled();
}
