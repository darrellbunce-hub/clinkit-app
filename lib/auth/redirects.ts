import {
  isEstateAgent,
  isHomeowner,
  isSolicitor,
  requiresEstateAgentOnboarding,
  type AccountType,
} from "@/lib/accountType";
import type { ProfileAccountFields } from "@/lib/estateAgent/types";
import { ROUTES } from "@/lib/auth/routes";

export type PostLoginRedirectInput = Pick<
  ProfileAccountFields,
  "account_type" | "onboarding_completed_at"
>;

export function resolvePostLoginRedirect(
  profile: PostLoginRedirectInput
): string {
  if (isHomeowner(profile)) {
    return ROUTES.homeownerDashboard;
  }

  if (isEstateAgent(profile)) {
    if (
      requiresEstateAgentOnboarding(profile)
    ) {
      return ROUTES.estateAgentOnboarding;
    }

    return ROUTES.agentHome;
  }

  if (isSolicitor(profile)) {
    return ROUTES.homeownerLogin;
  }

  return ROUTES.homeownerDashboard;
}

export function resolveLoginPathForAccountType(
  accountType: AccountType
): string {
  if (accountType === "estate_agent") {
    return ROUTES.estateAgentLogin;
  }

  return ROUTES.homeownerLogin;
}

export function resolveLoginPathForProtectedRoute(
  pathname: string,
  isEstateAgentRoute: boolean
): string {
  if (isEstateAgentRoute) {
    return ROUTES.estateAgentLogin;
  }

  return ROUTES.homeownerLogin;
}

/**
 * Full post-login destination for a protected route, including query string.
 */
export function buildProtectedRouteNextDestination(
  requestUrl: URL,
  pathname: string
): string {
  return `${pathname}${requestUrl.search}`;
}

/**
 * Resolve a safe internal redirect from the login page `next` query parameter.
 * Rejects open redirects; preserves pathname and search when valid.
 */
export function resolveLoginNextDestination(
  nextDestination: string | null | undefined,
  fallback: string
): string {
  const candidate = nextDestination?.trim();

  if (!candidate) {
    return fallback;
  }

  if (
    !candidate.startsWith("/") ||
    candidate.startsWith("//") ||
    candidate.includes("://")
  ) {
    return fallback;
  }

  return candidate;
}

export function buildLoginRedirectUrl(
  requestUrl: URL,
  loginPath: string,
  nextDestination?: string
): URL {
  const loginUrl = new URL(
    loginPath,
    requestUrl.origin
  );

  if (nextDestination) {
    loginUrl.searchParams.set(
      "next",
      nextDestination
    );
  }

  return loginUrl;
}

export function resolveEstateAgentDestination(
  profile: PostLoginRedirectInput
): string {
  if (
    requiresEstateAgentOnboarding(profile)
  ) {
    return ROUTES.estateAgentOnboarding;
  }

  return ROUTES.agentHome;
}

export function resolveHomeownerBlockedRedirect(
  profile: PostLoginRedirectInput
): string {
  if (isEstateAgent(profile)) {
    return resolveEstateAgentDestination(
      profile
    );
  }

  if (isSolicitor(profile)) {
    return ROUTES.homeownerLogin;
  }

  return ROUTES.homeownerDashboard;
}
