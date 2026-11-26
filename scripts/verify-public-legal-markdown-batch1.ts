/**
 * Batch 1 soft-launch check: public legal markdown omits internal draft
 * banners and unresolved date placeholders, while source files retain them.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  LEGAL_SOURCE_FILES,
  loadLegalMarkdown,
  type LegalSourceKey,
} from "../lib/legal/legalSource";

const ROOT = process.cwd();

const KEYS = Object.keys(LEGAL_SOURCE_FILES) as LegalSourceKey[];

let failed = 0;

function assert(label: string, condition: boolean) {
  if (!condition) {
    console.log(`FAIL  ${label}`);
    failed += 1;
    return;
  }

  console.log(`OK    ${label}`);
}

/** Mirror LegalMarkdown unescape for offline heading checks. */
function unescapeMarkdownText(value: string): string {
  return value.replace(/\\([\\`*_{}\[\]()#+\-.!])/g, "$1");
}

for (const key of KEYS) {
  const publicMd = loadLegalMarkdown(key);
  const prefix = key;

  assert(
    `${prefix}: no DRAFT banner`,
    !/DRAFT\s*[—-]\s*REQUIRES LEGAL REVIEW/i.test(publicMd)
  );
  assert(`${prefix}: no Not published`, !/Not published/i.test(publicMd));
  assert(`${prefix}: no Launch Draft label`, !/Launch Draft/i.test(publicMd));
  assert(
    `${prefix}: no unresolved date placeholder`,
    !/\[(?:INSERT\s+)?DATE\]/i.test(publicMd)
  );
  assert(`${prefix}: retains Version metadata`, /\*\*Version:\*\*/i.test(publicMd));
  assert(`${prefix}: retains title heading`, /^#\s+/m.test(publicMd));
  assert(
    `${prefix}: numbered heading escapes still present in source form or unescaped`,
    /(?:\\?\d+\\\.\s+|##\s+\*\*\d+\.\s+)/.test(publicMd) ||
      /\d+\\\./.test(publicMd) ||
      /##\s+\*\*\d+\\\./.test(publicMd)
  );
}

const privacyPath = join(
  ROOT,
  "docs",
  "legal-source",
  LEGAL_SOURCE_FILES.privacyPolicy
);
const privacyRaw = readFileSync(privacyPath, "utf8");

assert(
  "source retains DRAFT banner",
  /DRAFT\s*[—-]\s*REQUIRES LEGAL REVIEW/i.test(privacyRaw)
);
assert(
  "source retains unresolved date placeholder",
  /\\\[DATE\\\]|\[DATE\]/i.test(privacyRaw)
);

assert(
  "unescape numbered heading",
  unescapeMarkdownText("1\\. Who we are") === "1. Who we are"
);
assert(
  "unescape multi-digit heading",
  unescapeMarkdownText("10\\. Who we share information with") ===
    "10. Who we share information with"
);
assert(
  "unescape brackets",
  unescapeMarkdownText("\\[DATE\\]") === "[DATE]"
);

const publicPrivacy = loadLegalMarkdown("privacyPolicy");
assert(
  "public privacy heading source still has escape for renderer",
  publicPrivacy.includes("1\\. Who we are")
);

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}

console.log("\nALL CHECKS PASSED");
