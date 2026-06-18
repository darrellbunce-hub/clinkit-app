"use client";

import { useState } from "react";

import {
  COMPLETION_CONFIRMATION_MODAL_NOTICE,
  COMPLETION_CONFIRMATION_MODAL_TITLE,
  formatCompletionScheduledDate,
} from "@/lib/completionLifecycle";
import {
  MobileModal,
  MODAL_ACTIONS_CLASS,
} from "@/components/mobile/MobileLayout";
import { SECTION_TITLE_CLASS } from "@/components/mobileStandards";

type ConfirmCompletionModalProps = {
  isOpen: boolean;
  scheduledDate: string;
  onClose: () => void;
  onConfirm: () => Promise<{ ok: boolean; message?: string }>;
};

export default function ConfirmCompletionModal({
  isOpen,
  scheduledDate,
  onClose,
  onConfirm,
}: ConfirmCompletionModalProps) {
  const [isSaving, setIsSaving] =
    useState(false);
  const [errorMessage, setErrorMessage] =
    useState("");

  if (!isOpen) {
    return null;
  }

  async function handleConfirm() {
    if (isSaving) {
      return;
    }

    setIsSaving(true);
    setErrorMessage("");

    const result = await onConfirm();

    if (result.ok) {
      onClose();
    } else {
      setErrorMessage(
        result.message ||
          "Could not confirm completion."
      );
    }

    setIsSaving(false);
  }

  return (
    <MobileModal
      onClose={onClose}
      ariaLabelledBy="confirm-completion-title"
    >
      <h2
        id="confirm-completion-title"
        className={SECTION_TITLE_CLASS}
      >
        {COMPLETION_CONFIRMATION_MODAL_TITLE}
      </h2>

      <p className="mt-4 text-slate-700">
        {COMPLETION_CONFIRMATION_MODAL_NOTICE}
      </p>

      <div className="mt-6 rounded-2xl bg-slate-50 p-5">
        <p className="text-sm font-medium text-slate-600">
          Completion Date:
        </p>
        <p className="mt-1 text-lg font-semibold text-slate-900">
          {formatCompletionScheduledDate(
            scheduledDate
          )}
        </p>
      </div>

      {errorMessage && (
        <p className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
          {errorMessage}
        </p>
      )}

      <div className={MODAL_ACTIONS_CLASS}>
        <button
          type="button"
          onClick={onClose}
          disabled={isSaving}
          className="rounded-2xl border border-slate-300 px-5 py-3 font-semibold text-slate-700"
        >
          Cancel
        </button>

        <button
          type="button"
          onClick={handleConfirm}
          disabled={isSaving}
          className="rounded-2xl bg-slate-900 px-5 py-3 font-semibold text-white disabled:bg-slate-400"
        >
          {isSaving
            ? "Confirming..."
            : "Confirm Completion"}
        </button>
      </div>
    </MobileModal>
  );
}
