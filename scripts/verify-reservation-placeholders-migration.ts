/**
 * Static checks for the reservation follow-up: unrepresented placeholders stay
 * reserved (awaiting_seller) and 'stale' is no longer produced.
 *
 *   supabase/migrations/20261005140000_reservation_placeholders_awaiting_seller.sql
 *
 * Usage:
 *   npx tsx scripts/verify-reservation-placeholders-migration.ts
 */
import { readdirSync, readFileSync } from "fs";
import { join } from "path";

const ROOT = join(import.meta.dirname, "..");
const MIGRATION = "supabase/migrations/20261005140000_reservation_placeholders_awaiting_seller.sql";
const M1 = "supabase/migrations/20261005100000_address_reservation_classifier.sql";
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
  return sql.replace(/\s+/g, " ").trim().toLowerCase();
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

function main() {
  const sql = stripSqlComments(read(MIGRATION));
  const flat = normalize(sql);

  // Forward-only
  const migrations = readdirSync(join(ROOT, "supabase/migrations")).filter((f) => f.endsWith(".sql")).sort();
  const index = migrations.indexOf("20261005140000_reservation_placeholders_awaiting_seller.sql");
  record(
    "Ordering: applies after the lifecycle migration (20261005130000)",
    index > migrations.indexOf("20261005130000_lifecycle_bounded_dormancy.sql") &&
      migrations.indexOf("20261005130000_lifecycle_bounded_dormancy.sql") > -1
  );
  record(
    "No data changes, no table or policy changes",
    !/\b(insert into|update public\.|delete from|alter table|create policy|drop policy)\b/.test(
      flat.replace(/insert into public\.property_ea_assignments/g, "")
    )
  );

  // Preflight
  record(
    "Preflight: classifier, connect and start-move bodies must match 20261005100000 / 20261005110000",
    flat.includes("v_src not like '%return ''stale'';%'") &&
      flat.includes("v_src not like '%is distinct from ''awaiting_seller''%'") &&
      flat.includes("v_src not like '%v_state in (''historical'', ''stale'')%'")
  );

  // Classifier
  const classifier = functionBody(sql, "_property_reservation_state");
  const order = [
    "if v_property.id is null then return 'historical';",
    "if v_property.stage = 'searching' or public._address_match_key(v_property.address) is null or public._postcode_match_key(v_property.postcode) is null then return 'historical';",
    "if v_lifecycle in ('released', 'anonymised') then return 'historical';",
    "if v_lifecycle = 'archived' then return 'lifecycle_held';",
    "if v_sides.seller_side = 'none' then return 'awaiting_seller';",
    "if v_property.relationship_type = 'sale' and v_sides.buyer_side = 'none' then return 'awaiting_buyer';",
    "if v_sides.seller_side = 'homeowner' then return 'live_homeowner';",
    "return 'live_ea_managed';",
  ];
  const positions = order.map((clause) => classifier.indexOf(clause));
  record(
    "Classifier: historical → lifecycle_held → awaiting_seller (any seller-less row) → awaiting_buyer → live_*",
    positions.every((position, i) => position > -1 && (i === 0 || position > positions[i - 1])),
    JSON.stringify(positions)
  );
  record("Classifier: never returns 'stale'", !classifier.includes("'stale'"));
  record(
    "Classifier: STABLE SECURITY DEFINER, owner postgres, service_role only",
    /stable security definer set search_path = public/.test(
      normalize(sql.slice(sql.indexOf("function public._property_reservation_state"), sql.indexOf("as $$", sql.indexOf("function public._property_reservation_state"))))
    ) &&
      flat.includes("alter function public._property_reservation_state(bigint) owner to postgres;") &&
      flat.includes("revoke all on function public._property_reservation_state(bigint) from public, anon, authenticated;") &&
      flat.includes("grant execute on function public._property_reservation_state(bigint) to service_role;")
  );

  // Reserved
  const reserved = functionBody(sql, "property_address_is_reserved");
  record(
    "property_address_is_reserved: every state other than historical reserves",
    reserved === "select public._property_reservation_state(p_property_id) <> 'historical';" &&
      flat.includes("revoke all on function public.property_address_is_reserved(bigint) from public, anon, authenticated;") &&
      flat.includes("grant execute on function public.property_address_is_reserved(bigint) to service_role;")
  );

  // Start-move check is untouched and still routes correctly with the new classes
  const startMove = functionBody(stripSqlComments(read(M1)), "check_start_move_address");
  record(
    "check_start_move_address: not redefined; only a purchase awaiting its seller with a buyer routes to awaiting_connection",
    !flat.includes("function public.check_start_move_address") &&
      startMove.includes("awaiting_connection") &&
      startMove.includes("'already_represented'")
  );

  // Connect: M2 body plus the buyer-side requirement
  const connect = functionBody(sql, "connect_ea_to_awaiting_property");
  const m2Connect = functionBody(stripSqlComments(read(M2)), "connect_ea_to_awaiting_property");
  const scanAddition =
    " and (select s.buyer_side from public._property_side_representation(v_row.id) s) <> 'none'";
  const recheckAddition =
    " or (select s.buyer_side from public._property_side_representation(v_property.id) s) = 'none'";
  record(
    "connect_ea_to_awaiting_property: buyer side required on the scan and on the locked re-check",
    connect.includes(scanAddition.trim()) && connect.includes(recheckAddition.trim())
  );
  record(
    "connect_ea_to_awaiting_property: otherwise identical to 20261005110000",
    m2Connect.length > 0 && connect.replace(scanAddition, "").replace(recheckAddition, "") === m2Connect
  );
  record(
    "connect_ea_to_awaiting_property: authenticated + service_role, not anon",
    flat.includes("revoke all on function public.connect_ea_to_awaiting_property(text, text, text, uuid) from public, anon;") &&
      flat.includes("grant execute on function public.connect_ea_to_awaiting_property(text, text, text, uuid) to authenticated, service_role;")
  );

  // Postflight
  record(
    "Postflight: classifier, reserved and connect fingerprints; no client execute on internals",
    flat.includes("reservation_placeholders_awaiting_seller postflight: classifier not replaced") &&
      flat.includes("reservation_placeholders_awaiting_seller postflight: property_address_is_reserved not replaced") &&
      flat.includes("reservation_placeholders_awaiting_seller postflight: connect_ea_to_awaiting_property not replaced") &&
      flat.includes("is client-executable")
  );

  const failed = results.filter((r) => !r.pass).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed.`);
  if (failed > 0) process.exit(1);
}

main();
