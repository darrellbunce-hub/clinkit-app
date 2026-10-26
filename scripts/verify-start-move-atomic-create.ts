/**
 * Start Move atomic create and chain preservation (static, offline).
 * Run: npx tsx scripts/verify-start-move-atomic-create.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { START_MOVE_RECOVERY_COPY } from "../lib/onboarding/startMoveRecovery";

const ROOT = join(import.meta.dirname, "..");
let failed = 0;

function read(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), "utf8").replace(/\r\n/g, "\n");
}

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log("PASS:", message);
  } else {
    failed += 1;
    console.error("FAIL:", message);
  }
}

const page = read("app/start-move/page.tsx");
const grants = read("lib/ownership/grants.ts");
const allowlist = read("scripts/secdef-user-rpc-allowlist.json");

const creates = [
  ...page.matchAll(
    /createOutcomeUnknown = true;\s*const (\w+) = await createStartMoveProperty\(supabase, \{([\s\S]*?)\}\);\s*createOutcomeUnknown =\s*!\1\.ok && \1\.outcomeUnknown;/g
  ),
];

assert(
  creates.length === 2 && (page.match(/createStartMoveProperty\(/g) ?? []).length === 2,
  "page: sale and purchase are each created once; the unknown-outcome flag is set before the call and cleared only by a definite answer"
);
assert(
  creates.some((m) => /relationshipType: "sale"/.test(m[2]) && /awaitingBuyer: notBuying/.test(m[2])) &&
    creates.some((m) => /relationshipType: "purchase"/.test(m[2]) && /awaitingBuyer: false/.test(m[2])),
  "page: the sale passes awaitingBuyer = notBuying; the purchase passes false"
);
assert(
  !/\.from\(\s*["']properties["']\s*\)/.test(page) && !page.includes("establishOperationalHomeowner"),
  "page: no direct properties write and no separate homeowner grant"
);
assert(
  /"cleanup_abandoned_onboarding_chain",\s*\{ p_chain_id: chainId, p_require_empty: true \}/.test(page),
  "page: cleanup asks for an empty chain, so the server refuses a chain that holds a property"
);
assert(
  (page.match(/cleanupOnboardingChain\(/g) ?? []).length === 3,
  "page: cleanup is defined once and called only from fail() and from cancelling with an empty source chain"
);
assert(
  /if \(chainId != null && \(propertyEstablished \|\| createOutcomeUnknown\)\) \{\s*setRecovery\(/.test(page),
  "page: fail() shows recovery instead of cleanup once a property exists or may exist"
);
assert(
  /if \(action\.preserveSourceChain\) \{\s*setRecovery\([\s\S]*?\} else \{\s*void cleanupOnboardingChain\(action\.chainId\);/.test(page),
  "page: cancelling the duplicate dialog keeps a chain that already holds the sale"
);
assert(
  page.includes("promptJoinExistingChain(chainId, false);") &&
    page.includes("promptJoinExistingChain(chainId, propertyEstablished);"),
  "page: only the purchase duplicate prompt can carry an established sale"
);
assert(
  !/link_start_move_onward_purchase|linkStartMoveOnwardPurchase|search_ea_branch_directory|get_property_ea_branch_entry|createSearchingPlaceholderForSale/.test(page + grants),
  "page and grants: no dependency on Stage-only RPCs"
);
assert(
  /supabase\.rpc\("start_move_create_property", \{\s*p_chain_id: params\.chainId,\s*p_relationship_type: params\.relationshipType,\s*p_address: params\.address,\s*p_postcode: params\.postcode,\s*p_awaiting_buyer: params\.awaitingBuyer,\s*\}\)/.test(grants),
  "grants: RPC arguments match start_move_create_property(bigint, text, text, text, boolean)"
);
assert(
  /if \(error\) \{\s*const existingId = await findStartMoveProperty\(supabase, params\);/.test(grants) &&
    grants.includes("outcomeUnknown: row.ok !== false"),
  "grants: a transport or server error reads the chain back; only an explicit ok = false is a definite refusal"
);
assert(
  /\.eq\("chain_id", params\.chainId\)\s*\.eq\("relationship_type", params\.relationshipType\)\s*\.eq\("is_searching", false\)\s*\.eq\("address", params\.address\.trim\(\)\)\s*\.eq\("postcode", params\.postcode\.trim\(\)\)/.test(grants),
  "grants: read-back matches the chain, relationship, address and postcode that were requested"
);
assert(
  /const \{ error: buyerReadyError \} = await supabase\s*\.from\("chain_nodes"\)[\s\S]*?if \(buyerReadyError\) \{\s*await fail\([\s\S]*?"buyer_ready_not_added"\s*\);\s*return;/.test(page),
  "page: a failed buyer-ready step is reported, never skipped"
);
{
  const start = page.indexOf("onCancel={() => {");
  const handler = start < 0 ? "" : page.slice(start, page.indexOf("/>", start));
  const preserve = handler.slice(handler.indexOf("if (action.preserveSourceChain) {"), handler.indexOf("} else {"));
  assert(
    handler.length > 0 &&
      (handler.match(/cleanupOnboardingChain\(/g) ?? []).length === 1 &&
      preserve.includes("setRecovery(") &&
      !preserve.includes("cleanupOnboardingChain("),
    "page: the duplicate-dialog cancel calls cleanup at most once and never when the source chain is preserved"
  );
}
assert(
  allowlist.includes('"name": "start_move_create_property", "args": "bigint, text, text, text, boolean"'),
  "allowlist: start_move_create_property(bigint, text, text, text, boolean)"
);
assert(
  Object.values(START_MOVE_RECOVERY_COPY).every((copy) => copy.length > 0),
  "recovery copy exists for every reason"
);

console.log(`\n${failed === 0 ? "All checks passed" : `${failed} check(s) failed`}`);

if (failed > 0) {
  process.exit(1);
}
