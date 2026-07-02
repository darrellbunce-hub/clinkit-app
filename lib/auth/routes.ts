/**
 * Route classification for account-type-aware middleware and guards.
 *
 * Homeowner-only routes cover join/start/dashboard flows.
 * Shared operational routes are used by homeowners and estate agents.
 */

export const ROUTES = {
  home: "/",
  homeownerLogin: "/login",
  homeownerDashboard: "/dashboard",
  accountSettings: "/account",
  forgotPassword: "/forgot-password",
  resetPassword: "/reset-password",
  authConfirm: "/auth/confirm",
  estateAgentLogin: "/estate-agents/login",
  estateAgentSignup: "/estate-agents/signup",
  estateAgentMarketing: "/estate-agents",
  estateAgentPricing: "/estate-agents/pricing",
  estateAgentOnboarding: "/estate-agents/onboarding",
  agentHome: "/agent",
  agentOriginate: "/agent/originate",
  claimProperty: "/claim",
} as const;

/** Prefixes for account settings — any authenticated account type. */
export const ACCOUNT_SETTINGS_PREFIXES = [
  "/account",
] as const;

/** Homeowner-only operational flows — estate agents must not access these. */
export const HOMEOWNER_ONLY_PREFIXES = [
  "/dashboard",
  "/start-move",
  "/join-chain",
  "/my-chains",
  "/claim",
] as const;

/**
 * Shared operational workspace — homeowners and onboarded estate agents.
 * Same chain, property, and workflow pages for all operational roles.
 */
export const SHARED_OPERATIONAL_PREFIXES = [
  "/chain/",
  "/property/",
  "/buyer-ready/",
] as const;

/**
 * @deprecated Use HOMEOWNER_ONLY_PREFIXES and SHARED_OPERATIONAL_PREFIXES.
 * Kept for callers that still check the combined homeowner operational set.
 */
export const HOMEOWNER_PROTECTED_PREFIXES = [
  ...HOMEOWNER_ONLY_PREFIXES,
  ...SHARED_OPERATIONAL_PREFIXES,
] as const;

/** Prefixes for estate agent product routes. */
export const ESTATE_AGENT_PROTECTED_PREFIXES = [
  "/agent",
  "/estate-agents/onboarding",
] as const;

/** Exact public paths that do not require authentication. */
export const PUBLIC_EXACT_PATHS = [
  ROUTES.home,
  ROUTES.homeownerLogin,
  ROUTES.forgotPassword,
  ROUTES.resetPassword,
  "/verify-email",
  ROUTES.estateAgentMarketing,
  ROUTES.estateAgentPricing,
  ROUTES.estateAgentSignup,
  ROUTES.estateAgentLogin,
] as const;

export function normalizePathname(
  pathname: string
): string {
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.slice(0, -1);
  }

  return pathname;
}

export function matchesPrefix(
  pathname: string,
  prefix: string
): boolean {
  const normalizedPath =
    normalizePathname(pathname);

  if (prefix.endsWith("/")) {
    return normalizedPath.startsWith(prefix);
  }

  return (
    normalizedPath === prefix ||
    normalizedPath.startsWith(`${prefix}/`)
  );
}

export function isPublicExactPath(
  pathname: string
): boolean {
  const normalizedPath =
    normalizePathname(pathname);

  return (
    PUBLIC_EXACT_PATHS as readonly string[]
  ).includes(normalizedPath);
}

export function isAccountSettingsRoute(
  pathname: string
): boolean {
  return ACCOUNT_SETTINGS_PREFIXES.some(
    (prefix) =>
      matchesPrefix(pathname, prefix)
  );
}

export function isHomeownerOnlyRoute(
  pathname: string
): boolean {
  return HOMEOWNER_ONLY_PREFIXES.some(
    (prefix) =>
      matchesPrefix(pathname, prefix)
  );
}

export function isSharedOperationalRoute(
  pathname: string
): boolean {
  return SHARED_OPERATIONAL_PREFIXES.some(
    (prefix) =>
      matchesPrefix(pathname, prefix)
  );
}

export function isHomeownerProtectedRoute(
  pathname: string
): boolean {
  return HOMEOWNER_PROTECTED_PREFIXES.some(
    (prefix) =>
      matchesPrefix(pathname, prefix)
  );
}

export function isEstateAgentProtectedRoute(
  pathname: string
): boolean {
  return ESTATE_AGENT_PROTECTED_PREFIXES.some(
    (prefix) =>
      matchesPrefix(pathname, prefix)
  );
}

export function isEstateAgentOnboardingRoute(
  pathname: string
): boolean {
  return matchesPrefix(
    pathname,
    ROUTES.estateAgentOnboarding
  );
}

export function isAgentHomeRoute(
  pathname: string
): boolean {
  return matchesPrefix(
    pathname,
    ROUTES.agentHome
  );
}

export function isAccountGatedRoute(
  pathname: string
): boolean {
  return (
    isAccountSettingsRoute(pathname) ||
    isHomeownerOnlyRoute(pathname) ||
    isSharedOperationalRoute(pathname) ||
    isEstateAgentProtectedRoute(pathname)
  );
}

/**
 * Middleware matcher paths — keep in sync with middleware config export.
 */
export const MIDDLEWARE_MATCHER = [
  "/account/:path*",
  "/dashboard/:path*",
  "/start-move/:path*",
  "/join-chain/:path*",
  "/my-chains/:path*",
  "/claim/:path*",
  "/chain/:path*",
  "/property/:path*",
  "/buyer-ready/:path*",
  "/agent/:path*",
  "/estate-agents/onboarding/:path*",
] as const;
