"use client";

import { useState } from "react";

import {
  MobileModal,
  MODAL_ACTIONS_CLASS,
} from "@/components/mobile/MobileLayout";
import { SECTION_TITLE_CLASS } from "@/components/mobileStandards";
import {
  INVITATION_REJECTION_REASONS,
  type InvitationRejectionReason,
} from "@/lib/propertyClaim/invitationRejection";
import {
  BTN_PRIMARY_SM_CLASS,
  BTN_SECONDARY_OUTLINE_SM_CLASS,
} from "@/lib/theme/themeTokens";

type ClaimRejectInvitationDialogProps = {
  isOpen: boolean;
  isSubmitting: boolean;
  onClose: () => void;
  onConfirm: (
    rejectionReason: InvitationRejectionReason | null
  ) => void | Promise<void>;
};

export default function ClaimRejectInvitationDialog({
  isOpen,
  isSubmitting,
  onClose,
  onConfirm,
}: ClaimRejectInvitationDialogProps) {
  const [selectedReason, setSelectedReason] =
    useState<InvitationRejectionReason | null>(null);

  if (!isOpen) {
    return null;
  }

  function handleClose() {
    if (isSubmitting) {
      return;
    }

    setSelectedReason(null);
    onClose();
  }

  async function handleConfirm() {
    await onConfirm(selectedReason);
    setSelectedReason(null);
  }

  return (
    <MobileModal
      onClose={handleClose}
      ariaLabelledBy="reject-invitation-title"
    >
      <h2
        id="reject-invitation-title"
        className={SECTION_TITLE_CLASS}
      >
        Reject invitation?
      </h2>

      <div className="mt-4 space-y-3 text-sm text-slate-600">
        <p>This invitation will be declined.</p>
        <p>
          Your estate agent will be informed that you
          rejected the invitation.
        </p>
        <p>
          You can still receive another invitation later
          if needed.
        </p>
      </div>

      <fieldset className="mt-6 space-y-3">
        <legend className="text-sm font-medium text-slate-700">
          Optional reason (not required)
        </legend>

        {INVITATION_REJECTION_REASONS.map((reason) => (
          <label
            key={reason.value}
            className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 px-4 py-3 hover:bg-slate-50"
          >
            <input
              type="radio"
              name="rejection-reason"
              value={reason.value}
              checked={selectedReason === reason.value}
              disabled={isSubmitting}
              onChange={() =>
                setSelectedReason(reason.value)
              }
              className="mt-0.5"
            />
            <span className="text-sm text-slate-800">
              {reason.label}
            </span>
          </label>
        ))}
      </fieldset>

      <div className={MODAL_ACTIONS_CLASS}>
        <button
          type="button"
          onClick={handleClose}
          disabled={isSubmitting}
          className={`rounded-xl px-5 py-3 text-sm font-semibold disabled:opacity-60 ${BTN_SECONDARY_OUTLINE_SM_CLASS}`}
        >
          Cancel
        </button>

        <button
          type="button"
          onClick={() => void handleConfirm()}
          disabled={isSubmitting}
          className={`rounded-xl px-5 py-3 text-sm font-semibold disabled:opacity-60 ${BTN_PRIMARY_SM_CLASS}`}
        >
          {isSubmitting
            ? "Rejecting..."
            : "Reject Invitation"}
        </button>
      </div>
    </MobileModal>
  );
}
