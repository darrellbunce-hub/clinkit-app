"use client";

import { useState } from "react";

import {
  COMPLETION_AMENDMENT_CONFIRMATION_INTRO,
  COMPLETION_AMENDMENT_REASONS,
  COMPLETION_AMENDMENT_SOLICITOR_NOTICE,
  COMPLETION_SCHEDULING_GUIDANCE,
  formatCompletionScheduledDate,
  getCompletionAmendmentReasonLabel,
  type CompletionAmendmentReasonCode,
} from "@/lib/completionLifecycle";

type ChangeCompletionDateModalProps = {
  isOpen: boolean;
  currentDate: string;
  onClose: () => void;
  onConfirm: (
    newDate: string,
    reasonCode: CompletionAmendmentReasonCode
  ) => Promise<{ ok: boolean; message?: string }>;
};

export default function ChangeCompletionDateModal({
  isOpen,
  currentDate,
  onClose,
  onConfirm,
}: ChangeCompletionDateModalProps) {
  const [step, setStep] =
    useState<"form" | "confirm">("form");
  const [newDate, setNewDate] =
    useState("");
  const [reasonCode, setReasonCode] =
    useState("");
  const [isSaving, setIsSaving] =
    useState(false);
  const [errorMessage, setErrorMessage] =
    useState("");

  if (!isOpen) {
    return null;
  }

  function handleClose() {
    setStep("form");
    setNewDate("");
    setReasonCode("");
    setErrorMessage("");
    onClose();
  }

  function handleContinue() {
    if (!newDate || !reasonCode) {
      setErrorMessage(
        "Enter a new completion date and select a reason."
      );

      return;
    }

    setErrorMessage("");
    setStep("confirm");
  }

  async function handleConfirm() {
    if (
      !newDate ||
      !reasonCode ||
      isSaving
    ) {
      return;
    }

    setIsSaving(true);
    setErrorMessage("");

    const result = await onConfirm(
      newDate,
      reasonCode as CompletionAmendmentReasonCode
    );

    if (result.ok) {
      handleClose();
    } else {
      setErrorMessage(
        result.message ||
          "Could not update the completion date."
      );
      setStep("form");
    }

    setIsSaving(false);
  }

  const formattedCurrentDate =
    formatCompletionScheduledDate(currentDate);

  const formattedNewDate = newDate
    ? formatCompletionScheduledDate(newDate)
    : "";

  const formattedReason = reasonCode
    ? getCompletionAmendmentReasonLabel(
        reasonCode as CompletionAmendmentReasonCode
      )
    : "";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-4">
      <div className="w-full max-w-xl rounded-3xl border border-slate-200 bg-white p-8 shadow-xl">
        {step === "form" ? (
          <>
            <h2 className="text-2xl font-bold text-slate-900">
              Change Completion Date
            </h2>

            <p className="mt-4 text-sm font-medium text-slate-700">
              Current completion date:
            </p>
            <p className="mt-1 text-lg font-semibold text-slate-900">
              {formattedCurrentDate}
            </p>

            <label className="mt-6 block text-sm font-medium text-slate-700">
              New completion date
            </label>
            <input
              type="date"
              value={newDate}
              onChange={(event) =>
                setNewDate(event.target.value)
              }
              className="mt-2 w-full rounded-2xl border border-slate-300 px-4 py-3 text-slate-900"
            />

            <label className="mt-6 block text-sm font-medium text-slate-700">
              Reason
            </label>
            <select
              value={reasonCode}
              onChange={(event) =>
                setReasonCode(event.target.value)
              }
              className="mt-2 w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-slate-900"
            >
              <option value="">
                Select a reason
              </option>
              {COMPLETION_AMENDMENT_REASONS.map(
                (reason) => (
                  <option
                    key={reason.code}
                    value={reason.code}
                  >
                    {reason.label}
                  </option>
                )
              )}
            </select>

            <p className="mt-4 text-sm text-slate-600">
              {COMPLETION_SCHEDULING_GUIDANCE}
            </p>

            {errorMessage && (
              <p className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
                {errorMessage}
              </p>
            )}

            <div className="mt-6 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={handleClose}
                className="rounded-2xl border border-slate-300 px-5 py-3 font-semibold text-slate-700"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={handleContinue}
                className="rounded-2xl bg-slate-900 px-5 py-3 font-semibold text-white"
              >
                Continue
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 className="text-2xl font-bold text-slate-900">
              Confirm Date Change
            </h2>

            <p className="mt-4 text-slate-700">
              {COMPLETION_AMENDMENT_CONFIRMATION_INTRO}
            </p>

            <div className="mt-6 space-y-4 rounded-2xl bg-slate-50 p-5">
              <div>
                <p className="text-sm font-medium text-slate-600">
                  Current:
                </p>
                <p className="text-lg font-semibold text-slate-900">
                  {formattedCurrentDate}
                </p>
              </div>

              <div>
                <p className="text-sm font-medium text-slate-600">
                  New:
                </p>
                <p className="text-lg font-semibold text-slate-900">
                  {formattedNewDate}
                </p>
              </div>

              <div>
                <p className="text-sm font-medium text-slate-600">
                  Reason:
                </p>
                <p className="text-lg font-semibold text-slate-900">
                  {formattedReason}
                </p>
              </div>
            </div>

            <p className="mt-4 text-sm text-slate-600">
              {COMPLETION_AMENDMENT_SOLICITOR_NOTICE}
            </p>

            {errorMessage && (
              <p className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
                {errorMessage}
              </p>
            )}

            <div className="mt-6 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => {
                  setStep("form");
                  setErrorMessage("");
                }}
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
                  ? "Saving..."
                  : "Confirm Date Change"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
