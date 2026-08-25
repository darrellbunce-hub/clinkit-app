import { randomBytes } from "crypto";

/** Ambiguity-safe charset shared with database access-code validation. */
export const ACCESS_CODE_CHARSET =
  "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** Canonical new format: KN-XXX-XXXX (7 random symbols). */
export const ACCESS_CODE_CANONICAL_PATTERN = /^KN-[A-Z0-9]{3}-[A-Z0-9]{4}$/;

function randomSymbol(): string {
  const index = randomBytes(1)[0]! % ACCESS_CODE_CHARSET.length;
  return ACCESS_CODE_CHARSET.charAt(index);
}

/**
 * Generate a new chain access code in canonical KN-XXX-XXXX format.
 * Legacy stored codes are not rewritten; this applies to new chains only.
 */
export function generateAccessCode(): string {
  const partA =
    randomSymbol() + randomSymbol() + randomSymbol();
  const partB =
    randomSymbol() +
    randomSymbol() +
    randomSymbol() +
    randomSymbol();

  return `KN-${partA}-${partB}`;
}
