import type { SignupTermsDocument } from "@/lib/legal/constants";

const STORAGE_KEY = "keynetic:pending-signup-legal-acceptance";

/**
 * Not an acceptance record. Set when a stored acceptance expires so expiry
 * cannot be read back as "nothing pending". Contains no versions or timestamps.
 */
const UNRESOLVED_MARKER_KEY =
  "keynetic:pending-signup-legal-acceptance-unresolved";

/**
 * Keep pending acceptance long enough for email verification in another tab,
 * without retaining the acceptance payload indefinitely on the device.
 */
export const PENDING_SIGNUP_LEGAL_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type PendingSignupLegalAcceptance = {
  termsDocument: SignupTermsDocument;
  termsVersion: string;
  privacyVersion: string;
  acceptedAt: string;
};

export type PendingSignupLegalAcceptanceInspection =
  | { state: "absent" }
  | { state: "valid"; record: PendingSignupLegalAcceptance }
  | { state: "expired" };

type ClassifiedPayload =
  | { kind: "missing" }
  | { kind: "invalid" }
  | { kind: "expired" }
  | { kind: "valid"; record: PendingSignupLegalAcceptance };

function getBrowserStorages(): Storage[] {
  if (typeof window === "undefined") {
    return [];
  }

  const stores: Storage[] = [];

  try {
    stores.push(window.sessionStorage);
  } catch {
    // ignore
  }

  try {
    stores.push(window.localStorage);
  } catch {
    // ignore
  }

  return stores;
}

function isSignupTermsDocument(
  value: unknown
): value is SignupTermsDocument {
  return value === "terms_of_use";
}

function classifyRaw(
  raw: string | null,
  nowMs: number
): ClassifiedPayload {
  if (!raw) {
    return { kind: "missing" };
  }

  try {
    const parsed = JSON.parse(raw) as Partial<PendingSignupLegalAcceptance>;
    const termsVersion =
      typeof parsed.termsVersion === "string"
        ? parsed.termsVersion.trim()
        : "";
    const privacyVersion =
      typeof parsed.privacyVersion === "string"
        ? parsed.privacyVersion.trim()
        : "";
    const acceptedAt =
      typeof parsed.acceptedAt === "string"
        ? parsed.acceptedAt.trim()
        : "";

    if (
      !isSignupTermsDocument(parsed.termsDocument) ||
      !termsVersion ||
      !privacyVersion ||
      !acceptedAt
    ) {
      return { kind: "invalid" };
    }

    const acceptedAtMs = Date.parse(acceptedAt);

    if (Number.isNaN(acceptedAtMs)) {
      return { kind: "invalid" };
    }

    if (nowMs - acceptedAtMs > PENDING_SIGNUP_LEGAL_TTL_MS) {
      return { kind: "expired" };
    }

    return {
      kind: "valid",
      record: {
        termsDocument: parsed.termsDocument,
        termsVersion,
        privacyVersion,
        acceptedAt,
      },
    };
  } catch {
    return { kind: "invalid" };
  }
}

function hasExpiredMarker(storage: Storage): boolean {
  try {
    const raw = storage.getItem(UNRESOLVED_MARKER_KEY);

    if (!raw) {
      return false;
    }

    const parsed = JSON.parse(raw) as { state?: unknown };

    return parsed?.state === "expired";
  } catch {
    return false;
  }
}

function readStorageRaw(
  storage: Storage,
  key: string
): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Distinguish a missing pending acceptance from a valid one and from one that
 * expired before it was recorded. Does not write storage and does not invent
 * an acceptance timestamp.
 */
export function inspectPendingSignupLegalAcceptance(
  nowMs: number = Date.now()
): PendingSignupLegalAcceptanceInspection {
  const stores = getBrowserStorages();

  if (stores.length === 0) {
    return { state: "absent" };
  }

  let sawExpired = false;

  for (const storage of stores) {
    const classified = classifyRaw(
      readStorageRaw(storage, STORAGE_KEY),
      nowMs
    );

    if (classified.kind === "valid") {
      return { state: "valid", record: classified.record };
    }

    if (
      classified.kind === "expired" ||
      hasExpiredMarker(storage)
    ) {
      sawExpired = true;
    }
  }

  if (sawExpired) {
    return { state: "expired" };
  }

  return { state: "absent" };
}

/**
 * Drop corrupt payloads only. Expired payloads stay until
 * `retainExpiredUnresolvedSignupLegalAcceptance` replaces them with a marker.
 */
export function discardInvalidPendingSignupLegalAcceptance(
  nowMs: number = Date.now()
) {
  for (const storage of getBrowserStorages()) {
    const classified = classifyRaw(
      readStorageRaw(storage, STORAGE_KEY),
      nowMs
    );

    if (classified.kind === "invalid") {
      storage.removeItem(STORAGE_KEY);
    }
  }
}

/**
 * Remove the expired acceptance payload and keep a non-acceptance marker.
 * The marker has no document version and no acceptedAt.
 */
export function retainExpiredUnresolvedSignupLegalAcceptance() {
  const marker = JSON.stringify({ state: "expired" });

  for (const storage of getBrowserStorages()) {
    storage.removeItem(STORAGE_KEY);
    storage.setItem(UNRESOLVED_MARKER_KEY, marker);
  }
}

/**
 * Persist acceptance intent until an authenticated session can record it.
 * Writes sessionStorage (same-tab) and localStorage (email link in a new tab).
 * Does not invent acceptance — only stores what the signup form already captured.
 */
export function savePendingSignupLegalAcceptance(
  payload: PendingSignupLegalAcceptance
) {
  const record: PendingSignupLegalAcceptance = {
    termsDocument: payload.termsDocument,
    termsVersion: payload.termsVersion.trim(),
    privacyVersion: payload.privacyVersion.trim(),
    acceptedAt: payload.acceptedAt.trim(),
  };
  const serialized = JSON.stringify(record);

  for (const storage of getBrowserStorages()) {
    storage.setItem(STORAGE_KEY, serialized);
    storage.removeItem(UNRESOLVED_MARKER_KEY);
  }
}

/**
 * Usable pending acceptance only.
 * Null means there is nothing safe to record. It is not proof that acceptance
 * was absent — call `inspectPendingSignupLegalAcceptance` before treating null
 * as permission to proceed.
 */
export function readPendingSignupLegalAcceptance():
  | PendingSignupLegalAcceptance
  | null {
  const inspection = inspectPendingSignupLegalAcceptance();

  if (inspection.state === "valid") {
    return inspection.record;
  }

  return null;
}

export function clearPendingSignupLegalAcceptance() {
  for (const storage of getBrowserStorages()) {
    storage.removeItem(STORAGE_KEY);
    storage.removeItem(UNRESOLVED_MARKER_KEY);
  }
}
