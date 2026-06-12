"use client";

import { useState } from "react";

import {
  COMPLETION_SCHEDULING_GUIDANCE,
  COMPLETION_SCHEDULING_SUPPORTING_TEXT,
} from "@/lib/completionLifecycle";

type RecordCompletionDateFormProps = {
  onSubmit: (
    scheduledDate: string
  ) => Promise<{ ok: boolean; message?: string }>;
  variant?: "standalone" | "embedded";
};

export default function RecordCompletionDateForm({
  onSubmit,
  variant = "standalone",
}: RecordCompletionDateFormProps) {
  const [scheduledDate, setScheduledDate] =
    useState("");
  const [isSaving, setIsSaving] =
    useState(false);
  const [errorMessage, setErrorMessage] =
    useState("");
  const [successMessage, setSuccessMessage] =
    useState("");

  async function handleSubmit() {
    if (isSaving) {
      return;
    }

    setErrorMessage("");
    setSuccessMessage("");
    setIsSaving(true);

    const result = await onSubmit(scheduledDate);

    if (result.ok) {
      setSuccessMessage(
        "Agreed completion date recorded for this chain."
      );
      setScheduledDate("");
    } else {
      setErrorMessage(
        result.message ||
          "Could not record the agreed completion date."
      );
    }

    setIsSaving(false);
  }

  const formContent = (
    <>
      {variant === "standalone" && (
        <>
          <h2 className="text-2xl font-bold text-slate-900">
            Record agreed completion date
          </h2>

          <p className="mt-4 text-slate-700">
            {COMPLETION_SCHEDULING_GUIDANCE}
          </p>

          <p className="mt-2 text-sm text-slate-500">
            {COMPLETION_SCHEDULING_SUPPORTING_TEXT}
          </p>
        </>
      )}

      {variant === "embedded" && (
        <>
          <p className="text-slate-700">
            {COMPLETION_SCHEDULING_GUIDANCE}
          </p>

          <p className="mt-2 text-sm text-slate-600">
            {COMPLETION_SCHEDULING_SUPPORTING_TEXT}
          </p>
        </>
      )}

      <label className="mt-6 block text-sm font-medium text-slate-700">
        Agreed completion date
      </label>

      <input
        type="date"
        value={scheduledDate}
        onChange={(event) =>
          setScheduledDate(event.target.value)
        }
        className="mt-2 w-full max-w-sm rounded-2xl border border-slate-300 px-4 py-3 text-slate-900"
      />

      <button
        type="button"
        onClick={handleSubmit}
        disabled={!scheduledDate || isSaving}
        className="mt-6 rounded-2xl bg-slate-900 px-6 py-4 font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-400"
      >
        {isSaving
          ? "Saving..."
          : "Record agreed completion date"}
      </button>

      {errorMessage && (
        <p className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
          {errorMessage}
        </p>
      )}

      {successMessage && (
        <p className="mt-4 rounded-2xl border border-green-200 bg-green-50 px-4 py-3 text-sm font-medium text-green-800">
          {successMessage}
        </p>
      )}
    </>
  );

  if (variant === "embedded") {
    return <div>{formContent}</div>;
  }

  return (
    <div className="mt-8 rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
      {formContent}
    </div>
  );
}
