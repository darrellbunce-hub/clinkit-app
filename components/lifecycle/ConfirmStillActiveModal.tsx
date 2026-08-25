"use client";

import { useState } from "react";

import {
  CONFIRM_STILL_ACTIVE_MODAL_MESSAGE,
  CONFIRM_STILL_ACTIVE_MODAL_PRIMARY,
  CONFIRM_STILL_ACTIVE_MODAL_SECONDARY,
  CONFIRM_STILL_ACTIVE_MODAL_TITLE,
} from "@/lib/lifecycle/dormancyConfirmationPresentation";
import {
  MobileModal,
  MODAL_ACTIONS_CLASS,
} from "@/components/mobile/MobileLayout";
import { SECTION_TITLE_CLASS, TOUCH_TARGET_CLASS } from "@/components/mobileStandards";
import { BTN_PRIMARY_CLASS } from "@/lib/theme/themeTokens";

const MODAL_SECONDARY_BUTTON_CLASS =
  "rounded-2xl border border-slate-300 px-5 py-3 font-semibold text-slate-700 whitespace-normal text-center";

type ConfirmStillActiveModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => Promise<{ ok: boolean; message?: string }>;
};

export default function ConfirmStillActiveModal({
  isOpen,
  onClose,
  onConfirm,
}: ConfirmStillActiveModalProps) {
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

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
        result.message ?? "Could not confirm that your transaction is still active."
      );
    }

    setIsSaving(false);
  }

  return (
    <MobileModal
      onClose={onClose}
      ariaLabelledBy="confirm-still-active-title"
    >
      <h2
        id="confirm-still-active-title"
        className={`break-words ${SECTION_TITLE_CLASS}`}
      >
        {CONFIRM_STILL_ACTIVE_MODAL_TITLE}
      </h2>

      <p className="mt-4 text-slate-700 break-words">
        {CONFIRM_STILL_ACTIVE_MODAL_MESSAGE}
      </p>

      {errorMessage ? (
        <p className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800 break-words">
          {errorMessage}
        </p>
      ) : null}

      <div className={MODAL_ACTIONS_CLASS}>
        <button
          type="button"
          onClick={onClose}
          disabled={isSaving}
          className={`${MODAL_SECONDARY_BUTTON_CLASS} ${TOUCH_TARGET_CLASS}`}
        >
          {CONFIRM_STILL_ACTIVE_MODAL_SECONDARY}
        </button>

        <button
          type="button"
          onClick={handleConfirm}
          disabled={isSaving}
          className={`${BTN_PRIMARY_CLASS} ${TOUCH_TARGET_CLASS} px-5 py-3 whitespace-normal text-center disabled:opacity-60`}
        >
          {isSaving ? "Confirming..." : CONFIRM_STILL_ACTIVE_MODAL_PRIMARY}
        </button>
      </div>
    </MobileModal>
  );
}
