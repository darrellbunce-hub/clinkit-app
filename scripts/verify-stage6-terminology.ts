/**
 * Stage 6 — terminology, UX copy, and brand polish verification.
 * Run: npx tsx scripts/verify-stage6-terminology.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");

const HOMEOWNER_CUSTOMER_COPY_FILES = [
  "app/page.tsx",
  "app/chain/[chainId]/page.tsx",
  "app/property/[propertyId]/page.tsx",
  "app/buyer-ready/[chainId]/page.tsx",
  "app/start-move/page.tsx",
  "app/join-chain/page.tsx",
  "app/dashboard/page.tsx",
  "app/my-chains/page.tsx",
  "app/claim/page.tsx",
  "components/claim/ClaimPropertyExperience.tsx",
  "components/claim/ClaimablePropertyCard.tsx",
  "components/claim/ClaimInvitationError.tsx",
  "components/operational/OperationalContextStrip.tsx",
  "components/operational/OperationalManagerBanner.tsx",
];

function read(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), "utf8");
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

function assertExcludesCaseInsensitive(
  name: string,
  haystack: string,
  needle: string
) {
  if (haystack.toLowerCase().includes(needle.toLowerCase())) {
    console.error("FAIL:", name, "— should not include:", needle);
    process.exitCode = 1;
  } else {
    console.log("PASS:", name);
  }
}

function main() {
  const homeownerBundle = HOMEOWNER_CUSTOMER_COPY_FILES.map((path) =>
    read(path)
  ).join("\n");

  assertIncludes(
    "Chain status label defined",
    read("lib/customerFacingLabels.ts"),
    'export const CHAIN_STATUS_LABEL = "Chain status"'
  );
  assertIncludes(
    "Chain page uses Chain status",
    read("app/chain/[chainId]/page.tsx"),
    "CHAIN_STATUS_LABEL"
  );
  assertExcludes(
    "Chain page no Operational status label",
    read("app/chain/[chainId]/page.tsx"),
    "Operational status"
  );

  assertIncludes(
    "Logo tagline constant",
    read("lib/theme/logoAssets.ts"),
    "Moving Made Clear"
  );
  assertIncludes(
    "Logo showTagline support",
    read("components/ui/Logo.tsx"),
    "showTagline"
  );
  assertIncludes(
    "Homepage footer tagline",
    read("app/page.tsx"),
    "showTagline"
  );
  assertIncludes(
    "Homepage public header tagline",
    read("components/Navbar.tsx"),
    "showTagline={showMarketingBrandTagline}"
  );
  assertIncludes(
    "Homepage tagline route-based",
    read("components/Navbar.tsx"),
    'showMarketingBrandTagline = pathname === "/"'
  );
  assertExcludes(
    "Homepage tagline not auth-gated",
    read("components/Navbar.tsx"),
    "!showAuthenticatedNav && pathname"
  );
  assertIncludes(
    "EA marketing header tagline",
    read("components/estate-agents/EaMarketingShell.tsx"),
    "showBrandTagline"
  );
  assertExcludes(
    "Agent shell header remains logo-only",
    read("components/agent/AgentShell.tsx"),
    "showBrandTagline"
  );
  assertIncludes(
    "Email footer tagline constant",
    read("emails/components/Footer.tsx"),
    "KEYNETIC_TAGLINE"
  );
  assertIncludes(
    "Email footer renders tagline",
    read("emails/components/Footer.tsx"),
    "{KEYNETIC_TAGLINE}"
  );

  assertExcludesCaseInsensitive(
    "Homeowner customer copy no operational status label",
    homeownerBundle,
    "Operational status"
  );
  assertExcludes(
    "Operational context strip no hardcoded Operational owner",
    read("components/operational/OperationalContextStrip.tsx"),
    'label="Operational owner"'
  );
  assertExcludesCaseInsensitive(
    "Homeowner customer copy no operational alert badge",
    homeownerBundle,
    "Operational Alert"
  );
  assertExcludes(
    "Join chain no searching placeholder leak",
    read("app/join-chain/page.tsx"),
    "Searching placeholder"
  );
  assertExcludes(
    "Join chain searching helper no searching placeholder leak",
    read("lib/joinChainSearching.ts"),
    "Searching placeholder"
  );
  assertExcludes(
    "Join chain searching helper no topology leak",
    read("lib/joinChainSearching.ts"),
    "topology"
  );

  assertIncludes(
    "Claim flow connect CTA",
    read("components/claim/ClaimablePropertyCard.tsx"),
    "Connect this property"
  );
  assertExcludesCaseInsensitive(
    "Claim card no customer claim CTA",
    read("components/claim/ClaimablePropertyCard.tsx"),
    "Claim this property"
  );

  assertExcludes(
    "Chain confidence tooltip no operational wording",
    read("lib/chainIntelligence/presentation.ts"),
    "operational information"
  );

  assertExcludes(
    "EA landing no whoever starts headline",
    read("components/estate-agents/EaLandingPage.tsx"),
    "Whoever starts the move"
  );
  assertIncludes(
    "EA landing shared chain view headline",
    read("components/estate-agents/EaLandingPage.tsx"),
    "One shared chain view"
  );

  assertExcludes(
    "Confidence bar no operational confidence label",
    read("components/agent/commandCentre/ConfidenceBar.tsx"),
    "Operational confidence"
  );

  console.log(
    `\nStage 6 terminology checks complete (${HOMEOWNER_CUSTOMER_COPY_FILES.length} homeowner copy files scanned).`
  );
}

main();
