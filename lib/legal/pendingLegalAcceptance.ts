import type { SignupTermsDocument } from "@/lib/legal/constants";

const STORAGE_KEY = "keynetic:pending-signup-legal-acceptance";

export type PendingSignupLegalAcceptance = {
  termsDocument: SignupTermsDocument;
  termsVersion: string;
  privacyVersion: string;
  acceptedAt: string;
};

export function savePendingSignupLegalAcceptance(
  payload: PendingSignupLegalAcceptance
) {
  if (typeof window === "undefined") {
    return;
  }

  sessionStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(payload)
  );
}

export function readPendingSignupLegalAcceptance():
  | PendingSignupLegalAcceptance
  | null {
  if (typeof window === "undefined") {
    return null;
  }

  const raw = sessionStorage.getItem(STORAGE_KEY);

  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as PendingSignupLegalAcceptance;
  } catch {
    return null;
  }
}

export function clearPendingSignupLegalAcceptance() {
  if (typeof window === "undefined") {
    return;
  }

  sessionStorage.removeItem(STORAGE_KEY);
}
