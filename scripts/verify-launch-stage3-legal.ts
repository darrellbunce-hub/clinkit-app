/**
 * Stage 3 — P0 launch legal/content structure verification.
 * Run: npx tsx scripts/verify-launch-stage3-legal.ts
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import {
  isPublicExactPath,
  PUBLIC_EXACT_PATHS,
} from "../lib/auth/routes";
import { formatConnectionStatusLabel } from "../lib/legal/connectionStatusLabels";
import {
  PRIVACY_EMAIL,
  PUBLIC_LEGAL_PATHS,
} from "../lib/legal/constants";

const ROOT = join(import.meta.dirname, "..");

function assertEqual<T>(name: string, actual: T, expected: T) {
  if (actual !== expected) {
    console.error("FAIL:", name);
    console.error("  expected:", expected);
    console.error("  actual:  ", actual);
    process.exitCode = 1;
  } else {
    console.log("PASS:", name);
  }
}

function assertTruthy(name: string, value: unknown) {
  if (!value) {
    console.error("FAIL:", name, "— expected truthy, got", value);
    process.exitCode = 1;
  } else {
    console.log("PASS:", name);
  }
}

function assertIncludes(name: string, haystack: string, needle: string) {
  if (!haystack.includes(needle)) {
    console.error("FAIL:", name, "— missing:", needle);
    process.exitCode = 1;
  } else {
    console.log("PASS:", name);
  }
}

function assertExcludes(name: string, haystack: string, needle: string) {
  if (haystack.includes(needle)) {
    console.error("FAIL:", name, "— should not include:", needle);
    process.exitCode = 1;
  } else {
    console.log("PASS:", name);
  }
}

function readProjectFile(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), "utf8");
}

// Legal routes are public
for (const path of PUBLIC_LEGAL_PATHS) {
  assertTruthy(`Public legal path registered: ${path}`, isPublicExactPath(path));
}

assertTruthy(
  "EA pricing route is public",
  isPublicExactPath("/estate-agents/pricing")
);

// Legal page files exist
const legalPages = [
  "app/privacy/page.tsx",
  "app/terms/page.tsx",
  "app/cookies/page.tsx",
  "app/data-retention/page.tsx",
  "app/estate-agents/terms/page.tsx",
  "app/estate-agents/pricing/page.tsx",
];

for (const page of legalPages) {
  assertTruthy(`Legal page exists: ${page}`, existsSync(join(ROOT, page)));
}

// Content modules exist
const contentModules = [
  "lib/legal/content/privacyPolicy.ts",
  "lib/legal/content/termsOfUse.ts",
  "lib/legal/content/estateAgentTerms.ts",
  "lib/legal/content/cookiePolicy.ts",
  "lib/legal/content/dataRetention.ts",
];

for (const mod of contentModules) {
  assertTruthy(`Content module exists: ${mod}`, existsSync(join(ROOT, mod)));
}

// Account legal section — no Coming soon placeholders
const legalSection = readProjectFile(
  "components/account/LegalPrivacySection.tsx"
);
assertExcludes(
  "LegalPrivacySection has no Coming soon",
  legalSection,
  "Coming soon"
);
assertIncludes(
  "LegalPrivacySection erasure request CTA",
  legalSection,
  "Request deletion of your personal data"
);
assertIncludes(
  "LegalPrivacySection privacy@",
  legalSection,
  "PRIVACY_EMAIL"
);
assertExcludes(
  "LegalPrivacySection no admin@",
  legalSection,
  "admin@keynetic.co.uk"
);

// Homepage FAQ present tense
const homepage = readProjectFile("app/page.tsx");
assertExcludes(
  "Homepage FAQ no eventually for EA",
  homepage,
  "eventually estate agents"
);
assertIncludes(
  "Homepage footer LegalFooterLinks",
  homepage,
  "LegalFooterLinks"
);

// Collection notices
for (const file of [
  "app/login/page.tsx",
  "app/start-move/page.tsx",
  "app/estate-agents/signup/page.tsx",
  "app/estate-agents/onboarding/page.tsx",
]) {
  const source = readProjectFile(file);
  assertIncludes(
    `${file} has CollectionPointNotice`,
    source,
    "CollectionPointNotice"
  );
}

// De-link erasure distinction
const delinkPanel = readProjectFile(
  "components/participation/ParticipationDelinkPanel.tsx"
);
assertIncludes(
  "De-link panel erasure distinction",
  delinkPanel,
  "separate from requesting deletion"
);

// Internal IDs removed from key surfaces
const myChains = readProjectFile("app/my-chains/page.tsx");
assertExcludes("my-chains no Chain #", myChains, "Chain #");

const chainPage = readProjectFile("app/chain/[chainId]/page.tsx");
assertExcludes("chain page title no Chain #", chainPage, "Chain #");
assertExcludes(
  "chain page stale warning no property id",
  chainPage,
  "staleProperties[0].id"
);

// Topology terminology
assertEqual(
  "healthy displays as Connected",
  formatConnectionStatusLabel("healthy"),
  "Connected"
);

const propertyPage = readProjectFile("app/property/[propertyId]/page.tsx");
assertIncludes(
  "property page Disconnect from chain",
  propertyPage,
  "Disconnect from chain"
);
assertExcludes(
  "property page no Break Chain Connection",
  propertyPage,
  "Break Chain Connection"
);

// Pricing / billing stage messaging (Phase 2A/2B: do not claim billing inactive)
const eaLanding = readProjectFile(
  "components/estate-agents/EaLandingPage.tsx"
);
assertExcludes(
  "EA landing must not say billing is not yet live",
  eaLanding,
  "billing not yet live"
);
assertExcludes(
  "EA landing must not say billing is not yet live (alt)",
  eaLanding,
  "billing is not yet live"
);
assertIncludes(
  "EA landing founding offer price present",
  eaLanding,
  "£99/month"
);

// Chain Intelligence — timing_v1 model (Stage 3.5; penalty-from-85 retired)
assertTruthy(
  "chainIntelligence.ts still exists unchanged path",
  existsSync(join(ROOT, "lib/chainIntelligence.ts"))
);
const chainIntelConfig = readProjectFile(
  "lib/chainIntelligence/config.ts"
);
assertIncludes(
  "Chain Intelligence uses timing_v1 confidence model",
  chainIntelConfig,
  'confidenceAlgorithmVersion: "timing_v1"'
);
assertIncludes(
  "Chain Intelligence ETA uses critical_path_v1",
  chainIntelConfig,
  'etaAlgorithmVersion: "critical_path_v1"'
);
const chainIntel = readProjectFile("lib/chainIntelligence.ts");
assertExcludes(
  "Chain Intelligence retired CONFIDENCE_BASE penalty model",
  chainIntel,
  "CONFIDENCE_BASE = 85"
);
assertTruthy(
  "Limited-coverage ETA qualifier helper exists",
  existsSync(
    join(ROOT, "lib/chainIntelligence/estimatedCompletion.ts")
  )
);
const estimatedCompletionModule = readProjectFile(
  "lib/chainIntelligence/estimatedCompletion.ts"
);
assertIncludes(
  "ETA limited-coverage qualifier preserved",
  estimatedCompletionModule,
  "appendEtaLimitedCoverageQualifier"
);

// Documentation deliverables
assertTruthy(
  "Legal review pack index exists",
  existsSync(join(ROOT, "docs/LAUNCH_LEGAL_REVIEW_PACK_INDEX.md"))
);
assertTruthy(
  "Legal draft review register exists",
  existsSync(join(ROOT, "docs/LAUNCH_LEGAL_DRAFT_REVIEW_REGISTER.md"))
);

// PUBLIC_EXACT_PATHS includes all legal routes
for (const path of PUBLIC_LEGAL_PATHS) {
  assertTruthy(
    `PUBLIC_EXACT_PATHS includes ${path}`,
    (PUBLIC_EXACT_PATHS as readonly string[]).includes(path)
  );
}

if (process.exitCode) {
  console.error("\nStage 3 legal verification FAILED");
} else {
  console.log("\nStage 3 legal verification PASSED");
}
