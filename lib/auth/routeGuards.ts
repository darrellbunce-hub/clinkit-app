import {
  isEstateAgent,
  isEstateAgentOnboardingComplete,
  isHomeowner,
  isSolicitor,
  requiresEstateAgentOnboarding,
} from "@/lib/accountType";
import type { CurrentUserContext } from "@/lib/currentUserContext";
import {
  buildLoginRedirectUrl,
  resolveHomeownerBlockedRedirect,
  resolveLoginPathForProtectedRoute,
} from "@/lib/auth/redirects";
import {
  ROUTES,
  isAccountSettingsRoute,
  isAgentHomeRoute,
  isEstateAgentOnboardingRoute,
  isEstateAgentProtectedRoute,
  isHomeownerOnlyRoute,
  isSharedOperationalRoute,
} from "@/lib/auth/routes";

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
      pathname
    );

  return deny(
    `${redirectUrl.pathname}${redirectUrl.search}`,
    "authentication_required"
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

/**
 * Middleware entry point: evaluate account-type rules for a protected route.
 */
export function evaluateProtectedRouteAccess(
  context: CurrentUserContext | null,
  requestUrl: URL,
  pathname: string
): RouteGuardResult {
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

  if (isHomeownerOnlyRoute(pathname)) {
    return requireHomeowner(context);
  }

  if (isSharedOperationalRoute(pathname)) {
    return requireSharedOperationalAccess(context);
  }

  if (isEstateAgentOnboardingRoute(pathname)) {
    return requireEstateAgentOnboarding(
      context
    );
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
 * Future company-level roles (company_admin, billing_admin) should layer on
 * top of branch membership via ea_company_members — not by rewriting these
 * guards. Branch-scoped checks remain in ea_branch_members.role.
 */
