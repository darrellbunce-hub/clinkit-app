"use client";

import { useState } from "react";

import LegalAcceptanceFields from "@/components/legal/LegalAcceptanceFields";
import { ROUTES } from "@/lib/auth/routes";
import {
  SIGNUP_LEGAL_ACCEPTANCE_ERROR,
  SIGNUP_LEGAL_ACCEPTANCE_RETRY_FAILED_MESSAGE,
  SUPPORT_EMAIL,
  SUPPORT_MAILTO,
} from "@/lib/legal/constants";
import {
  ensurePendingSignupLegalAcceptanceFlushed,
  isSignupLegalAcceptanceComplete,
  recordExplicitSignupLegalAcceptance,
} from "@/lib/legal/recordSignupLegalAcceptance";
import { supabase } from "@/lib/supabase";
import Link from "next/link";

type SignupLegalAcceptanceRecoveryPanelProps = {
  mode: "expired" | "persist_failed";
  message: string | null;
  onCleared: () => void;
};

export default function SignupLegalAcceptanceRecoveryPanel({
  mode,
  message,
  onCleared,
}: SignupLegalAcceptanceRecoveryPanelProps) {
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [localError, setLocalError] = useState("");
  const [isWorking, setIsWorking] = useState(false);

  async function retryPersist() {
    setLocalError("");
    setIsWorking(true);

    try {
      const result =
        await ensurePendingSignupLegalAcceptanceFlushed(supabase);

      if (
        result.ok &&
        (result.disposition === "absent" ||
          result.disposition === "flushed")
      ) {
        onCleared();
        return;
      }

      setLocalError(
        result.message ??
          SIGNUP_LEGAL_ACCEPTANCE_RETRY_FAILED_MESSAGE
      );
    } catch {
      setLocalError(SIGNUP_LEGAL_ACCEPTANCE_RETRY_FAILED_MESSAGE);
    } finally {
      setIsWorking(false);
    }
  }

  async function submitFreshAcceptance() {
    setLocalError("");

    if (
      !isSignupLegalAcceptanceComplete(
        termsAccepted,
        privacyAccepted
      )
    ) {
      setLocalError(SIGNUP_LEGAL_ACCEPTANCE_ERROR);
      return;
    }

    setIsWorking(true);

    try {
      const result =
        await recordExplicitSignupLegalAcceptance(supabase);

      if (result.ok) {
        onCleared();
        return;
      }

      setLocalError(
        result.error ??
          SIGNUP_LEGAL_ACCEPTANCE_RETRY_FAILED_MESSAGE
      );
    } catch {
      setLocalError(SIGNUP_LEGAL_ACCEPTANCE_RETRY_FAILED_MESSAGE);
    } finally {
      setIsWorking(false);
    }
  }

  const shownError = localError || message;
  const needsSignIn = (shownError ?? "")
    .toLowerCase()
    .includes("sign in");

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 text-left text-slate-800">
      {shownError ? (
        <p role="alert" className="text-sm text-red-800">
          {shownError}
        </p>
      ) : null}

      {mode === "expired" ? (
        <div className="mt-4">
          <LegalAcceptanceFields
            variant="homeowner"
            termsAccepted={termsAccepted}
            privacyAccepted={privacyAccepted}
            onTermsAcceptedChange={setTermsAccepted}
            onPrivacyAcceptedChange={setPrivacyAccepted}
            disabled={isWorking}
          />

          <button
            type="button"
            onClick={() => {
              void submitFreshAcceptance();
            }}
            disabled={isWorking}
            className="mt-4 w-full rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
          >
            {isWorking ? "Saving acceptance..." : "Save acceptance"}
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            void retryPersist();
          }}
          disabled={isWorking}
          className="mt-4 w-full rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
        >
          {isWorking ? "Trying again..." : "Try again"}
        </button>
      )}

      {needsSignIn ? (
        <p className="mt-4 text-sm text-slate-600">
          <Link href={ROUTES.homeownerLogin} className="font-semibold underline">
            Homeowner sign in
          </Link>
          {" · "}
          <Link
            href={ROUTES.estateAgentLogin}
            className="font-semibold underline"
          >
            Estate agent sign in
          </Link>
        </p>
      ) : null}

      <p className="mt-4 text-sm text-slate-600">
        Need help?{" "}
        <a
          href={SUPPORT_MAILTO}
          className="font-semibold underline"
        >
          {SUPPORT_EMAIL}
        </a>
      </p>
    </div>
  );
}
