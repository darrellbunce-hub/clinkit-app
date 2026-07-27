import { ACCESS_CODE_CHARSET } from "@/lib/accessCode/generateAccessCode";

const LOOKUP_CHARSET = new Set(ACCESS_CODE_CHARSET.split(""));

function upperAlphanumeric(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * Lookup-side access code normalisation. Produces candidate stored forms for
 * database matching without rewriting persisted codes.
 */
export function accessCodeLookupCandidates(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) {
    return [];
  }

  const upper = trimmed.toUpperCase();
  const alnum = upperAlphanumeric(trimmed);
  const candidates = new Set<string>([trimmed, upper]);

  if (/^KN[A-Z0-9]{7}$/.test(alnum)) {
    candidates.add(
      `KN-${alnum.slice(2, 5)}-${alnum.slice(5, 9)}`
    );
  }

  if (/^KN[A-Z0-9]{6}$/.test(alnum)) {
    candidates.add(
      `KN-${alnum.slice(2, 5)}-${alnum.slice(5, 8)}`
    );
  }

  if (alnum.length === 7 && !alnum.startsWith("KN")) {
    candidates.add(alnum);
  }

  return [...candidates].filter(
    (candidate) =>
      candidate.length > 0 &&
      [...candidate.toUpperCase()].every(
        (char) => char === "-" || LOOKUP_CHARSET.has(char)
      )
  );
}

/** Normalise user input for display/storage of newly generated codes only. */
export function canonicalizeNewAccessCodeInput(raw: string): string | null {
  const alnum = upperAlphanumeric(raw);
  if (/^KN[A-Z0-9]{7}$/.test(alnum)) {
    return `KN-${alnum.slice(2, 5)}-${alnum.slice(5, 9)}`;
  }
  return null;
}
