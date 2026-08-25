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
  isTransactionParticipationRoute,
  TRANSACTION_PARTICIPATION_PREFIXES,
  isEstateAgentOnboardingRoute,
  isAgentHomeRoute,
  isAccountGatedRoute,
} from "@/lib/auth/routes";

export {
  resolvePostLoginRedirect,
  resolveLoginPathForAccountType,
  resolveLoginPathForProtectedRoute,
  buildProtectedRouteNextDestination,
  resolveLoginNextDestination,
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

export {
  PASSWORD_MIN_LENGTH,
  PASSWORD_POLICY,
  getPasswordRequirementStates,
  validatePasswordPolicy,
  validateNewPassword,
  validatePasswordForSignUp,
  mapPasswordUpdateError,
  mapPasswordRecoveryError,
} from "@/lib/auth/passwordPolicy";

export {
  mapAuthSignInError,
  mapAuthSignUpError,
} from "@/lib/auth/authErrors";

export {
  isEmailVerified,
} from "@/lib/auth/emailVerification";

export {
  EMAIL_VERIFICATION_REQUIRED_ERROR,
  EMAIL_VERIFICATION_TRANSACTION_MESSAGE,
  EMAIL_VERIFICATION_ACCOUNT_ACCESS_MESSAGE,
  buildVerifyEmailRedirectPath,
  isEmailVerificationRequiredError,
  mapTransactionParticipationError,
} from "@/lib/auth/emailVerificationGate";
