import { resolveLoginNextDestination } from "@/lib/auth/redirects";
import { ROUTES } from "@/lib/auth/routes";

/**
 * Signup email redirect — must match the Supabase Auth redirect allow-list.
 * `next` is revalidated again by /auth/confirm before the post-verify hop.
 */
export function buildSignupConfirmUrl(
  origin: string,
  nextDestination?: string | null
): string {
  const url = new URL(ROUTES.authConfirm, origin);
  const safeNext = resolveLoginNextDestination(
    nextDestination,
    ROUTES.homeownerDashboard
  );

  url.searchParams.set("next", safeNext);

  return url.toString();
}

/**
 * Signup confirmation resend. Must use the same `/auth/confirm?next=` redirect
 * as the original `signUp` call.
 *
 * Dashboard template assumption (unchanged): the Confirm signup template uses
 * `{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=signup`, not raw
 * `{{ .ConfirmationURL }}`. `emailRedirectTo` becomes `{{ .RedirectTo }}`.
 * Password recovery does not use this helper.
 */
export function buildSignupConfirmationResendRequest(
  origin: string,
  email: string,
  nextDestination?: string | null
): {
  type: "signup";
  email: string;
  options: { emailRedirectTo: string };
} {
  return {
    type: "signup",
    email: email.trim(),
    options: {
      emailRedirectTo: buildSignupConfirmUrl(
        origin,
        nextDestination
      ),
    },
  };
}

/**
 * Client bridge after signup confirmation so pending legal acceptance /
 * EA profile can flush from browser storage before the final destination.
 */
export function buildPostSignupVerifiedPath(
  nextDestination?: string | null
): string {
  const url = new URL(ROUTES.verifyEmail, "http://local.invalid");
  const safeNext = resolveLoginNextDestination(
    nextDestination,
    ROUTES.homeownerDashboard
  );

  url.searchParams.set("verified", "1");
  url.searchParams.set("next", safeNext);

  return `${url.pathname}${url.search}`;
}

export function buildVerifyEmailPathWithNext(
  nextDestination?: string | null
): string {
  const safeNext = resolveLoginNextDestination(
    nextDestination,
    ""
  );

  if (!safeNext) {
    return ROUTES.verifyEmail;
  }

  const url = new URL(ROUTES.verifyEmail, "http://local.invalid");
  url.searchParams.set("next", safeNext);

  return `${url.pathname}${url.search}`;
}
