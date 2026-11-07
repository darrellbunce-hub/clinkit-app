/**
 * Help & FAQs page and Start Move recovery preservation (static, offline).
 * Run: npx tsx scripts/verify-help-and-start-move-recovery.ts
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  isAccountGatedRoute,
  isPublicExactPath,
  MIDDLEWARE_MATCHER,
  PUBLIC_EXACT_PATHS,
  ROUTES,
} from "../lib/auth/routes";
import {
  HELP_SECTION_IDS,
  HELP_SECTIONS,
  HELP_STATUS_LABELS,
  helpHref,
} from "../lib/help/helpContent";
import { getLaunchGateBypassPath, isLaunchGateExemptPath } from "../lib/launchGate";
import { PRIVACY_EMAIL } from "../lib/legal/constants";
import { START_MOVE_RECOVERY_COPY } from "../lib/onboarding/startMoveRecovery";

const ROOT = join(import.meta.dirname, "..");

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error("FAIL:", message);
    process.exitCode = 1;
  } else {
    console.log("PASS:", message);
  }
}

function read(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), "utf8").replace(/\r\n/g, "\n");
}

// ---------------------------------------------------------------------------
// Route: public, never account-gated
// ---------------------------------------------------------------------------

assert(ROUTES.help === "/help", "ROUTES.help is /help");
assert(
  (PUBLIC_EXACT_PATHS as readonly string[]).includes(ROUTES.help),
  "PUBLIC_EXACT_PATHS includes /help"
);
assert(isPublicExactPath("/help"), "isPublicExactPath(/help)");
assert(!isAccountGatedRoute("/help"), "/help is not account-gated");
assert(
  !(MIDDLEWARE_MATCHER as readonly string[]).some((m) => m.startsWith("/help")),
  "/help is not in the account middleware matcher"
);
assert(isLaunchGateExemptPath("/help"), "/help is reachable while the launch gate is enabled");
assert(isLaunchGateExemptPath("/help/"), "/help/ normalises to the exempt Help path");
assert(!isLaunchGateExemptPath("/help/anything"), "Launch gate exemption is exact: nested /help paths stay gated");
for (const exempt of ["/privacy", "/terms"]) {
  assert(isLaunchGateExemptPath(exempt), `${exempt} is reachable while the launch gate is enabled`);
  assert(!isLaunchGateExemptPath(`${exempt}/anything`), `Launch gate exemption for ${exempt} is exact`);
}
for (const gated of [
  "/",
  "/about",
  "/cookies",
  "/data-protection",
  "/estate-agents/pricing",
  "/dashboard",
  "/join-chain",
  "/start-move",
  "/login",
]) {
  assert(!isLaunchGateExemptPath(gated), `Launch gate still applies to ${gated}`);
}
{
  const previous = process.env.LAUNCH_GATE_BYPASS_PATH;
  process.env.LAUNCH_GATE_BYPASS_PATH = "/help";
  assert(getLaunchGateBypassPath() === null, "/help cannot be configured as the launch gate bypass path");
  if (previous === undefined) {
    delete process.env.LAUNCH_GATE_BYPASS_PATH;
  } else {
    process.env.LAUNCH_GATE_BYPASS_PATH = previous;
  }
}
assert(helpHref() === "/help", "helpHref() is /help");
assert(
  helpHref(HELP_SECTION_IDS.somethingWentWrong) === "/help#something-went-wrong",
  "helpHref(section) adds the section anchor"
);

// ---------------------------------------------------------------------------
// Page: static Server Component with metadata and native disclosure widgets
// ---------------------------------------------------------------------------

assert(existsSync(join(ROOT, "app/help/page.tsx")), "app/help/page.tsx exists");
const helpPage = read("app/help/page.tsx");
assert(!helpPage.includes('"use client"'), "Help page is a Server Component");
assert(
  /export const metadata: Metadata = \{[\s\S]*?title: "Help & FAQs \| MoveLoop"/.test(helpPage),
  "Help page exports metadata"
);
assert(
  helpPage.includes("<details") && helpPage.includes("<summary"),
  "FAQs use native <details>/<summary>"
);
assert(helpPage.includes("<h1"), "Help page has one top-level heading");
assert(
  helpPage.includes('aria-label="Help topics"'),
  "Help page has a labelled topics navigation"
);
assert(helpPage.includes("LegalFooterLinks"), "Help page uses the shared footer links");

// ---------------------------------------------------------------------------
// Content: required topics, no invented contact or promises
// ---------------------------------------------------------------------------

const requiredSections = Object.values(HELP_SECTION_IDS);
for (const id of requiredSections) {
  const section = HELP_SECTIONS.find((s) => s.id === id);
  assert(
    section != null && section.items.length > 0,
    `Help section present with questions: ${id}`
  );
}

const itemIds = HELP_SECTIONS.flatMap((s) => s.items.map((i) => i.id));
assert(new Set(itemIds).size === itemIds.length, "FAQ item ids are unique");
assert(
  !itemIds.some((id) => (requiredSections as string[]).includes(id)),
  "FAQ item ids do not collide with section anchors"
);
assert(
  HELP_SECTIONS.every((s) => s.items.every((i) => i.answer.length > 0)),
  "Every FAQ has an answer"
);

const allHelpText = [
  ...HELP_SECTIONS.flatMap((s) => [
    s.title,
    ...s.items.flatMap((i) => [
      i.question,
      ...i.answer,
      ...(i.links ?? []).flatMap((l) => [l.href, l.label]),
    ]),
  ]),
  ...HELP_STATUS_LABELS.flatMap((s) => [s.label, s.meaning]),
].join("\n");

const emails = allHelpText.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [];
assert(
  emails.every((email) => email === PRIVACY_EMAIL),
  "The only email address in Help content is the configured privacy contact"
);

const privacySection = HELP_SECTIONS.find(
  (s) => s.id === HELP_SECTION_IDS.privacyAndVisibility
);
const privacySectionText = JSON.stringify(privacySection);
const nonPrivacyText = JSON.stringify(
  HELP_SECTIONS.filter((s) => s.id !== HELP_SECTION_IDS.privacyAndVisibility)
);
assert(
  privacySectionText.includes(PRIVACY_EMAIL) && !nonPrivacyText.includes(PRIVACY_EMAIL),
  "Privacy contact appears only in the privacy section"
);
assert(
  allHelpText.includes("for privacy and data-protection matters only"),
  "Privacy contact is scoped to privacy matters"
);
assert(!/support@/i.test(allHelpText), "No support@ address");
assert(!/contact (MoveLoop )?support/i.test(allHelpText), "No 'contact support' route that does not exist");
assert(
  !/\bwithin \d+|\bworking days?\b|\b\d+ hours?\b|\bwe will respond\b|\bwe aim to respond\b/i.test(allHelpText),
  "No response-time promises"
);
assert(
  allHelpText
    .split(/(?<=\.)\s+|\n/)
    .filter((sentence) => /guarantee/i.test(sentence))
    .every((sentence) => /\b(does not|do not)\b/i.test(sentence)),
  "Every mention of a guarantee is a disclaimer"
);
assert(!/\bEA\b/.test(allHelpText), "Customer-facing copy does not abbreviate Estate Agent");

const operationalPosition = read("lib/operationalPosition.ts");
for (const label of [
  "Awaiting Buyer",
  "Buyer Ready",
  "Your Sale",
  "Your Purchase",
  "Connected Buyer",
  "Connected Purchase",
  "Next Home Search",
  "Seller's Next Home Search",
]) {
  assert(
    operationalPosition.includes(`"${label}"`) && allHelpText.includes(label),
    `Help explains the product label: ${label}`
  );
}
const connectionLabels = read("lib/legal/connectionStatusLabels.ts");
for (const label of ["Connected", "Pending Connection", "Disconnected", "Delayed"]) {
  assert(
    connectionLabels.includes(`"${label}"`) &&
      HELP_STATUS_LABELS.some((s) => s.label === label),
    `Help explains the connection label: ${label}`
  );
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

const legalFooter = read("components/legal/LegalDocumentPage.tsx");
assert(
  /export function LegalFooterLinks[\s\S]*?href=\{ROUTES\.help\}/.test(legalFooter),
  "LegalFooterLinks links to Help & FAQs"
);
assert(
  !read("lib/legal/constants.ts").includes("/help"),
  "Help is not added to the legal document navigation"
);
const navbar = read("components/Navbar.tsx");
assert(
  (navbar.match(/href=\{ROUTES\.help\}/g) ?? []).length === 4,
  "Navbar: Help in both desktop navs and both mobile menus"
);
assert(
  /href=\{ROUTES\.help\}\s*className=\{`\$\{NAV_LINK_DARK_CLASS\} hidden lg:block px-4 py-2`\}/.test(navbar),
  "Navbar: signed-out desktop Help link appears from the lg breakpoint, where it fits beside the logo"
);
assert(read("app/page.tsx").includes("href={ROUTES.help}"), "Homepage FAQ links to Help & FAQs");
assert(read("app/join-chain/page.tsx").includes("<HelpLink"), "Join Chain links to Help");
assert(read("app/agent/originate/page.tsx").includes("<HelpLink"), "Estate Agent origination errors link to Help");

const helpLink = read("components/help/HelpLink.tsx");
assert(
  helpLink.includes('rel: "noopener noreferrer"') && helpLink.includes("(opens in a new tab)"),
  "HelpLink new-tab variant is safe and announced"
);

// ---------------------------------------------------------------------------
// Start Move: an established sale or purchase is never cleaned up
// ---------------------------------------------------------------------------

const startMove = read("app/start-move/page.tsx");

assert(!startMove.includes("incompleteChainId"), "Start Move: recovery state replaces incompleteChainId");
assert(
  /async function fail\([\s\S]*?recoveryReason: StartMoveRecoveryReason = "step_incomplete"[\s\S]*?if \(chainId != null && propertyEstablished\) \{\s*setRecovery\(\{ chainId, reason: recoveryReason \}\);\s*return;\s*\}\s*if \(chainId != null\) \{\s*await cleanupOnboardingChain\(chainId\);\s*\}/.test(
    startMove
  ),
  "Start Move: fail() keeps an established chain and only cleans up before any property is established"
);

const saleGrantCheck = startMove.indexOf("if (!sellingResult.ok) {");
const buyerGrantCheck = startMove.indexOf("if (!buyingResult.ok) {");
const established = [...startMove.matchAll(/propertyEstablished = true;/g)].map((m) => m.index ?? -1);
assert(
  established.length === 2 &&
    established[0] > saleGrantCheck &&
    established[0] < startMove.indexOf("// BUYING PROPERTY") &&
    established[1] > buyerGrantCheck &&
    established[1] < startMove.indexOf("await linkStartMoveOnwardPurchase("),
  "Start Move: a property counts as established only after its homeowner grant succeeds"
);

assert(
  /if \(!buyingResult\.ok\) \{\s*const reserved = isAddressReservedFailure\(buyingResult\.error\);[\s\S]*?reserved \? "purchase_address_reserved" : "purchase_not_added"\s*\);\s*return;\s*\}/.test(
    startMove
  ),
  "Start Move: purchase failures after a sale keep the sale with a purchase recovery"
);
assert(
  /attachResult\.error,\s*START_MOVE_FAILED_MESSAGE,\s*"searching_not_added"/.test(startMove),
  "Start Move: Searching failure keeps the sale with its own recovery"
);
assert(
  startMove.includes('setRecovery({ chainId, reason: "buyer_ready_not_added" })'),
  "Start Move: Buyer Ready failure keeps the purchase"
);

const promptCalls = [...startMove.matchAll(/promptJoinExistingChain\(\s*chainId,[\s\S]*?\n\s*(false|propertyEstablished)\s*\);/g)].map(
  (m) => m[1]
);
assert(
  promptCalls.length === 2 && promptCalls[0] === "false" && promptCalls[1] === "propertyEstablished",
  "Start Move: join prompts record whether the source chain already holds an established sale"
);
assert(
  /if \(action\.kind === "join_source_chain"\) \{\s*if \(action\.preserveSourceChain\) \{\s*setRecovery\(\{\s*chainId: action\.chainId,\s*reason: "purchase_already_on_moveloop",\s*\}\);\s*\} else \{\s*void cleanupOnboardingChain\(action\.chainId\);\s*\}/.test(
    startMove
  ),
  "Start Move: cancelling after the sale exists keeps it; only an empty source chain is cleaned up"
);
assert(
  (startMove.match(/cleanupOnboardingChain\(/g) ?? []).length === 3,
  "Start Move: no new cleanup call sites (definition, fail(), empty-chain cancel)"
);
assert(
  /"cleanup_abandoned_onboarding_chain",\s*\{ p_chain_id: chainId \}/.test(startMove),
  "Start Move: cleanup RPC call itself is unchanged (database stage handles it)"
);
assert(
  startMove.includes("<StartMoveRecoveryPanel recovery={recovery} />"),
  "Start Move: recovery panel rendered"
);
assert(
  /role="alert"[\s\S]{0,400}?\{errorMessage\}[\s\S]{0,400}?<HelpLink[\s\S]{0,120}?newTab/.test(startMove),
  "Start Move: form errors link to Help in a new tab (answers are kept)"
);

for (const [reason, copy] of Object.entries(START_MOVE_RECOVERY_COPY)) {
  const text = copy.join(" ");
  assert(copy.length > 0, `Recovery copy present: ${reason}`);
  assert(
    !/\b(delete|deleted|remove|removed|discard|discarded|cancel your sale)\b/i.test(text),
    `Recovery copy does not suggest discarding saved work: ${reason}`
  );
  assert(!/support/i.test(text), `Recovery copy does not point to a support channel: ${reason}`);
  assert(!/searching/i.test(text) || reason === "searching_not_added", `Recovery copy does not present a known purchase as Searching: ${reason}`);
}

const panel = read("components/onboarding/StartMoveRecoveryPanel.tsx");
assert(
  panel.includes("<HelpLink section={HELP_SECTION_IDS.somethingWentWrong} />") &&
    panel.includes("Open your chain") &&
    panel.includes('role="alert"'),
  "Recovery panel: Help link, Open your chain, announced as an alert"
);

const dialog = read("components/onboarding/DuplicatePropertyDialog.tsx");
assert(!/contact MoveLoop support/i.test(dialog), "Duplicate dialog no longer points to a missing support channel");
assert(
  dialog.includes("section={HELP_SECTION_IDS.alreadyOnMoveLoop}") && dialog.includes("newTab"),
  "Duplicate dialog links to the relevant Help answers in a new tab"
);
