const ALLOWED_ADMIN_PREFIXES = ["/admin/privacy", "/admin/mfa"] as const;

/**
 * Sanitises post-MFA return paths. Rejects open redirects and non-admin targets.
 */
export function sanitizeAdminNextPath(
  nextPath: string | null | undefined
): string | null {
  if (!nextPath) {
    return null;
  }

  const trimmed = nextPath.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) {
    return null;
  }

  if (trimmed.includes("://") || trimmed.includes("\\")) {
    return null;
  }

  const normalized = trimmed.split("?")[0]?.split("#")[0] ?? trimmed;

  const allowed = ALLOWED_ADMIN_PREFIXES.some(
    (prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`)
  );

  if (!allowed) {
    return null;
  }

  return trimmed;
}

export function buildAdminMfaEnrollPath(nextPath?: string | null): string {
  const safeNext = sanitizeAdminNextPath(nextPath);
  if (!safeNext) {
    return "/admin/mfa/enroll";
  }
  return `/admin/mfa/enroll?next=${encodeURIComponent(safeNext)}`;
}

export function buildAdminMfaChallengePath(nextPath?: string | null): string {
  const safeNext = sanitizeAdminNextPath(nextPath);
  if (!safeNext) {
    return "/admin/mfa/challenge";
  }
  return `/admin/mfa/challenge?next=${encodeURIComponent(safeNext)}`;
}
