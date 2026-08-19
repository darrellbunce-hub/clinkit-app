/**
 * Postcode formatting for address lookup capture.
 *
 * Does NOT change join_chain_property semantics. Applies only when Keynetic
 * populates address/postcode from lookup (or manual fields inside the lookup
 * component) so casing/spacing are consistent for new captures.
 *
 * Broader join-side normalisation is intentionally not implemented here —
 * report separately if product wants SQL-level matching changes.
 */

export function formatUkPostcodeForStorage(postcode: string): string {
  const compact = postcode
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");

  if (compact.length < 5) {
    return compact;
  }

  // UK inward code is the final three characters.
  return `${compact.slice(0, -3)} ${compact.slice(-3)}`;
}

export function formatAddressLinesForStorage(parts: {
  line1?: string | null;
  line2?: string | null;
  line3?: string | null;
  postTown?: string | null;
}): string {
  return [parts.line1, parts.line2, parts.line3, parts.postTown]
    .map((part) => (part ?? "").trim())
    .filter(Boolean)
    .join(", ");
}
