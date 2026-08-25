import type { ChainHealthStatus } from "@/lib/chainIntelligence";

export function mapChainHealthStatusToSlug(
  status: ChainHealthStatus
): string {
  switch (status) {
    case "Stable":
      return "stable";
    case "Active":
      return "active";
    case "At Risk":
      return "at_risk";
    case "Replacement Buyer Required":
      return "replacement_buyer_required";
  }
}

export function mapChainHealthSlugToLabel(
  slug: string
): string {
  switch (slug) {
    case "stable":
      return "Stable";
    case "active":
      return "Active";
    case "at_risk":
      return "At Risk";
    case "replacement_buyer_required":
      return "Replacement Buyer Required";
    default:
      return slug;
  }
}
