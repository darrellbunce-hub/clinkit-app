"use client";

import { BTN_PRIMARY_SM_CLASS, BTN_SECONDARY_OUTLINE_SM_CLASS } from "@/lib/theme/themeTokens";

type TeamActionConfirmDialogProps = {
  isOpen: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  isPending?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
};

export default function TeamActionConfirmDialog({
  isOpen,
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  isPending = false,
  onConfirm,
  onCancel,
}: TeamActionConfirmDialogProps) {
  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 px-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="team-action-confirm-title"
        className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl"
      >
        <h3
          id="team-action-confirm-title"
          className="text-lg font-bold text-slate-900"
        >
          {title}
        </h3>

        <p className="mt-3 text-sm leading-6 text-slate-600">
          {description}
        </p>

        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            disabled={isPending}
            onClick={onCancel}
            className={`rounded-lg px-4 py-2 text-sm font-medium ${BTN_SECONDARY_OUTLINE_SM_CLASS}`}
          >
            {cancelLabel}
          </button>

          <button
            type="button"
            disabled={isPending}
            onClick={() => void onConfirm()}
            className={`rounded-lg px-4 py-2 text-sm font-semibold ${BTN_PRIMARY_SM_CLASS}`}
          >
            {isPending ? "Please wait..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
