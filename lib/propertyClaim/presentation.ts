import type { PropertyClaimStatus } from "@/lib/propertyClaim/types";

export type ClaimStatusBadgeVariant =
  | "awaiting_claim"
  | "claim_invited"
  | "claimed";

export function getClaimStatusBadgeVariant(
  claimStatus: PropertyClaimStatus | null | undefined
): ClaimStatusBadgeVariant {
  switch (claimStatus) {
    case "claim_invited":
      return "claim_invited";
    case "claimed":
      return "claimed";
    default:
      return "awaiting_claim";
  }
}

export function getClaimStatusBadgeLabel(
  claimStatus: PropertyClaimStatus | null | undefined
): string {
  switch (claimStatus) {
    case "claim_invited":
      return "Claim invitation recorded";
    case "claimed":
      return "Claimed";
    default:
      return "Awaiting homeowner claim";
  }
}

export function getClaimStatusBadgeClasses(
  variant: ClaimStatusBadgeVariant
): string {
  switch (variant) {
    case "claimed":
      return "bg-green-100 text-green-800";
    case "claim_invited":
      return "bg-slate-100 text-slate-700";
    default:
      return "bg-slate-100 text-slate-700";
  }
}
