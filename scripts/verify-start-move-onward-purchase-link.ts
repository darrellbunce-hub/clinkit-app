/**
 * Offline checks for linking a Start Move sale to its onward purchase and for
 * the chain view's segment-gap rendering:
 *
 *   supabase/migrations/20261010110000_link_start_move_onward_purchase.sql
 *
 * Migration shape and scope, the Start Move call order and failure path,
 * chain topology for linked / unlinked / broken pairs, and the connector
 * classes used by the chain page. Reads repository files only.
 *
 * Usage:
 *   npx tsx scripts/verify-start-move-onward-purchase-link.ts
 */
import { readdirSync, readFileSync } from "fs";
import { join } from "path";

import {
  buildChainTopology,
  getLinkedPropertyGapState,
  type TopologyProperty,
} from "../lib/buildChainTopology";
import {
  chainAwaitingBuyerConnectorClasses,
  chainAwaitingConnectionGapClasses,
} from "../lib/theme/chainViz";

const ROOT = join(import.meta.dirname, "..");
const MIGRATIONS_DIR = "supabase/migrations";
const FILE = "20261010110000_link_start_move_onward_purchase.sql";
const STEP1 = "20261010090000_close_ea_self_connect_awaiting_property.sql";
const SIGNATURE = "public.link_start_move_onward_purchase(bigint, bigint)";

type TestResult = { name: string; pass: boolean; detail?: string };
const results: TestResult[] = [];

function record(name: string, pass: boolean, detail?: string) {
  results.push({ name, pass, detail });
  console.log(pass ? `✓ ${name}` : `✗ ${name}${detail ? `: ${detail}` : ""}`);
}

function read(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), "utf8").replace(/\r\n/g, "\n");
}

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

function stripSqlComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, "");
}

function functionBody(sql: string, name: string): string {
  const pattern = new RegExp(
    `create\\s+(?:or\\s+replace\\s+)?function\\s+public\\.${name}\\s*\\([\\s\\S]*?\\$(\\w*)\\$([\\s\\S]*?)\\$\\1\\$`,
    "i"
  );
  return normalize(sql.match(pattern)?.[2] ?? "");
}

function property(
  overrides: Partial<TopologyProperty> &
    Pick<TopologyProperty, "id" | "chainPosition" | "stage">
): TopologyProperty {
  return {
    status: "pending_connection",
    currentUserRole: null,
    lastUpdatedDays: 0,
    address: "Address",
    awaiting_buyer: false,
    is_searching: false,
    buyer_connected: false,
    seller_connected: true,
    relationship_type: null,
    linked_property_id: null,
    ...overrides,
  };
}

function checkMigration() {
  const migrations = readdirSync(join(ROOT, MIGRATIONS_DIR))
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const index = migrations.indexOf(FILE);
  record("Ordering: migration file exists", index > -1);
  record(
    `Ordering: applies after ${STEP1}`,
    index > migrations.indexOf(STEP1) && migrations.indexOf(STEP1) > -1
  );
  const version = FILE.slice(0, 14);
  record(
    "Ordering: version is unique",
    migrations.filter((f) => f.slice(0, 14) === version).length === 1
  );
  record(
    "Ordering: only migration defining link_start_move_onward_purchase",
    migrations.filter((f) =>
      /function\s+public\.link_start_move_onward_purchase\s*\(/i.test(
        read(`${MIGRATIONS_DIR}/${f}`)
      )
    ).join() === FILE
  );

  const sql = stripSqlComments(read(`${MIGRATIONS_DIR}/${FILE}`));
  const flat = normalize(sql);
  const body = functionBody(sql, "link_start_move_onward_purchase");

  record(
    "Function: jsonb, plpgsql, SECURITY DEFINER, search_path = public",
    flat.includes(
      "create or replace function public.link_start_move_onward_purchase( p_sale_property_id bigint, p_purchase_property_id bigint ) returns jsonb language plpgsql security definer set search_path = public as $$"
    )
  );
  record(
    "Function: verified-email gate, authentication and estate-agent refusal",
    body.includes("public._require_verified_email_for_transaction()") &&
      body.includes("'not_authenticated'") &&
      body.includes("public._is_estate_agent_account(v_uid)")
  );
  record(
    "Function: both rows locked in id order before reading",
    /perform 1 from public\.properties where id in \(p_sale_property_id, p_purchase_property_id\) order by id for update;/.test(
      body
    ) && body.indexOf("for update") < body.indexOf("into v_sale")
  );
  record(
    "Function: caller created both rows and holds the active seller (sale) and buyer (purchase) identities",
    body.includes("v_sale.created_by_user_id is distinct from v_uid") &&
      body.includes("v_purchase.created_by_user_id is distinct from v_uid") &&
      body.includes("poi.property_id = v_sale.id and poi.homeowner_user_id = v_uid and poi.operational_role = 'seller' and poi.status = 'active'") &&
      body.includes("poi.property_id = v_purchase.id and poi.homeowner_user_id = v_uid and poi.operational_role = 'buyer' and poi.status = 'active'")
  );
  record(
    "Function: missing and foreign rows share one error (no existence oracle)",
    body.includes("if v_sale.id is null or v_purchase.id is null or v_sale.created_by_user_id") &&
      !body.includes("'property_not_found'")
  );
  record(
    "Function: same chain, chain placement right, sale/purchase shape, live lifecycle",
    body.includes("'chain_mismatch'") &&
      body.includes("public.caller_may_place_property_in_chain(v_sale.chain_id)") &&
      body.includes("v_sale.relationship_type is distinct from 'sale' or v_sale.stage = 'searching'") &&
      body.includes("v_purchase.relationship_type is distinct from 'purchase' or v_purchase.stage = 'searching' or v_purchase.address is null") &&
      body.includes("pls.operational_state in ('released', 'anonymised', 'archived')")
  );
  record(
    "Function: idempotent when already linked to this purchase",
    body.includes("if v_sale.linked_property_id = v_purchase.id then return jsonb_build_object('ok', true, 'linked', true, 'idempotent', true);")
  );
  record(
    "Function: refuses a sale linked elsewhere and a purchase already linked or linked into",
    body.includes("'sale_already_linked'") &&
      body.includes("v_purchase.linked_property_id is not null") &&
      body.includes("p.linked_property_id = v_purchase.id and p.id <> v_sale.id") &&
      body.includes("'purchase_already_linked'")
  );
  const writes = body.match(/(?<!for )\b(?:insert into|update|delete from)\b[^;]*;/g) ?? [];
  record(
    "Function: its only write sets the sale's linked_property_id",
    writes.length === 1 &&
      writes[0] === "update public.properties set linked_property_id = v_purchase.id where id = v_sale.id;",
    writes.join(" | ")
  );

  const revoke = `revoke all on function ${SIGNATURE} from public, anon;`;
  const grant = `grant execute on function ${SIGNATURE} to authenticated, service_role;`;
  record("Grants: authenticated and service_role, not anon", flat.includes(revoke) && flat.includes(grant));

  const outside = normalize(
    sql.replace(/\$(\w*)\$[\s\S]*?\$\1\$/g, "$$$$").replace(/'(?:[^']|'')*'/g, "''")
  );
  record(
    "Scope: no data, table, policy or trigger statements (historic rows untouched)",
    !/\b(insert\s+into|update\s+public\.|delete\s+from|truncate|alter\s+table|create\s+policy|drop\s+policy|create\s+trigger|drop\s+trigger|drop\s+function)\b/.test(
      outside
    )
  );
  record(
    "Scope: exactly one function definition",
    (sql.match(/create\s+(?:or\s+replace\s+)?function/gi) ?? []).length === 1
  );
  record(
    "Preflight and postflight present",
    flat.includes("link_start_move_onward_purchase aborted: required helpers are missing") &&
      flat.includes("link_start_move_onward_purchase postflight: function is anon-executable") &&
      flat.includes("link_start_move_onward_purchase postflight: grants missing")
  );

  const allowlist = JSON.parse(read("scripts/secdef-user-rpc-allowlist.json")) as {
    allowlist: { name: string; args: string }[];
  };
  record(
    "Allowlist: link_start_move_onward_purchase(bigint, bigint) is a deliberate user RPC",
    allowlist.allowlist.some(
      (e) => e.name === "link_start_move_onward_purchase" && e.args === "bigint, bigint"
    )
  );
}

function checkStartMovePage() {
  const page = read("app/start-move/page.tsx");
  const helper = read("lib/onboarding/startMoveOnwardPurchase.ts");

  record(
    "Helper: calls link_start_move_onward_purchase with sale and purchase ids",
    helper.includes('"link_start_move_onward_purchase"') &&
      helper.includes("p_sale_property_id: params.salePropertyId") &&
      helper.includes("p_purchase_property_id: params.purchasePropertyId")
  );

  const buyingInsert = page.indexOf('relationship_type: "purchase"');
  const buyerGrant = page.indexOf("buyerMemberError || !buyerGrant.ok");
  const linkCall = page.indexOf("await linkStartMoveOnwardPurchase(supabase, {");
  const placeholder = page.indexOf("// SEARCHING PLACEHOLDER");
  const redirect = page.indexOf("window.location.href =\n          `/chain/${chainId}");
  record(
    "Start Move: links after the purchase insert and its identity grant",
    buyingInsert > -1 && buyerGrant > buyingInsert && linkCall > buyerGrant
  );
  record(
    "Start Move: link happens before the searching-placeholder step and the redirect",
    linkCall > -1 && linkCall < placeholder && linkCall < redirect
  );
  const linkBlock = page.slice(page.lastIndexOf("if (sellingPropertyId != null) {", linkCall), linkCall + 600);
  record(
    "Start Move: link only when a sale was created in this flow",
    page.lastIndexOf("if (sellingPropertyId != null) {", linkCall) > buyerGrant
  );
  record(
    "Start Move: link failure runs fail() (onboarding chain cleanup) and stops",
    /if \(!linkResult\.ok\) \{\s*await fail\(\s*"\[start-move\] onward purchase link failed:",\s*linkResult\.error\s*\);\s*return;\s*\}/.test(
      linkBlock
    )
  );
  record(
    "Start Move: fail() still cleans up the onboarding chain",
    /async function fail\([\s\S]{0,400}?cleanupOnboardingChain\(chainId\)/.test(page)
  );
  record(
    "Start Move: searching placeholder path unchanged (no link call inside it)",
    !page.slice(placeholder, redirect).includes("linkStartMoveOnwardPurchase")
  );
  record(
    "Start Move: exactly one link call",
    (page.match(/linkStartMoveOnwardPurchase\(/g) ?? []).length === 1
  );
}

function checkTopology() {
  const sale = property({
    id: 1,
    chainPosition: 1,
    stage: "property_listed",
    relationship_type: "sale",
    buyer_connected: false,
    seller_connected: true,
  });
  const purchase = property({
    id: 2,
    chainPosition: 2,
    stage: "offer_accepted",
    relationship_type: "purchase",
    buyer_connected: true,
    seller_connected: false,
  });

  const unlinked = buildChainTopology([sale, purchase], null);
  record(
    "Topology: unlinked Start Move pair is two segments with an awaiting_connection gap (pre-fix shape)",
    unlinked.segments.length === 2 && unlinked.segments[1].gapBefore === "awaiting_connection"
  );

  const linkedSale = { ...sale, linked_property_id: purchase.id };
  const linked = buildChainTopology([linkedSale, purchase], null);
  record(
    "Topology: linked Start Move pair is one segment, sale then purchase, no segment gap",
    linked.segments.length === 1 &&
      linked.segments[0].gapBefore === null &&
      linked.segments[0].propertyNodes.map((p) => p.id).join() === "1,2"
  );
  record(
    "Topology: linked pair keeps the in-segment awaiting connector while the hop is unconnected",
    getLinkedPropertyGapState(linkedSale, purchase) === "awaiting_connection"
  );
  record(
    "Topology: linked pair connects once both sides are connected and healthy",
    getLinkedPropertyGapState(
      { ...linkedSale, status: "healthy", buyer_connected: true },
      { ...purchase, status: "healthy", seller_connected: true }
    ) === "connected"
  );

  const otherSale = property({
    id: 3,
    chainPosition: 3,
    stage: "property_listed",
    relationship_type: "sale",
  });
  const genuine = buildChainTopology([linkedSale, purchase, otherSale], null);
  record(
    "Topology: a genuinely unlinked segment still gets an awaiting_connection gap",
    genuine.segments.length === 2 && genuine.segments[1].gapBefore === "awaiting_connection"
  );

  const broken = buildChainTopology(
    [linkedSale, purchase, { ...otherSale, status: "broken_connection" }],
    null
  );
  record(
    "Topology: a broken_connection segment still gets a broken gap",
    broken.segments.length === 2 && broken.segments[1].gapBefore === "broken"
  );

  const placeholder = property({
    id: 4,
    chainPosition: 2,
    stage: "searching",
    address: null,
    relationship_type: "purchase",
  });
  const placeholderTopology = buildChainTopology(
    [{ ...sale, linked_property_id: placeholder.id }, placeholder],
    null
  );
  record(
    "Topology: sale linked to a searching placeholder is unchanged (one segment)",
    placeholderTopology.segments.length === 1 &&
      placeholderTopology.segments[0].propertyNodes.map((p) => p.id).join() === "1,4"
  );
}

function checkRendering() {
  const gap = chainAwaitingConnectionGapClasses();
  record(
    "Connector: awaiting-connection gap is a horizontal dashed amber line",
    /\bw-\d+\b/.test(gap) &&
      gap.includes("border-t-4") &&
      gap.includes("border-dashed") &&
      gap.includes("border-amber-400") &&
      !/\bborder-l-|\bh-\d+\b/.test(gap),
    gap
  );
  record(
    "Connector: Awaiting Buyer connector unchanged",
    chainAwaitingBuyerConnectorClasses() === "w-24 border-t-4 border-dashed border-amber-400"
  );

  const page = read("app/chain/[chainId]/page.tsx");
  const awaitingStart = page.indexOf('segmentGapState ===\n          "awaiting_connection"');
  const connectedStart = page.indexOf('segmentGapState ===\n          "connected"');
  const awaitingBlock = page.slice(awaitingStart, connectedStart);
  record(
    "Chain page: awaiting-connection gap uses the horizontal connector and keeps its label",
    awaitingStart > -1 &&
      awaitingBlock.includes("chainAwaitingConnectionGapClasses()") &&
      awaitingBlock.includes('aria-label="Awaiting connection"') &&
      awaitingBlock.includes("Awaiting connection\n") &&
      !awaitingBlock.includes("border-l-4") &&
      !awaitingBlock.includes("h-20")
  );

  const brokenStart = page.indexOf('segmentGapState === "broken"');
  const brokenBlock = page.slice(brokenStart, awaitingStart);
  record(
    "Chain page: chain-break gap keeps the vertical red dashed line and label",
    brokenStart > -1 &&
      brokenBlock.includes("h-20") &&
      brokenBlock.includes("border-l-4") &&
      brokenBlock.includes("border-dashed") &&
      brokenBlock.includes("border-red-400") &&
      brokenBlock.includes("Chain break")
  );
  record(
    "Chain page: Awaiting Buyer tile still uses its horizontal connector",
    page.includes("className={chainAwaitingBuyerConnectorClasses()}")
  );
}

function main() {
  checkMigration();
  checkStartMovePage();
  checkTopology();
  checkRendering();

  const failed = results.filter((r) => !r.pass).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed.`);
  if (failed > 0) process.exit(1);
}

main();
