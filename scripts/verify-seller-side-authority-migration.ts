/**
 * Static checks for seller-side authority and awaiting connection (M2).
 *
 *   supabase/migrations/20261005110000_seller_side_authority_and_awaiting_connection.sql
 *   scripts/secdef-user-rpc-allowlist.json
 *   scripts/secdef-service-role-only-targets.json
 *
 * Usage:
 *   npx tsx scripts/verify-seller-side-authority-migration.ts
 */
import { readFileSync } from "fs";
import { join } from "path";

const ROOT = join(import.meta.dirname, "..");
const M2 = "supabase/migrations/20261005110000_seller_side_authority_and_awaiting_connection.sql";

type TestResult = { name: string; pass: boolean; detail?: string };
const results: TestResult[] = [];

function record(name: string, pass: boolean, detail?: string) {
  results.push({ name, pass, detail });
  console.log(pass ? `✓ ${name}` : `✗ ${name}${detail ? `: ${detail}` : ""}`);
}

function read(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), "utf8").replace(/\r\n/g, "\n");
}

function normalize(sql: string): string {
  return sql.replace(/--[^\n]*/g, "").replace(/\s+/g, " ").trim().toLowerCase();
}

type SqlFunction = { args: string; header: string; body: string };

function extractFunctions(sql: string): Map<string, SqlFunction> {
  const functions = new Map<string, SqlFunction>();
  const pattern =
    /create\s+or\s+replace\s+function\s+public\.([a-z0-9_]+)\s*\(([\s\S]*?)\)\s*(returns[\s\S]*?|language[\s\S]*?)\$(\w*)\$([\s\S]*?)\$\4\$/gi;

  for (const match of sql.matchAll(pattern)) {
    functions.set(match[1].toLowerCase(), {
      args: match[2],
      header: match[3],
      body: match[5],
    });
  }

  return functions;
}

function previousBody(file: string, name: string): string {
  return normalize(extractFunctions(read(`supabase/migrations/${file}`)).get(name)?.body ?? "");
}

function escape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function internalAcl(sql: string, signature: string): boolean {
  const s = escape(signature);
  return (
    new RegExp(`revoke all on function ${s} from public, anon, authenticated;`, "i").test(sql) &&
    new RegExp(`grant execute on function ${s} to service_role;`, "i").test(sql) &&
    !new RegExp(`grant execute on function ${s} to [^;]*authenticated`, "i").test(sql)
  );
}

function userRpcAcl(sql: string, signature: string): boolean {
  const s = escape(signature);
  return (
    new RegExp(`revoke all on function ${s} from public, anon;`, "i").test(sql) &&
    new RegExp(`grant execute on function ${s} to authenticated, service_role;`, "i").test(sql)
  );
}

function replaceAll(source: string, pairs: [string, string][]): { text: string; missing: string[] } {
  let text = source;
  const missing: string[] = [];
  for (const [from, to] of pairs) {
    if (!text.includes(from)) missing.push(from.slice(0, 60));
    text = text.replace(from, to);
  }
  return { text, missing };
}

function main() {
  const sql = read(M2);
  const n = normalize(sql);
  const fns = extractFunctions(sql);
  const body = (name: string) => normalize(fns.get(name)?.body ?? "");
  const header = (name: string) => fns.get(name)?.header ?? "";

  const defined = [
    "_property_seller_side_user_id",
    "is_property_seller_side_homeowner",
    "can_operate_property",
    "_converge_onward_purchase_after_seller_join",
    "_grant_counterparty_participation_core",
    "join_chain_property",
    "connect_ea_to_awaiting_property",
    "create_searching_placeholder_for_sale",
    "link_sale_to_searching_placeholder",
    "convert_searching_placeholder_for_sale",
    "_create_ea_operational_property_core",
  ];
  for (const name of defined) {
    record(`M2 defines public.${name}`, fns.has(name));
    record(
      `${name}: SECURITY DEFINER with search_path = public`,
      /security\s+definer/i.test(header(name)) && /set\s+search_path\s*=\s*public/i.test(header(name))
    );
  }

  // Preflight
  for (const guard of [
    "_grant_counterparty_participation_core body differs from 20261001130000",
    "join_chain_property body differs from 20260729120000",
    "create_searching_placeholder_for_sale body differs from 20261001110000",
    "link_sale_to_searching_placeholder body differs from 20261001130000",
    "convert_searching_placeholder_for_sale body differs from 20261001130000",
    "_create_ea_operational_property_core body differs from 20260905120000",
    "ea_operational_assignments differs from 20260612000000",
  ]) {
    record(`Preflight guard: ${guard}`, n.includes(guard.toLowerCase()));
  }
  record(
    "Preflight requires the M1 classifier",
    n.includes("'public._property_side_representation(bigint)'") &&
      n.includes("'public._property_reservation_state(bigint)'") &&
      n.includes("'public._address_match_key(text)'")
  );

  // Seller-side helpers
  const sellerSide = body("_property_seller_side_user_id");
  record(
    "Seller side: sale = active identity holder",
    sellerSide.includes("when 'sale' then ( select poi.homeowner_user_id from public.property_operational_identities poi") &&
      sellerSide.includes("poi.status = 'active'")
  );
  record(
    "Seller side: purchase = the single active counterparty seller",
    sellerSide.includes("case when count(*) = 1 then (array_agg(cp.user_id))[1] end") &&
      sellerSide.includes("cp.counterparty_role = 'seller'") &&
      sellerSide.includes("cp.status = 'active'")
  );
  record(
    "Seller side never uses created_by_user_id, membership or EA assignments",
    !/created_by_user_id|property_members|property_ea_assignments/.test(sellerSide)
  );

  const sellerHomeowner = body("is_property_seller_side_homeowner");
  record(
    "is_property_seller_side_homeowner = caller is the seller side (no EA arm)",
    sellerHomeowner.includes("public._property_seller_side_user_id(p_property_id) = auth.uid()") &&
      !sellerHomeowner.includes("property_ea_assignments")
  );

  const canOperate = body("can_operate_property");
  record("can_operate_property: seller-side homeowner operates", canOperate.includes("t.seller_user_id = auth.uid()"));
  record(
    "can_operate_property: assigned branch member when EA updates allowed or EA-only",
    canOperate.includes("pea.status = 'active'") &&
      canOperate.includes("bm.user_id = auth.uid()") &&
      canOperate.includes("pea.homeowner_only_updates = false or t.seller_user_id is null")
  );
  record(
    "can_operate_property: assignment must be on the row itself (no chain-wide or linked-row authority)",
    canOperate.includes("pea.property_id = t.id") && !/linked_property_id|chain_id/.test(canOperate)
  );
  record("can_operate_property: searching placeholders are not operable", canOperate.includes("p.stage is distinct from 'searching'"));
  record(
    "can_operate_property: membership, delegates and creator grant nothing",
    !/property_members|property_delegates|created_by_user_id|is_property_member/.test(canOperate)
  );

  // Index
  record(
    "Unique index: one active counterparty per (property, role)",
    n.includes(
      "create unique index if not exists property_counterparty_participants_one_active_role_idx on public.property_counterparty_participants (property_id, counterparty_role) where status = 'active';"
    )
  );
  record(
    "Preflight aborts when existing data violates the index",
    n.includes("having count(*) > 1") && n.includes("more than one active counterparty in the same role")
  );

  // Convergence
  const converge = body("_converge_onward_purchase_after_seller_join");
  record(
    "Convergence: linked, same-chain, purchase, EA-created onward row",
    converge.includes("v_purchase.linked_property_id") &&
      converge.includes("v_onward.chain_id is distinct from v_purchase.chain_id") &&
      converge.includes("v_onward.relationship_type is distinct from 'purchase'") &&
      converge.includes("not public._is_estate_agent_account(v_onward.created_by_user_id)")
  );
  record(
    "Convergence: creator must belong to the purchase's assigned branch",
    converge.includes("pea.property_id = v_purchase.id") && converge.includes("bm.user_id = v_onward.created_by_user_id")
  );
  record(
    "Convergence: only rows that have never had an identity",
    converge.includes("from public.property_operational_identities poi where poi.property_id = v_onward.id")
  );
  record(
    "Convergence grants via core(onward, seller, 'ea_origination_claim', false)",
    converge.includes("public._establish_operational_homeowner_core( v_onward.id, p_seller_user_id, 'ea_origination_claim', false )")
  );

  // Counterparty core
  const core = body("_grant_counterparty_participation_core");
  record(
    "Core keeps estate-agent and own-homeowner refusals",
    core.includes("'estate_agent_cannot_be_counterparty'") && core.includes("'homeowner_cannot_be_counterparty'")
  );
  record("Core no longer requires an operational homeowner", !core.includes("no_operational_homeowner"));
  record(
    "Core opposite-side rule: sale needs seller side; purchase needs buyer side",
    core.includes("from public._property_side_representation(p_property_id)") &&
      core.includes(
        "(v_counterparty_role = 'buyer' and v_sides.seller_side = 'none') or (v_counterparty_role = 'seller' and v_sides.buyer_side = 'none')"
      ) &&
      core.includes("'opposite_side_unrepresented'")
  );
  record(
    "Core slot_held: role taken by someone else (pre-check and unique violation)",
    core.includes("cp.counterparty_role = v_counterparty_role") &&
      core.includes("cp.user_id <> p_user_id") &&
      (core.match(/'slot_held'/g) ?? []).length === 2 &&
      core.includes("when unique_violation then return jsonb_build_object('ok', false, 'error', 'slot_held')")
  );
  record("Core refuses searching placeholders", core.includes("v_property.stage = 'searching'"));
  record("Core locks the property row", core.includes("where id = p_property_id for update"));
  record(
    "Core converges only when a seller joins, isolated from the join",
    core.includes("if v_counterparty_role = 'seller' then begin v_onward := public._converge_onward_purchase_after_seller_join(") &&
      core.includes("exception when others then v_onward := jsonb_build_object('ok', false, 'onward_claimed', false);")
  );
  record("Core still records 'join_chain_property' grants", core.includes("'join_chain_property'"));

  // join_chain_property
  const join = body("join_chain_property");
  const joinDiff = replaceAll(previousBody("20260729120000_sec104_rpc_rate_limiting.sql", "join_chain_property"), [
    [
      "and p.address = p_address and p.postcode = p_postcode",
      "and public._address_match_key(p.address) = public._address_match_key(p_address) and public._postcode_match_key(p.postcode) = public._postcode_match_key(p_postcode)",
    ],
  ]);
  record(
    "join_chain_property: only the address/postcode comparison changes (normalised keys)",
    joinDiff.missing.length === 0 && joinDiff.text === join,
    joinDiff.missing.join(" | ")
  );

  // connect_ea_to_awaiting_property
  const connect = body("connect_ea_to_awaiting_property");
  record("connect: verified email required", connect.includes("_require_verified_email_for_transaction()"));
  record("connect: branch membership required", connect.includes("not public.is_ea_branch_member(p_branch_id)"));
  record(
    "connect: shares the join_chain_failed budget, checked before lookup",
    connect.includes("c_scope constant text := 'join_chain_failed'") &&
      connect.indexOf("_rate_limit_is_blocked(c_scope") < connect.indexOf("_access_code_lookup_candidates(")
  );
  record(
    "connect: access code + normalised address, purchase rows only",
    connect.includes("c.access_code = any (v_candidates)") &&
      connect.includes("p.relationship_type = 'purchase'") &&
      connect.includes("public._address_match_key(p.address) = public._address_match_key(p_address)")
  );
  record(
    "connect: awaiting_seller only, rechecked under a row lock",
    (connect.match(/'awaiting_seller'/g) ?? []).length === 2 && connect.includes("for update")
  );
  record(
    "connect: refuses any active assignment and the buyer's sale branch",
    connect.includes("pea.property_id = v_property.id and pea.status = 'active'") &&
      connect.includes("s.linked_property_id = v_property.id") &&
      connect.includes("spea.branch_id = p_branch_id")
  );
  record(
    "connect: writes the assignment only",
    connect.includes("insert into public.property_ea_assignments") &&
      (connect.match(/insert into/g) ?? []).length === 1 &&
      !/property_operational_identities|property_claim_metadata|property_counterparty_participants|_establish_operational_homeowner_core/.test(
        connect
      )
  );
  const connectErrors = [...connect.matchAll(/'error', '([a-z_]+)'/g)].map((m) => m[1]);
  record(
    "connect: failures are generic (join_details_not_matched), besides auth/branch",
    connectErrors.every((e) => ["not_authenticated", "not_ea_branch_member", "join_details_not_matched"].includes(e)),
    [...new Set(connectErrors)].join(",")
  );
  const connectKeys = new Set(
    [...connect.matchAll(/jsonb_build_object\(([^)]*)\)/g)].flatMap((m) =>
      m[1]
        .split(",")
        .map((part) => part.trim())
        .filter((_, index) => index % 2 === 0)
        .map((part) => part.replace(/'/g, ""))
    )
  );
  record(
    "connect: discloses only ok/error/property_id/chain_id",
    [...connectKeys].every((k) => ["ok", "error", "property_id", "chain_id"].includes(k)),
    [...connectKeys].join(",")
  );

  // View
  const viewStart = n.indexOf("create or replace view public.ea_operational_assignments");
  const view = n.slice(viewStart, n.indexOf(";", viewStart));
  record("View stays security_invoker = false", view.includes("with (security_invoker = false)"));
  record(
    "View subject = seller side (sale identity; purchase counterparty seller), inlined",
    view.includes("when 'sale' then ( select poi.homeowner_user_id") &&
      view.includes("cp.counterparty_role = 'seller'") &&
      view.includes("end as subject_user_id") &&
      !view.includes("_property_seller_side_user_id") &&
      !view.includes("get_property_operational_owner_user_id")
  );
  const columns = ["pea.property_id,", "p.chain_id,", "pea.homeowner_only_updates,", "end as subject_user_id,", "as claim_status,", "pcm.origin_type from"];
  record(
    "View columns unchanged and in the same order",
    columns.every((c) => view.includes(c)) &&
      columns.every((c, i) => i === 0 || view.indexOf(columns[i - 1]) < view.indexOf(c))
  );
  record(
    "View keeps branch scoping",
    view.includes("auth.uid() is not null and pea.status = 'active'") && view.includes("bm.user_id = auth.uid()")
  );
  record("View grants unchanged (no grant/revoke on the view)", !/(grant|revoke)[^;]*ea_operational_assignments/.test(n));

  // Placeholder RPCs
  const anchorCheck =
    "if v_sale.relationship_type is null or v_sale.relationship_type not in ('sale', 'purchase') or v_sale.stage = 'searching'";

  const create = body("create_searching_placeholder_for_sale");
  const createDiff = replaceAll(previousBody("20261001110000_create_searching_placeholder_for_sale.sql", "create_searching_placeholder_for_sale"), [
    ["if v_sale.relationship_type is distinct from 'sale' or v_sale.chain_id is null then", `${anchorCheck} or v_sale.chain_id is null then`],
    [
      "if not ( public.is_property_operational_homeowner(p_sale_property_id) or public.is_ea_assigned_to_property(p_sale_property_id) ) then",
      "if not public.can_operate_property(p_sale_property_id) then",
    ],
    [
      "v_owner := public.get_property_operational_owner_user_id(p_sale_property_id);",
      "v_owner := public._property_seller_side_user_id(p_sale_property_id);",
    ],
  ]);
  record(
    "create placeholder: operable sale/purchase anchor, seller-side owner; otherwise identical to 20261001110000",
    createDiff.missing.length === 0 && createDiff.text === create,
    createDiff.missing.join(" | ")
  );
  record("create placeholder: no view-only assigned-EA arm", !create.includes("is_ea_assigned_to_property"));

  const link = body("link_sale_to_searching_placeholder");
  const linkDiff = replaceAll(previousBody("20261001130000_searching_placeholder_ownership_enforcement.sql", "link_sale_to_searching_placeholder"), [
    ["if v_sale.relationship_type <> 'sale' then", `${anchorCheck} then`],
    [
      "v_sale_owner := public.get_property_operational_owner_user_id(p_sale_property_id);",
      "v_sale_owner := public._property_seller_side_user_id(p_sale_property_id);",
    ],
    [
      "if not ( public.is_property_member(p_sale_property_id) or public.is_ea_delegated_editor_on_property(p_sale_property_id) or ( v_sale.created_by_user_id = auth.uid() and v_sale_owner is null ) ) then",
      "if not ( public.can_operate_property(p_sale_property_id) or ( v_sale.relationship_type = 'sale' and ( public.is_property_member(p_sale_property_id) or public.is_ea_delegated_editor_on_property(p_sale_property_id) or ( v_sale.created_by_user_id = auth.uid() and v_sale_owner is null ) ) ) ) then",
    ],
  ]);
  record(
    "link: operable anchor; sale-row arms kept; otherwise identical to 20261001130000",
    linkDiff.missing.length === 0 && linkDiff.text === link,
    linkDiff.missing.join(" | ")
  );

  const convert = body("convert_searching_placeholder_for_sale");
  const convertDiff = replaceAll(previousBody("20261001130000_searching_placeholder_ownership_enforcement.sql", "convert_searching_placeholder_for_sale"), [
    [" v_is_homeowner_seller boolean; v_is_delegated_ea boolean;", ""],
    ["if v_sale.relationship_type is distinct from 'sale' then", `${anchorCheck} then`],
    [
      "select public.is_property_operational_homeowner(p_sale_property_id) into v_is_homeowner_seller; if not v_is_homeowner_seller then select public.is_ea_delegated_editor_on_property(p_sale_property_id) into v_is_delegated_ea; if not coalesce(v_is_delegated_ea, false) then return jsonb_build_object('ok', false, 'error', 'not_authorized'); end if; end if;",
      "if not public.can_operate_property(p_sale_property_id) then return jsonb_build_object('ok', false, 'error', 'not_authorized'); end if;",
    ],
    [
      "v_buyer_user_id := public.get_property_operational_owner_user_id(p_sale_property_id);",
      "v_buyer_user_id := public._property_seller_side_user_id(p_sale_property_id);",
    ],
  ]);
  record(
    "convert: operable anchor, seller-side buyer; otherwise identical to 20261001130000",
    convertDiff.missing.length === 0 && convertDiff.text === convert,
    convertDiff.missing.join(" | ")
  );
  record(
    "convert: buyer assigned exactly once, never auth.uid()",
    (convert.match(/v_buyer_user_id :=/g) ?? []).length === 1 && !convert.includes("v_buyer_user_id := auth.uid()")
  );

  // EA origination: sale only
  const eaCore = body("_create_ea_operational_property_core");
  const eaCoreDiff = replaceAll(
    previousBody("20260905120000_fix_create_ea_operational_property_chain_authz.sql", "_create_ea_operational_property_core"),
    [["if p_relationship_type not in ('sale', 'purchase') then", "if p_relationship_type is distinct from 'sale' then"]]
  );
  record(
    "EA core: purchase refused (invalid_relationship_type); otherwise identical to 20260905120000",
    eaCoreDiff.missing.length === 0 && eaCoreDiff.text === eaCore,
    eaCoreDiff.missing.join(" | ")
  );
  record(
    "Public EA RPCs not redefined (both reach the core)",
    !fns.has("create_ea_operational_property") && !fns.has("join_ea_operational_chain")
  );

  // ACLs
  for (const sig of [
    "public._property_seller_side_user_id(bigint)",
    "public._converge_onward_purchase_after_seller_join(bigint, uuid)",
    "public._grant_counterparty_participation_core(bigint, uuid)",
  ]) {
    record(`ACL service_role only: ${sig}`, internalAcl(sql, sig));
  }
  record(
    "ACL service_role only: _create_ea_operational_property_core",
    /revoke all on function public\._create_ea_operational_property_core\(\s*bigint, text, text, text, uuid, boolean, text, text, boolean\s*\) from public, anon, authenticated;/i.test(sql) &&
      /grant execute on function public\._create_ea_operational_property_core\(\s*bigint, text, text, text, uuid, boolean, text, text, boolean\s*\) to service_role;/i.test(sql)
  );
  for (const sig of [
    "public.is_property_seller_side_homeowner(bigint)",
    "public.can_operate_property(bigint)",
    "public.connect_ea_to_awaiting_property(text, text, text, uuid)",
  ]) {
    record(`ACL authenticated (not anon): ${sig}`, userRpcAcl(sql, sig));
  }
  for (const sig of [
    "public.create_searching_placeholder_for_sale(bigint)",
    "public.link_sale_to_searching_placeholder(bigint, bigint)",
    "public.convert_searching_placeholder_for_sale(bigint, text, text)",
  ]) {
    const s = escape(sig);
    record(
      `ACL unchanged: ${sig}`,
      new RegExp(`revoke all on function ${s} from public, anon;`, "i").test(sql) &&
        new RegExp(`grant execute on function ${s} to authenticated;`, "i").test(sql)
    );
  }
  record(
    "ACL unchanged: join_chain_property",
    /revoke all on function public\.join_chain_property\(text, text, text\) from public;/i.test(sql) &&
      /grant execute on function public\.join_chain_property\(text, text, text\) to authenticated;/i.test(sql)
  );
  record("No GRANT to anon", !/\bgrant\b[^;]*\bto\b[^;]*\banon\b/i.test(sql));

  // Inventories
  const allowlist = JSON.parse(read("scripts/secdef-user-rpc-allowlist.json")) as {
    allowlist: { name: string; args: string; reason: string }[];
  };
  const targets = JSON.parse(read("scripts/secdef-service-role-only-targets.json")) as {
    targets: { name: string; args: string }[];
  };
  const allowEntry = (name: string, args: string) => allowlist.allowlist.find((e) => e.name === name && e.args === args);
  const inTargets = (name: string, args: string) => targets.targets.some((e) => e.name === name && e.args === args);

  record(
    "Allowlist: can_operate_property(bigint) as read-only predicate",
    allowEntry("can_operate_property", "bigint")?.reason === "authenticated_readonly_predicate_helper"
  );
  record(
    "Allowlist: is_property_seller_side_homeowner(bigint) as read-only predicate",
    allowEntry("is_property_seller_side_homeowner", "bigint")?.reason === "authenticated_readonly_predicate_helper"
  );
  record(
    "Allowlist: connect_ea_to_awaiting_property(text, text, text, uuid)",
    allowEntry("connect_ea_to_awaiting_property", "text, text, text, uuid")?.reason === "user_facing_product_rpc"
  );
  for (const [name, args] of [
    ["_property_seller_side_user_id", "bigint"],
    ["_converge_onward_purchase_after_seller_join", "bigint, uuid"],
    ["_grant_counterparty_participation_core", "bigint, uuid"],
  ]) {
    record(`Service-role target: ${name}(${args})`, inTargets(name, args) && !allowEntry(name, args));
  }

  const failed = results.filter((r) => !r.pass).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed.`);
  if (failed > 0) process.exit(1);
}

main();
