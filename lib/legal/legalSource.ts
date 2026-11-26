import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Canonical approved legal source files under docs/legal-source/. */
export const LEGAL_SOURCE_FILES = {
  privacyPolicy: "PRIVACY_POLICY_V1.1.md",
  termsOfService: "TERMS_OF_SERVICE_V1.0.md",
  dataProtectionPlatformTerms: "DATA_PROTECTION_PLATFORM_TERMS_V1.0.md",
  cookiesPolicy: "COOKIES_POLICY_V1.0.md",
} as const;

export type LegalSourceKey = keyof typeof LEGAL_SOURCE_FILES;

/**
 * Accidental copy/paste duplicates identified during legal finalisation.
 * Remove only exact consecutive duplicate occurrences of these sentences.
 */
const ACCIDENTAL_DUPLICATE_SENTENCES = [
  "These communications form part of the Service and are not marketing communications.",
  "Where a provider processes Personal Data on Keynetic's behalf, Keynetic will impose appropriate contractual and data protection requirements in accordance with Applicable Data Protection Law.",
] as const;

/** Unresolved editorial placeholders that must not be invented for customers. */
const UNRESOLVED_DATE_PLACEHOLDER =
  /(?:\\\[|\[)\s*(?:INSERT\s+)?DATE\s*(?:\\\]|\])/i;

function legalSourceDirectory(): string {
  return join(process.cwd(), "docs", "legal-source");
}

function removeAccidentalDuplicateSentences(markdown: string): string {
  let next = markdown;

  for (const sentence of ACCIDENTAL_DUPLICATE_SENTENCES) {
    const escaped = sentence.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`(${escaped})\\s*\\n+\\s*\\1`, "g");
    next = next.replace(pattern, "$1");
  }

  return next;
}

function isInternalDraftBannerBlockquote(line: string): boolean {
  const body = line.replace(/^>\s?/, "").trim();

  return (
    /DRAFT\s*[—-]\s*REQUIRES LEGAL REVIEW/i.test(body) ||
    (/Launch draft for MoveLoop Ltd/i.test(body) &&
      /Not published/i.test(body))
  );
}

function isUnresolvedDateMetadataLine(line: string): boolean {
  if (!UNRESOLVED_DATE_PLACEHOLDER.test(line)) {
    return false;
  }

  return (
    /\*\*(?:Last updated|Effective date):\*\*/i.test(line) ||
    /^(?:Last updated|Effective date):/i.test(line.trim())
  );
}

/**
 * Prepare source markdown for customer-facing legal pages.
 *
 * Keeps internal draft banners and unresolved date placeholders in the
 * source files / review register, but omits them from public rendering so
 * pages do not display engineering labels or invented publication dates.
 * Does not claim legal approval.
 */
export function preparePublicLegalMarkdown(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const output: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();

    if (trimmed.startsWith(">") && isInternalDraftBannerBlockquote(trimmed)) {
      while (
        index < lines.length &&
        (lines[index] ?? "").trim().startsWith(">")
      ) {
        index += 1;
      }

      while (index < lines.length && !(lines[index] ?? "").trim()) {
        index += 1;
      }

      continue;
    }

    if (isUnresolvedDateMetadataLine(trimmed)) {
      index += 1;
      continue;
    }

    if (/\*\*Version:\*\*/i.test(trimmed) || /^Version:/i.test(trimmed)) {
      output.push(
        line.replace(/\s*[—–-]\s*Launch Draft\s*$/i, "").replace(/\s+$/, "")
      );
      index += 1;
      continue;
    }

    output.push(line);
    index += 1;
  }

  return output.join("\n").replace(/^\n+/, "").replace(/\n{3,}/g, "\n\n");
}

/** Load approved legal markdown. Source files are the sole wording authority. */
export function loadLegalMarkdown(key: LegalSourceKey): string {
  const fileName = LEGAL_SOURCE_FILES[key];
  const absolutePath = join(legalSourceDirectory(), fileName);
  const raw = readFileSync(absolutePath, "utf8");

  return preparePublicLegalMarkdown(
    removeAccidentalDuplicateSentences(raw)
  );
}
