import {
  isEstateAgent,
  isEstateAgentOnboardingComplete,
  isHomeowner,
  isSolicitor,
  requiresEstateAgentOnboarding,
} from "@/lib/accountType";
import {
  isEmailVerified,
} from "@/lib/auth/emailVerification";
import {
  buildVerifyEmailRedirectPath,
} from "@/lib/auth/emailVerificationGate";
import type { CurrentUserContext } from "@/lib/currentUserContext";
import {
  buildLoginRedirectUrl,
  buildProtectedRouteNextDestination,
  resolveHomeownerBlockedRedirect,
  resolveLoginPathForProtectedRoute,
} from "@/lib/auth/redirects";
import {
  isAccountSettingsRoute,
  isAgentHomeRoute,
  isEstateAgentOnboardingRoute,
  isEstateAgentProtectedRoute,
  isHomeownerOnlyRoute,
  isPlatformAdminMfaRoute,
  isPlatformAdminPrivilegedRoute,
  isPlatformAdminRoute,
  isSharedOperationalRoute,
  isTransactionParticipationRoute,
  ROUTES,
} from "@/lib/auth/routes";
import { isPlatformAdminUserId } from "@/lib/auth/platformAdminCore";
import { evaluatePlatformAdminAccess } from "@/lib/auth/platformAdminAccess";
import {
  buildAdminMfaChallengePath,
  buildAdminMfaEnrollPath,
} from "@/lib/auth/safeAdminRedirect";
import type { SupabaseClient } from "@supabase/supabase-js";

export type RouteGuardAllow = {
  allowed: true;
};

export type RouteGuardRedirect = {
  allowed: false;
  redirectTo: string;
  reason: string;
};

export type RouteGuardResult =
  | RouteGuardAllow
  | RouteGuardRedirect;

export function allow(): RouteGuardAllow {
  return { allowed: true };
}

export function deny(
  redirectTo: string,
  reason: string
): RouteGuardRedirect {
  return {
    allowed: false,
    redirectTo,
    reason,
  };
}

export function requireAuthenticatedForRequest(
  context: CurrentUserContext | null,
  requestUrl: URL,
  pathname: string
): RouteGuardResult {
  if (context) {
    return allow();
  }

  const loginPath =
    resolveLoginPathForProtectedRoute(
      pathname,
      isEstateAgentProtectedRoute(pathname)
    );

  const redirectUrl =
    buildLoginRedirectUrl(
      requestUrl,
      loginPath,
      buildProtectedRouteNextDestination(
        requestUrl,
        pathname
      )
    );

  return deny(
    `${redirectUrl.pathname}${redirectUrl.search}`,
    "authentication_required"
  );
}

export function requireVerifiedEmailForTransactionParticipation(
  context: CurrentUserContext | null,
  requestUrl: URL,
  pathname: string
): RouteGuardResult {
  if (!context) {
    return deny(
      ROUTES.homeownerLogin,
      "authentication_required"
    );
  }

  if (isEmailVerified(context.user)) {
    return allow();
  }

  const nextDestination =
    buildProtectedRouteNextDestination(
      requestUrl,
      pathname
    );

  return deny(
    buildVerifyEmailRedirectPath(nextDestination),
    "email_verification_required"
  );
}

export function requireHomeowner(
  context: CurrentUserContext | null
): RouteGuardResult {
  if (!context) {
    return deny(
      ROUTES.homeownerLogin,
      "authentication_required"
    );
  }

  if (!isHomeowner(context.profile)) {
    return deny(
      resolveHomeownerBlockedRedirect(
        context.profile
      ),
      "homeowner_route_forbidden"
    );
  }

  return allow();
}

export function requireEstateAgent(
  context: CurrentUserContext | null
): RouteGuardResult {
  if (!context) {
    return deny(
      ROUTES.estateAgentLogin,
      "authentication_required"
    );
  }

  if (isSolicitor(context.profile)) {
    return deny(
      ROUTES.homeownerLogin,
      "solicitor_access_not_available"
    );
  }

  if (!isEstateAgent(context.profile)) {
    return deny(
      ROUTES.homeownerDashboard,
      "estate_agent_route_forbidden"
    );
  }

  return allow();
}

/** Allows estate agents who still need to finish company/branch onboarding. */
export function requireEstateAgentOnboarding(
  context: CurrentUserContext | null
): RouteGuardResult {
  const estateAgentGuard =
    requireEstateAgent(context);

  if (!estateAgentGuard.allowed) {
    return estateAgentGuard;
  }

  if (
    !requiresEstateAgentOnboarding(
      context!.profile
    )
  ) {
    return deny(
      ROUTES.agentHome,
      "estate_agent_onboarding_already_complete"
    );
  }

  return allow();
}

/** Allows estate agents who have completed onboarding (future agent home/dashboard). */
export function requireCompletedEstateAgentOnboarding(
  context: CurrentUserContext | null
): RouteGuardResult {
  const estateAgentGuard =
    requireEstateAgent(context);

  if (!estateAgentGuard.allowed) {
    return estateAgentGuard;
  }

  if (
    !isEstateAgentOnboardingComplete(
      context!.profile
    )
  ) {
    return deny(
      ROUTES.estateAgentOnboarding,
      "estate_agent_onboarding_incomplete"
    );
  }

  return allow();
}

/**
 * Shared operational workspace: homeowners or onboarded estate agents.
 */
export function requireSharedOperationalAccess(
  context: CurrentUserContext | null
): RouteGuardResult {
  if (!context) {
    return deny(
      ROUTES.homeownerLogin,
      "authentication_required"
    );
  }

  if (isHomeowner(context.profile)) {
    return allow();
  }

  if (isEstateAgent(context.profile)) {
    return requireCompletedEstateAgentOnboarding(
      context
    );
  }

  return deny(
    resolveHomeownerBlockedRedirect(context.profile),
    "shared_operational_route_forbidden"
  );
}

function resolveAccountTypeGuard(
  context: CurrentUserContext | null,
  pathname: string
): RouteGuardResult {
  if (isHomeownerOnlyRoute(pathname)) {
    return requireHomeowner(context);
  }

  if (isSharedOperationalRoute(pathname)) {
    return requireSharedOperationalAccess(context);
  }

  if (isEstateAgentOnboardingRoute(pathname)) {
    return requireEstateAgentOnboarding(context);
  }

  if (
    isAgentHomeRoute(pathname) ||
    isEstateAgentProtectedRoute(pathname)
  ) {
    return requireCompletedEstateAgentOnboarding(
      context
    );
  }

  return allow();
}

/**
 * Middleware entry point: evaluate account-type rules for a protected route.
 */
export async function evaluateProtectedRouteAccess(
  context: CurrentUserContext | null,
  requestUrl: URL,
  pathname: string,
  supabase?: SupabaseClient
): Promise<RouteGuardResult> {
  if (isPlatformAdminRoute(pathname)) {
    if (!context) {
      const loginUrl = buildLoginRedirectUrl(
        requestUrl,
        ROUTES.homeownerLogin,
        buildProtectedRouteNextDestination(requestUrl, pathname)
      );

      return deny(
        `${loginUrl.pathname}${loginUrl.search}`,
        "platform_admin_authentication_required"
      );
    }

    const isAdmin = await isPlatformAdminUserId(context.user.id);
    if (!isAdmin) {
      return deny("/404", "platform_admin_forbidden");
    }

    if (!supabase) {
      return allow();
    }

    const access = await evaluatePlatformAdminAccess(supabase);
    const nextDestination = buildProtectedRouteNextDestination(
      requestUrl,
      pathname
    );

    if (isPlatformAdminMfaRoute(pathname)) {
      if (pathname.startsWith(ROUTES.platformAdminMfaEnroll)) {
        if (access.kind === "privileged_allowed") {
          return deny(
            sanitizeAdminReturnPath(requestUrl) ?? ROUTES.privacyAdmin,
            "mfa_already_satisfied"
          );
        }
        if (access.kind === "mfa_challenge_required") {
          return deny(
            buildAdminMfaChallengePath(nextDestination),
            "mfa_challenge_required"
          );
        }
        return allow();
      }

      if (pathname.startsWith(ROUTES.platformAdminMfaChallenge)) {
        if (access.kind === "privileged_allowed") {
          return deny(
            sanitizeAdminReturnPath(requestUrl) ?? ROUTES.privacyAdmin,
            "mfa_already_satisfied"
          );
        }
        if (access.kind === "mfa_enrollment_required") {
          return deny(
            buildAdminMfaEnrollPath(nextDestination),
            "mfa_enrollment_required"
          );
        }
        if (access.kind === "mfa_challenge_required") {
          return allow();
        }
        return deny("/404", "platform_admin_mfa_forbidden");
      }

      if (normalizeAdminPathname(pathname) === ROUTES.platformAdminMfa) {
        if (access.kind !== "privileged_allowed") {
          if (access.kind === "mfa_enrollment_required") {
            return deny(
              buildAdminMfaEnrollPath(nextDestination),
              "mfa_enrollment_required"
            );
          }
          if (access.kind === "mfa_challenge_required") {
            return deny(
              buildAdminMfaChallengePath(nextDestination),
              "mfa_challenge_required"
            );
          }
          return deny("/404", "platform_admin_mfa_forbidden");
        }
        return allow();
      }
    }

    if (isPlatformAdminPrivilegedRoute(pathname)) {
      if (access.kind === "privileged_allowed") {
        return allow();
      }
      if (access.kind === "mfa_enrollment_required") {
        return deny(
          buildAdminMfaEnrollPath(nextDestination),
          "mfa_enrollment_required"
        );
      }
      if (access.kind === "mfa_challenge_required") {
        return deny(
          buildAdminMfaChallengePath(nextDestination),
          "mfa_challenge_required"
        );
      }
      return deny("/404", "platform_admin_forbidden");
    }

    return allow();
  }

  const authGuard =
    requireAuthenticatedForRequest(
      context,
      requestUrl,
      pathname
    );

  if (!authGuard.allowed) {
    return authGuard;
  }

  if (isAccountSettingsRoute(pathname)) {
    return allow();
  }

  const accountTypeGuard =
    resolveAccountTypeGuard(context, pathname);

  if (!accountTypeGuard.allowed) {
    return accountTypeGuard;
  }

  if (isTransactionParticipationRoute(pathname)) {
    return requireVerifiedEmailForTransactionParticipation(
      context,
      requestUrl,
      pathname
    );
  }

  return allow();
}

function normalizeAdminPathname(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.slice(0, -1);
  }
  return pathname;
}

function sanitizeAdminReturnPath(requestUrl: URL): string | null {
  const next = requestUrl.searchParams.get("next");
  if (!next) {
    return null;
  }
  if (!next.startsWith("/") || next.startsWith("//")) {
    return null;
  }
  return next;
}

/**
 * Future company-level roles (company_admin, billing_admin) should layer on
 * top of branch membership via ea_company_members — not by rewriting these
 * guards. Branch-scoped checks remain in ea_branch_members.role.
 */
