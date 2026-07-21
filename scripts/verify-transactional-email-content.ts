/**
 * Stage 5 — transactional email content verification.
 * Run: npx tsx scripts/verify-transactional-email-content.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  getClaimSuccessfulSubject,
} from "../emails/templates/PropertyClaimed";
import {
  getHomeownerInvitationSubject,
} from "../emails/templates/HomeownerInvitation";
import {
  renderClaimSuccessful,
  renderHomeownerInvitation,
  renderEstateAgentInvitation,
  renderWelcomeEmail,
  renderPasswordReset,
  renderDormancyWarning,
} from "../lib/communications/render";
import { getSampleHomeownerInvitationParams } from "../lib/communications/sampleData";

const ROOT = join(import.meta.dirname, "..");

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

async function main() {
  const homeownerParams = getSampleHomeownerInvitationParams();
  const homeowner = await renderHomeownerInvitation(homeownerParams);
  const homeownerSubject = getHomeownerInvitationSubject(homeownerParams);

  assertIncludes(
    "Homeowner invitation CTA",
    homeowner.html,
    "Connect your property"
  );
  assertExcludes(
    "Homeowner invitation no Accept invitation CTA",
    homeowner.html,
    ">Accept invitation<"
  );
  assertIncludes(
    "Homeowner invitation free for homeowners",
    homeowner.html,
    "Homeowners use Keynetic for free"
  );
  assertIncludes(
    "Homeowner invitation partial chain wording",
    homeowner.html,
    "connected parts of your chain"
  );
  assertExcludes(
    "Homeowner invitation no real-time claim",
    homeowner.html.toLowerCase(),
    "real-time"
  );
  assertExcludes(
    "Homeowner invitation no customer-facing claim term",
    homeowner.html,
    "property claim"
  );
  assertIncludes(
    "Homeowner invitation footer privacy",
    homeowner.html,
    "Privacy Policy"
  );
  assertIncludes(
    "Homeowner subject retains address (FD-004 body direction)",
    homeownerSubject,
    homeownerParams.propertyAddress
  );
  assertExcludes(
    "Homeowner preheader avoids full address",
    homeowner.html,
    `${homeownerParams.companyName} invited you to connect ${homeownerParams.propertyAddress}`
  );

  const ea = await renderEstateAgentInvitation();
  assertIncludes(
    "EA invitation CRM complement",
    ea.html,
    "works alongside your CRM"
  );
  assertExcludes(
    "EA invitation no enterprise claims",
    ea.html.toLowerCase(),
    "enterprise"
  );

  const welcome = await renderWelcomeEmail();
  assertIncludes(
    "Welcome live shared updates",
    welcome.html,
    "live updates"
  );
  assertExcludes(
    "Welcome no real-time",
    welcome.html.toLowerCase(),
    "real-time"
  );

  const connected = await renderClaimSuccessful();
  assertIncludes(
    "Property connected heading",
    connected.html,
    "Your property is connected"
  );
  assertExcludes(
    "Property connected subject avoids address",
    getClaimSuccessfulSubject(),
    homeownerParams.propertyAddress
  );

  const reset = await renderPasswordReset();
  assertExcludes(
    "Password reset no property data",
    reset.html,
    "Maple Grove"
  );
  assertIncludes(
    "Password reset ignore instruction",
    reset.html,
    "did not request a password reset"
  );

  const dormancy = await renderDormancyWarning();
  assertExcludes(
    "Dormancy warning no property address",
    dormancy.html,
    "Maple Grove"
  );

  const footer = read("emails/components/Footer.tsx");
  assertIncludes("Footer privacy policy link", footer, "/privacy");
  assertIncludes("Footer privacy email constant", footer, "PRIVACY_EMAIL");
  assertIncludes(
    "Footer Moving Made Clear tagline (FD-039)",
    footer,
    "KEYNETIC_TAGLINE"
  );
  const homeownerRendered = await renderHomeownerInvitation(homeownerParams);
  assertIncludes(
    "Rendered homeowner email includes tagline",
    homeownerRendered.html,
    "Moving Made Clear"
  );

  const emailTs = read("lib/communications/email.ts");
  assertIncludes(
    "Homeowner send wired",
    emailTs,
    "sendHomeownerInvitation"
  );
  assertIncludes(
    "Dormancy send wired",
    emailTs,
    "sendDormancyWarningEmail"
  );
  assertExcludes(
    "Welcome not wired to production caller in email.ts only",
    read("app/login/page.tsx"),
    "sendWelcomeEmail"
  );

  if (process.exitCode) {
    console.error("\nStage 5 transactional email verification FAILED");
  } else {
    console.log("\nStage 5 transactional email verification PASSED");
  }
}

void main();
