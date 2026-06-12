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

export function buildLoginRedirectUrl(
  requestUrl: URL,
  loginPath: string,
  nextPath?: string
): URL {
  const loginUrl = new URL(
    loginPath,
    requestUrl.origin
  );

  if (nextPath) {
    loginUrl.searchParams.set(
      "next",
      nextPath
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
