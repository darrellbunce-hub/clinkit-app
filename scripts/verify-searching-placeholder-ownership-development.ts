/**
 * Searching placeholder ownership (14 July regression fix).
 *
 * Static checks (default; reads repository files only):
 *   20261001110000_create_searching_placeholder_for_sale.sql
 *   20261001120000_properties_chain_integrity_guard.sql
 *   20261001130000_searching_placeholder_ownership_enforcement.sql
 *   lib/estateAgent/finalizeOperationalSaleCreation.ts, lib/searchingPlaceholder.ts
 *
 * Live scenarios A–M (--execute, Development ONLY — bbbsxzxcjkmpqsfvmhbo):
 *   A homeowner creates tile → owns it          B homeowner converts → owns purchase
 *   C EA delegated origination → unowned tile   D EA view-only origination → unowned, convert denied
 *   E delegated EA converts unclaimed tile → unowned purchase
 *   F claim before conversion                   G conversion before claim → claim converges
 *   H unrelated EA denied                       I repair (service_role)
 *   J atomic convert failure leaves tile        K removed EA / EA removes homeowner
 *   L completion + delay policies               M regressions (Start Move, joinChainSearching,
 *                                                 purchase_agreed claim, EA self-grant blocked)
 *
 * Usage:
 *   npx tsx scripts/verify-searching-placeholder-ownership-development.ts
 *   npx tsx scripts/verify-searching-placeholder-ownership-development.ts --execute
 *
 * --execute requires all three migrations applied on Development. Scenario I
 * runs the service-role repair function, which is global (idempotent; the
 * migration already ran it).
 */
import { randomUUID } from "crypto";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { completeEstateAgentOnboarding } from "../lib/estateAgent/completeOnboarding";
import { createEstateAgentProfile } from "../lib/estateAgent/createEstateAgentProfile";
import { finalizeOperationalSaleCreation } from "../lib/estateAgent/finalizeOperationalSaleCreation";
import { resolveSearchingFromJoinIntent } from "../lib/joinChainSearching";
import {
  attachSearchingPlaceholderToSale,
  convertSearchingPlaceholder,
  createSearchingPlaceholderForSale,
} from "../lib/searchingPlaceholder";

const DEVELOPMENT_SUPABASE_PROJECT_REF = "bbbsxzxcjkmpqsfvmhbo";
const PASSWORD = "PlaceholderOwnershipDev123!";
const TEST_EMAIL_PREFIX = "ph-own";
const TEST_DOMAIN_SUFFIX = ".ph-own.test";

const ROOT = join(import.meta.dirname, "..");
const MIGRATIONS_DIR = join(ROOT, "supabase", "migrations");
const M1 = "20261001110000_create_searching_placeholder_for_sale.sql";
const M2 = "20261001120000_properties_chain_integrity_guard.sql";
const M3 = "20261001130000_searching_placeholder_ownership_enforcement.sql";
// Sequenced after this change set; every other migration must precede M1.
const LATER_MIGRATIONS = [
  "20261005100000_address_reservation_classifier.sql",
  "20261005110000_seller_side_authority_and_awaiting_connection.sql",
  "20261005120000_operational_authority_enforcement.sql",
  "20261005130000_lifecycle_bounded_dormancy.sql",
  "20261005140000_reservation_placeholders_awaiting_seller.sql",
  "20261005150000_dashboard_last_update_at.sql",
  "20261005160000_drop_properties_address_match_key_idx.sql",
];

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
  return sql.replace(/\s+/g, " ").trim().toLowerCase();
}

type SqlFunction = { args: string; header: string; body: string };

function extractFunctions(sql: string): Map<string, SqlFunction> {
  const functions = new Map<string, SqlFunction>();
  const pattern =
    /create\s+or\s+replace\s+function\s+public\.([a-z0-9_]+)\s*\(([\s\S]*?)\)\s*returns([\s\S]*?)\$(\w*)\$([\s\S]*?)\$\4\$/gi;

  for (const match of sql.matchAll(pattern)) {
    functions.set(match[1].toLowerCase(), {
      args: match[2],
      header: match[3],
      body: match[5],
    });
  }

  return functions;
}

function fn(functions: Map<string, SqlFunction>, name: string): SqlFunction {
  const found = functions.get(name);
  if (!found) {
    throw new Error(`Function public.${name} not found`);
  }
  return found;
}

function originalBody(file: string, name: string): string {
  return fn(extractFunctions(read(`supabase/migrations/${file}`)), name).body;
}

function isSecurityDefiner(f: SqlFunction): boolean {
  return /\bsecurity\s+definer\b/i.test(f.header);
}

function internalAcl(sql: string, signature: string): boolean {
  const escaped = signature.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return (
    new RegExp(`revoke all on function ${escaped} from public, anon, authenticated;`, "i").test(sql) &&
    new RegExp(`grant execute on function ${escaped} to service_role;`, "i").test(sql) &&
    !new RegExp(`grant execute on function ${escaped} to authenticated`, "i").test(sql)
  );
}

function publicRpcAcl(sql: string, signature: string): boolean {
  const escaped = signature.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return (
    new RegExp(`revoke all on function ${escaped} from public, anon;`, "i").test(sql) &&
    new RegExp(`grant execute on function ${escaped} to authenticated;`, "i").test(sql)
  );
}

// ---------------------------------------------------------------------------
// Static checks
// ---------------------------------------------------------------------------

function runStaticChecks(): void {
  console.log("\n--- Static checks ---\n");

  const m1 = read(`supabase/migrations/${M1}`);
  const m2 = read(`supabase/migrations/${M2}`);
  const m3 = read(`supabase/migrations/${M3}`);
  const f1 = extractFunctions(m1);
  const f2 = extractFunctions(m2);
  const f3 = extractFunctions(m3);

  // Ordering / sequencing
  {
    const others = readdirSync(MIGRATIONS_DIR)
      .filter(
        (file) => file.endsWith(".sql") && ![M1, M2, M3].includes(file) && !LATER_MIGRATIONS.includes(file)
      )
      .map((file) => file.split("_")[0]);
    const [v1, v2, v3] = [M1, M2, M3].map((file) => file.split("_")[0]);

    record(
      "ordering: 110000 < 120000 < 130000, all later than existing migrations",
      v1 < v2 &&
        v2 < v3 &&
        others.every((version) => version < v1) &&
        LATER_MIGRATIONS.every((file) => file.split("_")[0] > v3)
    );
    record(
      "ordering: helper _is_estate_agent_account defined in 110000 before 120000/130000 use it",
      f1.has("_is_estate_agent_account") &&
        !f2.has("_is_estate_agent_account") &&
        !f3.has("_is_estate_agent_account") &&
        m2.includes("public._is_estate_agent_account(auth.uid())") &&
        m3.includes("'public._is_estate_agent_account(uuid)'")
    );

    const names = (map: Map<string, SqlFunction>) => [...map.keys()];
    const duplicates = [
      ...names(f1).filter((name) => f2.has(name) || f3.has(name)),
      ...names(f2).filter((name) => f3.has(name)),
    ];
    record(
      "ordering: no function defined in more than one of the three migrations",
      duplicates.length === 0,
      duplicates.join(", ")
    );
    record(
      "no GRANT to anon in any of the three migrations",
      ![m1, m2, m3].some((sql) => /\bgrant\b[^;]*\bto\b[^;]*\banon\b/i.test(sql))
    );
  }

  // Phase 1 — create_searching_placeholder_for_sale
  {
    const rpc = fn(f1, "create_searching_placeholder_for_sale");
    const body = rpc.body;

    record("P1 RPC is SECURITY DEFINER with search_path = public", isSecurityDefiner(rpc) && /set\s+search_path\s*=\s*public/i.test(rpc.header));
    record(
      "P1 RPC revoked from public and anon, granted to authenticated",
      publicRpcAcl(m1, "public.create_searching_placeholder_for_sale(bigint)")
    );
    record(
      "P1 _is_estate_agent_account is internal (service_role only)",
      internalAcl(m1, "public._is_estate_agent_account(uuid)")
    );
    record(
      "P1 authorised through the sale (homeowner or assigned EA)",
      /public\.is_property_operational_homeowner\(p_sale_property_id\)\s+or public\.is_ea_assigned_to_property\(p_sale_property_id\)/i.test(body)
    );
    record(
      "P1 returns the existing linked placeholder; refuses other links",
      body.includes("'created', false") && body.includes("'sale_already_linked'")
    );
    record(
      "P1 inserts fixed searching placeholder (purchase / searching / null address / creator = auth.uid())",
      /'searching',\s*null,\s*null,\s*'purchase',\s*'pending_connection',\s*auth\.uid\(\)/i.test(body)
    );
    record(
      "P1 grants only to the sale's existing non-EA homeowner (never auth.uid() by default)",
      /v_owner := public\.get_property_operational_owner_user_id\(p_sale_property_id\)/i.test(body) &&
        /if v_owner is not null and public\._is_estate_agent_account\(v_owner\) then\s+v_owner := null;/i.test(body) &&
        /if v_owner is not null then\s+v_grant := public\._establish_operational_homeowner_core\(\s*v_placeholder_id,\s*v_owner,/i.test(body)
    );
    record(
      "P1 insert + link + grant are one sub-transaction (failed grant rolls back)",
      /begin\s+insert into public\.properties[\s\S]*update public\.properties\s+set linked_property_id = v_placeholder_id[\s\S]*raise exception using\s+errcode = 'SP001'[\s\S]*when sqlstate 'SP001' then/i.test(body)
    );
  }

  // Phase 8 — policies
  {
    record(
      "P8 completion insert: chain member OR delegated EA, AND actor_user_id = auth.uid()",
      /create policy chain_completion_events_insert_participants[\s\S]*?with check \(\s*actor_user_id = auth\.uid\(\)\s*and \([\s\S]*?pm\.user_id = auth\.uid\(\)[\s\S]*?or public\.is_ea_delegated_editor_on_chain\(chain_id\)\s*\)\s*\);/i.test(m1)
    );
    record(
      "P8 completion select: is_chain_operational_viewer",
      /create policy chain_completion_events_select_participants[\s\S]*?using \(\s*public\.is_chain_operational_viewer\(chain_id\)\s*\);/i.test(m1)
    );
    record(
      "P8 delays select: is_chain_operational_viewer",
      /create policy operational_delays_select_participant[\s\S]*?using \(\s*public\.is_chain_operational_viewer\(chain_id\)\s*\);/i.test(m1)
    );
  }

  // Phase 10 — draft guard
  {
    const place = fn(f2, "caller_may_place_property_in_chain").body;
    const forCreated = fn(f2, "establish_operational_homeowner_for_created_property").body;
    record("P10 caller_may_place_property_in_chain has no assigned-EA arm", !/is_ea_assigned_to_chain/i.test(place));
    record(
      "P10 for_created_property: EA rejection AND chain check",
      forCreated.includes("'estate_agent_cannot_be_homeowner'") &&
        forCreated.includes("caller_may_place_property_in_chain(p.chain_id)") &&
        forCreated.includes("p.created_by_user_id = auth.uid()")
    );
  }

  // Phase 3 — core
  {
    const core = fn(f3, "_establish_operational_homeowner_core");
    const guard =
      /\n  if public\._is_estate_agent_account\(p_homeowner_user_id\) then\n    return jsonb_build_object\('ok', false, 'error', 'estate_agent_cannot_be_homeowner'\);\n  end if;\n/;
    record("P3 core rejects estate-agent accounts", guard.test(core.body));
    record(
      "P3 core otherwise identical to 20260714150000",
      normalize(core.body.replace(guard, "\n")) ===
        normalize(originalBody("20260714150000_operational_identity_enforcement.sql", "_establish_operational_homeowner_core"))
    );
    record(
      "P3 core ACL internal",
      internalAcl(m3, "public._establish_operational_homeowner_core(bigint, uuid, text, boolean)")
    );
  }

  // Phase 7 — counterparty
  {
    const core = fn(f3, "_grant_counterparty_participation_core");
    const guard =
      /\n  if public\._is_estate_agent_account\(p_user_id\) then\n    return jsonb_build_object\('ok', false, 'error', 'estate_agent_cannot_be_counterparty'\);\n  end if;\n/;
    record("P7 counterparty core rejects estate-agent accounts", guard.test(core.body));
    record(
      "P7 counterparty core otherwise identical to 20260727100000",
      normalize(core.body.replace(guard, "\n")) ===
        normalize(originalBody("20260727100000_chain_join_security_remediation.sql", "_grant_counterparty_participation_core"))
    );
    record(
      "P7 counterparty ACL internal",
      internalAcl(m3, "public._grant_counterparty_participation_core(bigint, uuid)")
    );
  }

  // Phase 6 — link
  {
    const link = fn(f3, "link_sale_to_searching_placeholder").body;
    record(
      "P6 link (historical M3, superseded by can_operate_property): delegated EA editor, no view-only assigned arm",
      link.includes("public.is_ea_delegated_editor_on_property(p_sale_property_id)") &&
        !link.includes("is_ea_assigned_to_property")
    );
    record(
      "P6 link: creator case only while the sale has no homeowner",
      /v_sale\.created_by_user_id = auth\.uid\(\)\s+and v_sale_owner is null/i.test(link)
    );
    record(
      "P6 link: placeholder must be unowned or owned by the sale's homeowner",
      /v_searching_owner is not null\s+and v_searching_owner is distinct from v_sale_owner/i.test(link) &&
        link.includes("'placeholder_owner_mismatch'")
    );
  }

  // Phase 4 — convert
  {
    const convert = fn(f3, "convert_searching_placeholder_for_sale").body;
    record("P4 convert: no auth.uid() fallback for the buyer", !/v_buyer_user_id\s*:=\s*auth\.uid\(\)/i.test(convert));
    record(
      "P4 convert: buyer is always the sale's operational homeowner",
      /v_buyer_user_id :=\s+public\.get_property_operational_owner_user_id\(p_sale_property_id\);/i.test(convert) &&
        (convert.match(/v_buyer_user_id\s*:=/g) ?? []).length === 1
    );
    record(
      "P4 convert: no identity when the sale is unowned",
      /if v_buyer_user_id is not null then\s+v_grant := public\._establish_operational_homeowner_core\(/i.test(convert)
    );
    record(
      "P4 convert: rejects a placeholder owned by someone else",
      /v_placeholder_owner is not null\s+and v_placeholder_owner is distinct from v_buyer_user_id/i.test(convert)
    );
    record(
      "P4 convert: update + grant + activity atomic (SP001 → JSON error)",
      /begin\s+update public\.properties[\s\S]*_establish_operational_homeowner_core[\s\S]*insert into public\.activities[\s\S]*exception\s+when sqlstate 'SP001' then\s+return jsonb_build_object\('ok', false, 'error', sqlerrm\);/i.test(convert)
    );
    record(
      "P4 convert (historical M3, superseded by can_operate_property): delegated editor or homeowner only",
      convert.includes("public.is_property_operational_homeowner(p_sale_property_id)") &&
        convert.includes("public.is_ea_delegated_editor_on_property(p_sale_property_id)") &&
        !convert.includes("is_ea_assigned_to_property")
    );
    record(
      "P4 convert ACL",
      publicRpcAcl(m3, "public.convert_searching_placeholder_for_sale(bigint, text, text)")
    );
  }

  // Effective definitions: an EA-only sale follows can_operate_property
  {
    const latest = new Map<string, SqlFunction>();
    for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort()) {
      for (const [name, def] of extractFunctions(read(`supabase/migrations/${file}`))) {
        latest.set(name, def);
      }
    }
    const operate = fn(latest, "can_operate_property").body;
    record(
      "Effective can_operate_property: assigned EA operates when updates are allowed or no seller homeowner (EA-only)",
      /pea\.homeowner_only_updates = false\s+or t\.seller_user_id is null/i.test(operate) &&
        /pea\.status = 'active'/i.test(operate) &&
        /stage is distinct from 'searching'/i.test(operate)
    );
    for (const name of ["convert_searching_placeholder_for_sale", "link_sale_to_searching_placeholder"]) {
      const body = fn(latest, name).body;
      record(
        `Effective ${name}: authorised by can_operate_property on the anchor only (no stricter delegated-editor rule)`,
        body.includes("public.can_operate_property(p_sale_property_id)") &&
          !body.includes("is_ea_delegated_editor_on_property") &&
          !body.includes("is_ea_assigned_to_property")
      );
      record(
        `Effective ${name}: onward owner is the anchor's seller-side homeowner, never the caller`,
        body.includes("public._property_seller_side_user_id(p_sale_property_id)") &&
          !/:=\s*auth\.uid\(\)/i.test(body)
      );
    }
  }

  // Phase 5 — claim convergence + reverse
  {
    const converge = fn(f3, "_converge_onward_purchase_after_claim").body;
    const claim = fn(f3, "claim_operational_property").body;
    const release = fn(f3, "_release_converged_onward_purchase_with_sale").body;
    const delink = fn(f3, "_execute_participation_delink").body;

    record(
      "P5 convergence: linked, same-chain, purchase, EA-created, never owned",
      converge.includes("v_sale.linked_property_id") &&
        converge.includes("v_onward.chain_id is distinct from v_sale.chain_id") &&
        converge.includes("v_onward.relationship_type is distinct from 'purchase'") &&
        converge.includes("public._is_estate_agent_account(v_onward.created_by_user_id)") &&
        converge.includes("v_existing.property_id is not null")
    );
    record(
      "P5 convergence grants via core(onward, claimant, 'ea_origination_claim', false)",
      /_establish_operational_homeowner_core\(\s*v_onward\.id,\s*p_homeowner_user_id,\s*'ea_origination_claim',\s*false\s*\)/i.test(converge)
    );

    const isolated =
      /\n  -- Isolated: a convergence failure must not roll back the claim\.\n  begin\n    v_onward := public\._converge_onward_purchase_after_claim\(\n      p_property_id,\n      auth\.uid\(\)\n    \);\n  exception\n    when others then\n      v_onward := jsonb_build_object\('ok', false, 'onward_claimed', false\);\n  end;\n/;
    const onwardReturn =
      /,\n    'onward_claimed', coalesce\(\(v_onward ->> 'onward_claimed'\)::boolean, false\)/;
    record("P5 claim: convergence isolated in its own exception block", isolated.test(claim));
    record("P5 claim: returns onward_claimed", onwardReturn.test(claim));
    record(
      "P5 claim otherwise identical to 20260729120000",
      normalize(
        claim
          .replace(isolated, "\n")
          .replace(onwardReturn, "")
          .replace(/\n  v_onward jsonb;/, "")
      ) === normalize(originalBody("20260729120000_sec104_rpc_rate_limiting.sql", "claim_operational_property"))
    );

    const reverse =
      /\n\n      perform public\._release_converged_onward_purchase_with_sale\(\n        p_property_id,\n        v_identity\.homeowner_user_id,\n        p_reason_code\n      \);/;
    record(
      "P5 estate_agent_remove_homeowner releases the converged onward purchase",
      reverse.test(delink) &&
        delink.indexOf("_release_converged_onward_purchase_with_sale") >
          delink.indexOf("if p_operation = 'estate_agent_remove_homeowner' then")
    );
    record(
      "P5 delink otherwise identical to 20260727110000",
      normalize(delink.replace(reverse, "")) ===
        normalize(originalBody("20260727110000_fix_delink_stale_properties_updated_at.sql", "_execute_participation_delink"))
    );
    record(
      "P5 reverse only touches the same homeowner's active identity and marks it for re-convergence",
      release.includes("poi.homeowner_user_id = p_homeowner_user_id") &&
        release.includes("'released_with_sale_property_id'")
    );
    record(
      "P5 internal ACLs",
      internalAcl(m3, "public._converge_onward_purchase_after_claim(bigint, uuid)") &&
        internalAcl(m3, "public._release_converged_onward_purchase_with_sale(bigint, uuid, text)") &&
        internalAcl(m3, "public._execute_participation_delink(bigint, text, text, uuid)")
    );
    record("P5 claim ACL", publicRpcAcl(m3, "public.claim_operational_property(bigint, text)"));
  }

  // Phase 9 — repair
  {
    const repair = fn(f3, "_repair_estate_agent_operational_identities").body;
    record(
      "P9 repair: Case A transfers via core with 'ea_origination_claim'",
      /_establish_operational_homeowner_core\(\s*r\.property_id,\s*v_target,\s*'ea_origination_claim',\s*false\s*\)/i.test(repair)
    );
    record(
      "P9 repair: audit rows are system / null actor / 'other' with previous identity",
      /null,\s*'system',\s*'other',/i.test(repair) && repair.includes("'previous_identity'")
    );
    record("P9 repair: never marks rows 'released'", !/status\s*=\s*'released'/i.test(repair));
    record("P9 repair: no fake auth user", !/insert\s+into\s+auth\./i.test(m3));
    record(
      "P9 repair ACL internal",
      internalAcl(m3, "public._repair_estate_agent_operational_identities()")
    );
    record(
      "P9 migration asserts zero EA identities and owner-class memberships",
      /if v_identities > 0 or v_memberships > 0 then\s+raise exception/i.test(m3)
    );
  }

  // Application
  {
    const finalize = read("lib/estateAgent/finalizeOperationalSaleCreation.ts");
    const placeholder = read("lib/searchingPlaceholder.ts");
    const wrapper =
      placeholder.match(/export async function createSearchingPlaceholderForSale\([\s\S]*?\n}\n/)?.[0] ?? "";

    record(
      "app: finalize calls createSearchingPlaceholderForSale (not attach)",
      finalize.includes("createSearchingPlaceholderForSale(supabase") &&
        !finalize.includes("attachSearchingPlaceholderToSale")
    );
    record(
      "app: wrapper calls create_searching_placeholder_for_sale and has no client-side grant",
      wrapper.includes('"create_searching_placeholder_for_sale"') &&
        !wrapper.includes("establishOperationalHomeowner") &&
        !wrapper.includes('.from("properties")')
    );
    record(
      "app: RPC failure is surfaced (no false success)",
      /if \(error\) \{\s*return \{\s*ok: false,/.test(wrapper) &&
        /if \(!result\?\.ok \|\| result\.property_id == null\) \{\s*return \{\s*ok: false,/.test(wrapper)
    );
    record(
      "app: Start Move keeps attachSearchingPlaceholderToSale",
      read("app/start-move/page.tsx").includes("attachSearchingPlaceholderToSale(")
    );

    const allowlist = JSON.parse(read("scripts/secdef-user-rpc-allowlist.json")) as {
      allowlist: { name: string; args: string }[];
    };
    record(
      "allowlist: create_searching_placeholder_for_sale(bigint)",
      allowlist.allowlist.some(
        (entry) => entry.name === "create_searching_placeholder_for_sale" && entry.args === "bigint"
      )
    );
  }
}

// ---------------------------------------------------------------------------
// Live Development scenarios
// ---------------------------------------------------------------------------

function loadEnvLocal(): void {
  try {
    for (const line of readFileSync(join(process.cwd(), ".env.local"), "utf8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const separatorIndex = trimmed.indexOf("=");
      if (separatorIndex <= 0) continue;
      const key = trimmed.slice(0, separatorIndex).trim();
      let value = trimmed.slice(separatorIndex + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  } catch {
    // optional
  }
}

function assertDevelopmentEnvironment(supabaseUrl: string): string {
  const projectRef = supabaseUrl.match(/^https:\/\/([a-z0-9]+)\.supabase\.co/i)?.[1] ?? null;
  if (projectRef !== DEVELOPMENT_SUPABASE_PROJECT_REF) {
    throw new Error(
      `Refusing to run: Supabase project "${projectRef ?? "unknown"}" is not Development (${DEVELOPMENT_SUPABASE_PROJECT_REF}).`
    );
  }
  if (process.env.VERCEL_ENV === "production") {
    throw new Error("Refusing to run: VERCEL_ENV=production.");
  }
  return projectRef;
}

type Rpc = { ok?: boolean; error?: string; [key: string]: unknown } | null;

type Ctx = {
  url: string;
  anonKey: string;
  admin: SupabaseClient;
  stamp: string;
  userIds: string[];
  chainIds: number[];
  branchIds: string[];
  companyIds: string[];
};

type Actor = { userId: string; email: string; client: SupabaseClient };
type EaActor = Actor & { branchId: string };

function anonClient(ctx: Ctx): SupabaseClient {
  return createClient(ctx.url, ctx.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function signIn(ctx: Ctx, email: string): Promise<SupabaseClient> {
  const client = anonClient(ctx);
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`Sign in failed: ${error.message}`);
  return client;
}

async function createAuthUser(ctx: Ctx, email: string): Promise<string> {
  const { data, error } = await ctx.admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user?.id) {
    throw new Error(`createUser failed: ${error?.message ?? "no user"}`);
  }
  ctx.userIds.push(data.user.id);
  return data.user.id;
}

async function setupHomeowner(ctx: Ctx, label: string): Promise<Actor> {
  const email = `${TEST_EMAIL_PREFIX}-${label}-${ctx.stamp}@ho-${ctx.stamp}${TEST_DOMAIN_SUFFIX}`;
  const userId = await createAuthUser(ctx, email);
  const client = await signIn(ctx, email);
  const { error } = await client.from("profiles").upsert(
    {
      id: userId,
      role: "homeowner",
      account_type: "homeowner",
      contact_name: `HO ${label}`,
      onboarding_completed_at: new Date().toISOString(),
    },
    { onConflict: "id" }
  );
  if (error) throw new Error(`homeowner profile: ${error.message}`);
  return { userId, email, client };
}

async function setupEstateAgent(ctx: Ctx, label: string): Promise<EaActor> {
  const domain = `${label}-${ctx.stamp}${TEST_DOMAIN_SUFFIX}`;
  const email = `${TEST_EMAIL_PREFIX}-${label}-${ctx.stamp}@${domain}`;
  const userId = await createAuthUser(ctx, email);
  const client = await signIn(ctx, email);

  const profile = await createEstateAgentProfile(client, {
    userId,
    contactName: `EA ${label}`,
    email,
  });
  if (profile.error) throw new Error(profile.error);

  const onboard = await completeEstateAgentOnboarding(client, {
    userId,
    companyName: `Placeholder Ownership Co ${label} ${ctx.stamp}`,
    branchName: `Branch ${label}`,
    townOrCity: "Fareham",
    postcode: "PO16 7AA",
    isHeadOffice: true,
    emailDomain: domain,
  });
  if (!onboard.success) throw new Error(onboard.error);

  const { data: membership } = await client
    .from("ea_branch_members")
    .select("branch_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (!membership?.branch_id) throw new Error("EA branch membership missing");

  const { data: branch } = await ctx.admin
    .from("ea_branches")
    .select("id, company_id")
    .eq("id", membership.branch_id)
    .single();

  ctx.branchIds.push(membership.branch_id as string);
  if (branch?.company_id) ctx.companyIds.push(branch.company_id as string);

  return { userId, email, client, branchId: membership.branch_id as string };
}

let chainCounter = 0;

async function eaSale(
  ctx: Ctx,
  ea: EaActor,
  options: { inviteEmail?: string; homeownerOnlyUpdates?: boolean; onward: boolean }
): Promise<{ chainId: number; saleId: number; finalize: { ok: boolean; error?: string } }> {
  chainCounter += 1;
  const suffix = `${ctx.stamp.slice(-6)}-${chainCounter}`;
  const { data: chain, error: chainError } = await ea.client.rpc("create_ea_operational_chain", {
    p_name: `PH Own ${suffix}`,
    p_access_code: `KN-PHO-${suffix}`.toUpperCase(),
  });
  if (chainError || !chain?.ok) {
    throw new Error(`create_ea_operational_chain: ${chainError?.message ?? chain?.error}`);
  }
  const chainId = chain.chain_id as number;
  ctx.chainIds.push(chainId);

  const { data: sale, error: saleError } = await ea.client.rpc("create_ea_operational_property", {
    p_chain_id: chainId,
    p_relationship_type: "sale",
    p_address: `${chainCounter} Ownership Sale ${ctx.stamp}`,
    p_postcode: "PO16 7AA",
    p_branch_id: ea.branchId,
    p_homeowner_only_updates: options.homeownerOnlyUpdates ?? false,
    p_invite_email: options.inviteEmail ?? null,
    p_awaiting_buyer: false,
  });
  if (saleError || !sale?.ok) {
    throw new Error(`create_ea_operational_property: ${saleError?.message ?? sale?.error}`);
  }
  const saleId = sale.property_id as number;

  const finalize = await finalizeOperationalSaleCreation(ea.client, {
    chainId,
    salePropertyId: saleId,
    userId: ea.userId,
    endOfChain: !options.onward,
    refreshSummaries: false,
  });

  return {
    chainId,
    saleId,
    finalize: finalize.ok ? { ok: true } : { ok: false, error: finalize.error },
  };
}

async function homeownerSale(
  ctx: Ctx,
  ho: Actor
): Promise<{ chainId: number; saleId: number }> {
  chainCounter += 1;
  const suffix = `${ctx.stamp.slice(-6)}-${chainCounter}`;
  const { data: chain, error: chainError } = await ho.client.rpc("create_chain_for_onboarding", {
    p_name: `PH HO ${suffix}`,
    p_access_code: `KN-PHH-${suffix}`.toUpperCase(),
  });
  if (chainError || chain?.chain_id == null) {
    throw new Error(`create_chain_for_onboarding: ${chainError?.message ?? chain?.error}`);
  }
  const chainId = chain.chain_id as number;
  ctx.chainIds.push(chainId);

  const { data: sale, error: saleError } = await ho.client
    .from("properties")
    .insert({
      chain_id: chainId,
      chain_position: 1,
      address: `${chainCounter} Homeowner Sale ${ctx.stamp}`,
      postcode: "PO16 7HS",
      stage: "property_listed",
      status: "pending_connection",
      relationship_type: "sale",
      created_by_user_id: ho.userId,
      awaiting_buyer: false,
      buyer_connected: false,
      seller_connected: true,
      is_searching: false,
      is_current_user: true,
      last_updated_days: 0,
    })
    .select("id")
    .single();
  if (saleError || !sale) throw new Error(`homeowner sale insert: ${saleError?.message}`);

  const { data: grant, error: grantError } = await ho.client.rpc(
    "establish_operational_homeowner_for_created_property",
    { p_property_id: sale.id }
  );
  if (grantError || !grant?.ok) {
    throw new Error(`for_created_property: ${grantError?.message ?? grant?.error}`);
  }

  return { chainId, saleId: sale.id as number };
}

async function identity(ctx: Ctx, propertyId: number) {
  const { data } = await ctx.admin
    .from("property_operational_identities")
    .select("homeowner_user_id, status, granted_via, metadata")
    .eq("property_id", propertyId)
    .maybeSingle();
  return data as
    | { homeowner_user_id: string; status: string; granted_via: string; metadata: Record<string, unknown> }
    | null;
}

async function members(ctx: Ctx, propertyId: number) {
  const { data } = await ctx.admin
    .from("property_members")
    .select("user_id, role")
    .eq("property_id", propertyId);
  return (data ?? []) as { user_id: string; role: string }[];
}

async function property(ctx: Ctx, propertyId: number) {
  const { data } = await ctx.admin
    .from("properties")
    .select("id, chain_id, stage, address, postcode, relationship_type, linked_property_id, created_by_user_id")
    .eq("id", propertyId)
    .single();
  return data as {
    id: number;
    chain_id: number;
    stage: string;
    address: string | null;
    postcode: string | null;
    relationship_type: string;
    linked_property_id: number | null;
    created_by_user_id: string;
  };
}

async function linkedTile(ctx: Ctx, saleId: number): Promise<number | null> {
  return (await property(ctx, saleId)).linked_property_id;
}

async function claim(ho: Actor, propertyId: number): Promise<Rpc> {
  const { data, error } = await ho.client.rpc("claim_operational_property", {
    p_property_id: propertyId,
    p_invitation_token: null,
  });
  return error ? { ok: false, error: error.message } : (data as Rpc);
}

async function convertRpc(actor: Actor, saleId: number, label: string): Promise<Rpc> {
  const { data, error } = await actor.client.rpc("convert_searching_placeholder_for_sale", {
    p_sale_property_id: saleId,
    p_address: `${label} Onward Purchase`,
    p_postcode: "PO16 7CV",
  });
  return error ? { ok: false, error: error.message } : (data as Rpc);
}

function noEaOwnerClass(list: { user_id: string; role: string }[], eaUserId: string): boolean {
  return !list.some((member) => member.user_id === eaUserId);
}

async function runScenarios(ctx: Ctx): Promise<void> {
  const eaA = await setupEstateAgent(ctx, "ea-a");
  const eaB = await setupEstateAgent(ctx, "ea-b");
  const hoA = await setupHomeowner(ctx, "ho-a");
  const hoF = await setupHomeowner(ctx, "ho-f");
  const hoG = await setupHomeowner(ctx, "ho-g");
  const hoM = await setupHomeowner(ctx, "ho-m");
  const hoP = await setupHomeowner(ctx, "ho-p");
  const s = ctx.stamp.slice(-6);

  // A — homeowner creates tile via the new RPC and owns it
  const a = await homeownerSale(ctx, hoA);
  const aCreate = await createSearchingPlaceholderForSale(hoA.client, { salePropertyId: a.saleId });
  const aTileId = aCreate.ok ? aCreate.placeholderId : null;
  const aIdentity = aTileId ? await identity(ctx, aTileId) : null;
  record(
    "A homeowner-created tile is owned by the homeowner",
    aCreate.ok &&
      aIdentity?.homeowner_user_id === hoA.userId &&
      aIdentity.status === "active" &&
      (await linkedTile(ctx, a.saleId)) === aTileId,
    JSON.stringify({ aCreate, granted_via: aIdentity?.granted_via })
  );
  const aAgain = await createSearchingPlaceholderForSale(hoA.client, { salePropertyId: a.saleId });
  record(
    "A repeat call returns the existing linked tile",
    aAgain.ok && aAgain.placeholderId === aTileId
  );

  // B — homeowner converts → owns purchase
  const bConvert = await convertSearchingPlaceholder(hoA.client, {
    chainId: a.chainId,
    salePropertyId: a.saleId,
    address: `B ${s} Onward`,
    postcode: "PO16 7BB",
  });
  const bIdentity = aTileId ? await identity(ctx, aTileId) : null;
  record(
    "B homeowner conversion → purchase owned by homeowner",
    bConvert.ok && bIdentity?.homeowner_user_id === hoA.userId && bIdentity.status === "active",
    JSON.stringify(bConvert)
  );

  // C — EA delegated origination → unowned tile, no EA owner-class membership
  const c = await eaSale(ctx, eaA, { inviteEmail: hoG.email, onward: true });
  const cTileId = await linkedTile(ctx, c.saleId);
  const cTile = cTileId ? await property(ctx, cTileId) : null;
  record(
    "C EA delegated origination succeeds with a linked searching tile",
    c.finalize.ok && cTile?.stage === "searching" && cTile.created_by_user_id === eaA.userId,
    JSON.stringify(c.finalize)
  );
  record(
    "C tile is unowned and the EA has no membership on it",
    cTileId != null && (await identity(ctx, cTileId)) == null && noEaOwnerClass(await members(ctx, cTileId), eaA.userId)
  );

  // D — EA-only sale with homeowner-only updates: no homeowner is connected, so the
  // assigned EA is the operational authority and converts; the purchase stays unowned.
  const d = await eaSale(ctx, eaA, { inviteEmail: hoM.email, homeownerOnlyUpdates: true, onward: true });
  const dTileId = await linkedTile(ctx, d.saleId);
  record(
    "D EA view-only origination succeeds; tile unowned, no EA membership",
    d.finalize.ok &&
      dTileId != null &&
      (await identity(ctx, dTileId)) == null &&
      noEaOwnerClass(await members(ctx, dTileId), eaA.userId),
    JSON.stringify(d.finalize)
  );
  const dConvert = await convertRpc(eaA, d.saleId, `D ${s}`);
  const dTile = dTileId ? await property(ctx, dTileId) : null;
  const { count: dAssignments } = dTileId
    ? await ctx.admin
        .from("property_ea_assignments")
        .select("id", { count: "exact", head: true })
        .eq("property_id", dTileId)
    : { count: null };
  record(
    "D EA-only sale (homeowner-only updates, unclaimed): EA converts → unowned purchase, no EA identity, membership or assignment",
    dConvert?.ok === true &&
      dTile?.stage === "offer_accepted" &&
      dTileId != null &&
      (await identity(ctx, dTileId)) == null &&
      noEaOwnerClass(await members(ctx, dTileId), eaA.userId) &&
      dAssignments === 0,
    JSON.stringify(dConvert)
  );

  // E — delegated EA converts the unclaimed tile → unowned purchase
  const eConvert = await convertRpc(eaA, c.saleId, `E ${s}`);
  const ePurchase = cTileId ? await property(ctx, cTileId) : null;
  record(
    "E delegated EA converts unclaimed tile → unowned purchase, no EA membership",
    eConvert?.ok === true &&
      ePurchase?.stage === "offer_accepted" &&
      cTileId != null &&
      (await identity(ctx, cTileId)) == null &&
      noEaOwnerClass(await members(ctx, cTileId), eaA.userId),
    JSON.stringify(eConvert)
  );

  // G — conversion before claim, then claim converges
  const gClaim = await claim(hoG, c.saleId);
  const gIdentity = cTileId ? await identity(ctx, cTileId) : null;
  record(
    "G claim after EA conversion → homeowner owns the purchase (onward_claimed)",
    gClaim?.ok === true &&
      gClaim.onward_claimed === true &&
      gIdentity?.homeowner_user_id === hoG.userId &&
      gIdentity.granted_via === "ea_origination_claim",
    JSON.stringify(gClaim)
  );

  // F — claim before conversion; homeowner converts
  const f = await eaSale(ctx, eaA, { inviteEmail: hoF.email, onward: true });
  const fTileId = await linkedTile(ctx, f.saleId);
  const fClaim = await claim(hoF, f.saleId);
  const fTileIdentity = fTileId ? await identity(ctx, fTileId) : null;
  record(
    "F claim before conversion → homeowner owns the tile (onward_claimed)",
    fClaim?.ok === true && fClaim.onward_claimed === true && fTileIdentity?.homeowner_user_id === hoF.userId,
    JSON.stringify(fClaim)
  );
  const fConvert = await convertRpc(hoF, f.saleId, `F ${s}`);
  const fPurchaseIdentity = fTileId ? await identity(ctx, fTileId) : null;
  record(
    "F homeowner converts → owns the purchase",
    fConvert?.ok === true && fPurchaseIdentity?.homeowner_user_id === hoF.userId,
    JSON.stringify(fConvert)
  );

  // H — unrelated EA denied
  const h = await eaSale(ctx, eaA, { onward: false });
  const { data: hCreate } = await eaB.client.rpc("create_searching_placeholder_for_sale", {
    p_sale_property_id: h.saleId,
  });
  record(
    "H unrelated EA cannot create a tile for another agency's sale",
    (hCreate as Rpc)?.ok === false && (hCreate as Rpc)?.error === "not_authorized",
    JSON.stringify(hCreate)
  );
  const hConvert = await convertRpc(eaB, d.saleId, `H ${s}`);
  record(
    "H unrelated EA cannot convert",
    hConvert?.ok === false && hConvert.error === "not_authorized",
    JSON.stringify(hConvert)
  );
  const { data: hLink } = await eaB.client.rpc("link_sale_to_searching_placeholder", {
    p_sale_property_id: h.saleId,
    p_searching_property_id: dTileId,
  });
  record(
    "H unrelated EA cannot link",
    (hLink as Rpc)?.ok === false,
    JSON.stringify(hLink)
  );
  const { data: hHo } = await hoA.client.rpc("create_searching_placeholder_for_sale", {
    p_sale_property_id: h.saleId,
  });
  record(
    "H unrelated homeowner cannot create a tile",
    (hHo as Rpc)?.ok === false && (hHo as Rpc)?.error === "not_authorized",
    JSON.stringify(hHo)
  );

  // J — atomic failure: sale "owned" by an EA (injected) → convert grant fails → tile unchanged
  const j = await eaSale(ctx, eaA, { onward: true });
  const jTileId = await linkedTile(ctx, j.saleId);
  await ctx.admin.from("property_operational_identities").insert({
    property_id: j.saleId,
    homeowner_user_id: eaA.userId,
    operational_role: "seller",
    granted_via: "backfill",
    status: "active",
  });
  const jConvert = await convertRpc(eaA, j.saleId, `J ${s}`);
  const jTile = jTileId ? await property(ctx, jTileId) : null;
  const { data: jActivities } = await ctx.admin
    .from("activities")
    .select("id")
    .eq("property_id", jTileId ?? -1);
  record(
    "J failed grant rolls back conversion (tile still searching, no activity)",
    jConvert?.ok === false &&
      jConvert.error === "estate_agent_cannot_be_homeowner" &&
      jTile?.stage === "searching" &&
      jTile.address == null &&
      jTile.relationship_type === "purchase" &&
      (jActivities ?? []).length === 0,
    JSON.stringify(jConvert)
  );
  await ctx.admin.from("property_operational_identities").delete().eq("property_id", j.saleId);

  // I — repair (Case B: unowned sale; Case A: tile linked from a homeowner-owned sale)
  const iB = await eaSale(ctx, eaA, { onward: true });
  const iBTileId = (await linkedTile(ctx, iB.saleId))!;
  await ctx.admin.from("property_operational_identities").insert({
    property_id: iBTileId,
    homeowner_user_id: eaA.userId,
    operational_role: "buyer",
    granted_via: "start_move",
    status: "active",
  });
  await ctx.admin.from("property_members").insert({ property_id: iBTileId, user_id: eaA.userId, role: "buyer" });

  if (fTileId) {
    await ctx.admin.from("property_members").delete().eq("property_id", fTileId).eq("user_id", hoF.userId);
    await ctx.admin.from("property_operational_identities").delete().eq("property_id", fTileId);
    await ctx.admin.from("property_operational_identities").insert({
      property_id: fTileId,
      homeowner_user_id: eaA.userId,
      operational_role: "buyer",
      granted_via: "start_move",
      status: "active",
    });
    await ctx.admin.from("property_members").insert({ property_id: fTileId, user_id: eaA.userId, role: "buyer" });
  }

  const { data: repair, error: repairError } = await ctx.admin.rpc(
    "_repair_estate_agent_operational_identities"
  );
  const iBEvents = await ctx.admin
    .from("property_delink_events")
    .select("actor_type, actor_user_id, reason_code, metadata")
    .eq("property_id", iBTileId);
  const iBEvent = (iBEvents.data ?? []).find(
    (event) => (event.metadata as { operation?: string })?.operation === "repair_estate_agent_operational_identity"
  );
  record(
    "I Case B: EA identity + membership removed, audited as system/other",
    !repairError &&
      (repair as Rpc)?.ok === true &&
      (await identity(ctx, iBTileId)) == null &&
      noEaOwnerClass(await members(ctx, iBTileId), eaA.userId) &&
      iBEvent?.actor_type === "system" &&
      iBEvent.actor_user_id == null &&
      iBEvent.reason_code === "other",
    repairError?.message ?? JSON.stringify(repair)
  );
  if (fTileId) {
    const iAIdentity = await identity(ctx, fTileId);
    record(
      "I Case A: EA identity on linked purchase transferred to the sale homeowner",
      iAIdentity?.homeowner_user_id === hoF.userId &&
        iAIdentity.status === "active" &&
        noEaOwnerClass(await members(ctx, fTileId), eaA.userId) &&
        (await members(ctx, fTileId)).some((m) => m.user_id === hoF.userId && m.role === "buyer")
    );
  }
  const { data: repairAgain } = await ctx.admin.rpc("_repair_estate_agent_operational_identities");
  record(
    "I repair is idempotent",
    (repairAgain as Rpc)?.identities_transferred === 0 &&
      (repairAgain as Rpc)?.identities_removed === 0 &&
      (repairAgain as Rpc)?.memberships_removed === 0,
    JSON.stringify(repairAgain)
  );
  const { error: repairClientError, data: repairClientData } = await eaA.client.rpc(
    "_repair_estate_agent_operational_identities" as never
  );
  record(
    "I repair function not executable by authenticated clients",
    !!repairClientError || (repairClientData as Rpc)?.ok !== true,
    repairClientError?.message
  );

  // K — removed EA; EA removes homeowner → onward follows the sale back
  const k = await eaSale(ctx, eaA, { onward: false });
  const { data: kRemove } = await eaA.client.rpc("execute_participation_delink", {
    p_property_id: k.saleId,
    p_operation: "estate_agent_remove_branch",
    p_reason_code: "other",
    p_branch_id: eaA.branchId,
  });
  const { data: kCreate } = await eaA.client.rpc("create_searching_placeholder_for_sale", {
    p_sale_property_id: k.saleId,
  });
  record(
    "K removed EA (branch released) cannot create a tile",
    (kRemove as Rpc)?.ok === true &&
      (kCreate as Rpc)?.ok === false &&
      (kCreate as Rpc)?.error === "not_authorized",
    JSON.stringify({ kRemove, kCreate })
  );

  const { data: kUnlink } = await eaA.client.rpc("execute_participation_delink", {
    p_property_id: c.saleId,
    p_operation: "estate_agent_remove_homeowner",
    p_reason_code: "wrong_homeowner_invited",
    p_branch_id: eaA.branchId,
  });
  const kOnward = cTileId ? await identity(ctx, cTileId) : null;
  record(
    "K EA removes homeowner → converged onward purchase released with the sale",
    (kUnlink as Rpc)?.ok === true &&
      kOnward?.status === "released" &&
      String(kOnward.metadata?.released_with_sale_property_id) === String(c.saleId) &&
      cTileId != null &&
      !(await members(ctx, cTileId)).some((m) => m.user_id === hoG.userId),
    JSON.stringify({ kUnlink, status: kOnward?.status })
  );
  const kReclaim = await claim(hoG, c.saleId);
  const kReclaimed = cTileId ? await identity(ctx, cTileId) : null;
  record(
    "K homeowner re-claims → onward purchase converges again",
    kReclaim?.ok === true &&
      kReclaim.onward_claimed === true &&
      kReclaimed?.homeowner_user_id === hoG.userId &&
      kReclaimed.status === "active" &&
      kReclaimed.metadata?.released_with_sale_property_id === undefined,
    JSON.stringify(kReclaim)
  );

  // L — completion and delay policies
  const lInsert = await eaA.client.from("chain_completion_events").insert({
    chain_id: c.chainId,
    event_type: "completion_date_update_acknowledged",
    actor_user_id: eaA.userId,
    actor_role: "operational_participant",
  });
  record("L delegated EA can insert a completion event as itself", !lInsert.error, lInsert.error?.message);
  const lSpoof = await eaA.client.from("chain_completion_events").insert({
    chain_id: c.chainId,
    event_type: "completion_date_update_acknowledged",
    actor_user_id: hoG.userId,
    actor_role: "operational_participant",
  });
  record("L completion event actor must be the caller", !!lSpoof.error);
  const lViewOnlyInsert = await eaA.client.from("chain_completion_events").insert({
    chain_id: d.chainId,
    event_type: "completion_date_update_acknowledged",
    actor_user_id: eaA.userId,
    actor_role: "operational_participant",
  });
  record(
    "L homeowner-only EA on a still-unclaimed (EA-only) sale operates it until a homeowner claims",
    !lViewOnlyInsert.error,
    lViewOnlyInsert.error?.message
  );
  await ctx.admin.from("chain_completion_events").insert({
    chain_id: d.chainId,
    event_type: "completion_date_update_acknowledged",
    actor_user_id: null,
  });
  const lViewOnlySelect = await eaA.client.from("chain_completion_events").select("id").eq("chain_id", d.chainId);
  record(
    "L view-only EA can read completion events (operational viewer)",
    !lViewOnlySelect.error && (lViewOnlySelect.data ?? []).length >= 1,
    lViewOnlySelect.error?.message
  );
  await ctx.admin.from("operational_delays").insert({
    chain_id: d.chainId,
    property_id: d.saleId,
    reason: "Awaiting Searches",
    status: "active",
  });
  const lDelays = await eaA.client.from("operational_delays").select("id").eq("chain_id", d.chainId);
  record(
    "L view-only EA can read operational delays (operational viewer)",
    !lDelays.error && (lDelays.data ?? []).length === 1,
    lDelays.error?.message
  );
  const lUnrelated = await eaB.client.from("operational_delays").select("id").eq("chain_id", d.chainId);
  record(
    "L unrelated EA cannot read the chain's delays",
    !lUnrelated.error && (lUnrelated.data ?? []).length === 0
  );

  // M — regressions
  const m = await homeownerSale(ctx, hoM);
  const mAttach = await attachSearchingPlaceholderToSale(hoM.client, {
    chainId: m.chainId,
    salePropertyId: m.saleId,
    userId: hoM.userId,
  });
  const mTileIdentity = mAttach.ok ? await identity(ctx, mAttach.placeholderId) : null;
  record(
    "M Start Move attach: tile owned by homeowner (start_move)",
    mAttach.ok && mTileIdentity?.homeowner_user_id === hoM.userId && mTileIdentity.granted_via === "start_move",
    mAttach.ok ? undefined : mAttach.error
  );

  const mj = await homeownerSale(ctx, hoP);
  const mJoin = await resolveSearchingFromJoinIntent(hoP.client, {
    userId: hoP.userId,
    joinedProperty: { id: mj.saleId, chain_id: mj.chainId, linked_property_id: null },
    searchingIntent: true,
    migratedSearchingId: null,
  });
  const mJoinIdentity = mJoin?.ok ? await identity(ctx, mJoin.searchingId) : null;
  record(
    "M joinChainSearching: placeholder created, linked, owned by homeowner",
    mJoin?.ok === true &&
      mJoinIdentity?.homeowner_user_id === hoP.userId &&
      (await linkedTile(ctx, mj.saleId)) === mJoin.searchingId,
    JSON.stringify(mJoin)
  );

  const { data: pa } = await eaA.client.rpc("create_ea_operational_property", {
    p_chain_id: h.chainId,
    p_relationship_type: "purchase",
    p_address: `PA ${s} Agreed Purchase`,
    p_postcode: "PO16 7PA",
    p_branch_id: eaA.branchId,
    p_homeowner_only_updates: false,
    p_invite_email: hoP.email,
    p_awaiting_buyer: false,
  });
  const { count: paRows } = await ctx.admin
    .from("properties")
    .select("id", { count: "exact", head: true })
    .eq("chain_id", h.chainId)
    .eq("address", `PA ${s} Agreed Purchase`);
  record(
    "M EA cannot originate a purchase row (invalid_relationship_type, nothing created)",
    (pa as Rpc)?.ok === false && (pa as Rpc)?.error === "invalid_relationship_type" && paRows === 0,
    JSON.stringify(pa)
  );

  const { data: selfGrant } = await eaA.client.rpc("establish_operational_homeowner_for_created_property", {
    p_property_id: dTileId,
  });
  record(
    "M EA cannot self-grant an EA-created tile via for_created_property",
    (selfGrant as Rpc)?.ok === false && (selfGrant as Rpc)?.error === "estate_agent_cannot_be_homeowner",
    JSON.stringify(selfGrant)
  );

  // N — EA-only unclaimed sale (homeowner-only updates, no homeowner): the assigned
  // EA links/converts its onward placeholder; nobody else can; the EA gains nothing
  // on the resulting purchase. eaB is first unassigned, then assigned to its own
  // sale elsewhere, then assigned to the buyer-side sale linking into N's sale.
  const n = await eaSale(ctx, eaA, { homeownerOnlyUpdates: true, onward: false });
  const { data: nCreate } = await eaA.client.rpc("create_searching_placeholder_for_sale", {
    p_sale_property_id: n.saleId,
  });
  const nTileId = (nCreate as Rpc)?.property_id as number | undefined;
  await ctx.admin.from("properties").update({ linked_property_id: null }).eq("id", n.saleId);
  record(
    "N fixture: EA-only sale with an unlinked, unowned searching placeholder",
    (nCreate as Rpc)?.ok === true &&
      nTileId != null &&
      (await linkedTile(ctx, n.saleId)) === null &&
      (await identity(ctx, nTileId)) == null,
    JSON.stringify(nCreate)
  );

  const nLink = async (actor: Actor): Promise<Rpc> => {
    const { data, error } = await actor.client.rpc("link_sale_to_searching_placeholder", {
      p_sale_property_id: n.saleId,
      p_searching_property_id: nTileId,
    });
    return error ? { ok: false, error: error.message } : (data as Rpc);
  };
  const refusedBoth = async (actor: Actor, label: string) => {
    const link = await nLink(actor);
    const convert = await convertRpc(actor, n.saleId, `N ${label} ${s}`);
    return {
      pass:
        link?.ok === false &&
        link.error === "forbidden" &&
        convert?.ok === false &&
        convert.error === "not_authorized",
      detail: JSON.stringify({ link, convert }),
    };
  };

  const { count: eaBAssignmentsBefore } = await ctx.admin
    .from("property_ea_assignments")
    .select("id", { count: "exact", head: true })
    .eq("branch_id", eaB.branchId);
  const nUnassigned = await refusedBoth(eaB, "unassigned");
  record(
    "N2 unassigned EA (no assignment anywhere) cannot link or convert",
    eaBAssignmentsBefore === 0 && nUnassigned.pass,
    nUnassigned.detail
  );

  const nOther = await eaSale(ctx, eaB, { onward: false });
  const nOtherProperty = await refusedBoth(eaB, "other");
  record(
    "N4 EA assigned to another property cannot link or convert",
    nOther.finalize.ok && nOtherProperty.pass,
    nOtherProperty.detail
  );

  const { data: nChainRows } = await ctx.admin
    .from("properties")
    .select("chain_position")
    .eq("chain_id", n.chainId);
  const nNextPosition = Math.max(0, ...(nChainRows ?? []).map((r) => Number(r.chain_position ?? 0))) + 1;
  const { data: nBuyerSale, error: nBuyerSaleError } = await ctx.admin
    .from("properties")
    .insert({
      chain_id: n.chainId,
      chain_position: nNextPosition,
      address: `N ${s} Buyer-side Sale`,
      postcode: "PO16 7NB",
      stage: "property_listed",
      status: "pending_connection",
      relationship_type: "sale",
      created_by_user_id: eaB.userId,
      awaiting_buyer: false,
      buyer_connected: true,
      seller_connected: true,
      is_searching: false,
      linked_property_id: n.saleId,
    })
    .select("id")
    .single();
  const { error: nBuyerAssignError } = nBuyerSale
    ? await ctx.admin.from("property_ea_assignments").insert({
        property_id: nBuyerSale.id,
        branch_id: eaB.branchId,
        status: "active",
        homeowner_only_updates: false,
        assigned_by_user_id: eaB.userId,
      })
    : { error: nBuyerSaleError };
  const nBuyerSide = await refusedBoth(eaB, "buyer-side");
  record(
    "N3 buyer-side EA (operates the sale buying into this one) cannot link or convert",
    !nBuyerAssignError && nBuyerSide.pass,
    nBuyerAssignError?.message ?? nBuyerSide.detail
  );

  const { error: nCounterpartyError } = await ctx.admin.from("property_counterparty_participants").insert({
    property_id: n.saleId,
    user_id: hoA.userId,
    counterparty_role: "buyer",
    granted_via: "join_chain_property",
    status: "active",
  });
  const nConnected = await refusedBoth(hoA, "connected");
  record(
    "N5 connected participant (buyer counterparty) cannot link or convert",
    !nCounterpartyError && nConnected.pass,
    nCounterpartyError?.message ?? nConnected.detail
  );

  const nLinked = await nLink(eaA);
  record(
    "N1 assigned EA on the EA-only unclaimed sale links its searching placeholder",
    nLinked?.ok === true && (await linkedTile(ctx, n.saleId)) === nTileId,
    JSON.stringify(nLinked)
  );
  const nConverted = await convertRpc(eaA, n.saleId, `N ${s}`);
  const nPurchase = nTileId ? await property(ctx, nTileId) : null;
  record(
    "N1 assigned EA on the EA-only unclaimed sale converts the onward placeholder",
    nConverted?.ok === true &&
      nConverted.property_id === nTileId &&
      nPurchase?.stage === "offer_accepted" &&
      nPurchase.relationship_type === "purchase",
    JSON.stringify(nConverted)
  );

  const { data: nOperate } = await eaA.client.rpc("can_operate_property", { p_property_id: nTileId });
  const { data: nOnward } = await eaA.client.rpc("create_searching_placeholder_for_sale", {
    p_sale_property_id: nTileId,
  });
  const { error: nActivityError } = await eaA.client.from("activities").insert({
    property_id: nTileId,
    update: "Solicitors Instructed",
    updated_by: "estate_agent",
  });
  const { count: nPurchaseAssignments } = await ctx.admin
    .from("property_ea_assignments")
    .select("id", { count: "exact", head: true })
    .eq("property_id", nTileId ?? -1);
  record(
    "N6 the original EA gains no authority over the resulting onward purchase (not operable, no onward from it, no write, no identity/membership/assignment)",
    nOperate === false &&
      (nOnward as Rpc)?.ok === false &&
      (nOnward as Rpc)?.error === "not_authorized" &&
      nActivityError?.code === "42501" &&
      nTileId != null &&
      (await identity(ctx, nTileId)) == null &&
      noEaOwnerClass(await members(ctx, nTileId), eaA.userId) &&
      nPurchaseAssignments === 0,
    JSON.stringify({ nOperate, nOnward, activity: nActivityError?.code ?? null, nPurchaseAssignments })
  );

  const { count: eaIdentityCount } = await ctx.admin
    .from("property_operational_identities")
    .select("property_id", { count: "exact", head: true })
    .in("homeowner_user_id", [eaA.userId, eaB.userId]);
  record("No fixture EA holds any operational identity at the end", (eaIdentityCount ?? 0) === 0);
}

async function cleanupFixtures(ctx: Ctx): Promise<void> {
  const warn = (label: string, error: { message: string } | null) => {
    if (error) console.warn(`cleanup ${label}: ${error.message}`);
  };

  for (const chainId of ctx.chainIds) {
    const { data: props } = await ctx.admin.from("properties").select("id").eq("chain_id", chainId);
    const ids = (props ?? []).map((p) => p.id as number);

    warn("operational_delays", (await ctx.admin.from("operational_delays").delete().eq("chain_id", chainId)).error);
    warn("chain_completion_events", (await ctx.admin.from("chain_completion_events").delete().eq("chain_id", chainId)).error);

    if (ids.length > 0) {
      for (const table of [
        "activities",
        "property_members",
        "property_operational_identities",
        "property_counterparty_participants",
        "property_delegates",
        "property_claim_invitations",
        "property_claim_metadata",
        "property_ea_assignments",
        "property_delink_events",
      ]) {
        warn(table, (await ctx.admin.from(table).delete().in("property_id", ids)).error);
      }
      warn("unlink", (await ctx.admin.from("properties").update({ linked_property_id: null }).in("id", ids)).error);
      warn("properties", (await ctx.admin.from("properties").delete().in("id", ids)).error);
    }

    warn("chain_nodes", (await ctx.admin.from("chain_nodes").delete().eq("chain_id", chainId)).error);
    warn("chains", (await ctx.admin.from("chains").delete().eq("id", chainId)).error);
  }

  // Deleting the branch cascades its members; deleting members first would leave a
  // populated branch with no owner and trip the deferred owner invariant.
  for (const branchId of ctx.branchIds) {
    warn("ea_branches", (await ctx.admin.from("ea_branches").delete().eq("id", branchId)).error);
  }
  for (const companyId of ctx.companyIds) {
    warn("ea_companies", (await ctx.admin.from("ea_companies").delete().eq("id", companyId)).error);
  }
  for (const userId of ctx.userIds) {
    warn("profiles", (await ctx.admin.from("profiles").delete().eq("id", userId)).error);
    const { error } = await ctx.admin.auth.admin.deleteUser(userId);
    warn("auth user", error);
  }
}

async function runExecute(): Promise<void> {
  console.log("\n--- Live Development scenarios A–N ---\n");
  loadEnvLocal();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !anonKey || !serviceRoleKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are required for --execute"
    );
  }
  console.log(`Development project: ${assertDevelopmentEnvironment(url)}`);

  const ctx: Ctx = {
    url,
    anonKey,
    admin: createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    }),
    stamp: `${Date.now()}-${randomUUID().slice(0, 8)}`,
    userIds: [],
    chainIds: [],
    branchIds: [],
    companyIds: [],
  };

  try {
    await runScenarios(ctx);
  } finally {
    await cleanupFixtures(ctx);
  }
}

async function main() {
  runStaticChecks();

  if (process.argv.includes("--execute")) {
    await runExecute();
  } else {
    console.log("\nStatic checks only. Re-run with --execute against Development after applying all three migrations.");
  }

  const failed = results.filter((r) => !r.pass).length;
  const passed = results.length - failed;
  console.log(`\n${passed}/${results.length} checks passed.`);
  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
