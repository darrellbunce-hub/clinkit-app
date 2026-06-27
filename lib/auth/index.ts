export {
  ROUTES,
  HOMEOWNER_ONLY_PREFIXES,
  SHARED_OPERATIONAL_PREFIXES,
  HOMEOWNER_PROTECTED_PREFIXES,
  ESTATE_AGENT_PROTECTED_PREFIXES,
  PUBLIC_EXACT_PATHS,
  MIDDLEWARE_MATCHER,
  normalizePathname,
  matchesPrefix,
  isPublicExactPath,
  isHomeownerOnlyRoute,
  isSharedOperationalRoute,
  isHomeownerProtectedRoute,
  isEstateAgentProtectedRoute,
  isEstateAgentOnboardingRoute,
  isAgentHomeRoute,
  isAccountGatedRoute,
} from "@/lib/auth/routes";

export {
  resolvePostLoginRedirect,
  resolveLoginPathForAccountType,
  resolveLoginPathForProtectedRoute,
  buildLoginRedirectUrl,
  resolveEstateAgentDestination,
  resolveHomeownerBlockedRedirect,
  type PostLoginRedirectInput,
} from "@/lib/auth/redirects";

export {
  allow,
  deny,
  requireAuthenticatedForRequest,
  requireHomeowner,
  requireEstateAgent,
  requireEstateAgentOnboarding,
  requireCompletedEstateAgentOnboarding,
  requireSharedOperationalAccess,
  evaluateProtectedRouteAccess,
  type RouteGuardAllow,
  type RouteGuardRedirect,
  type RouteGuardResult,
} from "@/lib/auth/routeGuards";

export {
  parsePositiveIntParam,
  isUserChainParticipant,
  isUserChainOperationalViewer,
  requireChainParticipantForRoute,
} from "@/lib/auth/chainAccess";

export {
  requirePropertyParticipantForRoute,
} from "@/lib/auth/propertyAccess";
