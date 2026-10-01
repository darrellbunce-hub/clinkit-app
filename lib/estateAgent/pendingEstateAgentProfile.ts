const STORAGE_KEY = "keynetic:pending-estate-agent-profile";

/** Supplementary client recovery only — Auth metadata is the durable source of truth. */
export const PENDING_EA_PROFILE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Minimum client-held EA signup fields until an authenticated session exists.
 * Never store passwords, tokens, or a caller-chosen profile id.
 */
export type PendingEstateAgentProfile = {
  contactName: string;
  email: string;
  savedAt: string;
};

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

function parsePending(
  raw: string | null
): PendingEstateAgentProfile | null {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<PendingEstateAgentProfile>;
    const contactName =
      typeof parsed.contactName === "string"
        ? parsed.contactName.trim()
        : "";
    const email =
      typeof parsed.email === "string" ? parsed.email.trim() : "";
    const savedAt =
      typeof parsed.savedAt === "string" ? parsed.savedAt : "";

    if (contactName.length < 2 || !email || !savedAt) {
      return null;
    }

    const savedAtMs = Date.parse(savedAt);

    if (Number.isNaN(savedAtMs)) {
      return null;
    }

    if (Date.now() - savedAtMs > PENDING_EA_PROFILE_TTL_MS) {
      return null;
    }

    return { contactName, email, savedAt };
  } catch {
    return null;
  }
}

export function savePendingEstateAgentProfile(payload: {
  contactName: string;
  email: string;
}) {
  const record: PendingEstateAgentProfile = {
    contactName: payload.contactName.trim(),
    email: payload.email.trim(),
    savedAt: new Date().toISOString(),
  };
  const serialized = JSON.stringify(record);

  for (const storage of getBrowserStorages()) {
    storage.setItem(STORAGE_KEY, serialized);
  }
}

/**
 * Prefer sessionStorage (same-tab), fall back to localStorage (new-tab email flow).
 */
export function readPendingEstateAgentProfile():
  | PendingEstateAgentProfile
  | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const fromSession = parsePending(
      window.sessionStorage.getItem(STORAGE_KEY)
    );
    if (fromSession) {
      return fromSession;
    }
  } catch {
    // ignore
  }

  try {
    return parsePending(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

export function clearPendingEstateAgentProfile() {
  for (const storage of getBrowserStorages()) {
    storage.removeItem(STORAGE_KEY);
  }
}
