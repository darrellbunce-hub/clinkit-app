"use client";

import { useState } from "react";

import ClaimablePropertyCard from "@/components/claim/ClaimablePropertyCard";
import {
  CARD_PADDING_CLASS,
  PAGE_TITLE_CLASS,
} from "@/components/mobileStandards";
import { claimOperationalProperty } from "@/lib/propertyClaim/claimOperationalProperty";
import type { ClaimablePropertySummary } from "@/lib/propertyClaim/types";
import { supabase } from "@/lib/supabase";

export default function ClaimPropertyExperience({
  initialProperties,
  highlightPropertyId = null,
  invitationToken = null,
  onClaimComplete,
}: {
  initialProperties: ClaimablePropertySummary[];
  highlightPropertyId?: number | null;
  invitationToken?: string | null;
  onClaimComplete: (params: {
    propertyId: number;
    chainId: number;
  }) => void | Promise<void>;
}) {
  const [properties, setProperties] =
    useState(initialProperties);
  const [claimingPropertyId, setClaimingPropertyId] =
    useState<number | null>(null);
  const [errorMessage, setErrorMessage] =
    useState("");

  const visibleProperties =
    highlightPropertyId != null
      ? properties.filter(
          (property) =>
            property.property_id ===
            highlightPropertyId
        )
      : properties;

  async function handleClaim(propertyId: number) {
    setErrorMessage("");
    setClaimingPropertyId(propertyId);

    const result =
      await claimOperationalProperty(
        supabase,
        propertyId,
        invitationToken
      );

    setClaimingPropertyId(null);

    if (!result.ok) {
      setErrorMessage(
        mapClaimError(result.error)
      );
      return;
    }

    setProperties((current) =>
      current.filter(
        (property) =>
          property.property_id !== propertyId
      )
    );

    await onClaimComplete({
      propertyId: result.propertyId,
      chainId: result.chainId,
    });
  }

  if (visibleProperties.length === 0) {
    return (
      <div
        className={`rounded-3xl border border-slate-200 bg-white text-center shadow-sm ${CARD_PADDING_CLASS}`}
      >
        <h2 className="text-xl font-bold text-slate-900">
          No properties to claim
        </h2>

        <p className="mt-3 text-slate-600">
          {highlightPropertyId != null
            ? "This claim link is no longer valid or the property has already been claimed."
            : "There are no managed properties waiting for your claim right now."}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className={PAGE_TITLE_CLASS}>
          Claim Your Property
        </h1>

        <p className="mt-3 text-lg text-slate-600">
          An estate agent has set up a property using
          your email. Review the details below and claim
          operational ownership when you are ready.
        </p>
      </div>

      {errorMessage ? (
        <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {errorMessage}
        </p>
      ) : null}

      <div className="grid gap-5">
        {visibleProperties.map((property) => (
          <ClaimablePropertyCard
            key={property.property_id}
            property={property}
            isClaiming={
              claimingPropertyId ===
              property.property_id
            }
            onClaim={handleClaim}
          />
        ))}
      </div>
    </div>
  );
}

function mapClaimError(error: string): string {
  switch (error) {
    case "not_claimable":
      return "This property is no longer available to claim.";
    case "already_member":
      return "You are already linked to this property.";
    case "homeowner_only":
      return "Only homeowner accounts can claim managed properties.";
    case "email_required":
      return "Your account must have a verified email address to claim a property.";
    default:
      return "Could not claim this property. Please try again.";
  }
}
