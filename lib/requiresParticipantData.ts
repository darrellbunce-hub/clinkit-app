import { normalizePathname } from "@/lib/auth/routes";

/**
 * Routes that consume ChainContext participant data (properties, activities,
 * chain nodes, chains). All other routes resolve auth only.
 */
export function requiresParticipantData(
  pathname: string
): boolean {
  const path = normalizePathname(pathname);

  if (
    path === "/dashboard" ||
    path === "/my-chains"
  ) {
    return true;
  }

  if (
    path.startsWith("/chain/") ||
    path.startsWith("/property/") ||
    path.startsWith("/buyer-ready/")
  ) {
    return true;
  }

  return false;
}
