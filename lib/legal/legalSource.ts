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

/** Load approved legal markdown. Source files are the sole wording authority. */
export function loadLegalMarkdown(key: LegalSourceKey): string {
  const fileName = LEGAL_SOURCE_FILES[key];
  const absolutePath = join(legalSourceDirectory(), fileName);
  const raw = readFileSync(absolutePath, "utf8");

  return removeAccidentalDuplicateSentences(raw);
}
