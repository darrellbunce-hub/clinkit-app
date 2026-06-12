/**
 * Route classification for account-type-aware middleware and guards.
 *
 * Homeowner-only routes cover operational participant workflows.
 * Estate agent routes are reserved for onboarding and the future agent product.
 * Public EA marketing/auth routes are listed for future PRs even though pages
 * are not implemented yet.
 */

export const ROUTES = {
  home: "/",
  homeownerLogin: "/login",
  homeownerDashboard: "/dashboard",
  estateAgentLogin: "/estate-agents/login",
  estateAgentSignup: "/estate-agents/signup",
  estateAgentMarketing: "/estate-agents",
  estateAgentPricing: "/estate-agents/pricing",
  estateAgentOnboarding: "/estate-agents/onboarding",
  agentHome: "/agent",
} as const;

/** Prefixes for homeowner operational workflows — estate agents must not access these. */
export const HOMEOWNER_PROTECTED_PREFIXES = [
  "/dashboard",
  "/start-move",
  "/join-chain",
  "/my-chains",
  "/chain/",
  "/property/",
  "/buyer-ready/",
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
    isHomeownerProtectedRoute(pathname) ||
    isEstateAgentProtectedRoute(pathname)
  );
}

/**
 * Middleware matcher paths — keep in sync with middleware config export.
 */
export const MIDDLEWARE_MATCHER = [
  "/dashboard/:path*",
  "/start-move/:path*",
  "/join-chain/:path*",
  "/my-chains/:path*",
  "/chain/:path*",
  "/property/:path*",
  "/buyer-ready/:path*",
  "/agent/:path*",
  "/estate-agents/onboarding/:path*",
] as const;
