export const PROPERTY_ORIGIN_TYPES = [
  "homeowner",
  "estate_agent",
] as const;

export type PropertyOriginType =
  (typeof PROPERTY_ORIGIN_TYPES)[number];

export const PROPERTY_CLAIM_STATUSES = [
  "unclaimed",
  "claim_invited",
  "claimed",
] as const;

export type PropertyClaimStatus =
  (typeof PROPERTY_CLAIM_STATUSES)[number];

export type PropertyClaimMetadata = {
  property_id: number;
  origin_type: PropertyOriginType;
  claim_status: PropertyClaimStatus;
  invite_email: string | null;
  invite_display_name: string | null;
  originated_by_user_id: string | null;
  claimed_at: string | null;
  claimed_by_user_id: string | null;
};

export function resolveClaimStatusFromEmail(
  inviteEmail: string | null | undefined
): Extract<PropertyClaimStatus, "unclaimed" | "claim_invited"> {
  const email = inviteEmail?.trim();

  return email ? "claim_invited" : "unclaimed";
}

export function isPropertyClaimed(
  claimStatus: PropertyClaimStatus | null | undefined
): boolean {
  return claimStatus === "claimed";
}
