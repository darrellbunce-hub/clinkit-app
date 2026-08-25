"use client";

import { useEffect, useState } from "react";

import {
  MobileModal,
  MODAL_ACTIONS_CLASS,
} from "@/components/mobile/MobileLayout";
import { SECTION_TITLE_CLASS } from "@/components/mobileStandards";
import type { ParticipationDelinkConfirmationCopy } from "@/lib/ownership/participationDelinkPresentation";
import {
  getParticipationDelinkReasonOptions,
  type ParticipationDelinkReasonCode,
  type ParticipationDelinkReasonOption,
} from "@/lib/ownership/participationDelinkReasonCodes";
import type { ParticipationDelinkOperation } from "@/lib/ownership/participationDelinkTypes";

type ParticipationDelinkConfirmModalProps = {
  isOpen: boolean;
  operation: ParticipationDelinkOperation;
  copy: ParticipationDelinkConfirmationCopy;
  onClose: () => void;
  onConfirm: (
    reasonCode: ParticipationDelinkReasonCode
  ) => Promise<{ ok: boolean; message?: string }>;
};

export default function ParticipationDelinkConfirmModal({
  isOpen,
  operation,
  copy,
  onClose,
  onConfirm,
}: ParticipationDelinkConfirmModalProps) {
  const [isSaving, setIsSaving] = useState(false);
  const [selectedReasonCode, setSelectedReasonCode] =
    useState<ParticipationDelinkReasonCode | "">("");
  const [errorMessage, setErrorMessage] = useState("");

  const reasonOptions: ParticipationDelinkReasonOption[] =
    getParticipationDelinkReasonOptions(operation);

  useEffect(() => {
    if (!isOpen) {
      setSelectedReasonCode("");
      setErrorMessage("");
    }
  }, [isOpen, operation]);

  if (!isOpen) {
    return null;
  }

  async function handleConfirm() {
    if (isSaving || !selectedReasonCode) {
      return;
    }

    setIsSaving(true);
    setErrorMessage("");

    const result = await onConfirm(selectedReasonCode);

    if (result.ok) {
      setSelectedReasonCode("");
      onClose();
    } else {
      setErrorMessage(
        result.message ?? "Could not complete this de-link."
      );
    }

    setIsSaving(false);
  }

  function handleClose() {
    if (isSaving) {
      return;
    }

    setSelectedReasonCode("");
    setErrorMessage("");
    onClose();
  }

  return (
    <MobileModal
      onClose={handleClose}
      ariaLabelledBy="participation-delink-title"
    >
      <h2
        id="participation-delink-title"
        className={SECTION_TITLE_CLASS}
      >
        {copy.title}
      </h2>

      <p className="mt-4 text-slate-700">{copy.body}</p>

      <fieldset className="mt-6 space-y-3">
        <legend className="text-sm font-medium text-slate-700">
          Reason
        </legend>

        {reasonOptions.map((option) => (
          <label
            key={option.code}
            className="flex cursor-pointer items-start gap-3 rounded-2xl border border-slate-200 px-4 py-3 has-[:checked]:border-slate-900 has-[:checked]:bg-slate-50"
          >
            <input
              type="radio"
              name="delink-reason-code"
              value={option.code}
              checked={selectedReasonCode === option.code}
              onChange={() => setSelectedReasonCode(option.code)}
              disabled={isSaving}
              className="mt-1"
            />

            <span className="text-sm text-slate-900">{option.label}</span>
          </label>
        ))}
      </fieldset>

      {errorMessage ? (
        <p className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
          {errorMessage}
        </p>
      ) : null}

      <div className={MODAL_ACTIONS_CLASS}>
        <button
          type="button"
          onClick={handleClose}
          disabled={isSaving}
          className="rounded-2xl border border-slate-300 px-5 py-3 font-semibold text-slate-700"
        >
          Cancel
        </button>

        <button
          type="button"
          onClick={() => void handleConfirm()}
          disabled={isSaving || !selectedReasonCode}
          className={`rounded-2xl px-5 py-3 font-semibold text-white disabled:opacity-60 ${
            copy.destructive
              ? "bg-red-600 hover:bg-red-700"
              : "bg-slate-900 hover:bg-slate-800"
          }`}
        >
          {isSaving ? "Processing…" : copy.confirmLabel}
        </button>
      </div>
    </MobileModal>
  );
}
