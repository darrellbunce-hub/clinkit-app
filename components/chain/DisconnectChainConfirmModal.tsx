"use client";

import { useState } from "react";

import {
  MobileModal,
  MODAL_ACTIONS_CLASS,
} from "@/components/mobile/MobileLayout";
import { SECTION_TITLE_CLASS } from "@/components/mobileStandards";

export const DISCONNECT_CHAIN_BREAK_REASONS = [
  {
    value: "buyer_side",
    label: "My buyer's transaction ended",
  },
  {
    value: "seller_side",
    label: "My purchase transaction ended",
  },
] as const;

export type DisconnectChainBreakReason =
  (typeof DISCONNECT_CHAIN_BREAK_REASONS)[number]["value"];

type DisconnectChainConfirmModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (
    breakReason: DisconnectChainBreakReason
  ) => Promise<{ ok: boolean; message?: string }>;
};

export default function DisconnectChainConfirmModal({
  isOpen,
  onClose,
  onConfirm,
}: DisconnectChainConfirmModalProps) {
  const [isSaving, setIsSaving] = useState(false);
  const [selectedReason, setSelectedReason] = useState<
    DisconnectChainBreakReason | ""
  >("");
  const [errorMessage, setErrorMessage] = useState("");

  if (!isOpen) {
    return null;
  }

  async function handleConfirm() {
    if (isSaving || !selectedReason) {
      return;
    }

    setIsSaving(true);
    setErrorMessage("");

    try {
      const result = await onConfirm(selectedReason);

      if (result.ok) {
        setSelectedReason("");
        onClose();
      } else {
        setErrorMessage(
          result.message ??
            "Could not disconnect this property from the chain."
        );
      }
    } finally {
      setIsSaving(false);
    }
  }

  function handleClose() {
    if (isSaving) {
      return;
    }

    setSelectedReason("");
    setErrorMessage("");
    onClose();
  }

  return (
    <MobileModal
      onClose={handleClose}
      ariaLabelledBy="disconnect-chain-title"
    >
      <h2
        id="disconnect-chain-title"
        className={SECTION_TITLE_CLASS}
      >
        Disconnect from chain?
      </h2>

      <p className="mt-4 text-slate-700">
        This removes the MoveLoop link between this property and
        neighbouring properties in the chain. It does not cancel your
        real-world sale or purchase, and it does not delete your MoveLoop
        account. Chain confidence and progression on MoveLoop may change.
        This cannot be undone from this screen.
      </p>

      <fieldset className="mt-6 space-y-3">
        <legend className="text-sm font-medium text-slate-700">
          Reason
        </legend>

        {DISCONNECT_CHAIN_BREAK_REASONS.map((option) => (
          <label
            key={option.value}
            className="flex cursor-pointer items-start gap-3 rounded-2xl border border-slate-200 px-4 py-3 has-[:checked]:border-slate-900 has-[:checked]:bg-slate-50"
          >
            <input
              type="radio"
              name="disconnect-chain-reason"
              value={option.value}
              checked={selectedReason === option.value}
              onChange={() => setSelectedReason(option.value)}
              disabled={isSaving}
              className="mt-1"
            />

            <span className="text-sm text-slate-900">
              {option.label}
            </span>
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
          disabled={isSaving || !selectedReason}
          className="rounded-2xl bg-red-600 px-5 py-3 font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSaving ? "Disconnecting…" : "Disconnect from chain"}
        </button>
      </div>
    </MobileModal>
  );
}
