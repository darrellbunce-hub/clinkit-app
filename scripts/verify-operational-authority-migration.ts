/**
 * Static checks for operational authority + address reservation enforcement (M3)
 * and its companion application changes.
 *
 *   supabase/migrations/20261005120000_operational_authority_enforcement.sql
 *   scripts/secdef-user-rpc-allowlist.json
 *   scripts/secdef-service-role-only-targets.json
 *   lib/estateAgent/assignments.ts, components/estate-agents/PropertyEstateAgentAssignment.tsx,
 *   app/start-move/page.tsx, app/agent/originate/page.tsx, lib/searchingPlaceholder.ts
 *
 * Usage:
 *   npx tsx scripts/verify-operational-authority-migration.ts
 */
import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";

const ROOT = join(import.meta.dirname, "..");
const M3 = "supabase/migrations/20261005120000_operational_authority_enforcement.sql";

const MEMBERSHIP_HELPERS =
  /(is_property_member|is_chain_participant|is_ea_delegated_editor|is_property_operational_participant|is_chain_operational_viewer|property_members)/i;

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

type SqlPolicy = { table: string; text: string };

function extractPolicies(sql: string): Map<string, SqlPolicy> {
  const policies = new Map<string, SqlPolicy>();
  const pattern = /create\s+policy\s+([a-z0-9_]+)\s+on\s+public\.([a-z0-9_]+)([\s\S]*?);/gi;

  for (const match of sql.matchAll(pattern)) {
    policies.set(match[1].toLowerCase(), {
      table: match[2].toLowerCase(),
      text: normalize(match[3]),
    });
  }

  return policies;
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

function predicateAcl(sql: string, signature: string): boolean {
  const s = escape(signature);
  return (
    new RegExp(`revoke all on function ${s} from public, anon;`, "i").test(sql) &&
    new RegExp(`grant execute on function ${s} to authenticated, service_role;`, "i").test(sql)
  );
}

function authenticatedOnlyAcl(sql: string, signature: string): boolean {
  const s = escape(signature);
  return (
    new RegExp(`revoke all on function ${s} from public, anon;`, "i").test(sql) &&
    new RegExp(`grant execute on function ${s} to authenticated;`, "i").test(sql) &&
    !new RegExp(`grant execute on function ${s} to [^;]*anon`, "i").test(sql)
  );
}

function ownedByPostgres(sql: string, signature: string): boolean {
  return new RegExp(`alter function ${escape(signature)} owner to postgres;`, "i").test(sql);
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

function main() {
  const raw = read(M3);
  const sql = stripSqlComments(raw);
  const flat = normalize(sql);
  const fns = extractFunctions(sql);
  const policies = extractPolicies(sql);
  const body = (name: string) => normalize(fns.get(name)?.body ?? "");
  const header = (name: string) => fns.get(name)?.header ?? "";

  // ---------------------------------------------------------------------------
  // Preflight
  // ---------------------------------------------------------------------------
  for (const dep of [
    "public.can_operate_property(bigint)",
    "public.is_property_seller_side_homeowner(bigint)",
    "public.get_property_operational_owner_user_id(bigint)",
    "public.property_in_caller_accessible_chain(bigint, bigint)",
    "public.caller_owns_unshared_chain(bigint)",
    "public._address_match_key(text)",
    "public._postcode_match_key(text)",
    "public.property_address_is_reserved(bigint)",
    "public._establish_operational_homeowner_core(bigint, uuid, text, boolean)",
    "public._ea_assign_originated_property(bigint, uuid, boolean, text, text, text)",
    "public._property_reservation_state(bigint)",
    "public._upsert_property_membership_row(bigint, uuid, text)",
    "public._sync_property_claim_on_homeowner_grant(bigint, uuid)",
    "public._insert_participation_delink_activity(bigint, text, text)",
    "public._revoke_open_property_claim_invitations(bigint)",
    "public.record_property_lifecycle_transition(bigint, text, text, text, text, jsonb)",
    "public.get_auth_user_email()",
    "public.get_active_property_claim_invitation(bigint)",
  ]) {
    record(`Preflight requires ${dep}`, flat.includes(`'${dep}'`));
  }
  for (const signature of [
    "public._establish_operational_homeowner_core(bigint, uuid, text, boolean)",
    "public._grant_counterparty_participation_core(bigint, uuid)",
    "public._execute_participation_delink(bigint, text, text, uuid)",
    "public.is_allowed_structured_activity_update(text)",
    "public.discover_claimable_properties()",
    "public.resolve_claim_invitation_token(text)",
  ]) {
    record(`Preflight fingerprints the replaced body of ${signature}`, flat.includes(`('${signature}', '%`));
  }
  for (const signature of [
    "public.caller_may_place_property_in_chain(bigint)",
    "public._trg_properties_guard_direct_writes()",
    "public.break_chain_connection(bigint, text)",
    "public.report_operational_delay(text, bigint, bigint, text)",
    "public.resolve_operational_delay(bigint, text)",
    "public.link_sale_to_searching_placeholder(bigint, bigint)",
    "public.establish_connected_hop(bigint)",
    "public.upsert_operational_summaries(jsonb, jsonb)",
    "public.establish_operational_homeowner_for_created_property(bigint)",
    "public._create_ea_operational_property_core(bigint, text, text, text, uuid, boolean, text, text, boolean)",
  ]) {
    record(`Preflight fingerprints the live body of ${signature}`, flat.includes(`('${signature}', '%`));
  }
  record(
    "Preflight requires every replaced policy to exist",
    [
      "('properties', 'properties_update_member')",
      "('activities', 'activities_insert_participant')",
      "('chain_nodes', 'chain_nodes_insert_participant')",
      "('chain_nodes', 'chain_nodes_update_participant')",
      "('chains', 'chains_update_participants')",
      "('chain_completion_events', 'chain_completion_events_insert_participants')",
      "('property_ea_assignments', 'property_ea_assignments_insert_homeowner')",
      "('property_ea_assignments', 'property_ea_assignments_update_homeowner')",
    ].every((needle) => flat.includes(needle))
  );

  // ---------------------------------------------------------------------------
  // Predicates
  // ---------------------------------------------------------------------------
  const canOperateInChain = body("can_operate_in_chain");
  record(
    "can_operate_in_chain: a property the caller can operate, or the caller's Buyer Ready node",
    canOperateInChain.includes("public.can_operate_property(p.id)") &&
      canOperateInChain.includes("cn.node_type = 'buyer_ready' and cn.user_id = auth.uid()") &&
      !MEMBERSHIP_HELPERS.test(canOperateInChain)
  );
  record(
    "owns_chain_node: chain_nodes.user_id = auth.uid()",
    body("owns_chain_node").includes("cn.id = p_chain_node_id and cn.user_id = auth.uid()")
  );
  for (const sig of ["public.can_operate_in_chain(bigint)", "public.owns_chain_node(bigint)"]) {
    record(`${sig}: SECURITY DEFINER, owned by postgres`, ownedByPostgres(sql, sig));
    record(`ACL authenticated + service_role (not anon): ${sig}`, predicateAcl(sql, sig));
  }
  record(
    "can_operate_in_chain / owns_chain_node are SECURITY DEFINER",
    /security\s+definer/i.test(header("can_operate_in_chain")) &&
      /security\s+definer/i.test(header("owns_chain_node"))
  );

  const placement = body("caller_may_place_property_in_chain");
  record(
    "caller_may_place_property_in_chain: creator, active identity, active counterparty or Buyer Ready owner",
    placement.includes("c.created_by_user_id = auth.uid()") &&
      placement.includes("poi.status = 'active' and poi.homeowner_user_id = auth.uid()") &&
      placement.includes("cp.status = 'active' and cp.user_id = auth.uid()") &&
      placement.includes("cn.node_type = 'buyer_ready' and cn.user_id = auth.uid()")
  );
  record(
    "caller_may_place_property_in_chain: plain membership no longer qualifies",
    !MEMBERSHIP_HELPERS.test(placement)
  );

  const guard = body("_trg_properties_guard_direct_writes");
  record(
    "Direct-write guard: inserts and chain moves use caller_may_place_property_in_chain",
    guard.includes("if not public.caller_may_place_property_in_chain(new.chain_id) then raise exception 'properties_insert_chain_not_authorised'") &&
      guard.includes("or not public.caller_may_place_property_in_chain(new.chain_id) then raise exception 'properties_chain_move_not_authorised'")
  );
  record(
    "Direct-write guard: keeps creator immutability and linked-property checks",
    guard.includes("'properties_created_by_immutable'") &&
      guard.includes("'properties_insert_creator_mismatch'") &&
      (guard.match(/'properties_linked_property_not_in_chain'/g) ?? []).length === 2
  );
  record("Direct-write guard: no membership helper", !MEMBERSHIP_HELPERS.test(guard));

  // ---------------------------------------------------------------------------
  // Policies
  // ---------------------------------------------------------------------------
  for (const [oldName, table] of [
    ["properties_update_member", "properties"],
    ["activities_insert_participant", "activities"],
    ["chain_nodes_insert_participant", "chain_nodes"],
    ["chain_nodes_update_participant", "chain_nodes"],
    ["chains_update_participants", "chains"],
    ["chain_completion_events_insert_participants", "chain_completion_events"],
    ["property_ea_assignments_insert_homeowner", "property_ea_assignments"],
    ["property_ea_assignments_update_homeowner", "property_ea_assignments"],
  ]) {
    record(
      `Drops ${table}.${oldName}`,
      flat.includes(`drop policy if exists ${oldName} on public.${table};`) && !policies.has(oldName)
    );
  }

  const propertiesUpdate = policies.get("properties_update_operator");
  const operatorArm =
    "public.can_operate_property(id) or ( stage = 'searching' and public.get_property_operational_owner_user_id(id) = auth.uid() )";
  record(
    "properties_update_operator: USING and WITH CHECK are can_operate_property or own searching placeholder",
    propertiesUpdate?.table === "properties" &&
      propertiesUpdate.text.includes("for update to authenticated") &&
      propertiesUpdate.text.includes(`using ( ${operatorArm} )`) &&
      propertiesUpdate.text.includes(`with check ( ${operatorArm} )`)
  );

  const activitiesInsert = policies.get("activities_insert_operator");
  record(
    "activities_insert_operator: property target needs can_operate_property; node target needs owns_chain_node; never both",
    activitiesInsert?.table === "activities" &&
      activitiesInsert.text.includes(
        "property_id is not null and chain_node_id is null and public.can_operate_property(property_id)"
      ) &&
      activitiesInsert.text.includes(
        "chain_node_id is not null and property_id is null and public.owns_chain_node(chain_node_id)"
      )
  );

  const nodesInsert = policies.get("chain_nodes_insert_owner");
  record(
    "chain_nodes_insert_owner: own Buyer Ready node, placement rule, linked property in chain",
    nodesInsert?.table === "chain_nodes" &&
      nodesInsert.text.includes("user_id = auth.uid() and node_type = 'buyer_ready'") &&
      nodesInsert.text.includes("public.caller_may_place_property_in_chain(chain_id)") &&
      nodesInsert.text.includes("public.property_in_caller_accessible_chain(linked_property_id, chain_id)")
  );

  const nodesUpdate = policies.get("chain_nodes_update_owner");
  record(
    "chain_nodes_update_owner: owner only (USING) and owner + placement on CHECK",
    nodesUpdate?.table === "chain_nodes" &&
      nodesUpdate.text.includes("using (user_id = auth.uid())") &&
      nodesUpdate.text.includes("with check ( user_id = auth.uid() and public.caller_may_place_property_in_chain(chain_id)")
  );

  const chainsUpdate = policies.get("chains_update_operator");
  record(
    "chains_update_operator: can_operate_in_chain on USING and CHECK",
    chainsUpdate?.table === "chains" &&
      chainsUpdate.text.includes("using (public.can_operate_in_chain(id))") &&
      chainsUpdate.text.includes("with check (public.can_operate_in_chain(id))")
  );

  const completionInsert = policies.get("chain_completion_events_insert_operator");
  record(
    "chain_completion_events_insert_operator: actor is caller and can_operate_in_chain",
    completionInsert?.table === "chain_completion_events" &&
      completionInsert.text.includes("actor_user_id = auth.uid() and public.can_operate_in_chain(chain_id)")
  );

  record(
    "No new policy references a membership helper",
    [...policies.values()].every((p) => !MEMBERSHIP_HELPERS.test(p.text))
  );
  record(
    "No client write policy on property_ea_assignments is created",
    ![...policies.values()].some((p) => p.table === "property_ea_assignments")
  );
  record(
    "Client INSERT/UPDATE/DELETE on property_ea_assignments revoked",
    flat.includes("revoke insert, update, delete on public.property_ea_assignments from anon, authenticated;")
  );

  // ---------------------------------------------------------------------------
  // Re-authorised RPCs
  // ---------------------------------------------------------------------------
  const breakConn = body("break_chain_connection");
  record(
    "break_chain_connection: can_operate_property -> not_authorized",
    breakConn.includes("if not public.can_operate_property(v_property.id) then return jsonb_build_object('ok', false, 'error', 'not_authorized');")
  );

  const report = body("report_operational_delay");
  record(
    "report_operational_delay: property target can_operate_property; node target owner only",
    report.includes("if not public.can_operate_property(p_property_id) then return jsonb_build_object('ok', false, 'error', 'forbidden');") &&
      report.includes("if v_node.user_id is distinct from v_uid then return jsonb_build_object('ok', false, 'error', 'forbidden');")
  );
  record(
    "report_operational_delay: activity message keeps the em dash",
    report.includes("'delay reported — ' || p_reason")
  );

  const resolve = body("resolve_operational_delay");
  record(
    "resolve_operational_delay: property target can_operate_property; node target owner only",
    resolve.includes("v_allowed := public.can_operate_property(v_delay.property_id);") &&
      resolve.includes("where cn.id = v_delay.chain_node_id and cn.user_id = v_uid")
  );
  record(
    "resolve_operational_delay: idempotent resolved path precedes authorisation",
    resolve.indexOf("'already_resolved', true") >= 0 &&
      resolve.indexOf("'already_resolved', true") < resolve.indexOf("v_allowed := public.can_operate_property")
  );

  const link = body("link_sale_to_searching_placeholder");
  record(
    "link_sale_to_searching_placeholder: can_operate_property only; placeholder owner must match seller side",
    link.includes("if not public.can_operate_property(p_sale_property_id) then return jsonb_build_object('ok', false, 'error', 'forbidden');") &&
      link.includes("'placeholder_owner_mismatch'") &&
      !link.includes("v_sale_owner is null")
  );

  const hop = body("establish_connected_hop");
  record(
    "establish_connected_hop: can_operate_property on the purchase",
    hop.includes("if not public.can_operate_property(v_purchase.id) then return jsonb_build_object('ok', false, 'error', 'not_authorized');")
  );

  const summaries = body("upsert_operational_summaries");
  record(
    "upsert_operational_summaries: can_operate_in_chain, rate limit kept",
    summaries.includes("if not public.can_operate_in_chain(v_chain_id) then raise exception 'access denied';") &&
      summaries.includes("public._rate_limit_try_consume(")
  );

  for (const name of [
    "break_chain_connection",
    "report_operational_delay",
    "resolve_operational_delay",
    "link_sale_to_searching_placeholder",
    "establish_connected_hop",
    "upsert_operational_summaries",
  ]) {
    record(`${name}: SECURITY DEFINER, no membership helper`, /security\s+definer/i.test(header(name)) && !MEMBERSHIP_HELPERS.test(body(name)));
  }

  // ---------------------------------------------------------------------------
  // Appointment RPCs
  // ---------------------------------------------------------------------------
  const assign = body("assign_property_ea_branch");
  record(
    "assign_property_ea_branch: refuses searching placeholders",
    assign.includes("if v_property.stage = 'searching' then return jsonb_build_object('ok', false, 'error', 'invalid_property');")
  );
  record(
    "assign_property_ea_branch: seller-side homeowner only",
    assign.includes("if not public.is_property_seller_side_homeowner(p_property_id) then return jsonb_build_object('ok', false, 'error', 'not_authorized');")
  );
  record(
    "assign_property_ea_branch: refuses the branch active on the sale linked to this row (branch_acts_for_buyer)",
    assign.includes("s.chain_id = v_property.chain_id and s.linked_property_id = v_property.id and spea.branch_id = p_branch_id and spea.status = 'active'") &&
      assign.includes("'branch_acts_for_buyer'")
  );
  record(
    "assign_property_ea_branch: authorisation precedes any write",
    assign.indexOf("is_property_seller_side_homeowner") < assign.indexOf("update public.property_ea_assignments") &&
      assign.indexOf("'branch_acts_for_buyer'") < assign.indexOf("update public.property_ea_assignments") &&
      assign.indexOf("'branch_acts_for_buyer'") < assign.indexOf("insert into public.property_ea_assignments")
  );
  record(
    "assign_property_ea_branch: locks the row and the active assignment",
    (assign.match(/for update;/g) ?? []).length === 2
  );
  record(
    "assign_property_ea_branch: replaces a different branch by revoking it first; records the caller",
    assign.indexOf("status = 'revoked'") < assign.indexOf("insert into public.property_ea_assignments") &&
      assign.includes("coalesce(p_homeowner_only_updates, true), v_uid")
  );

  const permission = body("set_property_ea_update_permission");
  record(
    "set_property_ea_update_permission: seller-side homeowner only; requires an active assignment",
    permission.includes("if not public.is_property_seller_side_homeowner(p_property_id) then return jsonb_build_object('ok', false, 'error', 'not_authorized');") &&
      permission.includes("'no_active_assignment'") &&
      permission.includes("'invalid_value'")
  );
  for (const sig of [
    "public.assign_property_ea_branch(bigint, uuid, boolean)",
    "public.set_property_ea_update_permission(bigint, boolean)",
  ]) {
    record(`${sig}: owned by postgres`, ownedByPostgres(sql, sig));
    record(`ACL authenticated only (not anon): ${sig}`, authenticatedOnlyAcl(sql, sig));
  }

  // ---------------------------------------------------------------------------
  // Address reservation
  // ---------------------------------------------------------------------------
  record(
    "Expression index on normalised postcode + address",
    flat.includes(
      "create index if not exists properties_address_match_key_idx on public.properties ( public._postcode_match_key(postcode), public._address_match_key(address) );"
    )
  );

  const conflict = body("_address_reservation_conflict");
  record(
    "_address_reservation_conflict: no key means no conflict",
    conflict.includes("if v_address_key is null or v_postcode_key is null then return false;")
  );
  record(
    "_address_reservation_conflict: transaction advisory lock on the normalised key before the lookup",
    conflict.includes("pg_advisory_xact_lock( hashtextextended( 'property_address_reservation:' || v_postcode_key || ':' || v_address_key, 0 ) )") &&
      conflict.indexOf("pg_advisory_xact_lock") < conflict.indexOf("return exists")
  );
  record(
    "_address_reservation_conflict: another row (excluded id) that property_address_is_reserved",
    conflict.includes("p.id is distinct from p_exclude_property_id and public.property_address_is_reserved(p.id)")
  );
  record(
    "_address_reservation_conflict: VOLATILE SECURITY DEFINER",
    /volatile/i.test(header("_address_reservation_conflict")) &&
      /security\s+definer/i.test(header("_address_reservation_conflict"))
  );

  const trigger = body("_trg_properties_address_reservation");
  record(
    "Reservation trigger: own address checked only with a key, on insert or a key change",
    trigger.includes(
      "if public._address_match_key(new.address) is not null and public._postcode_match_key(new.postcode) is not null and ( tg_op = 'insert' or public._address_match_key(old.address) is distinct from public._address_match_key(new.address) or public._postcode_match_key(old.postcode) is distinct from public._postcode_match_key(new.postcode) ) and public._address_reservation_conflict(new.address, new.postcode, new.id) then raise exception 'property_address_reserved' using errcode = '23505';"
    )
  );
  record(
    "Reservation trigger: linked target checked on insert or a link/chain change",
    trigger.includes(
      "if new.linked_property_id is not null and ( tg_op = 'insert' or new.linked_property_id is distinct from old.linked_property_id or new.chain_id is distinct from old.chain_id ) then"
    )
  );
  record(
    "Reservation trigger: a stale same-chain purchase target whose address is reserved elsewhere raises 23505",
    trigger.includes(
      "v_target.relationship_type = 'purchase' and v_target.chain_id is not distinct from new.chain_id and public._property_reservation_state(v_target.id) = 'stale' and public._address_reservation_conflict(v_target.address, v_target.postcode, v_target.id) then raise exception 'property_address_reserved' using errcode = '23505';"
    )
  );
  record(
    "Reservation trigger function is SECURITY DEFINER",
    /security\s+definer/i.test(header("_trg_properties_address_reservation"))
  );
  record(
    "Trigger: BEFORE INSERT OR UPDATE OF address, postcode, linked_property_id, chain_id, FOR EACH ROW",
    flat.includes(
      "create trigger trg_properties_address_reservation before insert or update of address, postcode, linked_property_id, chain_id on public.properties for each row execute function public._trg_properties_address_reservation();"
    )
  );
  for (const sig of [
    "public._address_reservation_conflict(text, text, bigint)",
    "public._trg_properties_address_reservation()",
  ]) {
    record(`${sig}: owned by postgres`, ownedByPostgres(sql, sig));
    record(`ACL service_role only: ${sig}`, internalAcl(sql, sig));
  }

  const grant = body("establish_operational_homeowner_for_created_property");
  record(
    "Identity grant: keeps email gate, EA refusal, creator and placement checks",
    grant.includes("public._require_verified_email_for_transaction()") &&
      grant.includes("'estate_agent_cannot_be_homeowner'") &&
      grant.includes("p.created_by_user_id = auth.uid() and p.relationship_type in ('sale', 'purchase')") &&
      grant.includes("public.caller_may_place_property_in_chain(p.chain_id)")
  );
  record(
    "Identity grant: address_reserved check (same lock) precedes the grant",
    grant.includes("if public._address_reservation_conflict( v_property.address, v_property.postcode, v_property.id ) then return jsonb_build_object('ok', false, 'error', 'address_reserved');") &&
      grant.indexOf("'address_reserved'") < grant.indexOf("_establish_operational_homeowner_core(")
  );

  const eaCore = body("_create_ea_operational_property_core");
  record(
    "EA create: same-chain normalised duplicate or global reservation -> property_already_exists",
    eaCore.includes("or public._address_reservation_conflict(v_address, v_postcode, null) then return jsonb_build_object('ok', false, 'error', 'property_already_exists');")
  );
  record(
    "EA create: duplicate check precedes the insert; sales only; EA assignment kept",
    eaCore.indexOf("'property_already_exists'") < eaCore.indexOf("insert into public.properties") &&
      eaCore.includes("'invalid_relationship_type'") &&
      eaCore.includes("perform public._ea_assign_originated_property(")
  );

  // ---------------------------------------------------------------------------
  // Grants onto existing rows + branch leaving an ownerless sale
  // ---------------------------------------------------------------------------
  const closedLifecycle =
    "pls.operational_state in ('archived', 'released', 'anonymised') ) then return jsonb_build_object('ok', false, 'error', 'property_released');";
  const identityCore = body("_establish_operational_homeowner_core");
  record(
    "Identity core: locks the row and refuses archived/released/anonymised (property_released)",
    identityCore.includes("where id = p_property_id for update;") && identityCore.includes(closedLifecycle)
  );
  record(
    "Identity core: closed-row refusal precedes the idempotent path",
    identityCore.indexOf("'property_released'") < identityCore.indexOf("'idempotent', true")
  );
  record(
    "Identity core: a stale row whose address another row reserves -> address_reserved, before any identity write",
    identityCore.includes(
      "if public._property_reservation_state(p_property_id) = 'stale' and public._address_reservation_conflict( v_property.address, v_property.postcode, p_property_id ) then return jsonb_build_object('ok', false, 'error', 'address_reserved');"
    ) &&
      identityCore.indexOf("'address_reserved'") < identityCore.indexOf("update public.property_operational_identities") &&
      identityCore.indexOf("'address_reserved'") < identityCore.indexOf("insert into public.property_operational_identities")
  );
  record(
    "Identity core: a sale's stale same-chain onward purchase with a reserved address is unlinked with a notice",
    identityCore.includes(
      "v_onward.relationship_type = 'purchase' and v_onward.chain_id is not distinct from v_property.chain_id and public._property_reservation_state(v_onward.id) = 'stale' and public._address_reservation_conflict( v_onward.address, v_onward.postcode, v_onward.id ) then update public.properties set linked_property_id = null where id = v_property.id; perform public._insert_participation_delink_activity( v_property.id, 'the onward purchase was unlinked from this sale because that address is now part of another moveloop chain.', 'system' );"
    ) && identityCore.indexOf("set linked_property_id = null") < identityCore.indexOf("insert into public.property_operational_identities")
  );
  record(
    "Identity core: SECURITY DEFINER, service_role only",
    /security\s+definer/i.test(header("_establish_operational_homeowner_core")) &&
      internalAcl(sql, "public._establish_operational_homeowner_core(bigint, uuid, text, boolean)")
  );

  const counterpartyCore = body("_grant_counterparty_participation_core");
  record(
    "Counterparty core: locks the row and refuses archived/released/anonymised (property_released)",
    counterpartyCore.includes("where id = p_property_id for update;") &&
      counterpartyCore.includes(closedLifecycle) &&
      counterpartyCore.indexOf("'property_released'") < counterpartyCore.indexOf("insert into public.property_counterparty_participants")
  );
  record(
    "Counterparty core: keeps the opposite-side representation rule",
    counterpartyCore.includes("'opposite_side_unrepresented'")
  );
  record(
    "Counterparty core: SECURITY DEFINER, service_role only",
    /security\s+definer/i.test(header("_grant_counterparty_participation_core")) &&
      internalAcl(sql, "public._grant_counterparty_participation_core(bigint, uuid)")
  );

  const delink = body("_execute_participation_delink");
  const removeBranch = delink.slice(
    delink.indexOf("if p_operation = 'estate_agent_remove_branch' then"),
    delink.indexOf("if p_operation = 'estate_agent_remove_homeowner' then")
  );
  record(
    "Remove branch: released (ea_delink_no_homeowner) only for a mistake reason with no homeowner and no dependants; failure raises",
    delink.includes(
      "v_mistake := p_reason_code in ('wrong_property', 'added_by_mistake', 'duplicate_property');"
    ) &&
      removeBranch.includes("v_homeowner_remains := public._property_seller_side_user_id(p_property_id) is not null;") &&
      removeBranch.includes(
        "if not v_homeowner_remains then v_dependants := public._property_placeholder_has_dependants(p_property_id, null); v_release := v_mistake and not v_dependants; end if;"
      ) &&
      removeBranch.includes("public.record_property_lifecycle_transition( p_property_id, 'released', 'ea_delink_no_homeowner',") &&
      removeBranch.includes("raise exception 'participation_delink_lifecycle_transition_failed: %'")
  );
  record(
    "Remove branch: the release transition is recorded while the branch is still assigned",
    removeBranch.indexOf("'ea_delink_no_homeowner'") > -1 &&
      removeBranch.indexOf("'ea_delink_no_homeowner'") < removeBranch.indexOf("update public.property_ea_assignments")
  );
  record(
    "Remove branch: release revokes delegates, counterparties, members, open invitations; resets the claim",
    removeBranch.includes("update public.property_delegates") &&
      removeBranch.includes("update public.property_counterparty_participants set status = 'delinked'") &&
      removeBranch.includes("delete from public.property_members") &&
      removeBranch.includes("perform public._revoke_open_property_claim_invitations(p_property_id);") &&
      removeBranch.includes("claim_status = 'unclaimed', claimed_by_user_id = null, claimed_at = null")
  );
  record(
    "Remove branch: release notice uses an allowlisted message and the result reports lifecycle_state and placeholder",
    removeBranch.includes("'property released for future transactions. historic chain data retained.'") &&
      removeBranch.includes("'lifecycle_state', case when v_release then 'released' else 'active' end") &&
      removeBranch.includes("'placeholder', not v_homeowner_remains and not v_release")
  );
  // estate_agent_remove_homeowner: current seller-side authority, not origin
  const withdrawal = body("_ea_homeowner_withdrawal_status");
  record(
    "Withdraw homeowner: purchase rows refused first (their identity holder is the buyer)",
    withdrawal.indexOf("when p.relationship_type is distinct from 'sale' then 'not_seller_side_row'") > -1 &&
      withdrawal.indexOf("'not_seller_side_row'") < withdrawal.indexOf("'invitation_pending'")
  );
  record(
    "Withdraw homeowner: with no identity, only an open claim with an invitation (or an EA-originated row) is withdrawable",
    withdrawal.includes(
      "when poi.homeowner_user_id is null then case when coalesce(pcm.claim_status, 'claimed') in ('unclaimed', 'claim_invited') and ( pcm.origin_type = 'estate_agent' or nullif(trim(pcm.invite_email), '') is not null or (public.get_active_property_claim_invitation(p.id)).id is not null ) then 'invitation_pending' else 'no_homeowner_to_remove' end"
    )
  );
  record(
    "Withdraw homeowner: a homeowner who created the transaction is never withdrawable (identity must come from the claim / invitation flow, or an EA-originated row)",
    withdrawal.includes(
      "when not ( pcm.origin_type is not distinct from 'estate_agent' or poi.granted_via in ('claim_operational_property', 'ea_origination_claim') ) then 'homeowner_not_invited'"
    ) && withdrawal.indexOf("'homeowner_not_invited'") < withdrawal.indexOf("'removable'")
  );
  record(
    "Withdraw homeowner: meaningful participation still blocks removal",
    withdrawal.includes(
      "when public.homeowner_has_meaningful_participation(p.id) then 'homeowner_actively_participating' else 'removable'"
    )
  );
  record(
    "Withdraw homeowner: helper is SECURITY DEFINER, stable, service_role only",
    /security\s+definer/i.test(header("_ea_homeowner_withdrawal_status")) &&
      /stable/i.test(header("_ea_homeowner_withdrawal_status")) &&
      internalAcl(sql, "public._ea_homeowner_withdrawal_status(bigint)")
  );
  const removeHomeowner = delink.slice(delink.indexOf("if p_operation = 'estate_agent_remove_homeowner' then"));
  record(
    "Withdraw homeowner RPC: caller's branch must be actively assigned to this row, then the shared rule decides before any write",
    removeHomeowner.includes(
      "from public.property_ea_assignments pea inner join public.ea_branch_members bm on bm.branch_id = pea.branch_id where pea.property_id = p_property_id and pea.status = 'active' and bm.user_id = v_uid"
    ) &&
      removeHomeowner.indexOf("'not_assigned_ea'") < removeHomeowner.indexOf("_ea_homeowner_withdrawal_status(p_property_id)") &&
      removeHomeowner.includes(
        "if v_withdrawal not in ('invitation_pending', 'removable') then return jsonb_build_object('ok', false, 'error', v_withdrawal);"
      ) &&
      removeHomeowner.indexOf("_ea_homeowner_withdrawal_status(p_property_id)") <
        removeHomeowner.indexOf("insert into public.property_delink_events")
  );
  record(
    "Withdraw homeowner RPC: no origin-only gate remains (EA-originated != EA-authorised)",
    !removeHomeowner.includes("not_ea_originated") && !removeHomeowner.includes("v_claim.origin_type")
  );
  const delinkOptions = body("get_participation_delink_options");
  record(
    "Options = RPC: homeowner_remove_ea offered only to the seller-side homeowner",
    delinkOptions.includes("v_is_seller_side_homeowner := public.is_property_seller_side_homeowner(p_property_id);") &&
      delinkOptions.includes("if v_is_seller_side_homeowner and v_has_ea then") &&
      delink.includes("if p_operation = 'homeowner_remove_ea' then if not public.is_property_seller_side_homeowner(p_property_id) then")
  );
  record(
    "Options = RPC: EA options only for a member of the actively assigned branch; withdraw uses the same helper and allowed results",
    delinkOptions.includes(
      "where pea.property_id = p_property_id and pea.status = 'active' and bm.user_id = auth.uid()"
    ) &&
      delinkOptions.includes("if v_caller_branch_id is not null then") &&
      delinkOptions.includes("v_withdrawal := public._ea_homeowner_withdrawal_status(p_property_id);") &&
      delinkOptions.includes("if v_withdrawal in ('invitation_pending', 'removable') then") &&
      !delinkOptions.includes("pcm.origin_type")
  );
  record(
    "Options: user-callable (authenticated), never anon",
    /revoke all on function public\.get_participation_delink_options\(bigint\) from public, anon;/i.test(sql) &&
      /grant execute on function public\.get_participation_delink_options\(bigint\) to authenticated;/i.test(sql)
  );
  const delinkTypes = read("lib/ownership/participationDelinkTypes.ts");
  const quickActions = read("components/participation/ParticipationDelinkQuickActions.tsx");
  const delinkPanel = read("components/participation/ParticipationDelinkPanel.tsx");
  record(
    "UI: withdraw is offered only from the options RPC (no client-side origin or authority gate); new refusals have messages",
    quickActions.includes("getParticipationDelinkOptions(") &&
      !/origin_type|originType/.test(quickActions) &&
      !/origin_type|originType/.test(delinkPanel) &&
      delinkTypes.includes("not_seller_side_row:") &&
      delinkTypes.includes("homeowner_not_invited:")
  );

  const dependantsFn = body("_property_placeholder_has_dependants");
  record(
    "Remove branch: dependants are buyer_connected, an active identity or counterparty, a linked Buyer Ready node, a represented linking row, or a represented onward row",
    dependantsFn.includes("(p.relationship_type = 'sale' and coalesce(p.buyer_connected, false))") &&
      dependantsFn.includes("from public.property_operational_identities poi where poi.property_id = p.id and poi.status = 'active'") &&
      dependantsFn.includes("from public.property_counterparty_participants cp where cp.property_id = p.id and cp.status = 'active'") &&
      dependantsFn.includes("from public.chain_nodes cn where cn.linked_property_id = p.id and cn.node_type = 'buyer_ready'") &&
      dependantsFn.includes("from public.properties q where q.linked_property_id = p.id and q.id <> p.id")
  );
  record(
    "Remove branch: unrelated rows sharing the chain do not count (no chain_id dependency test)",
    !/\.chain_id\s*=\s*p\.chain_id/.test(dependantsFn) && !dependantsFn.includes("v_chain_id")
  );
  record(
    "Remove branch: otherwise only the assignment is revoked (branch_left); the row stays as a placeholder",
    removeBranch.indexOf("v_release := v_mistake and not v_dependants;") <
      removeBranch.indexOf("if v_release then v_transition") &&
      /end if; update public\.property_ea_assignments set status = 'revoked', revoked_at = now\(\), revocation_reason = 'branch_left', updated_at = now\(\) where property_id = p_property_id and branch_id = v_branch_id and status = 'active';/.test(removeBranch)
  );
  record(
    "Remove branch: counterparties, members, invitations and claim reset happen only inside the release branch",
    (() => {
      const releaseBlock = removeBranch.slice(
        removeBranch.indexOf("if v_release then v_transition"),
        removeBranch.indexOf("update public.property_ea_assignments")
      );
      const outside = removeBranch.replace(releaseBlock, "");
      return (
        releaseBlock.includes("update public.property_counterparty_participants") &&
        releaseBlock.includes("delete from public.property_members") &&
        releaseBlock.includes("_revoke_open_property_claim_invitations") &&
        !outside.includes("update public.property_counterparty_participants") &&
        !outside.includes("delete from public.property_members") &&
        !outside.includes("_revoke_open_property_claim_invitations") &&
        !outside.includes("update public.property_claim_metadata")
      );
    })()
  );

  const discover = body("discover_claimable_properties");
  record(
    "Claim discovery: archived, released and anonymised rows are not listed",
    discover.includes(
      "and not exists ( select 1 from public.property_lifecycle_states pls where pls.property_id = pcm.property_id and pls.operational_state in ('archived', 'released', 'anonymised') )"
    ) &&
      discover.includes("pcm.claim_status in ('unclaimed', 'claim_invited')") &&
      discover.includes("pci.invitation_rejected_by_user_id = auth.uid()")
  );
  record(
    "Claim discovery: SECURITY DEFINER, authenticated only",
    /security\s+definer/i.test(header("discover_claimable_properties")) &&
      authenticatedOnlyAcl(sql, "public.discover_claimable_properties()")
  );
  const resolveToken = body("resolve_claim_invitation_token");
  record(
    "Invitation link: a closed row reports property_released before any claim details",
    resolveToken.includes(
      "pls.operational_state in ('archived', 'released', 'anonymised') ) then return jsonb_build_object('ok', false, 'error', 'property_released');"
    ) &&
      resolveToken.indexOf("'property_released'") > resolveToken.indexOf("'expired'") &&
      resolveToken.indexOf("'property_released'") < resolveToken.indexOf("'property', jsonb_build_object(")
  );
  record(
    "Invitation link: SECURITY DEFINER, authenticated only",
    /security\s+definer/i.test(header("resolve_claim_invitation_token")) &&
      authenticatedOnlyAcl(sql, "public.resolve_claim_invitation_token(text)")
  );
  record(
    "Delink: SECURITY DEFINER",
    /security\s+definer/i.test(header("_execute_participation_delink"))
  );

  const activityAllowlist = body("is_allowed_structured_activity_update");
  record(
    "Activity allowlist: admits the onward-purchase unlink notice and keeps the release notice",
    activityAllowlist.includes(
      "'the onward purchase was unlinked from this sale because that address is now part of another moveloop chain.'"
    ) && activityAllowlist.includes("'property released for future transactions. historic chain data retained.'")
  );

  // ---------------------------------------------------------------------------
  // Postflight
  // ---------------------------------------------------------------------------
  record(
    "Postflight: refuses membership-based write policies on operational tables",
    flat.includes("membership-based write policies remain") &&
      flat.includes("'operational_delays'") &&
      flat.includes("pol.cmd in ('insert', 'update', 'delete', 'all')")
  );
  record(
    "Postflight: refuses membership helpers in re-authorised bodies (incl. placement + guard)",
    flat.includes("membership-based rpc authority remains") &&
      flat.includes("to_regprocedure('public.caller_may_place_property_in_chain(bigint)')") &&
      flat.includes("to_regprocedure('public._trg_properties_guard_direct_writes()')")
  );
  record(
    "Postflight: refuses client write grants on property_ea_assignments",
    flat.includes("client write grants remain on property_ea_assignments")
  );
  record(
    "Postflight: reservation trigger installed, enabled, SECURITY DEFINER",
    flat.includes("t.tgname = 'trg_properties_address_reservation'") &&
      flat.includes("t.tgenabled <> 'd'") &&
      flat.includes("and p.prosecdef")
  );
  record(
    "Postflight: reservation trigger fires on link and chain changes",
    flat.includes("pg_get_triggerdef(t.oid) like '%linked_property_id%'") &&
      flat.includes("pg_get_triggerdef(t.oid) like '%chain_id%'")
  );
  record(
    "Postflight: grant/delink/allowlist hardening fingerprints",
    flat.includes("'%property_released%_address_reservation_conflict%'") &&
      flat.includes("('public._grant_counterparty_participation_core(bigint, uuid)', '%property_released%')") &&
      flat.includes("('public._execute_participation_delink(bigint, text, text, uuid)', '%for update%_property_placeholder_has_dependants%is_property_seller_side_homeowner%homeowner_removed_ea%branch_left%_ea_homeowner_withdrawal_status%')") &&
      flat.includes("('public._ea_homeowner_withdrawal_status(bigint)', '%not_seller_side_row%homeowner_not_invited%homeowner_has_meaningful_participation%')") &&
      flat.includes("('public.get_participation_delink_options(bigint)', '%is_property_seller_side_homeowner%_ea_homeowner_withdrawal_status%')") &&
      flat.includes("('public.discover_claimable_properties()', '%active_assignment.branch_id is not null%operational_state in (''archived'', ''released'', ''anonymised'')%')") &&
      flat.includes("('public.reconnect_returning_ea_branch(bigint, uuid)', '%for update%homeowner_left_cascade%property_ea_reconnection_events%')") &&
      flat.includes("('public.is_allowed_structured_activity_update(text)', '%the onward purchase was unlinked")
  );

  // Returning-EA reconnection
  const reconnectFn = body("reconnect_returning_ea_branch");
  record(
    "Reconnect: signature is (property, branch) only — no address or access code is accepted as proof",
    /create or replace function public\.reconnect_returning_ea_branch\(\s*p_property_id bigint,\s*p_branch_id uuid\s*\)/i.test(sql) &&
      !/p_address|p_access_code|p_postcode/.test(reconnectFn)
  );
  record(
    "Reconnect: verified email, rate limit, valid branch membership before any read of the row",
    reconnectFn.indexOf("_require_verified_email_for_transaction()") > -1 &&
      reconnectFn.indexOf("_rate_limit_try_consume(") > -1 &&
      reconnectFn.indexOf("public.is_ea_branch_member(p_branch_id)") > -1 &&
      reconnectFn.indexOf("public.is_ea_branch_member(p_branch_id)") < reconnectFn.indexOf("from public.properties")
  );
  record(
    "Reconnect: row locked; archived/released/anonymised and searching rows refused; seller side must be unrepresented",
    reconnectFn.includes("where id = p_property_id for update;") &&
      reconnectFn.includes("pls.operational_state in ('archived', 'released', 'anonymised')") &&
      reconnectFn.includes("v_property.stage = 'searching'") &&
      reconnectFn.includes("if v_sides.seller_side <> 'none' then")
  );
  record(
    "Reconnect: only the most recent assignment, by the same branch, revoked by the homeowner-leave cascade (branch_left / homeowner_removed_ea / replaced never qualify)",
    reconnectFn.includes("order by pea.assigned_at desc, pea.created_at desc limit 1 for update;") &&
      reconnectFn.includes("v_previous.branch_id is distinct from p_branch_id") &&
      reconnectFn.includes("v_previous.status = 'active'") &&
      reconnectFn.includes("v_previous.revocation_reason is distinct from 'homeowner_left_cascade'") &&
      !reconnectFn.includes("'branch_left'")
  );
  record(
    "Reconnect: refused when the branch acts for the sale linking to the row; audited; generic refusals",
    reconnectFn.includes("s.linked_property_id = v_property.id and spea.branch_id = p_branch_id and spea.status = 'active'") &&
      reconnectFn.includes("insert into public.property_ea_reconnection_events") &&
      (reconnectFn.match(/'not_reconnectable'/g) ?? []).length >= 5
  );
  record(
    "Reconnect: homeowner_left_cascade is set only by the GDPR person-link removal; normal delink paths never set it",
    body("_gdpr_remove_subject_property_links").includes("else 'homeowner_left_cascade'") &&
      !delink.includes("homeowner_left_cascade")
  );

  const likeMatches = (fnName: string, pattern: string) => {
    const raw = fns.get(fnName)?.body ?? "";
    let at = 0;
    for (const part of pattern.split("%").filter(Boolean)) {
      const found = raw.indexOf(part, at);
      if (found < 0) return false;
      at = found + part.length;
    }
    return true;
  };
  record(
    "Postflight: withdraw-homeowner fingerprints match the bodies this migration defines (in order)",
    likeMatches(
      "_execute_participation_delink",
      "%for update%_property_placeholder_has_dependants%is_property_seller_side_homeowner%homeowner_removed_ea%branch_left%_ea_homeowner_withdrawal_status%"
    ) &&
      likeMatches(
        "_ea_homeowner_withdrawal_status",
        "%not_seller_side_row%homeowner_not_invited%homeowner_has_meaningful_participation%"
      ) &&
      likeMatches("get_participation_delink_options", "%is_property_seller_side_homeowner%_ea_homeowner_withdrawal_status%")
  );

  // Returning-EA lookup (list_reconnectable_ea_properties)
  const lookupFn = body("list_reconnectable_ea_properties");
  const lookupAll = normalize(fns.get("list_reconnectable_ea_properties")?.args ?? "x");
  record(
    "Lookup: takes no input at all — no address, postcode or access code can be used to discover a row",
    /create or replace function public\.list_reconnectable_ea_properties\(\)/i.test(sql) &&
      lookupAll === "" &&
      !/p_address|p_access_code|p_postcode|access_code/.test(lookupFn)
  );
  record(
    "Lookup: STABLE, SECURITY DEFINER, owned by postgres, authenticated only (no anon)",
    /^\s*returns jsonb\s+language plpgsql\s+stable\s+security definer\s+set search_path = public/i.test(
      header("list_reconnectable_ea_properties")
    ) &&
      ownedByPostgres(sql, "public.list_reconnectable_ea_properties()") &&
      authenticatedOnlyAcl(sql, "public.list_reconnectable_ea_properties()")
  );
  record(
    "Lookup: grants nothing — no insert/update/delete/perform, never calls the reconnect RPC",
    lookupFn.length > 0 &&
      !/\b(insert|update|delete|perform|upsert)\b/.test(lookupFn) &&
      !lookupFn.includes("reconnect_returning_ea_branch") &&
      !lookupFn.includes("for update")
  );
  record(
    "Lookup: verified email required; scoped to the caller's own branch memberships (auth.uid())",
    lookupFn.includes("v_uid uuid := auth.uid();") &&
      lookupFn.includes("_require_verified_email_for_transaction()") &&
      lookupFn.includes("from public.ea_branch_members bm") &&
      lookupFn.includes("where bm.user_id = v_uid") &&
      lookupFn.includes("on pea.branch_id = bm.branch_id")
  );
  record(
    "Lookup parity: homeowner_left_cascade only, never branch_left; assignment not active",
    lookupFn.includes("and pea.revocation_reason = 'homeowner_left_cascade'") &&
      lookupFn.includes("and pea.status <> 'active'") &&
      !lookupFn.includes("branch_left") &&
      !lookupFn.includes("homeowner_removed_ea") &&
      !lookupFn.includes("'replaced'")
  );
  record(
    "Lookup parity: must be the latest assignment on the row (a replacement branch, active or revoked, excludes it)",
    lookupFn.includes(
      "where later.property_id = pea.property_id and later.id <> pea.id and (later.assigned_at, later.created_at) >= (pea.assigned_at, pea.created_at)"
    )
  );
  record(
    "Lookup parity: not searching, not archived/released/anonymised, seller side unrepresented",
    lookupFn.includes("p.stage is distinct from 'searching'") &&
      lookupFn.includes("pls.operational_state in ('archived', 'released', 'anonymised')") &&
      lookupFn.includes("from public._property_side_representation(p.id) s ) = 'none'")
  );
  record(
    "Lookup parity: excluded when the branch acts for the sale linking to the row (buyer-side EA)",
    lookupFn.includes(
      "s.linked_property_id = p.id and spea.branch_id = pea.branch_id and spea.status = 'active'"
    )
  );
  record(
    "Lookup returns only the row, branch and what the branch already held (no homeowner/buyer identity, no access code)",
    lookupFn.includes("'property_id', p.id") &&
      lookupFn.includes("'address', p.address") &&
      lookupFn.includes("'postcode', p.postcode") &&
      !/email|access_code|user_id|homeowner|full_name|buyer/.test(
        lookupFn.slice(
          lookupFn.indexOf("jsonb_agg("),
          lookupFn.indexOf("from public.ea_branch_members")
        )
      )
  );
  record(
    "Reconnect RPC re-checks every lookup condition independently (membership, lock, lifecycle, seller side, latest same-branch cascade, linking sale)",
    reconnectFn.includes("public.is_ea_branch_member(p_branch_id)") &&
      reconnectFn.includes("for update;") &&
      reconnectFn.includes("pls.operational_state in ('archived', 'released', 'anonymised')") &&
      reconnectFn.includes("if v_sides.seller_side <> 'none' then") &&
      reconnectFn.includes("v_previous.revocation_reason is distinct from 'homeowner_left_cascade'") &&
      reconnectFn.includes("s.linked_property_id = v_property.id") &&
      !reconnectFn.includes("list_reconnectable_ea_properties")
  );
  record(
    "Lookup: partial index on homeowner_left_cascade assignments",
    flat.includes(
      "create index if not exists property_ea_assignments_homeowner_left_cascade_idx on public.property_ea_assignments (branch_id) where revocation_reason = 'homeowner_left_cascade';"
    )
  );
  const lookupFingerprint =
    "%_require_verified_email_for_transaction%homeowner_left_cascade%bm.user_id = v_uid%operational_state in ('archived', 'released', 'anonymised')%_property_side_representation%linked_property_id%";
  record(
    "Postflight: lookup fingerprint present and matches the body in order; anon refused; stable with no input",
    flat.includes(
      "('public.list_reconnectable_ea_properties()', '%_require_verified_email_for_transaction%homeowner_left_cascade%bm.user_id = v_uid%operational_state in (''archived'', ''released'', ''anonymised'')%_property_side_representation%linked_property_id%')"
    ) &&
      likeMatches("list_reconnectable_ea_properties", lookupFingerprint) &&
      flat.includes("has_function_privilege('anon', 'public.list_reconnectable_ea_properties()', 'execute')") &&
      flat.includes("p.provolatile <> 's' or p.pronargs <> 0")
  );
  const postflightStart = raw.toLowerCase().lastIndexOf("create or replace function");
  const fingerprintMismatches = [
    ...raw.matchAll(/\(\s*'public\.([a-z0-9_]+)\([^']*\)'\s*,\s*'((?:[^']|'')*%(?:[^']|'')*)'\s*\)/gi),
  ]
    .filter((m) => (m.index ?? 0) > postflightStart && fns.has(m[1].toLowerCase()))
    .filter((m) => !likeMatches(m[1].toLowerCase(), m[2].replace(/''/g, "'")))
    .map((m) => m[1]);
  record(
    "Postflight: every fingerprint for a function this migration defines matches its body in order",
    fingerprintMismatches.length === 0,
    fingerprintMismatches.join(", ")
  );
  record(
    "Postflight: reconnect fingerprint matches the body in order",
    likeMatches(
      "reconnect_returning_ea_branch",
      "%for update%homeowner_left_cascade%property_ea_reconnection_events%"
    )
  );

  // ---------------------------------------------------------------------------
  // Allowlist / targets
  // ---------------------------------------------------------------------------
  const allowlist = JSON.parse(read("scripts/secdef-user-rpc-allowlist.json")) as {
    allowlist: { name: string; args: string; reason: string }[];
  };
  const targets = JSON.parse(read("scripts/secdef-service-role-only-targets.json")) as {
    targets: { name: string; args: string }[];
  };
  const allowEntry = (name: string, args: string) =>
    allowlist.allowlist.find((e) => e.name === name && e.args === args);
  const inTargets = (name: string, args: string) =>
    targets.targets.some((e) => e.name === name && e.args === args);

  for (const [name, args, reason] of [
    ["assign_property_ea_branch", "bigint, uuid, boolean", "user_facing_product_rpc"],
    ["set_property_ea_update_permission", "bigint, boolean", "user_facing_product_rpc"],
    ["reconnect_returning_ea_branch", "bigint, uuid", "user_facing_product_rpc"],
    ["list_reconnectable_ea_properties", "", "user_facing_product_rpc"],
    ["can_operate_in_chain", "bigint", "authenticated_readonly_predicate_helper"],
    ["owns_chain_node", "bigint", "authenticated_readonly_predicate_helper"],
  ]) {
    record(`Allowlist: ${name}(${args}) as ${reason}`, allowEntry(name, args)?.reason === reason);
  }
  for (const [name, args] of [
    ["_address_reservation_conflict", "text, text, bigint"],
    ["_trg_properties_address_reservation", ""],
  ]) {
    record(`Service-role target: ${name}(${args})`, inTargets(name, args) && !allowEntry(name, args));
  }
  const definedFunctions = new Set(
    readdirSync(join(ROOT, "supabase/migrations"))
      .filter((f) => f.endsWith(".sql"))
      .flatMap((f) =>
        [...read(`supabase/migrations/${f}`).matchAll(/create\s+(?:or\s+replace\s+)?function\s+public\.(\w+)\s*\(/gi)].map(
          (m) => m[1].toLowerCase()
        )
      )
  );
  const undefinedTargets = targets.targets.filter((e) => !definedFunctions.has(e.name.toLowerCase()));
  record(
    "Every service-role target is a function some migration defines",
    undefinedTargets.length === 0,
    undefinedTargets.map((e) => `${e.name}(${e.args})`).join(", ")
  );
  const names = allowlist.allowlist.map((e) => `${e.name}(${e.args})`);
  record(
    "Allowlist entries are unique",
    new Set(names).size === names.length,
    names.find((n, i) => names.indexOf(n) !== i)
  );

  // ---------------------------------------------------------------------------
  // Companion application
  // ---------------------------------------------------------------------------
  const assignments = read("lib/estateAgent/assignments.ts");
  record(
    "assignments.ts: appointment and permission go through the RPCs",
    assignments.includes('"assign_property_ea_branch"') &&
      assignments.includes('"set_property_ea_update_permission"') &&
      assignments.includes("p_homeowner_only_updates")
  );
  record(
    "assignments.ts: assignedByUserId removed (server records the caller)",
    !assignments.includes("assignedByUserId")
  );

  const clientWritePattern =
    /from\(\s*["']property_ea_assignments["']\s*\)\s*\.(insert|update|upsert|delete)\(/;
  // lib/smokeTest runs with the service-role admin client only.
  const offenders = ["app", "components", "lib"]
    .flatMap((dir) => walk(join(ROOT, dir)))
    .filter((file) => !relative(ROOT, file).replace(/\\/g, "/").startsWith("lib/smokeTest/"))
    .filter((file) => clientWritePattern.test(readFileSync(file, "utf8")))
    .map((file) => relative(ROOT, file));
  record(
    "No user-session app/components/lib file writes property_ea_assignments directly",
    offenders.length === 0,
    offenders.join(", ")
  );

  const assignmentUi = read("components/estate-agents/PropertyEstateAgentAssignment.tsx");
  record(
    "Assignment panel: permission toggle passes the property id",
    /updatePropertyEaDelegation\(\s*supabase,\s*propertyId,\s*checked\s*\)/.test(assignmentUi) &&
      !assignmentUi.includes("assignedByUserId")
  );

  const startMove = read("app/start-move/page.tsx");
  record(
    "Start Move: trigger refusal (23505 property_address_reserved) or grant address_reserved gets its own message",
    startMove.includes('insertError?.code === "23505"') &&
      startMove.includes('insertError.message === "property_address_reserved"') &&
      startMove.includes('grantError === "address_reserved"') &&
      (startMove.match(/START_MOVE_ADDRESS_RESERVED_MESSAGE/g) ?? []).length === 5
  );
  record(
    "Start Move: every failure still cleans up the chain",
    /async function fail\([\s\S]*?cleanupOnboardingChain\(chainId\)[\s\S]*?setErrorMessage\(userMessage\)/.test(startMove)
  );

  const reconnectLib = read("lib/estateAgent/reconnectReturningBranch.ts");
  const reconnectPage = read("app/agent/reconnect/page.tsx");
  const commandCentre = read("components/agent/AgentCommandCentre.tsx");
  const routes = read("lib/auth/routes.ts");
  record(
    "Reconnect lib: lookup calls list_reconnectable_ea_properties with no arguments; reconnect sends only property and branch",
    /supabase\.rpc\(\s*"list_reconnectable_ea_properties"\s*\)/.test(reconnectLib) &&
      /"reconnect_returning_ea_branch",\s*\{\s*p_property_id: params\.propertyId,\s*p_branch_id: params\.branchId,\s*\}/.test(
        reconnectLib
      ) &&
      !/p_address|p_access_code|p_postcode/.test(reconnectLib)
  );
  record(
    "Reconnect page: /agent/reconnect is under the EA-only, verified-email /agent prefix",
    routes.includes('agentReconnect: "/agent/reconnect"') &&
      /ESTATE_AGENT_PROTECTED_PREFIXES = \[\s*"\/agent",/.test(routes) &&
      /TRANSACTION_PARTICIPATION_PREFIXES = \[[\s\S]*?"\/agent",[\s\S]*?\] as const;/.test(routes)
  );
  record(
    "Reconnect page: lists only lookup results; the Reconnect action calls the RPC wrapper with the listed property and branch",
    reconnectPage.includes("listReconnectableProperties(supabase)") &&
      /reconnectReturningBranch\(\s*supabase,\s*\{\s*propertyId: item\.propertyId,\s*branchId: item\.branchId,\s*\}/.test(
        reconnectPage
      )
  );
  record(
    "Reconnect page: no address, postcode or access-code input and no direct table access (no UI-only authorization)",
    !/<input|<textarea|PropertyAddressLookup|accessCode|access_code/.test(reconnectPage) &&
      !/\.from\(|supabase\.rpc\(/.test(reconnectPage)
  );
  record(
    "Reconnect page: failures show the RPC's generic message and the list is re-read",
    /if \(!result\.ok\) \{\s*setActionError\(result\.error\);\s*await reload\(\);/.test(reconnectPage)
  );
  record(
    "Command centre: reconnect notice only when the lookup returns rows",
    commandCentre.includes("listReconnectableProperties(supabase)") &&
      commandCentre.includes("{reconnectableCount > 0 ? (") &&
      commandCentre.includes("href={ROUTES.agentReconnect}")
  );

  const originate = read("app/agent/originate/page.tsx");
  record(
    "EA originate (create): property_already_exists gets a join hint",
    originate.includes('propertyResult.error === "property_already_exists"') &&
      originate.includes("use Join with the chain access code")
  );
  record(
    "EA originate (create): the empty chain is cleaned up with p_require_empty",
    /createEaOperationalProperty[\s\S]*?"cleanup_abandoned_onboarding_chain",\s*\{\s*p_chain_id: chainId,\s*p_require_empty: true,/.test(originate)
  );

  const claimUi = read("components/claim/ClaimPropertyExperience.tsx");
  record(
    "Claim UI: property_released and address_reserved get their own messages",
    claimUi.includes('"property_released"') && claimUi.includes('"address_reserved"')
  );
  record(
    "Claim UI: a revoked or unknown invitation (invalid_token) gets its own message",
    /case "invalid_token":\s*return "This invitation is no longer valid\./.test(claimUi)
  );
  const invitationError = read("components/claim/ClaimInvitationError.tsx");
  record(
    "Invitation link page: property_released gets its own message",
    /case "property_released":\s*return "This property is no longer available to connect\.";/.test(invitationError)
  );
  const delinkCopy = read("lib/ownership/participationDelinkPresentation.ts");
  record(
    "Remove-branch confirmation: without a homeowner the row stays as a placeholder; released only for a mistake reason with no dependants",
    delinkCopy.includes("the property stays in the chain waiting for its seller") &&
      delinkCopy.includes("added by mistake") &&
      delinkCopy.includes("duplicate property") &&
      delinkCopy.includes("and nobody else depends on it")
  );

  const searching = read("lib/searchingPlaceholder.ts");
  record(
    "Convert placeholder: trigger refusal maps to duplicate_address",
    searching.includes('error.code === "23505"') &&
      searching.includes('error.message === "property_address_reserved"')
  );

  const failed = results.filter((r) => !r.pass).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed.`);
  if (failed > 0) process.exit(1);
}

main();
