import { ROUTES } from "@/lib/auth/routes";
import { getAppBaseUrl } from "@/lib/communications/config";

export function buildServerClaimInvitationUrl(token: string): string {
  const url = new URL(ROUTES.claimProperty, getAppBaseUrl());
  url.searchParams.set("token", token.trim());
  return url.toString();
}

export function buildServerEaBranchInvitationUrl(token: string): string {
  const url = new URL(ROUTES.estateAgentJoin, getAppBaseUrl());
  url.searchParams.set("token", token.trim());
  return url.toString();
}
