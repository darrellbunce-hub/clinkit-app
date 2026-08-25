export type AuthenticatorAssuranceLevel = "aal1" | "aal2" | null;

export type PlatformAdminAccessKind =
  | "unauthenticated"
  | "forbidden"
  | "mfa_enrollment_required"
  | "mfa_challenge_required"
  | "privileged_allowed";

export type PlatformAdminAccessState =
  | { kind: "unauthenticated" }
  | { kind: "forbidden" }
  | {
      kind: "mfa_enrollment_required";
      unverifiedFactorIds: string[];
    }
  | {
      kind: "mfa_challenge_required";
      verifiedFactorId: string;
    }
  | {
      kind: "privileged_allowed";
      userId: string;
      assuranceLevel: "aal2";
    };

export type PlatformAdminAccessSignals = {
  userId: string | null;
  isPlatformAdmin: boolean;
  currentLevel: AuthenticatorAssuranceLevel;
  nextLevel: AuthenticatorAssuranceLevel;
  verifiedTotpFactorId: string | null;
  unverifiedTotpFactorIds: string[];
};

export function resolvePlatformAdminAccess(
  signals: PlatformAdminAccessSignals
): PlatformAdminAccessState {
  if (!signals.userId) {
    return { kind: "unauthenticated" };
  }

  if (!signals.isPlatformAdmin) {
    return { kind: "forbidden" };
  }

  if (!signals.verifiedTotpFactorId) {
    return {
      kind: "mfa_enrollment_required",
      unverifiedFactorIds: signals.unverifiedTotpFactorIds,
    };
  }

  if (signals.currentLevel !== "aal2") {
    return {
      kind: "mfa_challenge_required",
      verifiedFactorId: signals.verifiedTotpFactorId,
    };
  }

  return {
    kind: "privileged_allowed",
    userId: signals.userId,
    assuranceLevel: "aal2",
  };
}

export function isPrivilegedPlatformAdminAccess(
  state: PlatformAdminAccessState
): state is Extract<PlatformAdminAccessState, { kind: "privileged_allowed" }> {
  return state.kind === "privileged_allowed";
}

export function requiresMfaEnrollment(
  state: PlatformAdminAccessState
): state is Extract<PlatformAdminAccessState, { kind: "mfa_enrollment_required" }> {
  return state.kind === "mfa_enrollment_required";
}

export function requiresMfaChallenge(
  state: PlatformAdminAccessState
): state is Extract<PlatformAdminAccessState, { kind: "mfa_challenge_required" }> {
  return state.kind === "mfa_challenge_required";
}
