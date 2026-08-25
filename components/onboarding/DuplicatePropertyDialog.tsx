"use client";

import {
  BTN_PRIMARY_CLASS,
  BTN_SECONDARY_OUTLINE_CLASS,
} from "@/lib/theme/themeTokens";

type DuplicatePropertyDialogProps = {
  isOpen: boolean;
  isPending?: boolean;
  onJoinExisting: () => void;
  onCancel: () => void;
};

export default function DuplicatePropertyDialog({
  isOpen,
  isPending = false,
  onJoinExisting,
  onCancel,
}: DuplicatePropertyDialogProps) {
  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 px-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="duplicate-property-dialog-title"
        aria-describedby="duplicate-property-dialog-description"
        className="w-full max-w-md rounded-3xl border border-surface-card-border bg-surface-card p-8 shadow-xl"
      >
        <h2
          id="duplicate-property-dialog-title"
          className="text-xl font-bold text-text-charcoal"
        >
          This property is already part of Keynetic
        </h2>

        <div
          id="duplicate-property-dialog-description"
          className="mt-4 space-y-3 text-sm leading-6 text-text-muted"
        >
          <p>
            We found an existing property chain for this address.
          </p>

          <p>
            Rather than creating another chain, you can join the existing
            chain instead.
          </p>
        </div>

        <div className="mt-8 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            disabled={isPending}
            onClick={onCancel}
            className={`rounded-2xl px-5 py-3 text-sm font-semibold ${BTN_SECONDARY_OUTLINE_CLASS}`}
          >
            Cancel
          </button>

          <button
            type="button"
            disabled={isPending}
            onClick={onJoinExisting}
            className={`rounded-2xl px-5 py-3 text-sm font-semibold ${BTN_PRIMARY_CLASS}`}
          >
            Join Existing Chain
          </button>
        </div>
      </div>
    </div>
  );
}
