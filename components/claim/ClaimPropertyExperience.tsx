"use client";

import { useState } from "react";

import ClaimablePropertyCard from "@/components/claim/ClaimablePropertyCard";
import ClaimRejectInvitationDialog from "@/components/claim/ClaimRejectInvitationDialog";
import {
  CARD_PADDING_CLASS,
  PAGE_TITLE_CLASS,
} from "@/components/mobileStandards";
import { claimOperationalProperty } from "@/lib/propertyClaim/claimOperationalProperty";
import type { InvitationRejectionReason } from "@/lib/propertyClaim/invitationRejection";
import { rejectPropertyClaimInvitation } from "@/lib/propertyClaim/propertyInvitations";
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
  const [rejectingPropertyId, setRejectingPropertyId] =
    useState<number | null>(null);
  const [rejectDialogPropertyId, setRejectDialogPropertyId] =
    useState<number | null>(null);
  const [declinedInvitation, setDeclinedInvitation] =
    useState(false);
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

  function handleOpenReject(propertyId: number) {
    setErrorMessage("");
    setRejectDialogPropertyId(propertyId);
  }

  async function handleConfirmReject(
    rejectionReason: InvitationRejectionReason | null
  ) {
    if (rejectDialogPropertyId == null) {
      return;
    }

    if (!invitationToken) {
      setErrorMessage(
        "Open the invitation link from your email to decline this property."
      );
      setRejectDialogPropertyId(null);
      return;
    }

    setRejectingPropertyId(rejectDialogPropertyId);

    const result = await rejectPropertyClaimInvitation(
      supabase,
      invitationToken,
      rejectionReason
    );

    setRejectingPropertyId(null);
    setRejectDialogPropertyId(null);

    if (!result.ok) {
      setErrorMessage(
        mapRejectError(result.error)
      );
      return;
    }

    setProperties((current) =>
      current.filter(
        (property) =>
          property.property_id !==
          result.propertyId
      )
    );
    setDeclinedInvitation(true);
  }

  if (visibleProperties.length === 0) {
    return (
      <div
        className={`rounded-3xl border border-slate-200 bg-white text-center shadow-sm ${CARD_PADDING_CLASS}`}
      >
        <h2 className="text-xl font-bold text-slate-900">
          {declinedInvitation
            ? "Invitation declined"
            : "No properties to claim"}
        </h2>

        <p className="mt-3 text-slate-600">
          {declinedInvitation
            ? "Your estate agent has been informed. You can accept a new invitation later if needed."
            : highlightPropertyId != null
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
            isRejecting={
              rejectingPropertyId ===
              property.property_id
            }
            onClaim={handleClaim}
            onReject={handleOpenReject}
          />
        ))}
      </div>

      <ClaimRejectInvitationDialog
        isOpen={rejectDialogPropertyId != null}
        isSubmitting={
          rejectingPropertyId != null
        }
        onClose={() =>
          setRejectDialogPropertyId(null)
        }
        onConfirm={handleConfirmReject}
      />
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
    case "invitation_declined":
      return "This invitation has already been declined.";
    default:
      return "Could not claim this property. Please try again.";
  }
}

function mapRejectError(error: string): string {
  switch (error) {
    case "expired":
      return "This invitation has expired. Contact your estate agent if you need a new one.";
    case "already_used":
      return "This invitation has already been used.";
    case "already_claimed":
      return "This property has already been claimed.";
    case "email_mismatch":
      return "Sign in with the email address your estate agent used for this invitation.";
    case "invitation_declined":
      return "This invitation has already been declined.";
    case "invalid_rejection_reason":
      return "Please choose one of the provided reasons.";
    default:
      return "Could not decline this invitation. Please try again.";
  }
}
