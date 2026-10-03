/**
 * Static checks for the address reservation classifier (M1).
 *
 *   supabase/migrations/20261005100000_address_reservation_classifier.sql
 *   scripts/secdef-user-rpc-allowlist.json
 *   scripts/secdef-service-role-only-targets.json
 *
 * Usage:
 *   npx tsx scripts/verify-address-reservation-migration.ts
 */
import { readFileSync } from "fs";
import { join } from "path";

const ROOT = join(import.meta.dirname, "..");
const M1 = "supabase/migrations/20261005100000_address_reservation_classifier.sql";

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

function main() {
  const sql = read(M1);
  const fns = extractFunctions(sql);
  const get = (name: string) => fns.get(name);

  const expected = [
    "_address_match_key",
    "_postcode_match_key",
    "_property_side_representation",
    "_property_reservation_state",
    "property_address_is_reserved",
    "property_exists_for_onboarding",
    "check_start_move_address",
    "cleanup_abandoned_onboarding_chain",
  ];
  for (const name of expected) {
    record(`M1 defines public.${name}`, fns.has(name));
  }

  for (const name of expected) {
    const f = get(name);
    if (!f) continue;
    record(
      `${name}: fixed search_path = public`,
      /set\s+search_path\s*=\s*public/i.test(f.header)
    );
  }

  for (const name of [
    "_property_side_representation",
    "_property_reservation_state",
    "property_address_is_reserved",
    "property_exists_for_onboarding",
    "check_start_move_address",
    "cleanup_abandoned_onboarding_chain",
  ]) {
    const f = get(name);
    record(`${name}: SECURITY DEFINER`, !!f && /security\s+definer/i.test(f.header));
  }

  const addressKey = normalize(get("_address_match_key")?.body ?? "");
  const postcodeKey = normalize(get("_postcode_match_key")?.body ?? "");
  record(
    "Address key: trim, lower case, whitespace collapsed",
    addressKey.includes("lower(regexp_replace(btrim(p_address), '\\s+', ' ', 'g'))")
  );
  record(
    "Postcode key: upper case, all whitespace removed",
    postcodeKey.includes("upper(regexp_replace(p_postcode, '\\s+', '', 'g'))")
  );
  record(
    "Redaction placeholders produce no key",
    addressKey.includes("'[released property]' then null") &&
      postcodeKey.includes("'redacted' then null")
  );

  const sides = normalize(get("_property_side_representation")?.body ?? "");
  record(
    "Side representation does not use created_by_user_id or status",
    !sides.includes("created_by_user_id") && !/\.status\s*=\s*'(healthy|pending_connection)'/.test(sides)
  );
  record(
    "Side representation: sale seller = identity, else EA; buyer = counterparty buyer",
    sides.includes("counterparty_role = 'buyer'") && sides.includes("when v_has_assignment then 'ea'")
  );
  record(
    "Side representation: purchase seller = counterparty seller, buyer = identity or via_sale",
    sides.includes("counterparty_role = 'seller'") && sides.includes("'via_sale'")
  );

  const state = normalize(get("_property_reservation_state")?.body ?? "");
  const lifecycleIdx = state.indexOf("in ('released', 'anonymised')");
  const sidesIdx = state.indexOf("_property_side_representation");
  record(
    "Reservation state checks lifecycle before representation",
    lifecycleIdx >= 0 && sidesIdx > lifecycleIdx
  );
  record(
    "Archived rows are lifecycle_held",
    state.includes("v_lifecycle = 'archived' then return 'lifecycle_held'")
  );
  record(
    "Rows without an address key (placeholders, redacted) are historical",
    state.includes("v_property.stage = 'searching'") &&
      state.includes("_address_match_key(v_property.address) is null")
  );
  for (const s of ["awaiting_seller", "awaiting_buyer", "live_homeowner", "live_ea_managed", "stale"]) {
    record(`Reservation state can return '${s}'`, state.includes(`return '${s}'`));
  }

  const reserved = normalize(get("property_address_is_reserved")?.body ?? "");
  record(
    "property_address_is_reserved = not historical and not stale",
    reserved.includes("not in ('historical', 'stale')")
  );

  const exists = normalize(get("property_exists_for_onboarding")?.body ?? "");
  record(
    "property_exists_for_onboarding matches on normalised keys",
    exists.includes("_address_match_key(p.address) = public._address_match_key(p_address)") &&
      exists.includes("_postcode_match_key(p.postcode) = public._postcode_match_key(p_postcode)")
  );

  const check = normalize(get("check_start_move_address")?.body ?? "");
  const checkHeader = normalize(get("check_start_move_address")?.header ?? "");
  record("check_start_move_address requires verified email", check.includes("_require_verified_email_for_transaction()"));
  record(
    "check_start_move_address 'yours' = identity, counterparty, delegate or assigned branch seat",
    check.includes("poi.homeowner_user_id = v_user_id") &&
      check.includes("cp.user_id = v_user_id") &&
      check.includes("pd.delegate_user_id = v_user_id") &&
      check.includes("bm.user_id = v_user_id")
  );
  record("check_start_move_address: plain membership is never 'yours'", !check.includes("property_members"));
  record("check_start_move_address is rate limited", check.includes("_rate_limit_try_consume(c_scope"));
  record("check_start_move_address is volatile (consumes rate limit)", checkHeader.includes("volatile"));
  record(
    "check_start_move_address returns only the four states",
    ["'yours'", "'awaiting_connection'", "'already_represented'", "'available'"].every((s) =>
      check.includes(`'state', ${s}`)
    )
  );
  const builds = [...check.matchAll(/jsonb_build_object\(([^)]*)\)/g)].map((m) => m[1]);
  const keys = new Set(
    builds.flatMap((b) =>
      b
        .split(",")
        .map((part) => part.trim())
        .filter((_, index) => index % 2 === 0)
        .map((part) => part.replace(/'/g, ""))
    )
  );
  record(
    "check_start_move_address discloses only ok/error/state/chain_id",
    [...keys].every((k) => ["ok", "error", "state", "chain_id"].includes(k)),
    [...keys].join(",")
  );
  record(
    "chain_id is returned only with 'yours'",
    builds.filter((b) => b.includes("'chain_id'")).every((b) => b.includes("'yours'"))
  );
  record(
    "Historical and stale rows are ignored by Start Move routing",
    check.includes("if v_state in ('historical', 'stale') then continue")
  );

  const cleanup = normalize(get("cleanup_abandoned_onboarding_chain")?.body ?? "");
  record(
    "One-argument cleanup is dropped",
    normalize(sql).includes("drop function if exists public.cleanup_abandoned_onboarding_chain(bigint);")
  );
  record(
    "Cleanup takes p_require_empty boolean default false",
    /p_require_empty\s+boolean\s+default\s+false/i.test(get("cleanup_abandoned_onboarding_chain")?.args ?? "")
  );
  record(
    "Cleanup requires the chain creator before anything else",
    cleanup.indexOf("c.created_by_user_id = v_user_id") >= 0 &&
      cleanup.indexOf("c.created_by_user_id = v_user_id") < cleanup.indexOf("delete from")
  );
  record("Cleanup p_require_empty refuses non-empty chains", cleanup.includes("'chain_not_empty'"));
  record("Cleanup requires caller_owns_unshared_chain", cleanup.includes("caller_owns_unshared_chain(p_chain_id)"));
  record(
    "Cleanup refuses counterparties and EA origination",
    cleanup.includes("property_counterparty_participants") && cleanup.includes("origin_type = 'estate_agent'")
  );

  const delink = normalize(get("_execute_participation_delink")?.body ?? "");
  const selfBranch = delink.slice(
    delink.indexOf("if p_operation = 'homeowner_self'"),
    delink.indexOf("if p_operation = 'homeowner_remove_ea'")
  );
  record(
    "homeowner_self records 'released' before releasing the identity",
    selfBranch.indexOf("v_transition := public.record_property_lifecycle_transition(") >= 0 &&
      selfBranch.indexOf("v_transition := public.record_property_lifecycle_transition(") <
        selfBranch.indexOf("update public.property_operational_identities") &&
      selfBranch.indexOf("v_transition := public.record_property_lifecycle_transition(") <
        selfBranch.indexOf("delete from public.property_members")
  );
  record(
    "homeowner_self aborts when the lifecycle transition is refused",
    selfBranch.includes("if coalesce((v_transition ->> 'ok')::boolean, false) is not true then raise exception")
  );
  record(
    "homeowner_self no longer discards the transition result",
    !delink.includes("perform public.record_property_lifecycle_transition(")
  );
  record(
    "_execute_participation_delink guarded against an unexpected current body",
    normalize(sql).includes(
      "'address_reservation_classifier aborted: _execute_participation_delink body differs from 20261001130000'"
    )
  );
  const previous = normalize(
    extractFunctions(read("supabase/migrations/20261001130000_searching_placeholder_ownership_enforcement.sql")).get(
      "_execute_participation_delink"
    )?.body ?? ""
  );
  const transitionCall =
    "public.record_property_lifecycle_transition( p_property_id, 'released', 'homeowner_delink', null, p_reason_code, jsonb_build_object('operation', p_operation, 'reason_code', p_reason_code) );";
  const resultCheck =
    " if coalesce((v_transition ->> 'ok')::boolean, false) is not true then raise exception 'participation_delink_lifecycle_transition_failed: %', coalesce(v_transition ->> 'error', 'unknown'); end if;";
  const previousWithoutCall = previous.replace(` perform ${transitionCall}`, "");
  const currentWithoutCall = delink
    .replace(" v_transition jsonb;", "")
    .replace(` v_transition := ${transitionCall}${resultCheck}`, "");
  record(
    "_execute_participation_delink otherwise identical to 20261001130000",
    previous.length > 0 && previousWithoutCall === currentWithoutCall
  );

  const backfill = normalize(sql.slice(sql.indexOf("-- 9) Backfill")));
  record("Backfill section present", backfill.startsWith("-- 9) backfill"));
  record(
    "Backfill selects only unrecorded homeowner_self releases nobody represents since",
    backfill.includes("e.metadata ->> 'operation' = 'homeowner_self'") &&
      backfill.includes("not in ('released', 'archived', 'anonymised')") &&
      backfill.includes("property_operational_identities poi where poi.property_id = e.property_id and poi.status = 'active'") &&
      backfill.includes("property_ea_assignments pea where pea.property_id = e.property_id and pea.status = 'active'") &&
      backfill.includes("property_counterparty_participants pcp where pcp.property_id = e.property_id and pcp.status = 'active'")
  );
  record(
    "Backfill records a homeowner_delink 'released' event and state dated to the de-link",
    backfill.includes("'released', 'homeowner_delink'") &&
      backfill.includes("e.created_at as released_at") &&
      backfill.includes("c.released_at, null, c.released_at")
  );
  record("Backfill rows are marked", (backfill.match(/'backfill', '20261005100000'/g) ?? []).length === 2);

  for (const sig of [
    "public._address_match_key(text)",
    "public._postcode_match_key(text)",
    "public._property_side_representation(bigint)",
    "public._property_reservation_state(bigint)",
    "public.property_address_is_reserved(bigint)",
    "public.property_exists_for_onboarding(text, text, bigint)",
    "public._execute_participation_delink(bigint, text, text, uuid)",
  ]) {
    record(`ACL service_role only: ${sig}`, internalAcl(sql, sig));
  }
  for (const sig of [
    "public.check_start_move_address(text, text, text)",
    "public.cleanup_abandoned_onboarding_chain(bigint, boolean)",
  ]) {
    record(`ACL authenticated (not anon): ${sig}`, userRpcAcl(sql, sig));
  }

  const allowlist = JSON.parse(read("scripts/secdef-user-rpc-allowlist.json")) as {
    allowlist: { name: string; args: string }[];
  };
  const targets = JSON.parse(read("scripts/secdef-service-role-only-targets.json")) as {
    targets: { name: string; args: string }[];
  };
  const inAllow = (name: string, args: string) =>
    allowlist.allowlist.some((e) => e.name === name && e.args === args);
  const inTargets = (name: string, args: string) =>
    targets.targets.some((e) => e.name === name && e.args === args);

  record("Allowlist: check_start_move_address(text, text, text)", inAllow("check_start_move_address", "text, text, text"));
  record(
    "Allowlist: cleanup_abandoned_onboarding_chain(bigint, boolean), not (bigint)",
    inAllow("cleanup_abandoned_onboarding_chain", "bigint, boolean") &&
      !inAllow("cleanup_abandoned_onboarding_chain", "bigint")
  );
  record(
    "property_address_is_reserved moved from allowlist to service-role targets",
    !inAllow("property_address_is_reserved", "bigint") && inTargets("property_address_is_reserved", "bigint")
  );
  for (const [name, args] of [
    ["_address_match_key", "text"],
    ["_postcode_match_key", "text"],
    ["_property_side_representation", "bigint"],
    ["_property_reservation_state", "bigint"],
    ["property_exists_for_onboarding", "text, text, bigint"],
  ]) {
    record(`Service-role target: ${name}(${args})`, inTargets(name, args));
  }

  const failed = results.filter((r) => !r.pass).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed.`);
  if (failed > 0) process.exit(1);
}

main();
