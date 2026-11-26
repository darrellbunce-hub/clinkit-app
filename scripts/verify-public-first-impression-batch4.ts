/**
 * Batch 4 soft-launch checks: legal page home path, EA CTA wording,
 * and homepage footer logged-out CTA.
 *
 * Run: npx tsx scripts/verify-public-first-impression-batch4.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function read(relativePath: string): string {
  return readFileSync(join(root, relativePath), "utf8");
}

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

const legalPage = read("components/legal/LegalDocumentPage.tsx");
assert(
  legalPage.includes("<Logo") && legalPage.includes("Back to MoveLoop"),
  "Legal pages must include MoveLoop logo/home path"
);
assert(
  legalPage.includes("ROUTES.home"),
  "Legal page home links must use ROUTES.home"
);

const glowTokens = read("lib/theme/themeTokens.ts");
assert(
  !glowTokens.includes("right-[-100px]") &&
    !glowTokens.includes("left-[-100px]"),
  "Hero/section glow tokens must not use negative horizontal offsets"
);

const eaLanding = read("components/estate-agents/EaLandingPage.tsx");
assert(
  eaLanding.includes(
    'className="pointer-events-none absolute inset-0 overflow-hidden"'
  ),
  "EA landing must clip decorative glows in an inset overflow container"
);
assert(
  !/\bSign [Uu]p\b/.test(eaLanding),
  "EA landing must not use Sign up label for the signup CTA"
);
assert(
  eaLanding.includes("Create account"),
  "EA landing footer CTA must say Create account"
);

const eaNav = read("components/estate-agents/useEaMarketingNavLinks.ts");
assert(
  eaNav.includes('label: "Create account"'),
  "EA marketing nav primary CTA must say Create account"
);
assert(
  !eaNav.includes('label: "Sign Up"'),
  "EA marketing nav must not say Sign Up"
);

const homepage = read("app/page.tsx");
assert(
  !homepage.includes('href="/dashboard"'),
  "Homepage footer must not link logged-out visitors to Dashboard"
);
assert(
  homepage.includes("ROUTES.homeownerLogin") &&
    /Log in/.test(homepage),
  "Homepage footer should offer Log in instead of Dashboard"
);

console.log(
  "verify-public-first-impression-batch4: legal chrome, overflow tokens, CTA/footer OK"
);
