/**
 * WHY positioning + mobile responsiveness sprint verification.
 * Run: npx tsx scripts/verify-marketing-why-positioning.ts
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  HOME_BUYING_EVIDENCE_STATS,
  HOME_BUYING_REFORM_ROADMAP_URL,
} from "../lib/marketing/homeBuyingEvidence";
import { PUBLIC_EXACT_PATHS, ROUTES } from "../lib/auth/routes";

const ROOT = join(import.meta.dirname, "..");

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error("FAIL:", message);
    process.exitCode = 1;
  } else {
    console.log("PASS:", message);
  }
}

function assertIncludes(
  name: string,
  haystack: string,
  needle: string
) {
  assert(haystack.includes(needle), `${name} — missing: ${needle}`);
}

function assertExcludes(
  name: string,
  haystack: string,
  needle: string
) {
  assert(
    !haystack.includes(needle),
    `${name} — should not include: ${needle}`
  );
}

function readProjectFile(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), "utf8");
}

assert(
  existsSync(join(ROOT, "app/about/page.tsx")),
  "/about page exists"
);

assert(
  (PUBLIC_EXACT_PATHS as readonly string[]).includes(ROUTES.about),
  "PUBLIC_EXACT_PATHS includes /about"
);

const navbar = readProjectFile("components/Navbar.tsx");
assertIncludes(
  "Public nav includes Why Keynetic",
  navbar,
  "Why Keynetic?"
);
assertIncludes(
  "Public nav links to /about",
  navbar,
  "ROUTES.about"
);
const authenticatedNav =
  navbar.match(
    /showAuthenticatedNav \? \([\s\S]*?\) : \(/,
  )?.[0]?.replace(/\) : \($/, "") ?? "";

assertExcludes(
  "Authenticated nav does not add Why Keynetic clutter",
  authenticatedNav,
  "Why Keynetic?"
);

const homepage = readProjectFile("app/page.tsx");

assertIncludes(
  "Homepage hero WHY headline",
  homepage,
  "Moving home will always have uncertainty."
);
assertIncludes(
  "Homepage hero eyebrow",
  homepage,
  "Clarity through every move"
);
assertIncludes(
  "Homepage retains Start Your Move CTA",
  homepage,
  "Start Your Move"
);
assertIncludes(
  "Homepage retains Join Existing Chain CTA",
  homepage,
  "Join Existing Chain"
);
assertIncludes(
  "Solution headline moved down page",
  homepage,
  "Your Property Chain."
);
assertIncludes(
  "Evidence section wired",
  homepage,
  "EvidenceSection"
);
assertIncludes(
  "Trust positioning section wired",
  homepage,
  "TrustPositioningSection"
);
assertIncludes(
  "Homepage shows monthly EA price constant",
  homepage,
  "EA_STANDARD_MONTHLY_LABEL"
);
assertIncludes(
  "Homepage shows daily EA value frame constant",
  homepage,
  "EA_STANDARD_DAILY_LABEL"
);
assertIncludes(
  "Founding pricing not removed from EA reference",
  homepage,
  "Founding branch pricing"
);

const aboutPage = readProjectFile("app/about/page.tsx");
assertIncludes(
  "About page hero",
  aboutPage,
  "Why Keynetic?"
);
assertIncludes(
  "About page avoids government endorsement language",
  aboutPage,
  "does not mean Keynetic has been government endorsed"
);
assertExcludes(
  "About page no government approved claim",
  aboutPage,
  "Government approved"
);

assert(
  HOME_BUYING_EVIDENCE_STATS.length === 3,
  "Three approved evidence stats defined"
);
assert(
  HOME_BUYING_REFORM_ROADMAP_URL.startsWith("https://www.gov.uk/"),
  "Evidence links to gov.uk roadmap"
);

const dashboard = readProjectFile("app/dashboard/page.tsx");
assertIncludes(
  "Dashboard uses MobilePanelHeader",
  dashboard,
  "MobilePanelHeader"
);
assertIncludes(
  "Dashboard cards allow shrink",
  dashboard,
  "min-w-0"
);
assertExcludes(
  "Dashboard avoids rigid header row",
  dashboard,
  "flex items-start justify-between gap-4"
);

const myChains = readProjectFile("app/my-chains/page.tsx");
assertIncludes(
  "My Chains cards allow shrink",
  myChains,
  "min-w-0"
);
assertIncludes(
  "My Chains access code wraps",
  myChains,
  "break-words"
);

const heroIllustration = readProjectFile(
  "components/marketing/HeroChainIllustration.tsx"
);
assertIncludes(
  "Hero 95% badge uses mimosa contrast",
  heroIllustration,
  "bg-brand-accent"
);
assertIncludes(
  "Hero progress uses white/mimosa not teal-on-teal",
  heroIllustration,
  "bg-white/85"
);

assertExcludes(
  "Dev theme tooling not restored on homepage",
  homepage,
  "branding-review"
);
assertExcludes(
  "Dev theme tooling not restored in globals",
  readProjectFile("app/globals.css"),
  "data-brand-theme="
    .concat('"dev"')
);

if (process.exitCode) {
  console.error("\nMarketing WHY positioning verification FAILED");
} else {
  console.log("\nMarketing WHY positioning verification PASSED");
}
