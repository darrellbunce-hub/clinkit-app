/**
 * Static checks for the bounded placeholder lifecycle and its companion
 * application changes.
 *
 *   supabase/migrations/20261005130000_lifecycle_bounded_dormancy.sql
 *   lib/lifecycle/{dormancyScenarios,schedule,config,worker,dormancyWarningNotifications,
 *     loadPropertyLifecycleState,stillActiveConfirmationEligibility}.ts
 *   components/lifecycle/*, app/buyer-ready/[chainId]/page.tsx,
 *   emails/templates/DormancyWarning.tsx, app/api/cron/property-lifecycle/route.ts,
 *   vercel.json
 *
 * Usage:
 *   npx tsx scripts/verify-lifecycle-bounded-dormancy-migration.ts
 */
import { existsSync, readFileSync } from "fs";
import { join } from "path";

import { renderDormancyWarning } from "../lib/communications/render";

const ROOT = join(import.meta.dirname, "..");
const MIGRATION = "supabase/migrations/20261005130000_lifecycle_bounded_dormancy.sql";

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

function extractFunctions(sql: string): Map<string, { header: string; body: string }> {
  const functions = new Map<string, { header: string; body: string }>();
  const pattern =
    /create\s+(?:or\s+replace\s+)?function\s+public\.([a-z0-9_]+)\s*\(([\s\S]*?)\)\s*(returns[\s\S]*?|language[\s\S]*?)\$(\w*)\$([\s\S]*?)\$\4\$/gi;

  for (const match of sql.matchAll(pattern)) {
    functions.set(match[1].toLowerCase(), { header: match[3], body: match[5] });
  }

  return functions;
}

function escape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function grantedTo(sql: string, signature: string, roles: string): boolean {
  return new RegExp(
    `grant execute on function ${escape(signature)} to ${escape(roles)};`,
    "i"
  ).test(sql);
}

function revokedFrom(sql: string, signature: string, roles: string): boolean {
  return new RegExp(
    `revoke all on function ${escape(signature)} from ${escape(roles)};`,
    "i"
  ).test(sql);
}

async function main() {
  const sql = stripSqlComments(read(MIGRATION));
  const flat = normalize(sql);
  const fns = extractFunctions(sql);
  const body = (name: string) => normalize(fns.get(name)?.body ?? "");
  const header = (name: string) => fns.get(name)?.header ?? "";
  const serviceRoleOnly = (signature: string) =>
    revokedFrom(sql, signature, "public, anon, authenticated") &&
    grantedTo(sql, signature, "service_role");

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
  const postflightStart = sql.toLowerCase().lastIndexOf("create or replace function");
  const fingerprintMismatches = [
    ...sql.matchAll(/\(\s*'public\.([a-z0-9_]+)\([^']*\)'\s*,\s*'((?:[^']|'')*%(?:[^']|'')*)'\s*\)/gi),
  ]
    .filter((m) => (m.index ?? 0) > postflightStart && fns.has(m[1].toLowerCase()))
    .filter((m) => !likeMatches(m[1].toLowerCase(), m[2].replace(/''/g, "'")))
    .map((m) => m[1]);
  record(
    "Postflight: every fingerprint for a function this migration defines matches its body in order",
    fingerprintMismatches.length === 0,
    fingerprintMismatches.join(", ")
  );

  // ---------------------------------------------------------------------------
  // Preflight
  // ---------------------------------------------------------------------------
  for (const dep of [
    "public._property_side_representation(bigint)",
    "public._property_placeholder_has_dependants(bigint, uuid)",
    "public.lifecycle_connected_dormant_days()",
    "public.lifecycle_dormant_inactivity_days()",
    "public.lifecycle_dormancy_confirmation_days()",
    "public.record_property_lifecycle_transition_worker(bigint, text, text, text, text, jsonb)",
    "public.execute_property_lifecycle_release(bigint, text, jsonb)",
  ]) {
    record(`Preflight requires ${dep}`, flat.includes(`'${dep}'`));
  }
  for (const signature of [
    "public.get_property_lifecycle_signals(bigint)",
    "public.get_dormancy_warning_email_recipient(bigint)",
    "public.execute_enter_dormancy_warning(bigint, text, jsonb)",
    "public.confirm_transaction_still_active(bigint)",
    "public.execute_property_lifecycle_action(bigint, text, text, text, uuid, jsonb)",
    "public.list_property_lifecycle_worker_candidates(integer)",
    "public._trg_touch_operational_activity_from_activity()",
    "public._execute_participation_delink(bigint, text, text, uuid)",
  ]) {
    record(`Preflight fingerprints the replaced body of ${signature}`, flat.includes(`('${signature}', '%`));
  }

  // ---------------------------------------------------------------------------
  // Columns, index, effective-from
  // ---------------------------------------------------------------------------
  record(
    "Columns: seller_side_unrepresented_since, placeholder_activity_at, next_evaluation_at",
    flat.includes("add column if not exists seller_side_unrepresented_since timestamptz null") &&
      flat.includes("add column if not exists placeholder_activity_at timestamptz null") &&
      flat.includes("add column if not exists next_evaluation_at timestamptz null")
  );
  record(
    "Index: partial index on next_evaluation_at",
    flat.includes(
      "create index if not exists property_lifecycle_states_next_evaluation_idx on public.property_lifecycle_states (next_evaluation_at) where next_evaluation_at is not null;"
    )
  );
  record(
    "Effective-from: database setting with the same fixed default as the app",
    body("lifecycle_dormancy_effective_from").includes(
      "current_setting('app.lifecycle_dormancy_effective_from', true)"
    ) &&
      body("lifecycle_dormancy_effective_from").includes("timestamptz '2026-10-05 00:00:00+00'") &&
      read("lib/lifecycle/config.ts").includes(
        'DEFAULT_LIFECYCLE_DORMANCY_EFFECTIVE_FROM = "2026-10-05T00:00:00.000Z"'
      )
  );

  // ---------------------------------------------------------------------------
  // Managed versus placeholder
  // ---------------------------------------------------------------------------
  record(
    "Managed = seller side represented (homeowner or EA); buyers never make a row managed",
    body("_property_is_managed").includes(
      "(select r.seller_side from public._property_side_representation(p_property_id) r) <> 'none'"
    )
  );
  const anchor = body("_property_placeholder_anchor");
  record(
    "Anchor: latest of unrepresented-since, dependent activity, confirmation and effective-from",
    anchor.includes(
      "greatest( pls.seller_side_unrepresented_since, pls.placeholder_activity_at, pls.last_still_active_confirmed_at, public.lifecycle_dormancy_effective_from() )"
    ) && anchor.includes("pls.seller_side_unrepresented_since is not null")
  );
  const refresh = body("_refresh_property_seller_side_state");
  record(
    "Refresh: locks the property row, then the lifecycle row",
    refresh.indexOf("from public.properties where id = p_property_id for update;") > -1 &&
      refresh.indexOf("from public.properties where id = p_property_id for update;") <
        refresh.indexOf("from public.property_lifecycle_states where property_id = p_property_id for update;")
  );
  record(
    "Refresh: closed and completion states are left alone",
    refresh.includes("if v_state in ('completed_grace', 'archived', 'released', 'anonymised') then return;")
  );
  record(
    "Refresh: managed (or searching) clears the clock and returns warning/dormant to active, logged",
    refresh.includes("if v_managed or v_property.stage = 'searching' then") &&
      refresh.includes("'seller side represented; managed rows are never dormant.'") &&
      refresh.includes("seller_side_unrepresented_since = null") &&
      refresh.includes("jsonb_build_object('source', 'seller_side_represented')")
  );
  record(
    "Refresh: a placeholder starts its clock only if it is not running",
    refresh.includes(
      "seller_side_unrepresented_since = coalesce( public.property_lifecycle_states.seller_side_unrepresented_since, excluded.seller_side_unrepresented_since )"
    )
  );
  record(
    "Refresh triggers: identities, EA assignments, counterparties (status), properties insert and searching/relationship changes",
    flat.includes(
      "create trigger trg_lifecycle_refresh_seller_side after insert or update of status on public.property_operational_identities"
    ) &&
      flat.includes(
        "create trigger trg_lifecycle_refresh_seller_side after insert or update of status on public.property_ea_assignments"
      ) &&
      flat.includes(
        "create trigger trg_lifecycle_refresh_seller_side after insert or update of status on public.property_counterparty_participants"
      ) &&
      flat.includes("create trigger trg_lifecycle_refresh_seller_side_insert after insert on public.properties") &&
      flat.includes(
        "create trigger trg_lifecycle_refresh_seller_side_update after update of stage, relationship_type on public.properties"
      )
  );

  // ---------------------------------------------------------------------------
  // Scheduling and worker candidates
  // ---------------------------------------------------------------------------
  const scheduleTrigger = body("_trg_property_lifecycle_states_schedule");
  record(
    "Schedule trigger: entering grace/warning/dormant/archived/released schedules now; anonymised clears",
    scheduleTrigger.includes(
      "if new.operational_state in ( 'completed_grace', 'dormancy_warning', 'dormant', 'archived', 'released' ) then new.next_evaluation_at := now();"
    ) && scheduleTrigger.includes("elsif new.operational_state = 'anonymised' then new.next_evaluation_at := null;")
  );
  record(
    "Chain completion schedules every active row of the chain",
    flat.includes(
      "create trigger trg_chains_completion_schedule_lifecycle after update of completed_at on public.chains for each row when (old.completed_at is null and new.completed_at is not null)"
    )
  );
  const schedule = body("schedule_property_lifecycle_evaluation");
  record(
    "schedule_property_lifecycle_evaluation: a running clock, grace, archived and snapshot-less released rows are never left unscheduled",
    schedule.includes("v_next := now() + interval '1 day';") &&
      schedule.includes("v_pls.operational_state in ('completed_grace', 'archived')") &&
      schedule.includes("pas.snapshot_kind = 'operational_release'") &&
      serviceRoleOnly("public.schedule_property_lifecycle_evaluation(bigint, timestamptz)")
  );
  const candidates = body("list_property_lifecycle_worker_candidates");
  record(
    "Worker candidates: next_evaluation_at <= now(), unleased, earliest first, bounded limit",
    candidates.includes("where pls.next_evaluation_at <= now()") &&
      candidates.includes("order by pls.next_evaluation_at limit greatest(p_limit, 1)") &&
      !candidates.includes("exclude") &&
      serviceRoleOnly("public.list_property_lifecycle_worker_candidates(integer)")
  );

  // ---------------------------------------------------------------------------
  // Activity
  // ---------------------------------------------------------------------------
  record(
    "Chain touch writes the chains row only (a repeat in one transaction writes nothing)",
    body("_touch_chain_operational_activity").includes(
      "update public.chains set last_operational_activity_at = now() where id = p_chain_id and last_operational_activity_at is distinct from now();"
    ) && !body("_touch_chain_operational_activity").includes("public.properties")
  );
  const dependentActivity = body("_record_placeholder_dependent_activity");
  record(
    "Dependent activity: managed rows (no clock) are untouched; one lifecycle row written",
    dependentActivity.includes(
      "if v_pls.property_id is null or v_pls.seller_side_unrepresented_since is null then return;"
    ) &&
      (dependentActivity.match(/update public\.property_lifecycle_states/g) ?? []).length === 2 &&
      !dependentActivity.includes("chain_id")
  );
  record(
    "Dependent activity: a warning returns to active (logged with its source); active rows restart at most hourly",
    dependentActivity.includes("jsonb_build_object('source', coalesce(p_source, 'activity'))") &&
      dependentActivity.includes("lifecycle_reason = 'dependent_activity'") &&
      dependentActivity.includes("v_pls.placeholder_activity_at < now() - interval '1 hour'")
  );
  const activityTrigger = body("_trg_touch_operational_activity_from_activity");
  record(
    "Activity trigger: non-system activity touches and restarts the row itself and the purchase its sale links to",
    activityTrigger.includes(
      "perform public.touch_property_operational_activity(new.property_id, true); perform public._record_placeholder_dependent_activity( new.property_id, 'placeholder_activity' );"
    ) &&
      activityTrigger.includes("'linked_sale_activity'") &&
      activityTrigger.includes("and s.relationship_type = 'sale'")
  );
  record(
    "Activity trigger: system notices return before any touch or restart; Buyer Ready activity touches the chains row and restarts the node's linked row",
    (() => {
      const guard = activityTrigger.indexOf("if new.updated_by is not distinct from 'system' then return new; end if;");
      return (
        guard > -1 &&
        guard < activityTrigger.indexOf("touch_property_operational_activity(") &&
        guard < activityTrigger.indexOf("_touch_chain_operational_activity(") &&
        guard < activityTrigger.indexOf("_record_placeholder_dependent_activity(")
      );
    })() &&
      activityTrigger.includes("perform public._touch_chain_operational_activity(v_chain_id);") &&
      activityTrigger.includes("'buyer_ready_activity'")
  );
  const propertyTrigger = body("_trg_touch_operational_activity_from_property");
  record(
    "Property trigger: a stage change restarts the row itself and the purchase a sale links to",
    propertyTrigger.includes("'placeholder_stage_change'") &&
      propertyTrigger.includes("'linked_sale_stage_change'") &&
      propertyTrigger.includes("new.chain_position is distinct from old.chain_position")
  );
  record(
    "Counterparty trigger: a buyer counterparty joining restarts the row",
    body("_trg_touch_operational_activity_from_counterparty").includes(
      "if new.counterparty_role = 'buyer' and (tg_op = 'insert' or old.status is distinct from 'active') then perform public._record_placeholder_dependent_activity( new.property_id, 'buyer_counterparty_joined' );"
    )
  );
  const nodeTrigger = body("_trg_touch_operational_activity_from_chain_node");
  record(
    "Buyer Ready trigger: chains row and the node's linked row only",
    nodeTrigger.includes("if new.node_type is distinct from 'buyer_ready' then return new;") &&
      nodeTrigger.includes("perform public._touch_chain_operational_activity(new.chain_id);") &&
      nodeTrigger.includes("_record_placeholder_dependent_activity( new.linked_property_id, 'buyer_ready_progress' )")
  );
  record(
    "No chain-wide warning reset remains",
    !flat.includes("_reset_dormancy_warning_after_activity") && !flat.includes("get_chain_dormancy_warning")
  );

  // ---------------------------------------------------------------------------
  // Signals, warning, recipient
  // ---------------------------------------------------------------------------
  const signals = body("get_property_lifecycle_signals");
  record(
    "Signals: read gate before the core call; adds representation and clock signals",
    signals.indexOf("property_lifecycle_read_caller_authorized(p_property_id)") > -1 &&
      signals.indexOf("property_lifecycle_read_caller_authorized(p_property_id)") <
        signals.indexOf("get_property_lifecycle_signals_core(p_property_id)") &&
      ["'sellerside'", "'buyerside'", "'ismanaged'", "'sellersideunrepresentedsince'", "'placeholderactivityat'", "'laststillactiveconfirmedat'", "'hasplaceholderdependants'", "'nextevaluationat'", "'dormancyeffectivefrom'"].every(
        (key) => signals.includes(key)
      ) &&
      !signals.includes("isrepresented")
  );
  record(
    "Warning entry: this row only (no chain peers)",
    !body("execute_enter_dormancy_warning").includes("chain_id") &&
      body("list_dormancy_warning_notification_targets").includes("where p.id = p_source_property_id")
  );
  const recipient = body("get_dormancy_warning_email_recipient");
  record(
    "Recipient: dependent side in order — buyer, buyer counterparty, linking seller, Buyer Ready owner, then the linking sale's EA branch",
    recipient.includes("'buyer'::text as kind, 1 as priority") &&
      recipient.includes("cp.counterparty_role = 'buyer'") &&
      recipient.includes("s.linked_property_id = t.id") &&
      recipient.includes("cn.node_type = 'buyer_ready'") &&
      recipient.includes("'estate_agent'::text, 5") &&
      recipient.includes("order by c.priority, c.rank, c.since nulls last, c.user_id limit 1")
  );
  const eaUpdateRule = (alias: string) =>
    `${alias}.homeowner_only_updates = false or public._property_seller_side_user_id(s.id) is null`;
  record(
    "Recipient = confirmer (A/B): every recipient passes _is_placeholder_dependent_side_user before it is chosen",
    recipient.indexOf("and public._is_placeholder_dependent_side_user(t.id, c.user_id)") > -1 &&
      recipient.indexOf("and public._is_placeholder_dependent_side_user(t.id, c.user_id)") <
        recipient.indexOf("order by c.priority")
  );
  record(
    "Recipient = confirmer (C): the linking sale's EA is a candidate only when it may update that sale (homeowner-only updates not bypassed)",
    recipient.includes(eaUpdateRule("pea")) &&
      body("_is_placeholder_dependent_side_user").includes(eaUpdateRule("spea"))
  );
  record(
    "Recipient = confirmer: the dependent-side helper is created before the recipient function (SQL bodies are validated at create time)",
    sql.indexOf("create or replace function public._is_placeholder_dependent_side_user(") > -1 &&
      sql.indexOf("create or replace function public._is_placeholder_dependent_side_user(") <
        sql.indexOf("create function public.get_dormancy_warning_email_recipient(")
  );
  record(
    "Recipient: verified, unbanned accounts only; service_role only",
    recipient.includes("u.email_confirmed_at is not null") &&
      recipient.includes("(u.banned_until is null or u.banned_until <= now())") &&
      serviceRoleOnly("public.get_dormancy_warning_email_recipient(bigint)")
  );

  // ---------------------------------------------------------------------------
  // Confirmation and status
  // ---------------------------------------------------------------------------
  const dependentSide = body("_is_placeholder_dependent_side_user");
  record(
    "Dependent side: purchase buyer, buyer counterparty, linking-sale seller or operating EA, Buyer Ready owner",
    dependentSide.includes("p.relationship_type = 'purchase'") &&
      dependentSide.includes("cp.counterparty_role = 'buyer'") &&
      dependentSide.includes("s.linked_property_id = p.id") &&
      dependentSide.includes("spea.homeowner_only_updates = false") &&
      dependentSide.includes("cn.node_type = 'buyer_ready'") &&
      !dependentSide.includes("property_members") &&
      serviceRoleOnly("public._is_placeholder_dependent_side_user(bigint, uuid)")
  );
  record(
    "can_confirm_property_still_active: internal (service_role only), dependent side while the clock runs",
    body("can_confirm_property_still_active").includes("pls.seller_side_unrepresented_since is not null") &&
      serviceRoleOnly("public.can_confirm_property_still_active(bigint)")
  );
  const confirm = body("confirm_transaction_still_active");
  record(
    "Confirm: locks the property row then the lifecycle row; a managed row is a no-op",
    confirm.indexOf("from public.properties where id = p_property_id for update;") > -1 &&
      confirm.indexOf("from public.properties where id = p_property_id for update;") <
        confirm.indexOf("from public.property_lifecycle_states where property_id = p_property_id for update;") &&
      confirm.includes("'managed', true")
  );
  record(
    "Confirm: dependent side only, before any write; idempotent within 24 hours; audited",
    confirm.indexOf("_is_placeholder_dependent_side_user(p_property_id, v_user_id)") > -1 &&
      confirm.indexOf("_is_placeholder_dependent_side_user(p_property_id, v_user_id)") <
        confirm.indexOf("insert into public.property_lifecycle_still_active_confirmations") &&
      confirm.includes("c.confirmed_at > now() - interval '24 hours'") &&
      confirm.includes("'still_active_confirmation'")
  );
  record(
    "Confirm: grants no authority (no identity, assignment, member or claim writes)",
    !/property_operational_identities|property_ea_assignments|property_members|property_claim_metadata/.test(confirm) &&
      revokedFrom(sql, "public.confirm_transaction_still_active(bigint)", "public, anon") &&
      grantedTo(sql, "public.confirm_transaction_still_active(bigint)", "authenticated")
  );
  const status = body("get_property_lifecycle_status");
  record(
    "Status RPC: rows outside a placeholder warning return at once; detail only for the dependent side",
    status.includes(
      "if v_state is distinct from 'dormancy_warning' or not coalesce(v_placeholder, false) then return jsonb_build_object('ok', true, 'in_warning', false);"
    ) &&
      status.indexOf("_is_placeholder_dependent_side_user") > status.indexOf("'in_warning', false") &&
      /stable/i.test(header("get_property_lifecycle_status")) &&
      revokedFrom(sql, "public.get_property_lifecycle_status(bigint)", "public, anon") &&
      grantedTo(sql, "public.get_property_lifecycle_status(bigint)", "authenticated")
  );

  // ---------------------------------------------------------------------------
  // Dispatcher
  // ---------------------------------------------------------------------------
  const dispatcher = body("execute_property_lifecycle_action");
  const branch = (action: string, next: string) =>
    dispatcher.slice(dispatcher.indexOf(`when '${action}' then`), dispatcher.indexOf(`when '${next}' then`));
  record(
    "Dispatcher: locks the property row, then the lifecycle row, before reading state",
    dispatcher.indexOf("from public.properties where id = p_property_id for update;") > -1 &&
      dispatcher.indexOf("from public.properties where id = p_property_id for update;") <
        dispatcher.indexOf("from public.property_lifecycle_states where property_id = p_property_id for update;") &&
      dispatcher.indexOf("from public.property_lifecycle_states where property_id = p_property_id for update;") <
        dispatcher.indexOf("case p_action")
  );
  record(
    "Dispatcher: every dormancy step on a managed row is refused (seller_side_represented); completion exempt",
    dispatcher.includes("if not v_chain_completed and v_state <> 'completed_grace' and p_action in ( 'enter_dormancy_warning', 'expire_dormancy_warning', 'mark_dormant', 'create_analytics_snapshot', 'archive_operational', 'release_property' )") &&
      dispatcher.includes("'reason', 'seller_side_represented'") &&
      dispatcher.indexOf("seller_side_represented") < dispatcher.indexOf("case p_action")
  );
  record(
    "Dispatcher: warning only for an active placeholder with dependants past the connected window",
    branch("enter_dormancy_warning", "expire_dormancy_warning").includes(
      "v_anchor > now() - make_interval(days => public.lifecycle_connected_dormant_days()) or not public._property_placeholder_has_dependants(p_property_id, null)"
    )
  );
  record(
    "Dispatcher: expire only from dormancy_warning past its deadline",
    branch("expire_dormancy_warning", "mark_dormant").includes(
      "if v_state <> 'dormancy_warning' or v_deadline is null or v_deadline > now() then"
    )
  );
  record(
    "Dispatcher: mark_dormant only for an active placeholder without dependants past the inactivity window",
    branch("mark_dormant", "create_analytics_snapshot").includes(
      "v_anchor > now() - make_interval(days => public.lifecycle_dormant_inactivity_days()) or public._property_placeholder_has_dependants(p_property_id, null)"
    )
  );
  record(
    "Dispatcher: archive from dormant/grace; release from archived after the release-safety check",
    branch("archive_operational", "release_property").includes("if v_state not in ('dormant', 'completed_grace', 'archived') then") &&
      branch("release_property", "anonymise_historical").indexOf("if v_state <> 'archived' then") <
        branch("release_property", "anonymise_historical").indexOf("property_lifecycle_chain_release_safe") &&
      serviceRoleOnly("public.execute_property_lifecycle_action(bigint, text, text, text, uuid, jsonb)")
  );
  record(
    "Release safety: placeholders in uncompleted chains are not blocked by unrelated chain activity",
    body("property_lifecycle_chain_release_safe").includes("seller_side_unrepresented_since is not null")
  );

  // ---------------------------------------------------------------------------
  // Backfill and postflight
  // ---------------------------------------------------------------------------
  record(
    "Backfill: managed rows lose any clock; legacy warning/dormant rows return to active (logged); nothing released",
    flat.includes("'lifecycle rollout: managed rows are never dormant.'") &&
      flat.includes("'lifecycle rollout: legacy dormancy state cleared; the placeholder clock restarts.'") &&
      !/update public\.property_lifecycle_states pls set operational_state = 'released'/.test(flat)
  );
  record(
    "Postflight: fingerprints, index, triggers, client grants, no legacy dormancy, no managed clock",
    flat.includes("lifecycle_bounded_dormancy postflight: functions missing or unexpected") &&
      flat.includes("lifecycle_bounded_dormancy postflight: next_evaluation_at index missing") &&
      flat.includes("lifecycle_bounded_dormancy postflight: triggers missing or disabled") &&
      flat.includes("lifecycle_bounded_dormancy postflight: unexpected client execute grants") &&
      flat.includes("a legacy dormancy state remains outside completed chains") &&
      flat.includes("a managed row still has a placeholder clock")
  );

  // ---------------------------------------------------------------------------
  // Allowlists
  // ---------------------------------------------------------------------------
  const allowlist = JSON.parse(read("scripts/secdef-user-rpc-allowlist.json")) as {
    allowlist: { name: string; args: string; reason: string }[];
  };
  const targets = JSON.parse(read("scripts/secdef-service-role-only-targets.json")) as {
    targets: { name: string; args: string }[];
  };
  record(
    "Allowlist: get_property_lifecycle_status(bigint); no can_confirm or chain warning entries",
    allowlist.allowlist.some((e) => e.name === "get_property_lifecycle_status" && e.args === "bigint") &&
      !allowlist.allowlist.some(
        (e) => e.name === "can_confirm_property_still_active" || e.name === "get_chain_dormancy_warning"
      )
  );
  record(
    "Service-role targets: the new internal helpers and worker RPCs",
    [
      ["_property_is_managed", "bigint"],
      ["_property_placeholder_anchor", "bigint"],
      ["_refresh_property_seller_side_state", "bigint"],
      ["_record_placeholder_dependent_activity", "bigint, text"],
      ["_is_placeholder_dependent_side_user", "bigint, uuid"],
      ["can_confirm_property_still_active", "bigint"],
      ["schedule_property_lifecycle_evaluation", "bigint, timestamp with time zone"],
      ["_trg_lifecycle_refresh_seller_side", ""],
      ["_trg_chains_completion_schedule_lifecycle", ""],
      ["get_dormancy_warning_email_recipient", "bigint"],
    ].every(([name, args]) => targets.targets.some((e) => e.name === name && e.args === args)) &&
      !targets.targets.some((e) => e.name === "_reset_dormancy_warning_after_activity")
  );

  // ---------------------------------------------------------------------------
  // Application
  // ---------------------------------------------------------------------------
  const scenarios = read("lib/lifecycle/dormancyScenarios.ts");
  record(
    "Evaluator: missing representation signals count as managed (never planned)",
    scenarios.includes("return context.isManaged ?? true;") && !scenarios.includes("isRepresented")
  );
  record(
    "Evaluator: an expired warning plans expireDormancyWarning, never markDormant",
    /action: PROPERTY_LIFECYCLE_ACTION\.expireDormancyWarning,[\s\S]*?\.\.\.dormantContinuationPlan\(scenario, deadline\)/.test(scenarios) &&
      !scenarios
        .slice(scenarios.indexOf("function expiredWarningPlan"), scenarios.indexOf("export function dormancyWarningDeadline"))
        .includes("markDormant")
  );
  const scheduleTs = read("lib/lifecycle/schedule.ts");
  record(
    "Schedule (app): managed rows are not scheduled; overdue work retries a day later",
    scheduleTs.includes("if (!isPlaceholderForDormancy(context)) {\n    return null;\n  }") &&
      scheduleTs.includes("const RETRY_DAYS = 1;")
  );

  const worker = read("lib/lifecycle/worker.ts");
  const route = read("app/api/cron/property-lifecycle/route.ts");
  record(
    "Worker: candidates with p_limit = batchSize (no growing exclude list); every row rescheduled",
    worker.includes('supabase.rpc("list_property_lifecycle_worker_candidates", {\n      p_limit: batchSize,\n    })') &&
      !worker.includes("excludePropertyIds") &&
      (worker.match(/await scheduleNextEvaluation\(/g) ?? []).length === 4 &&
      worker.includes("stoppedOnRepeatedCandidate")
  );
  record(
    "Worker: a skipped or failed dormancy gate (expire / markDormant) stops the rest of the plan",
    worker.includes("PROPERTY_LIFECYCLE_ACTION.expireDormancyWarning,\n  PROPERTY_LIFECYCLE_ACTION.markDormant,\n]);") &&
      (worker.match(/if \(isDormancyGate\) break;/g) ?? []).length === 2
  );
  const vercel = JSON.parse(read("vercel.json")) as { crons?: { path: string; schedule: string }[] };
  record(
    "Cron: no property-lifecycle schedule; route disabled unless LIFECYCLE_CRON_ENABLED=true (after auth)",
    !(vercel.crons ?? []).some((c) => c.path.includes("property-lifecycle")) &&
      route.includes('if (process.env.LIFECYCLE_CRON_ENABLED !== "true") {') &&
      route.indexOf("process.env.LIFECYCLE_CRON_ENABLED") >
        route.indexOf("isAuthorizedLifecycleCronRequest(authorization)") &&
      route.includes("runPropertyLifecycleWorker(supabase)")
  );
  record(
    "Cron: chain-intelligence runs daily at 05:30",
    (vercel.crons ?? []).some((c) => c.path.includes("chain-intelligence") && c.schedule === "30 5 * * *")
  );

  const loader = read("lib/lifecycle/loadPropertyLifecycleState.ts");
  const panel = read("components/lifecycle/PropertyLifecycleDormancySection.tsx");
  const chainPanel = read("components/lifecycle/ChainLifecycleDormancySection.tsx");
  const buyerReadyPage = read("app/buyer-ready/[chainId]/page.tsx");
  record(
    "Property page panel: one status RPC (get_property_lifecycle_status)",
    loader.includes('"get_property_lifecycle_status"') &&
      !loader.includes("can_confirm_property_still_active") &&
      (panel.match(/loadPropertyLifecycleStatus\(/g) ?? []).length === 1
  );
  record(
    "Buyer Ready page: status loaded only for the viewer's own node's linked property",
    !existsSync(join(ROOT, "lib/lifecycle/loadChainDormancyWarning.ts")) &&
      chainPanel.includes("if (linkedPropertyId === null) {") &&
      buyerReadyPage.includes("workflowNode.user_id === currentUserId") &&
      buyerReadyPage.includes("<ChainLifecycleDormancySection")
  );
  const chainPages = ["app/chain/[chainId]/page.tsx"].filter((path) => existsSync(join(ROOT, path)));
  record(
    "Chain page: no lifecycle call",
    chainPages.length > 0 &&
      chainPages.every(
        (path) => !/@\/lib\/lifecycle\/|components\/lifecycle\/|get_property_lifecycle|DormancySection/.test(read(path))
      )
  );

  const notifications = read("lib/lifecycle/dormancyWarningNotifications.ts");
  record(
    "Notifications: estate_agent recipients get the estate agent email; everyone else the buyer email",
    notifications.includes('recipient.recipient_kind === "estate_agent" ? "estate_agent" : "buyer"')
  );

  const buyerEmail = await renderDormancyWarning({
    to: "recipient@example.com",
    confirmationLink: "https://example.com/property/7?lifecycle=dormancy-warning",
  });
  const eaEmail = await renderDormancyWarning({
    to: "recipient@example.com",
    confirmationLink: "https://example.com/property/7?lifecycle=dormancy-warning",
    audience: "estate_agent",
  });
  record(
    "Email: buyer copy (default) keeps the subject and states confirmation grants no control",
    buyerEmail.subject === "Is your property transaction still active?" &&
      buyerEmail.text.includes("Confirm my transaction is still active") &&
      buyerEmail.text.includes("Confirming does not give you any control over the property."),
    buyerEmail.subject
  );
  record(
    "Email: estate agent copy is about the client's onward purchase and grants no control",
    eaEmail.subject !== buyerEmail.subject &&
      eaEmail.text.includes("onward purchase") &&
      eaEmail.text.includes("Confirming does not give your branch any control over that property.") &&
      eaEmail.html.includes("lifecycle=dormancy-warning"),
    eaEmail.subject
  );

  const failed = results.filter((r) => !r.pass).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed.`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
