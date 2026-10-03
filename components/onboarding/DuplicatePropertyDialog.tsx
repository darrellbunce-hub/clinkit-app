"use client";

import {
  BTN_PRIMARY_CLASS,
  BTN_SECONDARY_OUTLINE_CLASS,
} from "@/lib/theme/themeTokens";

export type DuplicatePropertyDialogVariant =
  | "existing"
  | "yours"
  | "awaiting_seller"
  | "awaiting_buyer"
  | "represented";

type DuplicatePropertyDialogProps = {
  isOpen: boolean;
  isPending?: boolean;
  variant?: DuplicatePropertyDialogVariant;
  onJoinExisting: () => void;
  onCancel: () => void;
};

const VARIANT_COPY: Record<
  DuplicatePropertyDialogVariant,
  {
    title: string;
    paragraphs: string[];
    primaryLabel: string | null;
  }
> = {
  existing: {
    title: "This property is already part of MoveLoop",
    paragraphs: [
      "We found an existing property chain for this address.",
      "Rather than creating another chain, you can join the existing chain instead.",
    ],
    primaryLabel: "Join Existing Chain",
  },
  yours: {
    title: "This property is already in your chain",
    paragraphs: [
      "You have already added this address to MoveLoop.",
      "Open your existing chain to continue rather than creating another one.",
    ],
    primaryLabel: "Go to your chain",
  },
  awaiting_seller: {
    title: "This property is already part of MoveLoop",
    paragraphs: [
      "The buyer of this property has already added it to their chain, and it is waiting for its seller to connect.",
      "Join the existing chain using the chain access code you were given. You can add your onward purchase after joining.",
    ],
    primaryLabel: "Join Existing Chain",
  },
  awaiting_buyer: {
    title: "This property is already part of MoveLoop",
    paragraphs: [
      "The property you are buying is already in a chain and is waiting for its buyer to connect.",
      "Join the existing chain using the chain access code you were given. Your sale will be connected to it.",
    ],
    primaryLabel: "Join Existing Chain",
  },
  represented: {
    title: "This property is already part of MoveLoop",
    paragraphs: [
      "This address is already connected in another chain, so it cannot be added again.",
      "If your estate agent invited you, use the link in your invitation to connect. Otherwise, please contact MoveLoop support.",
    ],
    primaryLabel: null,
  },
};

export default function DuplicatePropertyDialog({
  isOpen,
  isPending = false,
  variant = "existing",
  onJoinExisting,
  onCancel,
}: DuplicatePropertyDialogProps) {
  if (!isOpen) {
    return null;
  }

  const copy = VARIANT_COPY[variant];

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
          {copy.title}
        </h2>

        <div
          id="duplicate-property-dialog-description"
          className="mt-4 space-y-3 text-sm leading-6 text-text-muted"
        >
          {copy.paragraphs.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </div>

        <div className="mt-8 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            disabled={isPending}
            onClick={onCancel}
            className={`rounded-2xl px-5 py-3 text-sm font-semibold ${BTN_SECONDARY_OUTLINE_CLASS}`}
          >
            {copy.primaryLabel ? "Cancel" : "Close"}
          </button>

          {copy.primaryLabel ? (
            <button
              type="button"
              disabled={isPending}
              onClick={onJoinExisting}
              className={`rounded-2xl px-5 py-3 text-sm font-semibold ${BTN_PRIMARY_CLASS}`}
            >
              {copy.primaryLabel}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
