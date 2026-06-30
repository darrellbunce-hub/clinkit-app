import {
  getClaimStatusBadgeClasses,
  getClaimStatusBadgeLabel,
  getClaimStatusBadgeVariant,
} from "@/lib/propertyClaim/presentation";
import type { PropertyClaimStatus } from "@/lib/propertyClaim/types";

export default function ClaimStatusBadge({
  claimStatus,
}: {
  claimStatus: PropertyClaimStatus | string | null | undefined;
}) {
  const normalizedStatus =
    (claimStatus as PropertyClaimStatus | null) ??
    "unclaimed";
  const variant =
    getClaimStatusBadgeVariant(normalizedStatus);
  const label =
    getClaimStatusBadgeLabel(normalizedStatus);

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${getClaimStatusBadgeClasses(variant)}`}
    >
      <span aria-hidden="true">
        {variant === "claimed"
          ? "🟢"
          : "⚪"}
      </span>

      {label}
    </span>
  );
}
