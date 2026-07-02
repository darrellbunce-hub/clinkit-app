"use client";

import {
  CARD_PADDING_CLASS,
} from "@/components/mobileStandards";
import type { ClaimablePropertySummary } from "@/lib/propertyClaim/types";
import { BTN_PRIMARY_SM_CLASS } from "@/lib/theme/themeTokens";

function formatPropertyAddress(
  property: ClaimablePropertySummary
): string {
  const parts = [
    property.address,
    property.postcode,
  ].filter(Boolean);

  if (parts.length === 0) {
    return "Property address pending";
  }

  return parts.join(", ");
}

export default function ClaimablePropertyCard({
  property,
  isClaiming,
  onClaim,
}: {
  property: ClaimablePropertySummary;
  isClaiming: boolean;
  onClaim: (propertyId: number) => void;
}) {
  return (
    <article
      className={`rounded-3xl border border-slate-200 bg-white shadow-sm ${CARD_PADDING_CLASS}`}
    >
      <div className="space-y-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900">
            {formatPropertyAddress(property)}
          </h2>

          <p className="mt-2 text-slate-600">
            Managed by{" "}
            <span className="font-medium text-slate-800">
              {property.branch_name}
            </span>
          </p>
        </div>

        <p className="text-sm text-slate-600">
          {property.in_chain
            ? "This property is already part of an active chain."
            : "This property is not yet connected to other chain participants."}
        </p>

        <button
          type="button"
          disabled={isClaiming}
          onClick={() =>
            onClaim(property.property_id)
          }
          className={`w-full rounded-xl px-5 py-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60 ${BTN_PRIMARY_SM_CLASS}`}
        >
          {isClaiming
            ? "Claiming..."
            : "Claim this property"}
        </button>
      </div>
    </article>
  );
}
