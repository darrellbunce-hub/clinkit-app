/**
 * Stage 2 pre-launch proposals (static, offline). Reads the proposed SQL and
 * application patch under docs/prelaunch/stage2/; never connects to a database.
 * Run: npx tsx scripts/verify-prelaunch-stage2-proposals.ts
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const STAGE2 = "docs/prelaunch/stage2";

const ATOMIC = `${STAGE2}/20261021100000_start_move_create_property_atomic.sql`;
const CLEANUP = `${STAGE2}/20261021110000_cleanup_abandoned_onboarding_chain_fail_closed.sql`;
const VISIBILITY = `${STAGE2}/20261021120000_ea_assignment_visibility_seller_side.sql`;
const FORMER_BRANCH = `${STAGE2}/20261021130000_former_branch_scope_and_delink_options.sql`;
const ATTRIBUTION = `${STAGE2}/20261021140000_activity_actor_attribution.sql`;
const PROBES = `${STAGE2}/20261021150000_probe_and_reconnect_confidentiality.sql`;
const APP_PATCH = `${STAGE2}/start-move-atomic-create-app.patch`;
const EXISTENCE = `${STAGE2}/20261021160000_existence_probes_and_helper_grants.sql`;
const CHAINS_GUARD = `${STAGE2}/20261021170000_chains_attribution_guard.sql`;
const A1_PATCH = `${STAGE2}/a1-operational-context-strip-app.patch`;
const B1_PATCH = `${STAGE2}/b1-assignment-error-copy-app.patch`;
const ENTITLEMENT = `${STAGE2}/20261021180000_branch_entitlement_access_revocation.sql`;
const OWN_NODES = `${STAGE2}/20261021190000_chain_nodes_own_view.sql`;
const USER_ID_COLUMNS = `${STAGE2}/20261021200000_shared_chain_user_id_column_privileges.sql`;
const B2_PATCH = `${STAGE2}/b2-shared-chain-user-ids-app.patch`;
const B5_PATCH = `${STAGE2}/b5-branch-access-ended-notice-app.patch`;
const LEGACY_AUDIT = `${STAGE2}/legacy-assignment-audit.development-readonly.sql`;

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

/** SQL with `--` comments removed, so checks only see executable text. */
function code(sql: string): string {
  return sql
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

function functionBody(sql: string, name: string): string {
  const match = new RegExp(
    `create (?:or replace )?function public\\.${name}\\([\\s\\S]*?\\bas \\$\\$([\\s\\S]*?)\\n\\$\\$;`
  ).exec(sql);
  return match?.[1] ?? "";
}

function definerHeader(sql: string, name: string): string {
  const match = new RegExp(`create (?:or replace )?function public\\.${name}\\([\\s\\S]*?\\bas \\$\\$`).exec(sql);
  return match?.[0] ?? "";
}

function checkCommon(label: string, raw: string, functions: { name: string; args: string }[]) {
  const sql = code(raw);

  assert(raw.startsWith("-- PROPOSED — NOT APPLIED."), `${label}: marked PROPOSED — NOT APPLIED`);
  const preflight = sql.indexOf("do $$");
  const firstDdl = sql.search(/\b(create|drop) (or replace )?(function|policy)/);
  assert(preflight > -1 && preflight < firstDdl, `${label}: preflight DO block runs before any DDL`);
  assert(!/\bgrant\b[^;]*\bto\b[^;]*\b(anon|public)\b/i.test(sql), `${label}: nothing granted to anon or public`);
  assert(!/\bsecurity invoker\b/.test(sql), `${label}: no SECURITY INVOKER functions`);

  for (const fn of functions) {
    const header = definerHeader(sql, fn.name);
    const signature = `public.${fn.name}(${fn.args})`;
    assert(
      /\bsecurity definer\b/.test(header) && /\bset search_path = public\b/.test(header),
      `${label}: ${fn.name} is SECURITY DEFINER with search_path = public`
    );
    assert(sql.includes(`alter function ${signature} owner to postgres;`), `${label}: ${fn.name} owned by postgres`);
    assert(
      sql.includes(`revoke all on function ${signature} from public, anon;`) &&
        sql.includes(`grant execute on function ${signature} to authenticated, service_role;`),
      `${label}: ${fn.name} executable by authenticated and service_role only`
    );
  }
}

// ---------------------------------------------------------------------------
// Proposals stay out of supabase/migrations
// ---------------------------------------------------------------------------

const migrationFiles = readdirSync(join(ROOT, "supabase/migrations"));
for (const proposal of [ATOMIC, CLEANUP, VISIBILITY, FORMER_BRANCH, ATTRIBUTION, PROBES, EXISTENCE, CHAINS_GUARD, ENTITLEMENT, OWN_NODES, USER_ID_COLUMNS, LEGACY_AUDIT]) {
  const fileName = proposal.split("/").pop()!;
  assert(existsSync(join(ROOT, proposal)), `proposal present: ${fileName}`);
  assert(!migrationFiles.includes(fileName), `not promoted into supabase/migrations: ${fileName}`);
}
assert(
  !migrationFiles.some((file) => read(`supabase/migrations/${file}`).includes("start_move_create_property")),
  "no applied migration defines or references start_move_create_property"
);
const latestMigration = migrationFiles.filter((file) => /^\d{14}_/.test(file)).sort().pop() ?? "";
assert(
  latestMigration.slice(0, 14) < "20261021100000",
  "proposal versions sort after every existing migration"
);

// ---------------------------------------------------------------------------
// start_move_create_property
// ---------------------------------------------------------------------------

{
  const raw = read(ATOMIC);
  const sql = code(raw);
  const body = functionBody(sql, "start_move_create_property");

  checkCommon("atomic create", raw, [
    { name: "start_move_create_property", args: "bigint, text, text, text, boolean" },
  ]);

  assert(
    /^create function public\.start_move_create_property\(/m.test(sql) &&
      sql.includes("to_regprocedure('public.start_move_create_property(bigint, text, text, text, boolean)') is not null"),
    "atomic create: additive (plain CREATE, preflight refuses if it already exists)"
  );
  assert(
    !/\b(create or replace|drop) function\b/.test(sql) && !/\b(alter|drop|create) (table|policy|trigger)\b/.test(sql),
    "atomic create: replaces no function and changes no table, policy or trigger"
  );

  const order = [
    "public._require_verified_email_for_transaction()",
    "v_uid := auth.uid();",
    "public._is_estate_agent_account(v_uid)",
    "p_relationship_type not in ('sale', 'purchase')",
    "v_address is null or v_postcode is null",
    "for update;",
    "v_chain.created_by_user_id is distinct from v_uid",
    "public.caller_may_place_property_in_chain(p_chain_id)",
    "public.caller_owns_unshared_chain(p_chain_id)",
    "p.relationship_type = p_relationship_type",
    "public.property_exists_for_onboarding(v_address, v_postcode, null)",
    "insert into public.properties (",
    "public._establish_operational_homeowner_core(",
  ].map((needle) => body.indexOf(needle));
  assert(
    order.every((index, i) => index > -1 && (i === 0 || index > order[i - 1])),
    "atomic create: email gate, auth, EA refusal, input checks, chain lock, creator/placement/unshared, one-per-side, duplicate address, then insert and grant"
  );

  const insertValues = /values \(([\s\S]*?)\)\s*returning id into v_property_id;/.exec(body)?.[1] ?? "";
  const valueLines = insertValues
    .split(",\n")
    .map((value) => value.trim())
    .filter(Boolean);
  assert(
    valueLines[0] === "p_chain_id" && valueLines[7] === "v_uid" && !/p_created|p_user/.test(sql),
    "atomic create: creator is auth.uid(), never a parameter"
  );
  assert(!/linked_property_id/.test(body), "atomic create: never sets linked_property_id");
  assert(
    /v_grant := public\._establish_operational_homeowner_core\(\s*v_property_id,\s*v_uid,\s*'start_move',\s*false\s*\);/.test(body),
    "atomic create: grants the caller's identity via _establish_operational_homeowner_core(…, 'start_move', false)"
  );

  const block = /\n  begin\n([\s\S]*?)\n  exception\n([\s\S]*?)\n  end;/.exec(body);
  const handlers = block?.[2] ?? "";
  assert(
    (block?.[1] ?? "").includes("insert into public.properties (") &&
      (block?.[1] ?? "").includes("_establish_operational_homeowner_core(") &&
      /raise exception using\s*errcode = 'P0001',\s*message = 'start_move_create_property_grant_failed'/.test(block?.[1] ?? ""),
    "atomic create: insert and grant share one subtransaction; a failed grant raises inside it"
  );
  assert(
    /when unique_violation then[\s\S]*?if v_error = 'property_address_reserved' then\s*return jsonb_build_object\('ok', false, 'error', 'address_reserved'\);\s*end if;\s*raise;/.test(handlers) &&
      /when raise_exception then[\s\S]*?if v_error = 'start_move_create_property_grant_failed' then[\s\S]*?return jsonb_build_object\('ok', false, 'error', v_error\);\s*end if;\s*raise;/.test(handlers),
    "atomic create: only the reservation refusal and its own grant failure are caught; everything else re-raises"
  );
  assert(!/\bwhen others\b/.test(body), "atomic create: no WHEN OTHERS handler");
  assert(!/\b(update public\.|delete from)\b/.test(body), "atomic create: no UPDATE or DELETE statements");
}

// ---------------------------------------------------------------------------
// cleanup_abandoned_onboarding_chain
// ---------------------------------------------------------------------------

{
  const raw = read(CLEANUP);
  const sql = code(raw);
  const body = functionBody(sql, "cleanup_abandoned_onboarding_chain");

  checkCommon("cleanup", raw, [{ name: "cleanup_abandoned_onboarding_chain", args: "bigint, boolean" }]);

  assert(
    /create or replace function public\.cleanup_abandoned_onboarding_chain\(\s*p_chain_id bigint,\s*p_require_empty boolean default false\s*\)/.test(sql),
    "cleanup: same signature and default, so existing callers and grants keep working"
  );
  assert(!body.includes("p_require_empty"), "cleanup: p_require_empty is ignored (every call is empty-only)");
  assert(
    sql.includes("%caller_owns_unshared_chain(p_chain_id)%delete from public.properties%") &&
      sql.includes("k.confrelid = 'public.chains'::regclass") &&
      sql.includes("unexpected foreign key to chains"),
    "cleanup: preflight fingerprints the current body and refuses unknown foreign keys to chains"
  );

  const deletes = [...body.matchAll(/delete from public\.(\w+)/g)].map((match) => match[1]);
  assert(
    JSON.stringify(deletes) ===
      JSON.stringify(["chain_operational_refresh_queue", "chain_operational_summary", "property_operational_summary", "chains"]),
    "cleanup: deletes only the chain's derived caches and the chain itself"
  );
  assert(
    !/delete from public\.(properties|property_members|activities|chain_nodes|property_\w*events|chain_completion_events|operational_delays|email_events)\b/.test(body),
    "cleanup: never deletes properties, memberships, activities, nodes or history"
  );
  assert(
    /delete from public\.chains\s*where id = p_chain_id\s*and created_by_user_id = v_uid;/.test(body),
    "cleanup: chain delete is scoped to the caller as creator"
  );

  const firstDelete = body.indexOf("delete from");
  const guards = [
    "v_uid is null",
    "for update;",
    "v_chain.created_by_user_id is distinct from v_uid",
    "from public.properties p where p.chain_id = p_chain_id",
    "from public.chain_nodes n where n.chain_id = p_chain_id",
    "'chain_not_empty'",
    "from public.chain_completion_events e",
    "from public.operational_delays d",
    "from public.property_delink_events e",
    "from public.property_lifecycle_still_active_confirmations c",
    "from public.email_events e",
    "'chain_has_history'",
  ].map((needle) => body.indexOf(needle));
  assert(
    guards.every((index) => index > -1 && index < firstDelete),
    "cleanup: auth, chain lock, ownership, empty and history checks all precede the first delete"
  );
  assert(!/\b(update public\.|insert into)\b/.test(body), "cleanup: no UPDATE or INSERT statements");
}

// ---------------------------------------------------------------------------
// Estate Agent assignment visibility
// ---------------------------------------------------------------------------

/** Collapses whitespace so clause checks ignore indentation and line breaks. */
function squash(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function policyBlock(sql: string, name: string): string {
  return squash(new RegExp(`create policy ${name}\\b[\\s\\S]*?\\n  \\);`).exec(sql)?.[0] ?? "");
}

// Exact predicate text. The model below implements these clauses one-to-one,
// so a change to the SQL fails here before the model can drift from it.
const CLAUSE = {
  assignmentsActiveOnly: "using ( property_ea_assignments.status = 'active' and ( public.is_property_seller_side_homeowner(property_id)",
  assignmentsOwnBranch:
    "or exists ( select 1 from public.ea_branch_members bm where bm.branch_id = property_ea_assignments.branch_id and bm.user_id = auth.uid() ) ) );",
  entryActiveOnly: "and a.property_id = p_property_id and a.status = 'active'",
  entryAudience:
    "public.is_property_seller_side_homeowner(a.property_id) or exists ( select 1 from public.ea_branch_members bm where bm.branch_id = a.branch_id and bm.user_id = auth.uid() )",
  delinkActor: "using ( property_delink_events.actor_user_id = auth.uid() or (",
  delinkNoBranch: "coalesce(property_delink_events.metadata ->> 'branch_id', '') = '' and (",
  delinkNoBranchHolders:
    "exists ( select 1 from public.property_operational_identities poi where poi.property_id = property_delink_events.property_id and poi.homeowner_user_id = auth.uid() and poi.status = 'active' )",
  delinkNoBranchStaff: "or public.is_ea_assigned_to_property(property_delink_events.property_id) ) )",
  delinkWithBranch: "coalesce(property_delink_events.metadata ->> 'branch_id', '') <> '' and (",
  delinkWithBranchAudience:
    "public.is_property_seller_side_homeowner(property_delink_events.property_id) or exists ( select 1 from public.ea_branch_members bm where bm.user_id = auth.uid() and bm.branch_id::text = property_delink_events.metadata ->> 'branch_id' )",
  claimAudience:
    "using ( public.is_property_seller_side_homeowner(property_id) or public.is_ea_assigned_to_property(property_id) );",
};

{
  const raw = read(VISIBILITY);
  const sql = code(raw);
  const flat = squash(sql);
  const body = squash(functionBody(sql, "get_property_ea_branch_entry"));
  const assignments = policyBlock(sql, "property_ea_assignments_select_scope");
  const delink = policyBlock(sql, "property_delink_events_select_involved");
  const claim = policyBlock(sql, "property_claim_metadata_select_scope");

  checkCommon("visibility", raw, [{ name: "get_property_ea_branch_entry", args: "bigint" }]);

  assert(
    assignments.includes("on public.property_ea_assignments for select to authenticated using (") &&
      assignments.includes(CLAUSE.assignmentsActiveOnly) &&
      assignments.includes(CLAUSE.assignmentsOwnBranch) &&
      !assignments.includes("is_property_member") &&
      !assignments.includes("is_property_operational_participant"),
    "visibility: only active assignment rows, readable only by the seller-side homeowner or the assigned branch's staff"
  );
  assert(
    !delink
      .slice(delink.indexOf(CLAUSE.delinkNoBranch), delink.indexOf(CLAUSE.delinkWithBranch))
      .includes("from public.property_ea_assignments"),
    "visibility: events without a branch are no longer opened to staff of any branch ever assigned"
  );
  assert(
    body.includes("where auth.uid() is not null") &&
      body.includes(CLAUSE.entryActiveOnly) &&
      body.includes(CLAUSE.entryAudience) &&
      !body.includes("is_property_member") &&
      !body.includes("is_property_operational_participant"),
    "visibility: get_property_ea_branch_entry returns names only to the seller-side homeowner or the assigned branch"
  );
  assert(
    delink.includes("on public.property_delink_events for select to authenticated") &&
      delink.includes(CLAUSE.delinkActor) &&
      delink.includes(CLAUSE.delinkNoBranch) &&
      delink.includes(CLAUSE.delinkNoBranchHolders) &&
      delink.includes(CLAUSE.delinkNoBranchStaff) &&
      delink.includes(CLAUSE.delinkWithBranch) &&
      delink.includes(CLAUSE.delinkWithBranchAudience),
    "visibility: delink events that identify a branch are readable only by the actor, the seller-side homeowner and that branch"
  );
  assert(
    delink.indexOf(CLAUSE.delinkWithBranch) > -1 &&
      !delink.slice(delink.indexOf(CLAUSE.delinkWithBranch)).includes("property_operational_identities") &&
      !delink.slice(delink.indexOf(CLAUSE.delinkWithBranch)).includes("property_ea_assignments"),
    "visibility: branch-identifying delink events are not opened to identity holders or other branches"
  );
  assert(
    claim.includes("on public.property_claim_metadata for select to authenticated") &&
      claim.includes(CLAUSE.claimAudience) &&
      !claim.includes("is_property_member"),
    "visibility: claim metadata (seller's invite name and email) readable only by the seller side or the actively assigned branch"
  );

  assert(
    flat.includes("v_qual not like '%is_property_member(property_id)%'") &&
      flat.includes("pol.policyname <> 'property_ea_assignments_select_scope'") &&
      flat.includes("v_src not like '%public.is_property_member(a.property_id)%'") &&
      flat.includes("v_qual not like '%poi.homeowner_user_id = auth.uid()%'") &&
      flat.includes("v_qual not like '%bm.user_id = auth.uid()%'") &&
      flat.includes("pol.policyname <> 'property_delink_events_select_involved'") &&
      flat.includes("v_qual not like '%is_ea_assigned_to_property(property_id)%'") &&
      flat.includes("pol.policyname <> 'property_claim_metadata_select_scope'"),
    "visibility: preflight fingerprints all three current policies and the function, and refuses extra policies"
  );
  assert(
    flat.includes("p.prosrc ilike '%insert into public.property_delink_events%'") &&
      flat.includes("p.prosrc ~* 'branch'") &&
      flat.includes("p.prosrc not like '%''branch_id''%'"),
    "visibility: preflight refuses to install if a live delink writer records a branch under another key"
  );
  assert(
    !/\b(grant|revoke)\b[^;]*\bon (table )?public\.(property_ea_assignments|property_delink_events|property_claim_metadata)\b/.test(
      sql
    ) &&
      !/\b(insert into|update public\.|delete from)\b/.test(sql.replace(/do \$\$[\s\S]*?\n\$\$;/, "")) &&
      (sql.match(/\bcreate policy\b/g) ?? []).length === 3 &&
      (flat.match(/\bfor select to authenticated\b/g) ?? []).length === 3,
    "visibility: three SELECT-only policies, no table grants changed, no rows changed"
  );
  assert(
    !/\b(activities|chain_operational_summary|property_operational_summary|ea_branch_directory)\b/.test(sql),
    "visibility: generic status and timeline paths (activities, summaries) and the public directory are untouched"
  );

  // Every delink writer in the migration history keys branch identity as
  // metadata.branch_id, which is the key the new policy relies on.
  const branchKeys = new Set<string>();
  for (const file of migrationFiles.filter((name) => name.endsWith(".sql"))) {
    const text = read(`supabase/migrations/${file}`);
    for (const match of text.matchAll(/insert into public\.property_delink_events[\s\S]*?\);/g)) {
      for (const key of match[0].matchAll(/'([a-z_]*branch[a-z_]*)'/g)) branchKeys.add(key[1]);
    }
  }
  assert(
    branchKeys.size > 0 && [...branchKeys].every((key) => key === "branch_id"),
    `visibility: migration delink writers use only metadata.branch_id for branch identity (found: ${[...branchKeys].join(", ") || "none"})`
  );

  // Generic attribution stays a role label, never a person or branch.
  const permission = read("lib/mutationPermission.ts");
  assert(
    /export function resolveActivityUpdaterRole\(\s*accountType: AccountType \| null \| undefined\s*\): "homeowner" \| "estate_agent" \{/.test(
      permission
    ),
    "visibility: timeline attribution is the generic role label (homeowner / estate_agent)"
  );

  // "Branch Access Ended" (Business Rules 19.23, 25.27, 25.33, 25.35) is not
  // implemented. If it appears in code it must be reviewed before it can ship:
  // the notice may reach only the represented homeowner and authorised staff
  // of the affected branch, never the chain-wide timeline or
  // _notify_chain_participants_of_delink.
  const sourceDirs = ["app", "components", "lib", "emails", "supabase/migrations"];
  const hits: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(rel);
      else if (/\.(ts|tsx|sql)$/.test(entry.name) && /branch access ended/i.test(read(rel))) hits.push(rel);
    }
  };
  for (const dir of sourceDirs) if (existsSync(join(ROOT, dir))) walk(dir);
  // The B5 notice module (reviewed) is the only permitted mention: it reads
  // the caller's own delink event and writes nothing.
  const reviewedNoticeModule = "lib/estateAgent/branchAccessNotice.ts";
  const noticeModule = hits.includes(reviewedNoticeModule) ? read(reviewedNoticeModule) : "";
  assert(
    hits.every((hit) => hit === reviewedNoticeModule) &&
      (noticeModule === "" ||
        (/\.from\("property_delink_events"\)\s*\.select\("reason_code"\)/.test(noticeModule) &&
          (noticeModule.match(/\.from\(/g) ?? []).length === 1 &&
          !/\.(insert|update|upsert|delete|rpc)\(/.test(noticeModule) &&
          !/activities|notif|_notify_chain_participants_of_delink|sendEmail|emails\/|resend/i.test(noticeModule))),
    `visibility: "Branch Access Ended" appears only in the reviewed B5 notice module, which reads its own delink event and writes no timeline entry, notification or email (found: ${hits.join(", ") || "none"})`
  );
  assert(
    !/branch access ended/i.test(sql),
    'visibility: proposal does not add a "Branch Access Ended" notice'
  );
}

/**
 * True when `proposal` equals `source` after applying each [from, to] pair
 * exactly once, i.e. the proposal is a verbatim copy apart from the listed
 * edits.
 */
function verbatimExcept(proposal: string, source: string, edits: [string, string][]): boolean {
  let expected = source;
  for (const [from, to] of edits) {
    if (expected.split(from).length !== 2) return false;
    expected = expected.replace(from, to);
  }
  return proposal === expected;
}

function textBlock(text: string, start: string, end: string): string {
  const i = text.indexOf(start);
  if (i < 0 || text.indexOf(start, i + 1) >= 0) return "";
  const j = text.indexOf(end, i);
  return j < 0 ? "" : text.slice(i, j + end.length);
}

const AUTH_MIGRATION = read("supabase/migrations/20261005120000_operational_authority_enforcement.sql");
const OI_MIGRATION = read("supabase/migrations/20261006120000_operational_intelligence_refresh_queue.sql");

// ---------------------------------------------------------------------------
// Former-branch scope and get_participation_delink_options (20261021130000)
// ---------------------------------------------------------------------------

{
  const raw = read(FORMER_BRANCH);
  const sql = code(raw);
  const flat = squash(sql);

  checkCommon("former branch", raw, [
    { name: "is_property_creator_bootstrap_viewer", args: "bigint" },
    { name: "get_participation_delink_options", args: "bigint" },
  ]);

  const lifecycle = policyBlock(sql, "property_lifecycle_states_select_participant");
  assert(
    lifecycle ===
      "create policy property_lifecycle_states_select_participant on public.property_lifecycle_states for select to authenticated using ( public.is_property_operational_participant(property_id) );",
    "former branch: lifecycle states readable only by current operational participants (no branch-ever-assigned clause)"
  );

  const viewStart = "create or replace view public.agent_branch_property_summaries";
  const viewEnd = "grant select on public.agent_branch_property_summaries to authenticated;";
  assert(
    verbatimExcept(textBlock(raw, viewStart, viewEnd), textBlock(OI_MIGRATION, viewStart, viewEnd), [
      ["  and pea.status in ('active', 'revoked');", "  and pea.status = 'active';"],
      [
        "activity_clock_at is the live staleness clock: genuine activity, else the documented fallback.';",
        "activity_clock_at is the live staleness clock: genuine activity, else the documented fallback. Business Rules 24.7: active assignments only; revoked assignments are retained for audit but not shown to the former branch.';",
      ],
    ]),
    "former branch: branch dashboard view is the 20261006120000 view verbatim except active assignments only"
  );

  const creator = squash(functionBody(sql, "is_property_creator_bootstrap_viewer"));
  assert(
    creator.includes("select auth.uid() is not null") &&
      creator.includes("p.created_by_user_id = auth.uid()") &&
      creator.includes("not exists ( select 1 from public.property_members pm where pm.property_id = p.id )") &&
      creator.includes("not exists ( select 1 from public.property_ea_assignments pea where pea.property_id = p.id )") &&
      creator.includes("not exists ( select 1 from public.property_operational_identities poi where poi.property_id = p.id )") &&
      creator.includes("not exists ( select 1 from public.property_delink_events pde where pde.property_id = p.id )"),
    "former branch: creator bootstrap applies only to the caller's own row before any member and before any EA assignment"
  );
  assert(
    !/\b(status|revoked|active)\b/.test(creator) &&
      flat.includes("to_regclass('public.property_operational_identities') is null") &&
      flat.includes("to_regclass('public.property_delink_events') is null"),
    "former branch: any identity row (whatever its status) or delink event ends the creator bootstrap, so a creator who left keeps nothing; preflight requires both tables"
  );
  assert(
    policyBlock(sql, "properties_select_member_or_agent") ===
      "create policy properties_select_member_or_agent on public.properties for select to authenticated using ( public.is_property_member(id) or public.is_ea_assigned_to_property(id) or public.is_property_creator_bootstrap_viewer(id) );",
    "former branch: property rows readable by members, the actively assigned branch, or the bootstrap creator only"
  );

  const optionsStart = "create or replace function public.get_participation_delink_options(";
  const optionsEnd = "grant execute on function public.get_participation_delink_options(bigint) to authenticated";
  const optionsSource = textBlock(AUTH_MIGRATION, optionsStart, optionsEnd + ";");
  const optionsProposal = textBlock(raw, optionsStart, optionsEnd + ", service_role;");
  const gate = `  -- Business Rules 3.4 / 19.23: only the operational homeowner, the
  -- seller-side homeowner and the actively assigned branch learn anything.
  -- Everyone else, and every id that does not exist, gets the same empty
  -- answer, so the RPC is not an existence, invitation or branch oracle.
  if not (
    coalesce(v_is_homeowner, false)
    or coalesce(v_is_seller_side_homeowner, false)
    or v_caller_branch_id is not null
  ) then
    return jsonb_build_object(
      'ok', true,
      'property_id', p_property_id,
      'options', '[]'::jsonb,
      'signals', jsonb_build_object(
        'invitation_pending', false,
        'meaningful_participation', false,
        'is_operational_homeowner', false
      )
    );
  end if;

`;
  assert(
    verbatimExcept(optionsProposal, optionsSource, [
      [
        `  if not exists (
    select 1 from public.properties p where p.id = p_property_id
  ) then
    return jsonb_build_object('ok', false, 'error', 'property_not_found');
  end if;

`,
        "",
      ],
      ["  v_invitation_pending :=\n", `${gate}  v_invitation_pending :=\n`],
      [
        `      'invitation_pending', v_invitation_pending,
      'meaningful_participation', v_meaningful,`,
        `      -- Invitation and participation signals describe the seller side; the
      -- buyer who holds a purchase row gets only their own leave option.
      'invitation_pending',
        (coalesce(v_is_seller_side_homeowner, false) or v_caller_branch_id is not null)
        and v_invitation_pending,
      'meaningful_participation',
        (coalesce(v_is_seller_side_homeowner, false) or v_caller_branch_id is not null)
        and v_meaningful,`,
      ],
      [
        "estate_agent_remove_homeowner for the assigned branch per _ea_homeowner_withdrawal_status.';",
        "estate_agent_remove_homeowner for the assigned branch per _ea_homeowner_withdrawal_status. Callers with none of these roles, and unknown ids, receive an identical empty result (no existence, invitation or branch signal).';",
      ],
      [
        "revoke all on function public.get_participation_delink_options(bigint) from public, anon;\ngrant execute on function public.get_participation_delink_options(bigint) to authenticated;",
        "alter function public.get_participation_delink_options(bigint) owner to postgres;\n\nrevoke all on function public.get_participation_delink_options(bigint) from public, anon;\ngrant execute on function public.get_participation_delink_options(bigint) to authenticated, service_role;",
      ],
    ]),
    "delink options: 20261005120000 body verbatim except the authorisation gate, seller-side signals, comment and grants"
  );
  const options = functionBody(sql, "get_participation_delink_options");
  const gateAt = options.indexOf("or v_caller_branch_id is not null\n  ) then");
  assert(
    !options.includes("property_not_found") &&
      gateAt > options.indexOf("into v_caller_branch_id") &&
      ["property_invitation_is_pending", "homeowner_has_meaningful_participation", "_ea_homeowner_withdrawal_status", "jsonb_build_array"].every(
        (needle) => options.indexOf(needle) > gateAt
      ),
    "delink options: no existence error; the gate runs before any invitation, participation or option is computed"
  );

  assert(
    flat.includes("v_qual not like '%is_property_operational_participant(property_id)%'") &&
      flat.includes("v_qual like '%status%'") &&
      flat.includes("pol.policyname <> 'property_lifecycle_states_select_participant'") &&
      flat.includes("v_def not like '%''revoked''::text%'") &&
      flat.includes("'security_invoker=false' = any") &&
      flat.includes("v_qual not like '%property_has_any_member(id)%'") &&
      flat.includes("pol.policyname <> 'properties_select_member_or_agent'") &&
      flat.includes("v_src not like '%''property_not_found''%'") &&
      flat.includes("v_src not like '%public._ea_homeowner_withdrawal_status(p_property_id)%'"),
    "former branch: preflight fingerprints the lifecycle and property policies, the dashboard view and the options body, and refuses extra read policies"
  );
  assert(
    (sql.match(/\bcreate policy\b/g) ?? []).length === 2 &&
      (flat.match(/\bfor select to authenticated\b/g) ?? []).length === 2 &&
      !/\b(grant|revoke)\b[^;]*\bon (table )?public\.(properties|property_lifecycle_states|property_ea_assignments)\b/.test(sql) &&
      !/\b(insert into|update public\.|delete from)\b/.test(sql.replace(/do \$\$[\s\S]*?\n\$\$;/, "")),
    "former branch: two SELECT-only policies, no table grants changed, no rows changed"
  );

  // Legitimate callers render nothing for an empty option list and never
  // read the signals, so the uniform empty answer changes nothing for them.
  const panel = read("components/participation/ParticipationDelinkPanel.tsx");
  const quick = read("components/participation/ParticipationDelinkQuickActions.tsx");
  const signalReaders: string[] = [];
  const scan = (dir: string) => {
    for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) scan(rel);
      else if (
        /\.(ts|tsx)$/.test(entry.name) &&
        rel !== "lib/ownership/participationDelink.ts" &&
        /\.signals\b/.test(read(rel))
      ) {
        signalReaders.push(rel);
      }
    }
  };
  for (const dir of ["app", "components", "context", "lib"]) if (existsSync(join(ROOT, dir))) scan(dir);
  assert(
    /if \(options\.length === 0\) \{\s*return null;\s*\}/.test(panel) &&
      /if \(!data\.ok\) \{\s*setOptions\(\[\]\);/.test(quick) &&
      signalReaders.length === 0,
    `delink options: the panel renders nothing for an empty list and no app code reads the signals (readers: ${signalReaders.join(", ") || "none"})`
  );
}

// ---------------------------------------------------------------------------
// Activity actor attribution (20261021140000, separate security fix)
// ---------------------------------------------------------------------------

{
  const raw = read(ATTRIBUTION);
  const sql = code(raw);
  const flat = squash(sql);

  assert(raw.startsWith("-- PROPOSED — NOT APPLIED."), "attribution: marked PROPOSED — NOT APPLIED");
  assert(
    sql.indexOf("do $$") > -1 && sql.indexOf("do $$") < sql.search(/\b(create|drop) (or replace )?(function|policy|trigger)/),
    "attribution: preflight DO block runs before any DDL"
  );
  assert(!/\bgrant\b[^;]*\bto\b[^;]*\b(anon|public)\b/i.test(sql), "attribution: nothing granted to anon or public");

  const role = squash(functionBody(sql, "_activity_actor_role"));
  assert(
    /\bsecurity invoker\b/.test(definerHeader(sql, "_activity_actor_role")) &&
      role ===
        "select case when p_property_id is not null and not public.is_property_seller_side_homeowner(p_property_id) and public.is_ea_assigned_to_property(p_property_id) then 'estate_agent' else 'homeowner' end;",
    "attribution: label derived from authority on the property (assigned branch and not the seller side -> estate_agent, else homeowner)"
  );
  // The preflight fingerprints the current account_type-based bodies; nothing
  // that is installed may read profiles.
  const preflightBlock = /do \$\$[\s\S]*?\n\$\$;/.exec(sql)?.[0] ?? "";
  const installed = sql.replace(preflightBlock, "");
  assert(
    preflightBlock.length > 0 &&
      (sql.match(/\bdo \$\$/g) ?? []).length === 1 &&
      !/\baccount_type\b/.test(installed) &&
      !/\bfrom public\.profiles\b/.test(installed) &&
      preflightBlock
        .split("\n")
        .filter((line) => /\baccount_type\b/.test(line))
        .every((line) => /^\s*(if|or) v_src not like '%when p\.account_type = ''estate_agent'' then ''estate_agent''%'$/.test(line)),
    "attribution: never derived from profiles.account_type (client-writable); account_type appears only in the preflight fingerprints"
  );
  assert(
    sql.includes("alter function public._activity_actor_role(bigint) owner to postgres;") &&
      sql.includes("revoke all on function public._activity_actor_role(bigint) from public, anon;") &&
      sql.includes("grant execute on function public._activity_actor_role(bigint) to authenticated, service_role;"),
    "attribution: _activity_actor_role owned by postgres, executable by authenticated and service_role only"
  );

  const trigger = squash(functionBody(sql, "_trg_activities_enforce_actor_attribution"));
  assert(
    /\bsecurity invoker\b/.test(definerHeader(sql, "_trg_activities_enforce_actor_attribution")) &&
      trigger ===
        "begin if current_user = 'authenticated' then new.updated_by := public._activity_actor_role(new.property_id); end if; return new; end;",
    "attribution: direct client inserts always get the derived label; owner-run server writes keep their own"
  );
  assert(
    flat.includes(
      "create trigger trg_activities_enforce_actor_attribution before insert on public.activities for each row execute function public._trg_activities_enforce_actor_attribution();"
    ) && sql.includes("revoke all on function public._trg_activities_enforce_actor_attribution() from public, anon, authenticated;"),
    "attribution: BEFORE INSERT trigger on activities; trigger function not executable by end users"
  );

  const actorLine = "  v_actor_role := nullif(btrim(coalesce(p_actor_role, '')), '');";
  const reportEnd = "Buyer Ready targets require the node owner.';";
  const reportStart = "create or replace function public.report_operational_delay(";
  const resolveStart = "create or replace function public.resolve_operational_delay(";
  const ignored = " Actor label is derived by _activity_actor_role; p_actor_role is accepted for compatibility and ignored.";
  const reportProposalEnd = `Buyer Ready targets require the node owner.${ignored} Unknown and foreign targets both return forbidden.';`;
  const resolveProposalEnd = `Buyer Ready targets require the node owner.${ignored} Unknown and foreign delays both return forbidden; the idempotent answer is given only to callers who may resolve.';`;
  const idempotent = `  -- Idempotent: already resolved — do not corrupt state or insert duplicate activity.
  if v_delay.status = 'resolved' then
    return jsonb_build_object(
      'ok', true,
      'delay_id', v_delay.id,
      'status', 'resolved',
      'reason', v_delay.reason,
      'resolved_at', v_delay.resolved_at,
      'already_resolved', true
    );
  end if;
`;
  const forbidden = "return jsonb_build_object('ok', false, 'error', 'forbidden');";
  assert(
    verbatimExcept(textBlock(raw, reportStart, reportProposalEnd), textBlock(AUTH_MIGRATION, reportStart, reportEnd), [
      [actorLine, "  v_actor_role := public._activity_actor_role(p_property_id);"],
      [
        `    if not found then
      return jsonb_build_object('ok', false, 'error', 'property_not_found');
    end if;

    if not public.can_operate_property(p_property_id) then
      ${forbidden}
    end if;`,
        `    if not found or not public.can_operate_property(p_property_id) then
      ${forbidden}
    end if;`,
      ],
      [
        `    if not found then
      return jsonb_build_object('ok', false, 'error', 'chain_node_not_found');
    end if;

    if v_node.node_type is distinct from 'buyer_ready' then
      return jsonb_build_object('ok', false, 'error', 'invalid_target');
    end if;

    if v_node.user_id is distinct from v_uid then
      ${forbidden}
    end if;`,
        `    if not found or v_node.user_id is distinct from v_uid then
      ${forbidden}
    end if;

    if v_node.node_type is distinct from 'buyer_ready' then
      return jsonb_build_object('ok', false, 'error', 'invalid_target');
    end if;`,
      ],
      [reportEnd, reportProposalEnd],
    ]),
    "attribution: report_operational_delay is the 20261005120000 body verbatim except the derived label and the merged not-found / authorisation checks"
  );
  assert(
    verbatimExcept(textBlock(raw, resolveStart, resolveProposalEnd), textBlock(AUTH_MIGRATION, resolveStart, reportEnd), [
      [actorLine, "  v_actor_role := public._activity_actor_role(v_delay.property_id);"],
      [
        `  if not found then
    return jsonb_build_object('ok', false, 'error', 'delay_not_found');
  end if;

${idempotent}
`,
        `  if not found then
    ${forbidden}
  end if;

`,
      ],
      [`  if not v_allowed then\n    ${forbidden}\n  end if;\n`, `  if not v_allowed then\n    ${forbidden}\n  end if;\n\n${idempotent}`],
      [reportEnd, resolveProposalEnd],
    ]),
    "attribution: resolve_operational_delay is the 20261005120000 body verbatim except the derived label, forbidden for unknown ids, and the idempotent answer after authorisation"
  );

  const report = functionBody(sql, "report_operational_delay");
  const resolve = functionBody(sql, "resolve_operational_delay");
  assert(
    !/_not_found'/.test(report) &&
      !/_not_found'/.test(resolve) &&
      resolve.indexOf("if not v_allowed then") > -1 &&
      resolve.indexOf("if not v_allowed then") < resolve.indexOf("'already_resolved', true") &&
      resolve.indexOf("if not v_allowed then") < resolve.indexOf("'reason', v_delay.reason") &&
      resolve.indexOf("if not v_allowed then") < resolve.indexOf("'resolved_at', v_delay.resolved_at"),
    "attribution: delay RPCs return the same error for unknown and foreign targets; a resolved delay's reason and time are returned only after authorisation"
  );

  const breakStart = "create or replace function public.break_chain_connection(";
  const breakEnd = "Authorised by can_operate_property; same-chain updates only.';";
  const accountTypeLabel = `  select case
    when p.account_type = 'estate_agent' then 'estate_agent'
    else 'homeowner'
  end
  into v_updated_by
  from public.profiles p
  where p.id = auth.uid();

  v_updated_by := coalesce(v_updated_by, 'homeowner');`;
  const breakProposalEnd =
    "Authorised by can_operate_property; same-chain updates only. Unknown and foreign ids both return not_authorized. Actor label is derived by _activity_actor_role.';";
  assert(
    verbatimExcept(textBlock(raw, breakStart, breakProposalEnd), textBlock(AUTH_MIGRATION, breakStart, breakEnd), [
      [accountTypeLabel, "  v_updated_by := public._activity_actor_role(v_property.id);"],
      [
        `  if v_property.id is null then
    return jsonb_build_object('ok', false, 'error', 'property_not_found');
  end if;

  if not public.can_operate_property(v_property.id) then`,
        "  if v_property.id is null or not public.can_operate_property(v_property.id) then",
      ],
      [breakEnd, breakProposalEnd],
    ]),
    "attribution: break_chain_connection is the 20261005120000 body verbatim except the derived label and the merged not-found / authorisation check"
  );

  const sellerSideMigration = read("supabase/migrations/20261005110000_seller_side_authority_and_awaiting_connection.sql");
  const convertStart = "create or replace function public.convert_searching_placeholder_for_sale(";
  const convertEnd = "grant execute on function public.convert_searching_placeholder_for_sale(bigint, text, text) to authenticated;";
  assert(
    verbatimExcept(textBlock(raw, convertStart, convertEnd), textBlock(sellerSideMigration, convertStart, convertEnd), [
      [accountTypeLabel, "  v_updated_by := public._activity_actor_role(p_sale_property_id);"],
      [
        `  if v_sale.id is null then
    return jsonb_build_object('ok', false, 'error', 'sale_not_found');
  end if;`,
        `  if v_sale.id is null or not public.can_operate_property(p_sale_property_id) then
    return jsonb_build_object('ok', false, 'error', 'not_authorized');
  end if;`,
      ],
      [
        "or unowned when there is none. Atomic.';",
        "or unowned when there is none. Atomic. Unknown and foreign anchors both return not_authorized. Actor label is derived by _activity_actor_role on the anchor row.';",
      ],
      [
        "revoke all on function public.convert_searching_placeholder_for_sale(bigint, text, text) from public, anon;",
        "alter function public.convert_searching_placeholder_for_sale(bigint, text, text) owner to postgres;\n\nrevoke all on function public.convert_searching_placeholder_for_sale(bigint, text, text) from public, anon;",
      ],
    ]),
    "attribution: convert_searching_placeholder_for_sale is the 20261005110000 body verbatim except the derived label (anchor row) and authorisation before any sale-specific error"
  );

  const breakBody = functionBody(sql, "break_chain_connection");
  const convertBody = functionBody(sql, "convert_searching_placeholder_for_sale");
  const convertAuth = convertBody.indexOf("if v_sale.id is null or not public.can_operate_property(p_sale_property_id) then");
  assert(
    !breakBody.includes("property_not_found") &&
      !convertBody.includes("sale_not_found") &&
      convertAuth > -1 &&
      convertAuth < convertBody.indexOf("'invalid_sale'") &&
      convertAuth < convertBody.indexOf("'no_placeholder'") &&
      breakBody.indexOf("v_updated_by := public._activity_actor_role(v_property.id);") >
        breakBody.indexOf("if v_property.id is null or not public.can_operate_property(v_property.id) then"),
    "attribution: break and convert answer unknown and foreign ids identically and reveal no row state before authorisation"
  );
  for (const [signature, grantees] of [
    ["break_chain_connection(bigint, text)", "authenticated"],
    ["convert_searching_placeholder_for_sale(bigint, text, text)", "authenticated"],
  ] as const) {
    assert(
      /\bsecurity definer\b/.test(definerHeader(sql, signature.split("(")[0])) &&
        /\bset search_path = public\b/.test(definerHeader(sql, signature.split("(")[0])) &&
        sql.includes(`alter function public.${signature} owner to postgres;`) &&
        sql.includes(`revoke all on function public.${signature} from public, anon;`) &&
        sql.includes(`grant execute on function public.${signature} to ${grantees};`),
      `attribution: ${signature.split("(")[0]} stays SECURITY DEFINER with search_path = public, owner postgres, authenticated execute only`
    );
  }

  // Every user-callable activity writer in the migration history is one of
  // the four replaced here; the remaining writers are service_role only and
  // write 'system'.
  const latestBodies = new Map<string, { file: string; body: string }>();
  for (const file of migrationFiles.filter((name) => name.endsWith(".sql")).sort()) {
    const text = read(`supabase/migrations/${file}`);
    for (const match of text.matchAll(/create or replace function public\.([a-z0-9_]+)\(([\s\S]*?)\$(\w*)\$([\s\S]*?)\$\3\$/gi)) {
      latestBodies.set(match[1].toLowerCase(), { file, body: match[4] });
    }
  }
  const writers = [...latestBodies.entries()]
    .filter(([, def]) => /insert\s+into\s+(public\.)?activities\b/i.test(def.body))
    .map(([name]) => name)
    .sort();
  assert(
    JSON.stringify(writers) ===
      JSON.stringify([
        "_insert_participation_delink_activity",
        "_notify_chain_participants_of_delink",
        "break_chain_connection",
        "convert_searching_placeholder_for_sale",
        "report_operational_delay",
        "resolve_operational_delay",
      ]),
    `attribution: activity writers in the migration history are the four replaced RPCs plus two internal notice helpers (found: ${writers.join(", ")})`
  );
  // Net execute grants after replaying every grant / revoke in migration order.
  const netGrantees = (name: string): string[] => {
    const grantees = new Set<string>(["public"]);
    for (const file of migrationFiles.filter((entry) => entry.endsWith(".sql")).sort()) {
      const text = read(`supabase/migrations/${file}`);
      for (const match of text.matchAll(
        new RegExp(`\\b(grant|revoke) (?:all|execute) on function public\\.${name}\\([^)]*\\) (?:to|from) ([^;]+);`, "gi")
      )) {
        for (const role of match[2].split(",").map((entry) => entry.trim().toLowerCase())) {
          if (match[1].toLowerCase() === "grant") grantees.add(role);
          else grantees.delete(role);
        }
      }
    }
    return [...grantees].sort();
  };
  assert(
    ["_insert_participation_delink_activity", "_notify_chain_participants_of_delink"].every(
      (name) => JSON.stringify(netGrantees(name)) === JSON.stringify(["service_role"])
    ),
    "attribution: the internal notice helpers that write 'system' are service_role only, so system events stay system"
  );
  assert(
    !functionBody(sql, "report_operational_delay").includes("p_actor_role") &&
      !functionBody(sql, "resolve_operational_delay").includes("p_actor_role"),
    "attribution: p_actor_role stays in the signatures but is never read"
  );
  for (const signature of ["report_operational_delay(text, bigint, bigint, text)", "resolve_operational_delay(bigint, text)"]) {
    assert(
      sql.includes(`alter function public.${signature} owner to postgres;`) &&
        sql.includes(`revoke all on function public.${signature} from public, anon;`) &&
        sql.includes(`grant execute on function public.${signature} to authenticated, service_role;`),
      `attribution: ${signature.split("(")[0]} keeps owner postgres and authenticated / service_role execute`
    );
  }
  assert(
    flat.includes("v_src not like '%v_actor_role := nullif(btrim(coalesce(p_actor_role, '''')), '''');%'") &&
      flat.includes("pol.cmd in ('INSERT', 'UPDATE', 'ALL') and pol.policyname <> 'activities_insert_operator'") &&
      flat.includes("t.tgname = 'trg_activities_enforce_actor_attribution'"),
    "attribution: preflight fingerprints both delay RPCs and refuses any other end-user write path on activities"
  );
  assert(
    flat.includes("v_src not like '%''chain_node_not_found''%'") &&
      flat.includes("v_src not like '%''delay_not_found''%'") &&
      flat.includes("v_src not like '%''already_resolved'', true%'") &&
      flat.includes("v_src not like '%Chain Connection Broken - Seller Side%'") &&
      flat.includes("v_src not like '%''sale_not_found''%'") &&
      flat.includes("v_src not like '%''Onward purchase added''%'") &&
      flat.includes("to_regprocedure('public.break_chain_connection(bigint, text)') is null") &&
      flat.includes("to_regprocedure('public.convert_searching_placeholder_for_sale(bigint, text, text)') is null"),
    "attribution: preflight fingerprints the current break, convert and resolve bodies (including their not-found answers)"
  );
  assert(
    flat.includes("p.prosrc ~* 'insert\\s+into\\s+(public\\.)?activities\\M'") &&
      flat.includes("has_function_privilege('authenticated', p.oid, 'execute')") &&
      flat.includes("an unreviewed user-callable function writes activities"),
    "attribution: preflight refuses to install if any other user-callable function writes activities"
  );
  assert(
    !/\bcreate policy\b/.test(sql) && !/\b(grant|revoke)\b[^;]*\bon (table )?public\.activities\b/.test(sql),
    "attribution: no activities policy or table grant changes; who may write and read is unchanged"
  );
}

// ---------------------------------------------------------------------------
// Probes, reconnection and shared-view identifiers (20261021150000)
// ---------------------------------------------------------------------------

{
  const raw = read(PROBES);
  const sql = code(raw);
  const flat = squash(sql);
  const doBlocks = [...sql.matchAll(/do \$\$[\s\S]*?\n\$\$;/g)].map((match) => match[0]);
  const installed = doBlocks.reduce((text, block) => text.replace(block, ""), sql);
  const topLevel = installed.replace(/\bas \$\$[\s\S]*?\n\$\$;/g, "");

  assert(raw.startsWith("-- PROPOSED — NOT APPLIED."), "probes: marked PROPOSED — NOT APPLIED");
  assert(
    doBlocks.length === 2 &&
      sql.indexOf(doBlocks[0]) < sql.search(/\b(create|drop) (or replace )?(function|policy|view)/) &&
      sql.indexOf(doBlocks[1]) > sql.lastIndexOf("grant select on public.chain_properties_participant to authenticated;"),
    "probes: preflight DO block runs before any DDL; postflight runs after every change"
  );
  assert(!/\bgrant\b[^;]*\bto\b[^;]*\b(anon|public)\b/i.test(sql), "probes: nothing granted to anon or public");
  assert(!/\bsecurity invoker\b/.test(sql), "probes: no SECURITY INVOKER functions");
  assert(
    !/\b(insert into|update public\.|delete from)\b/.test(topLevel) &&
      !/\b(insert into|update public\.|delete from)\b/.test(
        functionBody(sql, "reconnect_returning_ea_branch") + functionBody(sql, "list_reconnectable_ea_properties")
      ) &&
      !/\bcreate policy\b|\bdrop policy\b|\balter table\b/.test(sql) &&
      !/\b(grant|revoke)\b[^;]*\bon (table )?public\.(properties|property_ea_assignments|property_ea_reconnection_events|ea_branch_invitations)\b/.test(sql),
    "probes: no rows changed, no policy or table change; reconnection audit rows are retained"
  );

  // 1) assign_property_ea_branch
  const eligibility = read("supabase/migrations/20261011090000_assign_property_ea_branch_directory_eligibility.sql");
  const assignStart = "create or replace function public.assign_property_ea_branch(";
  const assignEnd = "An existing assignment is never revoked or altered for eligibility.';";
  assert(
    verbatimExcept(textBlock(raw, assignStart, assignEnd), textBlock(eligibility, assignStart, assignEnd), [
      [
        `  if v_property.id is null then
    return jsonb_build_object('ok', false, 'error', 'property_not_found');
  end if;

  if v_property.stage = 'searching' then
    return jsonb_build_object('ok', false, 'error', 'invalid_property');
  end if;

  if not public.is_property_seller_side_homeowner(p_property_id) then
    return jsonb_build_object('ok', false, 'error', 'not_authorized');
  end if;
`,
        `  -- Unknown and foreign ids get the same answer (no existence oracle).
  if v_property.id is null
     or not public.is_property_seller_side_homeowner(p_property_id)
  then
    return jsonb_build_object('ok', false, 'error', 'not_authorized');
  end if;

  if v_property.stage = 'searching' then
    return jsonb_build_object('ok', false, 'error', 'invalid_property');
  end if;
`,
      ],
      [
        `  -- The branch acting for the buyer's sale cannot also take the seller side.
  if exists (
    select 1
    from public.properties s
    inner join public.property_ea_assignments spea
      on spea.property_id = s.id
    where s.chain_id = v_property.chain_id
      and s.linked_property_id = v_property.id
      and spea.branch_id = p_branch_id
      and spea.status = 'active'
  ) then
    return jsonb_build_object('ok', false, 'error', 'branch_acts_for_buyer');
  end if;

`,
        `  -- An assignment represents this row's seller side only. Another
  -- household's sale in the chain may use the same branch, and whether it
  -- does is never read here (Business Rules 3.4, 19.23).

`,
      ],
      [
        "Refuses the branch acting for the buyer''s sale.",
        "Another household''s sale in the same chain may use the same branch; the answer never depends on other rows'' assignments (Business Rules 3.4, 19.23). Unknown and foreign property ids both return not_authorized.",
      ],
    ]),
    "probes: assign_property_ea_branch is the 20261011090000 body verbatim except the merged existence / authorisation check and the removed linked-sale branch refusal"
  );
  const assign = functionBody(sql, "assign_property_ea_branch");
  const steps = [
    "or not public.is_property_seller_side_homeowner(p_property_id)",
    "if v_property.stage = 'searching' then",
    "from public.ea_branch_directory d",
    "revocation_reason = 'replaced'",
    "insert into public.property_ea_assignments",
  ].map((needle) => assign.indexOf(needle));
  assert(
    !assign.includes("property_not_found") &&
      !assign.includes("branch_acts_for_buyer") &&
      steps.every((index, i) => index > -1 && (i === 0 || index > steps[i - 1])),
    "probes: assign authorises before any property-specific answer; directory, revoke and insert keep their order"
  );
  {
    const body = code(assign);
    const otherRowReads = [...body.matchAll(/\bfrom public\.(\w+)\s+(\w+)?/g)].map((match) => match[1]);
    assert(
      !body.includes("linked_property_id") &&
        !body.includes("spea") &&
        !body.includes("chain_id") &&
        !/\bproperties s\b/.test(body) &&
        JSON.stringify([...new Set(otherRowReads)].sort()) ===
          JSON.stringify(["ea_branch_directory", "ea_branches", "properties", "property_ea_assignments"]) &&
        (body.match(/from public\.property_ea_assignments\b[^;]*?where property_id = p_property_id/g) ?? []).length === 1 &&
        (body.match(/from public\.properties\b[^;]*?where id = p_property_id/g) ?? []).length === 1,
      "B1: assign reads only the target row, its own active assignment, the branch and the directory; no other row's assignment can change the answer"
    );
  }
  assert(
    /\bsecurity definer\b/.test(definerHeader(sql, "assign_property_ea_branch")) &&
      /\bset search_path = public\b/.test(definerHeader(sql, "assign_property_ea_branch")) &&
      !/\b(grant|revoke)\b[^;]*public\.assign_property_ea_branch\b/.test(installed) &&
      flat.includes("perform set_config('moveloop.assign_property_ea_branch_acl', v_acl, false);") &&
      flat.includes("v_acl is distinct from current_setting('moveloop.assign_property_ea_branch_acl', true)") &&
      flat.includes("v_src like '%branch_acts_for_buyer%'") &&
      flat.includes("or v_src like '%linked_property_id%' or v_src like '%spea%'") &&
      flat.includes("not (v_auth < v_searching and v_searching < v_check and v_check < v_revoke and v_revoke < v_insert)") &&
      !flat.includes("v_buyer"),
    "probes: assign keeps definer, search_path and grants (postflight compares the ACL and the check order)"
  );

  // 2) Reconnection fails closed
  const reconnect = squash(functionBody(sql, "reconnect_returning_ea_branch"));
  const list = squash(functionBody(sql, "list_reconnectable_ea_properties"));
  assert(
    reconnect ===
      "declare v_email_gate jsonb; begin v_email_gate := public._require_verified_email_for_transaction(); if v_email_gate is not null then return v_email_gate; end if; if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'not_authenticated'); end if; return jsonb_build_object('ok', false, 'error', 'not_reconnectable'); end;",
    "probes: reconnect_returning_ea_branch always returns not_reconnectable after the sign-in and email checks (reads and writes nothing)"
  );
  assert(
    list ===
      "declare v_email_gate jsonb; begin if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'not_authenticated'); end if; v_email_gate := public._require_verified_email_for_transaction(); if v_email_gate is not null then return v_email_gate; end if; return jsonb_build_object('ok', true, 'properties', '[]'::jsonb); end;",
    "probes: list_reconnectable_ea_properties always returns an empty list (no address, postcode, branch or date)"
  );
  for (const signature of ["reconnect_returning_ea_branch(bigint, uuid)", "list_reconnectable_ea_properties()"]) {
    const name = signature.split("(")[0];
    assert(
      /\bsecurity definer\b/.test(definerHeader(sql, name)) &&
        /\bset search_path = public\b/.test(definerHeader(sql, name)) &&
        sql.includes(`alter function public.${signature} owner to postgres;`) &&
        sql.includes(`revoke all on function public.${signature} from public, anon;`) &&
        sql.includes(`grant execute on function public.${signature} to authenticated;`),
      `probes: ${name} keeps its signature, definer, search_path, owner and authenticated-only execute`
    );
  }
  const reconnectLib = read("lib/estateAgent/reconnectReturningBranch.ts");
  assert(
    /for \(const row of result\.properties \?\? \[\]\)/.test(reconnectLib) &&
      /default:\s*return "This branch cannot reconnect to this property\.";/.test(reconnectLib),
    "probes: the app lists nothing for an empty result and shows its generic refusal for not_reconnectable"
  );

  // 3) Internal helpers
  const helpers = [
    "get_active_ea_branch_invitation(uuid, text)",
    "user_has_ea_branch_membership(uuid)",
    "user_email_has_ea_branch_membership(text)",
    "resolve_convertible_searching_placeholder_for_sale(bigint)",
  ];
  for (const signature of helpers) {
    assert(
      sql.includes(`revoke all on function public.${signature} from public, anon, authenticated;`) &&
        sql.includes(`grant execute on function public.${signature} to service_role;`) &&
        flat.includes(`'public.${signature}'`),
      `probes: ${signature.split("(")[0]} no longer executable by end users (service_role only; postflight checks)`
    );
  }
  const helperNames = helpers.map((signature) => signature.split("(")[0]);
  const helperCallers: string[] = [];
  const appCallers: string[] = [];
  const latest = new Map<string, { header: string; body: string }>();
  for (const file of migrationFiles.filter((name) => name.endsWith(".sql")).sort()) {
    const text = read(`supabase/migrations/${file}`);
    for (const match of text.matchAll(/create or replace function public\.([a-z0-9_]+)\(([\s\S]*?)\$(\w*)\$([\s\S]*?)\$\3\$/gi)) {
      latest.set(match[1].toLowerCase(), { header: match[2], body: match[4] });
    }
  }
  for (const [name, def] of latest) {
    for (const helper of helperNames) {
      if (name !== helper && new RegExp(`\\b${helper}\\s*\\(`).test(def.body)) {
        helperCallers.push(`${helper}<-${name}:${/\bsecurity definer\b/i.test(def.header) ? "definer" : "invoker"}`);
      }
    }
  }
  const scanApp = (dir: string) => {
    for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) scanApp(rel);
      else if (/\.(ts|tsx)$/.test(entry.name) && helperNames.some((helper) => read(rel).includes(`"${helper}"`))) appCallers.push(rel);
    }
  };
  for (const dir of ["app", "components", "context", "lib", "hooks"]) if (existsSync(join(ROOT, dir))) scanApp(dir);
  assert(
    helperCallers.every((caller) => caller.endsWith(":definer")) && appCallers.length === 0,
    `probes: the helpers are called only from SECURITY DEFINER functions and never by the app (callers: ${helperCallers.join(", ") || "none"})`
  );
  assert(
    flat.includes("a policy uses %") &&
      flat.includes("a view uses %") &&
      flat.includes("(not p.prosecdef or p.proowner <> v_helper_owner)"),
    "probes: preflight refuses if a policy, view, invoker function or differently-owned function uses a helper"
  );

  // 4) chain_properties_participant
  const viewMigration = read("supabase/migrations/20260725140000_chain_properties_participant_stage_entered_at.sql");
  const viewStart = "create or replace view public.chain_properties_participant";
  const viewEnd = "grant select on public.chain_properties_participant to authenticated;";
  assert(
    verbatimExcept(textBlock(raw, viewStart, viewEnd), textBlock(viewMigration, viewStart, viewEnd), [
      [
        "  p.created_by_user_id,\n",
        "  case\n    when p.created_by_user_id = auth.uid() then p.created_by_user_id\n    else null\n  end as created_by_user_id,\n",
      ],
      [
        "address visible only for own or assigned properties; stage_entered_at",
        "address visible only for own or assigned properties; created_by_user_id only when it is the caller (Business Rules 3.4, 19.23); stage_entered_at",
      ],
    ]),
    "probes: chain_properties_participant is the 20260725140000 view verbatim except created_by_user_id (caller's own id only)"
  );
  const viewFiles = migrationFiles.filter((file) => /create or replace view public\.chain_properties_participant\b/.test(read(`supabase/migrations/${file}`))).sort();
  assert(
    viewFiles.pop() === "20260725140000_chain_properties_participant_stage_entered_at.sql",
    "probes: 20260725140000 is the latest definition of chain_properties_participant"
  );
  assert(
    flat.includes("'id,chain_id,chain_position,stage,status,relationship_type,linked_property_id,is_searching,buyer_connected,seller_connected,awaiting_buyer,created_by_user_id,address,postcode,current_user_role,is_own_property,has_members,stage_entered_at'") &&
      flat.includes("v_def not like '%is_chain_operational_viewer(p.chain_id)%'") &&
      flat.includes("has_table_privilege('anon', 'public.chain_properties_participant', 'select')"),
    "probes: preflight pins the view's column list, filter and security_invoker=false; postflight checks its grants"
  );

  // The app reads the view only to authorise a route by id; ChainContext maps
  // created_by_user_id but nothing reads another row's creator.
  const appReaders: string[] = [];
  const scanCreators = (dir: string) => {
    for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) scanCreators(rel);
      else if (/\.(ts|tsx)$/.test(entry.name) && /\.created_by_user_id\b|\.createdByUserId\b/.test(read(rel))) appReaders.push(rel);
    }
  };
  for (const dir of ["app", "components", "context", "hooks"]) if (existsSync(join(ROOT, dir))) scanCreators(dir);
  assert(
    JSON.stringify(appReaders) === JSON.stringify(["context/ChainContext.tsx"]) &&
      (read("context/ChainContext.tsx").match(/\.created_by_user_id\b/g) ?? []).length === 1 &&
      /\.from\("chain_properties_participant"\)\s*\.select\("id"\)/.test(read("lib/auth/propertyAccess.ts")),
    `probes: no app code reads another chain row's creator (readers: ${appReaders.join(", ") || "none"})`
  );
}

// ---------------------------------------------------------------------------
// Existence probes and unguarded helpers (20261021160000)
// ---------------------------------------------------------------------------

const SELLER_SIDE_MIGRATION = read("supabase/migrations/20261005110000_seller_side_authority_and_awaiting_connection.sql");
const DORMANCY_MIGRATION = read("supabase/migrations/20261005130000_lifecycle_bounded_dormancy.sql");
const EA_CREATE_MIGRATION = read("supabase/migrations/20260905120000_fix_create_ea_operational_property_chain_authz.sql");

/** Latest body of every public function: migrations in order, then the given proposals. */
function latestFunctions(proposals: string[]): Map<string, { header: string; body: string; file: string }> {
  const latest = new Map<string, { header: string; body: string; file: string }>();
  const sources = [
    ...migrationFiles.filter((name) => name.endsWith(".sql")).sort().map((name) => `supabase/migrations/${name}`),
    ...proposals,
  ];
  for (const file of sources) {
    const text = read(file);
    for (const match of text.matchAll(/create or replace function public\.([a-z0-9_]+)\(([\s\S]*?)\$(\w*)\$([\s\S]*?)\$\3\$/gi)) {
      latest.set(match[1].toLowerCase(), { header: match[2], body: match[4], file });
    }
  }
  return latest;
}

{
  const raw = read(EXISTENCE);
  const sql = code(raw);
  const flat = squash(sql);
  const doBlocks = [...sql.matchAll(/do \$\$[\s\S]*?\n\$\$;/g)].map((match) => match[0]);
  const installed = doBlocks.reduce((text, block) => text.replace(block, ""), sql);
  const topLevel = installed.replace(/\bas \$\$[\s\S]*?\n\$\$;/g, "");

  assert(raw.startsWith("-- PROPOSED — NOT APPLIED."), "existence probes: marked PROPOSED — NOT APPLIED");
  assert(
    doBlocks.length === 2 &&
      sql.indexOf(doBlocks[0]) < sql.search(/\b(create|drop) (or replace )?(function|policy|view)/) &&
      sql.indexOf(doBlocks[1]) >
        sql.lastIndexOf("grant execute on function public.execute_participation_delink(bigint, text, text, uuid) to authenticated;"),
    "existence probes: preflight DO block runs before any DDL; postflight runs after every change"
  );
  assert(!/\bgrant\b[^;]*\bto\b[^;]*\b(anon|public)\b/i.test(sql), "existence probes: nothing granted to anon or public");
  assert(!/\bsecurity invoker\b/.test(sql), "existence probes: no SECURITY INVOKER functions");
  assert(
    !/\b(insert into|update public\.|delete from)\b/.test(topLevel) &&
      !/\balter table\b/.test(sql) &&
      !/\b(grant|revoke)\b[^;]*\bon (table )?public\.[a-z_]+\s+(to|from)\b/.test(sql) &&
      (sql.match(/\bcreate policy\b/g) ?? []).length === 1 &&
      (sql.match(/\bdrop policy\b/g) ?? []).length === 1,
    "existence probes: no rows changed, no table grant change; the only policy change is properties_update_operator"
  );

  // Verbatim copies.
  const copies: { label: string; source: string; start: string; end: string; edits: [string, string][] }[] = [
    {
      label: "confirm_transaction_still_active (20261005130000)",
      source: DORMANCY_MIGRATION,
      start: "create or replace function public.confirm_transaction_still_active(",
      end: "\ncomment on function public.confirm_transaction_still_active(bigint) is",
      edits: [
        [
          "  if v_property.id is null then\n    return jsonb_build_object('ok', false, 'error', 'property_not_found');\n  end if;\n",
          "  -- Unknown ids get the answer a caller with no role on the property gets.\n  if v_property.id is null then\n    return jsonb_build_object('ok', false, 'error', 'not_authorised');\n  end if;\n",
        ],
        [
          "  then\n    -- Managed rows have no clock to confirm.\n    return jsonb_build_object(",
          "  then\n    -- Managed rows have no clock to confirm. Only the dependent side or an\n    -- operator of the row learns that it is managed.\n    if not public._is_placeholder_dependent_side_user(p_property_id, v_user_id)\n       and not public.can_operate_property(p_property_id)\n    then\n      return jsonb_build_object('ok', false, 'error', 'not_authorised');\n    end if;\n\n    return jsonb_build_object(",
        ],
      ],
    },
    {
      label: "create_searching_placeholder_for_sale (20261005110000)",
      source: SELLER_SIDE_MIGRATION,
      start: "create or replace function public.create_searching_placeholder_for_sale(",
      end: "\ncomment on function public.create_searching_placeholder_for_sale(bigint) is",
      edits: [
        [
          "  if v_sale.id is null then\n    return jsonb_build_object('ok', false, 'error', 'sale_not_found');\n  end if;\n",
          "  -- Unknown and foreign ids get the same answer (no existence oracle).\n  if v_sale.id is null\n     or not public.can_operate_property(p_sale_property_id)\n  then\n    return jsonb_build_object('ok', false, 'error', 'not_authorized');\n  end if;\n",
        ],
        ["  if not public.can_operate_property(p_sale_property_id) then\n    return jsonb_build_object('ok', false, 'error', 'not_authorized');\n  end if;\n\n", ""],
      ],
    },
    {
      label: "link_sale_to_searching_placeholder (20261005120000)",
      source: AUTH_MIGRATION,
      start: "create or replace function public.link_sale_to_searching_placeholder(",
      end: "The placeholder must be unowned or owned by the anchor''s seller-side homeowner",
      edits: [
        [
          "  if v_sale.id is null or v_searching.id is null then\n    return jsonb_build_object('ok', false, 'error', 'property_not_found');\n  end if;\n\n  if v_sale.chain_id <> v_searching.chain_id then\n    return jsonb_build_object('ok', false, 'error', 'chain_mismatch');\n  end if;\n",
          "  -- Authorise on the anchor before answering anything about either row.\n  if v_sale.id is null\n     or not public.can_operate_property(p_sale_property_id)\n  then\n    return jsonb_build_object('ok', false, 'error', 'forbidden');\n  end if;\n\n  -- A missing placeholder and one in another chain get the same answer.\n  if v_searching.id is null\n     or v_sale.chain_id is distinct from v_searching.chain_id\n  then\n    return jsonb_build_object('ok', false, 'error', 'chain_mismatch');\n  end if;\n",
        ],
        ["  if not public.can_operate_property(p_sale_property_id) then\n    return jsonb_build_object('ok', false, 'error', 'forbidden');\n  end if;\n\n", ""],
      ],
    },
    {
      label: "establish_connected_hop (20261005120000)",
      source: AUTH_MIGRATION,
      start: "create or replace function public.establish_connected_hop(p_purchase_property_id bigint)",
      end: "(its seller-side homeowner or their permitted EA).",
      edits: [
        [
          "  if v_purchase.id is null then\n    return jsonb_build_object('ok', false, 'error', 'purchase_not_found');\n  end if;\n\n  if v_purchase.relationship_type is distinct from 'purchase' then\n    return jsonb_build_object('ok', false, 'error', 'not_purchase');\n  end if;\n\n  if not public.can_operate_property(v_purchase.id) then\n    return jsonb_build_object('ok', false, 'error', 'not_authorized');\n  end if;\n",
          "  -- Unknown and foreign ids get the same answer (no existence oracle).\n  if v_purchase.id is null\n     or not public.can_operate_property(v_purchase.id)\n  then\n    return jsonb_build_object('ok', false, 'error', 'not_authorized');\n  end if;\n\n  if v_purchase.relationship_type is distinct from 'purchase' then\n    return jsonb_build_object('ok', false, 'error', 'not_purchase');\n  end if;\n",
        ],
      ],
    },
    {
      label: "_execute_participation_delink (20261005120000)",
      source: AUTH_MIGRATION,
      start: "create or replace function public._execute_participation_delink(",
      end: "grant execute on function public._execute_participation_delink(bigint, text, text, uuid) to service_role;",
      edits: [
        [
          "  if v_property.id is null then\n    return jsonb_build_object('ok', false, 'error', 'property_not_found');\n  end if;\n\n  v_chain_id := v_property.chain_id;",
          "  -- Unknown ids get the refusal a caller with no role on the property gets\n  -- from the operation's first ownership check below.\n  if v_property.id is null then\n    return jsonb_build_object(\n      'ok', false,\n      'error',\n      case\n        when p_operation in ('homeowner_self', 'homeowner_remove_ea')\n          then 'not_operational_homeowner'\n        when p_operation = 'estate_agent_remove_branch' and p_branch_id is null\n          then 'branch_required'\n        else 'not_assigned_ea'\n      end\n    );\n  end if;\n\n  v_chain_id := v_property.chain_id;",
        ],
      ],
    },
    {
      label: "create_ea_operational_property (20260905120000)",
      source: EA_CREATE_MIGRATION,
      start: "create or replace function public.create_ea_operational_property(",
      end: "or the first property on an empty chain created by the caller.",
      edits: [
        ["  if not exists (\n    select 1\n    from public.chains c\n    where c.id = p_chain_id\n  ) then\n    return jsonb_build_object('ok', false, 'error', 'chain_not_found');\n  end if;\n\n", ""],
      ],
    },
  ];
  for (const copy of copies) {
    assert(
      verbatimExcept(textBlock(raw, copy.start, copy.end), textBlock(copy.source, copy.start, copy.end), copy.edits),
      `existence probes: ${copy.label} is the source body verbatim except the listed edits`
    );
  }
  assert(
    raw.includes("A managed row is a no-op for its dependent side and operators. Unknown ids and callers with no role on the row both receive not_authorised.';") &&
      raw.includes("estate agents never receive one. Unknown and foreign anchor ids both return not_authorized.';") &&
      raw.includes("Unknown and foreign anchors both return forbidden; a missing placeholder and one in another chain both return chain_mismatch.';") &&
      raw.includes("(its seller-side homeowner or their permitted EA). Unknown and foreign ids both return not_authorized.';") &&
      raw.includes("Unknown and foreign chain ids both return not_authorised_for_chain.';"),
    "existence probes: each replaced function's comment states its unknown and foreign id answer"
  );

  // The source definitions copied are the latest ones.
  const latestBefore = latestFunctions([VISIBILITY, FORMER_BRANCH, ATTRIBUTION, PROBES]);
  const expectedSource: Record<string, string> = {
    confirm_transaction_still_active: "20261005130000_lifecycle_bounded_dormancy.sql",
    create_searching_placeholder_for_sale: "20261005110000_seller_side_authority_and_awaiting_connection.sql",
    link_sale_to_searching_placeholder: "20261005120000_operational_authority_enforcement.sql",
    establish_connected_hop: "20261005120000_operational_authority_enforcement.sql",
    _execute_participation_delink: "20261005120000_operational_authority_enforcement.sql",
    create_ea_operational_property: "20260905120000_fix_create_ea_operational_property_chain_authz.sql",
    get_next_chain_position: "20260610200000_phase5_homeowner_privacy_rls.sql",
  };
  assert(
    Object.entries(expectedSource).every(([name, file]) => latestBefore.get(name)?.file.endsWith(file)),
    "existence probes: each copied function is the latest definition (migrations and earlier proposals)"
  );

  // Order and answers.
  const confirm = functionBody(sql, "confirm_transaction_still_active");
  const placeholder = functionBody(sql, "create_searching_placeholder_for_sale");
  const link = functionBody(sql, "link_sale_to_searching_placeholder");
  const hop = functionBody(sql, "establish_connected_hop");
  const delink = functionBody(sql, "_execute_participation_delink");
  const eaCreate = functionBody(sql, "create_ea_operational_property");
  /** True when every needle occurs, each after the previous one. */
  const ordered = (body: string, needles: string[]) => {
    let from = 0;
    for (const needle of needles) {
      const index = body.indexOf(needle, from);
      if (index < 0) return false;
      from = index + needle.length;
    }
    return true;
  };
  assert(
    !/_not_found'/.test(confirm + placeholder + link + hop + delink + eaCreate) &&
      ordered(confirm, ["'not_authorised'", "and not public.can_operate_property(p_property_id)", "'managed', true", "if not public._is_placeholder_dependent_side_user(p_property_id, v_user_id) then"]) &&
      ordered(placeholder, ["or not public.can_operate_property(p_sale_property_id)", "'invalid_sale'", "get_next_chain_position"]) &&
      (placeholder.match(/can_operate_property\(p_sale_property_id\)/g) ?? []).length === 1 &&
      ordered(link, ["'forbidden'", "'chain_mismatch'", "'invalid_sale'", "'invalid_searching_placeholder'", "'placeholder_owner_mismatch'", "set linked_property_id"]) &&
      (link.match(/'forbidden'/g) ?? []).length === 1 &&
      ordered(hop, ["'not_authorized'", "'not_purchase'"]) &&
      (hop.match(/'not_authorized'/g) ?? []).length === 1 &&
      ordered(eaCreate, ["'not_ea_branch_member'", "into v_branch_authorised", "into v_empty_self_originated", "'not_authorised_for_chain'", "_create_ea_operational_property_core("]),
    "existence probes: no not-found answer remains; authorisation comes before every row-specific answer and authorised callers keep their errors in order"
  );
  assert(
    ordered(delink, [
      "when p_operation in ('homeowner_self', 'homeowner_remove_ea')",
      "then 'not_operational_homeowner'",
      "when p_operation = 'estate_agent_remove_branch' and p_branch_id is null",
      "then 'branch_required'",
      "else 'not_assigned_ea'",
      "v_chain_id := v_property.chain_id;",
      "if p_operation = 'homeowner_self' then",
    ]) &&
      ordered(textBlock(AUTH_MIGRATION, "create or replace function public._execute_participation_delink(", "\n$$;"), [
        "  if v_property.id is null then",
        "  if p_operation = 'homeowner_self' then",
        "      return jsonb_build_object('ok', false, 'error', 'not_operational_homeowner');",
        "  if p_operation = 'homeowner_remove_ea' then",
        "      return jsonb_build_object('ok', false, 'error', 'not_operational_homeowner');",
        "  if p_operation = 'estate_agent_remove_branch' then",
        "      return jsonb_build_object('ok', false, 'error', 'branch_required');",
        "      return jsonb_build_object('ok', false, 'error', 'not_assigned_ea');",
        "  if p_operation = 'estate_agent_remove_homeowner' then",
        "      return jsonb_build_object('ok', false, 'error', 'not_assigned_ea');",
      ]),
    "existence probes: an unknown delink id returns exactly the first refusal each operation gives a property the caller has no role on"
  );

  const position = squash(functionBody(sql, "get_next_chain_position"));
  assert(
    position ===
      "select case when auth.uid() is not null and ( public.caller_may_place_property_in_chain(p_chain_id) or public.is_chain_operational_viewer(p_chain_id) or exists ( select 1 from public.properties op where op.chain_id = p_chain_id and public.can_operate_property(op.id) ) ) then coalesce( ( select max(p.chain_position) from public.properties p where p.chain_id = p_chain_id ), 0 ) + 1 else 1 end;" &&
      /\bsecurity definer\b/.test(definerHeader(sql, "get_next_chain_position")) &&
      /\bstable\b/.test(definerHeader(sql, "get_next_chain_position")) &&
      /returns integer/.test(definerHeader(sql, "get_next_chain_position")),
    "existence probes: get_next_chain_position answers only callers who may place, view or operate in the chain; everyone else gets 1"
  );

  const coreGrants = [
    "revoke all on function public._execute_participation_delink(bigint, text, text, uuid) from public, anon, authenticated;",
    "grant execute on function public._execute_participation_delink(bigint, text, text, uuid) to service_role;",
  ];
  for (const name of Object.keys(expectedSource)) {
    const grantLines = [...installed.matchAll(new RegExp(`^.*\\b(grant|revoke)\\b[^;]*public\\.${name}\\(.*$`, "gm"))].map(
      (match) => match[0]
    );
    assert(
      /\bsecurity definer\b/.test(definerHeader(sql, name)) &&
        /\bset search_path = public\b/.test(definerHeader(sql, name)) &&
        JSON.stringify(grantLines) === JSON.stringify(name === "_execute_participation_delink" ? coreGrants : []),
      name === "_execute_participation_delink"
        ? `existence probes: ${name} keeps definer, search_path and its service_role-only grant (restated verbatim from the source)`
        : `existence probes: ${name} keeps definer, search_path and grants (create or replace keeps the ACL)`
    );
  }
  assert(
    flat.includes("perform set_config('moveloop.existence_probes_acl_' || v_i, v_acl, false);") &&
      flat.includes("v_acl is distinct from current_setting('moveloop.existence_probes_acl_' || v_i, true)") &&
      flat.includes("or v_owner is distinct from 'postgres'"),
    "existence probes: preflight saves each ACL and requires owner postgres; postflight compares both"
  );

  // properties_update_operator
  const policyStart = "create policy properties_update_operator";
  const policyEnd = "      and public.get_property_operational_owner_user_id(id) = auth.uid()\n    )\n  );\n";
  const sourcePolicy = textBlock(AUTH_MIGRATION, policyStart, policyEnd);
  const proposedPolicy = textBlock(raw, policyStart, "      and public.is_property_operational_homeowner(id)\n    )\n  );\n");
  assert(
    sourcePolicy !== "" &&
      proposedPolicy ===
        sourcePolicy.replace(
          /public\.get_property_operational_owner_user_id\(id\) = auth\.uid\(\)/g,
          "public.is_property_operational_homeowner(id)"
        ) &&
      (proposedPolicy.match(/is_property_operational_homeowner\(id\)/g) ?? []).length === 2,
    "existence probes: properties_update_operator is the 20261005120000 policy with the owner-id comparison replaced by is_property_operational_homeowner(id)"
  );
  const ownerFn = squash(functionBody(read("supabase/migrations/20260714150000_operational_identity_enforcement.sql"), "get_property_operational_owner_user_id"));
  const homeownerFn = squash(functionBody(read("supabase/migrations/20260714150000_operational_identity_enforcement.sql"), "is_property_operational_homeowner"));
  assert(
    ownerFn === "select poi.homeowner_user_id from public.property_operational_identities poi where poi.property_id = p_property_id and poi.status = 'active';" &&
      homeownerFn ===
        "select exists ( select 1 from public.property_operational_identities poi where poi.property_id = p_property_id and poi.homeowner_user_id = auth.uid() and poi.status = 'active' );" &&
      read("supabase/migrations/20260714140000_property_operational_identity_foundation.sql").includes(
        "create unique index if not exists property_operational_identities_one_active_per_property"
      ) &&
      flat.includes("to_regclass('public.property_operational_identities_one_active_per_property') is null"),
    "existence probes: the replacement predicate is equivalent (one active identity per property, enforced by a unique index the preflight requires)"
  );

  // Helpers losing end-user execute.
  const revoked = [
    "get_property_operational_owner_user_id(bigint)",
    "chain_last_operational_activity_at(bigint)",
    "property_chain_is_connected(bigint)",
    "homeowner_has_meaningful_participation(bigint)",
    "property_invitation_is_pending(bigint)",
    "property_has_any_member(bigint)",
  ];
  for (const signature of revoked) {
    assert(
      sql.includes(`revoke all on function public.${signature} from public, anon, authenticated;`) &&
        sql.includes(`grant execute on function public.${signature} to service_role;`) &&
        flat.includes(`'public.${signature}'`) &&
        flat.includes(`'${signature.split("(")[0]}'`),
      `existence probes: ${signature.split("(")[0]} is service_role only (preflight checks its callers; postflight checks grants)`
    );
  }
  assert(
    sql.includes("revoke all on function public.execute_participation_delink(bigint, text, text, uuid) from public, anon;") &&
      sql.includes("grant execute on function public.execute_participation_delink(bigint, text, text, uuid) to authenticated;") &&
      flat.includes("has_function_privilege('anon', 'public.execute_participation_delink(bigint, text, text, uuid)', 'execute')"),
    "existence probes: execute_participation_delink loses its PUBLIC execute; authenticated keeps it"
  );

  // After every proposal, each revoked helper is called only by SECURITY
  // DEFINER functions and by no policy, view or app code.
  const latestAfter = latestFunctions([VISIBILITY, FORMER_BRANCH, ATTRIBUTION, PROBES, EXISTENCE]);
  const revokedNames = revoked.map((signature) => signature.split("(")[0]);
  const helperCallers: string[] = [];
  for (const [name, def] of latestAfter) {
    for (const helper of revokedNames) {
      if (name !== helper && new RegExp(`\\b${helper}\\s*\\(`).test(def.body)) {
        helperCallers.push(`${helper}<-${name}:${/\bsecurity definer\b/i.test(def.header) ? "definer" : "invoker"}`);
      }
    }
  }
  const policyUsers = new Map<string, string>();
  const policySources = [
    ...migrationFiles.filter((name) => name.endsWith(".sql")).sort().map((name) => `supabase/migrations/${name}`),
    VISIBILITY,
    FORMER_BRANCH,
    ATTRIBUTION,
    PROBES,
    EXISTENCE,
  ];
  for (const file of policySources) {
    const text = code(read(file));
    for (const match of text.matchAll(/create policy (\w+)\s+on (public\.\w+)([\s\S]*?);/g)) {
      policyUsers.set(`${match[2]}.${match[1]}`, match[3]);
    }
  }
  const policyCallers = [...policyUsers]
    .filter(([, body]) => revokedNames.some((helper) => new RegExp(`\\b${helper}\\s*\\(`).test(body)))
    .map(([name]) => name);
  const appCallers: string[] = [];
  const scanApp = (dir: string) => {
    for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) scanApp(rel);
      else if (/\.(ts|tsx)$/.test(entry.name) && revokedNames.some((helper) => new RegExp(`\\.rpc\\(\\s*"${helper}"`).test(read(rel)))) appCallers.push(rel);
    }
  };
  for (const dir of ["app", "components", "context", "lib", "hooks"]) if (existsSync(join(ROOT, dir))) scanApp(dir);
  assert(
    helperCallers.every((caller) => caller.endsWith(":definer")) && policyCallers.length === 0 && appCallers.length === 0,
    `existence probes: after every proposal the revoked helpers have only SECURITY DEFINER callers (${helperCallers.join(", ") || "none"}), no policy (${policyCallers.join(", ") || "none"}) and no app caller`
  );
  {
    const placeholderLib = read("lib/searchingPlaceholder.ts");
    const callsNextPosition = /\.rpc\(\s*"get_next_chain_position"/.test(placeholderLib);
    assert(
      callsNextPosition
        ? /if \(error \|\| data == null\) \{[\s\S]*?return 1;/.test(placeholderLib)
        : !placeholderLib.includes("get_next_chain_position"),
      "existence probes: the app's get_next_chain_position caller (if any) treats a missing answer as position 1"
    );
  }

  // Completeness: every user-callable function, after every proposal, either
  // authorises before any not-found answer and checks its caller, or is on a
  // reviewed list with the reason it cannot disclose another participant's data.
  const allowlistDoc = JSON.parse(read("scripts/secdef-user-rpc-allowlist.json")) as {
    allowlist?: { name: string }[];
  };
  const revokedBy150000 = [
    "get_active_ea_branch_invitation",
    "user_has_ea_branch_membership",
    "user_email_has_ea_branch_membership",
    "resolve_convertible_searching_placeholder_for_sale",
  ];
  const allowlisted = [...new Set((allowlistDoc.allowlist ?? []).map((entry) => entry.name))];
  // Branch membership alone (not_ea_branch_member) says nothing about a row,
  // so the scan keeps reading past it.
  const authLike =
    /^(not_authori[sz]ed|forbidden|not_assigned_ea|not_operational_homeowner|not_branch_member|not_branch_admin|not_authorised_for_chain|homeowner_only|invalid_token|invalid_access_code|join_details_not_matched|email_mismatch|not_reconnectable|branch_required)$/;
  const reviewedNotFound: Record<string, string> = {
    assign_property_ea_branch: "branch_not_found: branch ids come from the public directory; the property answer is not_authorized for unknown and foreign ids (150000)",
    accept_ea_branch_invitation: "invitation_not_found: keyed by a secret token",
    preview_ea_branch_invitation: "invitation_not_found / branch_not_found / company_not_found: keyed by a secret token",
    record_ea_branch_invitation_sent: "invitation_not_found: random invitation uuid, then branch-admin check",
    revoke_ea_branch_invitation: "invitation_not_found: random invitation uuid, then branch-admin check",
    remove_ea_branch_member: "member_not_found: random member uuid, then branch-admin check",
    validate_ea_branch_invitation_for_email_send: "invitation_not_found: random invitation uuid",
    set_property_ea_update_permission: "branch_not_found: branch ids come from the public directory",
  };
  const scope = /auth\.uid\(\)|public\.(is_|can_|caller_|_is_|_caller)|_require_verified_email_for_transaction|\bpublic\._?execute_participation_delink\(/;
  const reviewedUnscoped: Record<string, string> = {
    connect_ea_to_awaiting_property: "closed: always join_details_not_matched (20261010090000)",
    ensure_property_membership: "no end-user execute",
    get_ea_founding_availability: "public founding-offer counts; no participant data",
    is_allowed_structured_activity_update: "validates its text argument only",
    is_ea_branch_commercially_entitled: "residual: branch entitlement by directory branch id (no participant data)",
    is_smoke_test_ea_branch: "residual: smoke-test flag by branch id (no participant data)",
    prevent_client_ea_branch_stripe_customer_mutation: "trigger function; not callable as an RPC",
    sync_property_claim_on_membership: "trigger function; not callable as an RPC",
    property_lifecycle_chain_release_safe: "service_role only (20261005130000)",
    preview_ea_branch_invitation: "keyed by a secret token",
  };
  const inventory = (latest: typeof latestAfter, revokedNow: string[]) => {
    const preAuthNotFound: string[] = [];
    const unscoped: string[] = [];
    for (const name of [...allowlisted.filter((fn) => !revokedNow.includes(fn)), "_execute_participation_delink"]) {
      const def = latest.get(name);
      if (!def) continue;
      const codes = [...def.body.matchAll(/'error',\s*'([a-z_]+)'/g)].map((match) => match[1]);
      for (const errorCode of codes) {
        if (authLike.test(errorCode)) break;
        if (/_not_found$/.test(errorCode) && !(name in reviewedNotFound)) preAuthNotFound.push(`${name}:${errorCode}`);
      }
      if (!scope.test(def.body) && !(name in reviewedUnscoped)) unscoped.push(name);
    }
    return { preAuthNotFound, unscoped };
  };
  const before = inventory(latestBefore, revokedBy150000);
  const { preAuthNotFound, unscoped } = inventory(latestAfter, [...revokedBy150000, ...revokedNames]);
  const sameList = (a: string[], b: string[]) => JSON.stringify(a) === JSON.stringify(b);
  assert(
    allowlisted.length > 100 &&
      sameList(before.preAuthNotFound.sort(), [
        "_execute_participation_delink:property_not_found",
        "confirm_transaction_still_active:property_not_found",
        "create_ea_operational_property:chain_not_found",
        "create_searching_placeholder_for_sale:sale_not_found",
        "establish_connected_hop:purchase_not_found",
        "link_sale_to_searching_placeholder:property_not_found",
      ]) &&
      sameList(before.unscoped.sort(), [...revokedNames, "get_next_chain_position"].sort()),
    `inventory: the scan is not vacuous: before this proposal it finds exactly the six not-found probes and seven unguarded functions fixed here (found: ${[...before.preAuthNotFound, ...before.unscoped].join(", ")})`
  );
  assert(
    preAuthNotFound.length === 0,
    `inventory: no user-callable function answers not-found before authorising, outside the reviewed id/token cases (found: ${preAuthNotFound.join(", ") || "none"})`
  );
  assert(
    unscoped.length === 0,
    `inventory: every user-callable function checks its caller, is revoked by a proposal, or is on the reviewed list (unreviewed: ${unscoped.join(", ") || "none"})`
  );
}

// ---------------------------------------------------------------------------
// chains attribution guard (20261021170000)
// ---------------------------------------------------------------------------

{
  const raw = read(CHAINS_GUARD);
  const sql = code(raw);
  const flat = squash(sql);
  const doBlocks = [...sql.matchAll(/do \$\$[\s\S]*?\n\$\$;/g)].map((match) => match[0]);
  const body = squash(functionBody(sql, "_trg_chains_enforce_attribution"));

  assert(raw.startsWith("-- PROPOSED — NOT APPLIED."), "chains guard: marked PROPOSED — NOT APPLIED");
  assert(
    doBlocks.length === 2 &&
      sql.indexOf(doBlocks[0]) < sql.search(/\bcreate (or replace )?(function|trigger)/) &&
      sql.indexOf(doBlocks[1]) > sql.indexOf("create trigger trg_chains_enforce_attribution"),
    "chains guard: preflight runs before any DDL; postflight after the trigger"
  );
  assert(
    !/\bgrant\b/.test(sql) &&
      sql.includes("revoke all on function public._trg_chains_enforce_attribution() from public, anon, authenticated;") &&
      sql.includes("alter function public._trg_chains_enforce_attribution() owner to postgres;") &&
      /\bsecurity invoker\b/.test(definerHeader(sql, "_trg_chains_enforce_attribution")) &&
      !/\b(create|drop) policy\b|\balter table\b|\b(insert into|delete from)\b/.test(sql),
    "chains guard: one invoker trigger function, no grants, no policy, table or row change"
  );
  assert(
    /create trigger trg_chains_enforce_attribution\s+before insert or update on public\.chains\s+for each row/.test(sql) &&
      flat.includes("and (t.tgtype & 2) = 2") &&
      flat.includes("chains already has a BEFORE trigger"),
    "chains guard: BEFORE INSERT OR UPDATE row trigger; preflight refuses if another BEFORE trigger could rewrite the columns"
  );
  assert(
    body.startsWith("begin if current_user <> 'authenticated' then return new; end if;") &&
      body.includes("if tg_op = 'INSERT' then new.created_by_user_id := auth.uid();") &&
      body.includes("new.created_by_user_id := old.created_by_user_id;") &&
      ["completion_date_recorded_by_user_id", "completion_date_updated_by_user_id", "completion_confirmed_by_user_id"].every(
        (column) =>
          body.includes(`if new.${column} is not null then new.${column} := auth.uid(); end if;`) &&
          body.includes(`if new.${column} is not null and new.${column} is distinct from old.${column} then new.${column} := auth.uid(); end if;`)
      ),
    "chains guard: direct client writes can only attribute the caller; creator is immutable on update; owner-run functions and service_role are unaffected"
  );
  const writers = ["lib/recordChainCompletionDate.ts", "lib/amendChainCompletionDate.ts", "lib/confirmChainCompletion.ts"].map(read);
  assert(
    /completion_date_recorded_by_user_id:\s*params\.userId/.test(writers[0]) &&
      /completion_date_updated_by_user_id:\s*null/.test(writers[0]) &&
      /completion_date_updated_by_user_id:\s*params\.userId/.test(writers[1]) &&
      /completion_confirmed_by_user_id:\s*params\.userId/.test(writers[2]),
    "chains guard: the app's three completion writers attribute only the signed-in user, so none changes behaviour"
  );
}

for (const [label, file] of [
  ["visibility", VISIBILITY],
  ["former branch", FORMER_BRANCH],
  ["probes", PROBES],
  ["existence probes", EXISTENCE],
] as const) {
  assert(
    !/\b(policy \w+\s+on|grant [^;]*on|revoke [^;]*on|trigger \w+[^;]*on|alter table)\s+(table\s+)?public\.(activities|chain_operational_summary|property_operational_summary|chains|chain_nodes)\b/.test(
      code(read(file))
    ),
    `${label}: no policy, grant or trigger change on activities, chains, nodes or chain summaries (generic status stays shared)`
  );
}

// ---------------------------------------------------------------------------
// Identity confidentiality: modelled test cases
// ---------------------------------------------------------------------------
//
// An offline model of the existing role helpers and of the current and
// proposed predicates (the CLAUSE and policy strings above). One chain holds
// S2, S5 and P4. H4 is buying S5: H4 is a member of S5 and holds the purchase
// row P4, on which H5 is the active counterparty seller. HX sold S5 before H5
// (identity revoked). Branch B5 (staff E5) actively represents H5 on S5 and
// P4. Branch BF (staff EF) represented H5 on S5 before H5 removed it; its
// entitlement later ended. EO belongs to an unrelated branch. Outside the
// chain: U was originated by EF for BF (assignment revoked, never claimed),
// U2 by E5 for B5 (active, invitation pending), and N is H9's own new
// property before anyone joins (stage searching).
//
// Also in the chain, S1 is the buyer's unclaimed sale, originated by E2 for
// branch B2 (active) and linked to S5, so B2 is "the branch acting for the
// buyer" when H5 appoints an agent on S5. Outside the chain, HX created G
// and R and has since been removed: G's appointed branch BF was revoked by
// homeowner_left_cascade (the reconnection path), R never had an agent.
// Directory-listed (eligible) branches are B5, B2 and BO; BF's entitlement
// ended. H5 has set profiles.account_type to estate_agent (client-writable).

type User = "H2" | "H4" | "H5" | "HX" | "H9" | "E5" | "EF" | "EO" | "E2";
type Property = "S1" | "S2" | "S5" | "P4" | "U" | "U2" | "N" | "G" | "R";
type Assignment = { property: Property; branch: string; status: "active" | "revoked"; reason?: "homeowner_left_cascade" };
type DelinkEvent = { id: string; property: Property; actor: string; branch: string | null };
type ClaimRow = { property: Property };

const CHAIN: Property[] = ["S1", "S2", "S5", "P4"];
const sellerSideOwner: Partial<Record<Property, User>> = { S2: "H2", S5: "H5", P4: "H5" };
const identities: Record<Property, { user: User; active: boolean }[]> = {
  S1: [],
  S2: [{ user: "H2", active: true }],
  S5: [
    { user: "HX", active: false },
    { user: "H5", active: true },
  ],
  P4: [{ user: "H4", active: true }],
  U: [],
  U2: [],
  N: [],
  G: [{ user: "HX", active: false }],
  R: [{ user: "HX", active: false }],
};
const members: Record<Property, User[]> = {
  S1: [],
  S2: ["H2"],
  S5: ["H5", "H4"],
  P4: ["H4"],
  U: [],
  U2: [],
  N: [],
  G: [],
  R: [],
};
const creators: Record<Property, User> = { S1: "E2", S2: "H2", S5: "H5", P4: "H4", U: "EF", U2: "E5", N: "H9", G: "HX", R: "HX" };
const addresses: Record<Property, string> = {
  S1: "addr-S1",
  S2: "addr-S2",
  S5: "addr-S5",
  P4: "addr-P4",
  U: "addr-U",
  U2: "addr-U2",
  N: "addr-N",
  G: "addr-G",
  R: "addr-R",
};
const searching: Property[] = ["N"];
const invitationPending: Partial<Record<Property, boolean>> = { U2: true };
const branchStaff: Record<string, User[]> = { B5: ["E5"], BF: ["EF"], BO: ["EO"], BX: [], B2: ["E2"] };
const directory = ["B5", "B2", "BO"];
/** Branch active on the sale that links into a row: the buyer household's own sale (S1 links to S5). */
const linkedSaleBranch: Partial<Record<Property, string>> = { S5: "B2" };
const accountType: Partial<Record<User, "estate_agent">> = { H5: "estate_agent", E5: "estate_agent", EF: "estate_agent", EO: "estate_agent", E2: "estate_agent" };
const assignmentRows: Assignment[] = [
  { property: "S5", branch: "BF", status: "revoked" },
  { property: "S5", branch: "B5", status: "active" },
  { property: "P4", branch: "BX", status: "revoked" },
  { property: "P4", branch: "B5", status: "active" },
  { property: "U", branch: "BF", status: "revoked" },
  { property: "U2", branch: "B5", status: "active" },
  { property: "S1", branch: "B2", status: "active" },
  { property: "G", branch: "BF", status: "revoked", reason: "homeowner_left_cascade" },
];
const delinkEvents: DelinkEvent[] = [
  { id: "S5 owner removed BF", property: "S5", actor: "H5", branch: "BF" },
  { id: "S5 B5 released", property: "S5", actor: "E5", branch: "B5" },
  { id: "P4 owner removed BX", property: "P4", actor: "H5", branch: "BX" },
  { id: "S5 previous seller left", property: "S5", actor: "HX", branch: null },
  { id: "S5 branch access ended (BF)", property: "S5", actor: "system", branch: "BF" },
  { id: "G homeowner removed", property: "G", actor: "HX", branch: null },
  { id: "R homeowner removed", property: "R", actor: "HX", branch: null },
];
const delays = [{ id: "D5", property: "S5" as Property, status: "resolved", reason: "searches_delayed" }];
const [eRemovedBF, eReleasedB5, eRemovedBX, eGeneric, eAccessEnded] = delinkEvents;

const isSellerSide = (user: User, property: Property) => sellerSideOwner[property] === user;
const isActiveHolder = (user: User, property: Property) =>
  identities[property].some((row) => row.user === user && row.active);
const isAnyHolder = (user: User, property: Property) => identities[property].some((row) => row.user === user);
const isMember = (user: User, property: Property) => members[property].includes(user);
const inBranch = (user: User, branch: string) => (branchStaff[branch] ?? []).includes(user);
const isEaAssigned = (user: User, property: Property) =>
  assignmentRows.some((row) => row.property === property && row.status === "active" && inBranch(user, row.branch));
const everAssignedBranchMember = (user: User, property: Property) =>
  assignmentRows.some((row) => row.property === property && inBranch(user, row.branch));
const isOperationalParticipant = (user: User, property: Property) =>
  isActiveHolder(user, property) || isSellerSide(user, property) || isMember(user, property) || isEaAssigned(user, property);
const isChainViewer = (user: User) =>
  CHAIN.some((property) => isMember(user, property) || isEaAssigned(user, property));
const canOperate = (user: User, property: Property) =>
  isActiveHolder(user, property) || isSellerSide(user, property) || isEaAssigned(user, property);
const isLatestAssignment = (row: Assignment) =>
  assignmentRows.filter((other) => other.property === row.property).at(-1) === row;

type DelinkOptions = { ok: boolean; error?: string; options: string[]; signals: Record<string, boolean> };
type ActivityLabel = (user: User, property: Property | null, requested: string) => string;
type RpcLabel = (user: User, property: Property) => string;
type ReconnectList = (user: User) => string[];
type Reconnect = (user: User, property: Property, branch: string) => string;
type ChainRow = { address: string | null; createdBy: User | null } | null;
type Rpc = "assign" | "report" | "break" | "convert" | "resolve";
type Target = Property | "missing";

/** The shared chain view row (chain_properties_participant) a user receives. */
const chainRow =
  (maskCreator: boolean) =>
  (user: User, property: Property): ChainRow =>
    isChainViewer(user) && CHAIN.includes(property)
      ? {
          address: isMember(user, property) || isEaAssigned(user, property) ? addresses[property] : null,
          createdBy: !maskCreator || creators[property] === user ? creators[property] : null,
        }
      : null;

const policies = {
  current: {
    assignment: (user: User, row: Assignment) => isMember(user, row.property) || inBranch(user, row.branch),
    entry: (user: User, row: Assignment) =>
      row.status === "active" && (isMember(user, row.property) || inBranch(user, row.branch)),
    delink: (user: User, event: DelinkEvent) =>
      event.actor === user || isAnyHolder(user, event.property) || everAssignedBranchMember(user, event.property),
    claim: (user: User, row: ClaimRow) => isMember(user, row.property) || isEaAssigned(user, row.property),
    lifecycle: (user: User, property: Property) =>
      isOperationalParticipant(user, property) || everAssignedBranchMember(user, property),
    dashboard: (user: User) =>
      assignmentRows
        .filter((row) => (row.status === "active" || row.status === "revoked") && inBranch(user, row.branch))
        .map((row) => addresses[row.property]),
    property: (user: User, property: Property) =>
      isMember(user, property) ||
      isEaAssigned(user, property) ||
      (creators[property] === user && members[property].length === 0),
    delinkOptions: (user: User, property: Property | "missing"): DelinkOptions => {
      if (property === "missing") return { ok: false, error: "property_not_found", options: [], signals: {} };
      const callerBranch = isEaAssigned(user, property);
      return {
        ok: true,
        options: [
          ...(isActiveHolder(user, property) ? ["homeowner_self"] : []),
          ...(isSellerSide(user, property) ? ["homeowner_remove_ea"] : []),
          ...(callerBranch ? ["estate_agent_remove_branch"] : []),
        ],
        signals: { invitation_pending: Boolean(invitationPending[property]), is_operational_homeowner: isActiveHolder(user, property) },
      };
    },
    activityLabel: ((_user: User, _property: Property | null, requested: string) => requested) as ActivityLabel,
    /** break_chain_connection / convert_searching_placeholder_for_sale label. */
    rpcLabel: ((user: User) => (accountType[user] === "estate_agent" ? "estate_agent" : "homeowner")) as RpcLabel,
    chainRow: chainRow(false),
    reconnectList: ((user: User) =>
      assignmentRows
        .filter(
          (row) =>
            row.reason === "homeowner_left_cascade" &&
            row.status !== "active" &&
            inBranch(user, row.branch) &&
            !searching.includes(row.property) &&
            !sellerSideOwner[row.property] &&
            isLatestAssignment(row)
        )
        .map((row) => addresses[row.property])) as ReconnectList,
    reconnect: ((user: User, property: Property, branch: string) =>
      assignmentRows.some(
        (row) =>
          row.property === property &&
          row.branch === branch &&
          row.reason === "homeowner_left_cascade" &&
          inBranch(user, branch) &&
          !sellerSideOwner[property] &&
          isLatestAssignment(row)
      )
        ? "ok"
        : "not_reconnectable") as Reconnect,
    probe: (rpc: Rpc, user: User, target: Target): string => {
      if (rpc === "resolve") {
        const delay = delays.find((row) => row.property === target);
        if (!delay) return "delay_not_found";
        if (delay.status === "resolved") return `already_resolved:${delay.reason}`;
        return canOperate(user, delay.property) ? "ok" : "forbidden";
      }
      if (target === "missing") return rpc === "convert" ? "sale_not_found" : "property_not_found";
      if (rpc === "assign") {
        if (searching.includes(target)) return "invalid_property";
        return isSellerSide(user, target) ? "ok" : "not_authorized";
      }
      if (rpc === "convert" && searching.includes(target)) return "invalid_sale";
      if (canOperate(user, target)) return "ok";
      return rpc === "report" ? "forbidden" : "not_authorized";
    },
    assign: (user: User, property: Target, branch: string): string => {
      if (!(branch in branchStaff)) return "branch_not_found";
      if (property === "missing") return "property_not_found";
      if (searching.includes(property)) return "invalid_property";
      if (!isSellerSide(user, property)) return "not_authorized";
      if (linkedSaleBranch[property] === branch) return "branch_acts_for_buyer";
      const existing = assignmentRows.find((row) => row.property === property && row.status === "active");
      return existing?.branch === branch || directory.includes(branch) ? "ok" : "branch_not_found";
    },
  },
  proposed: {
    assignment: (user: User, row: Assignment) =>
      row.status === "active" && (isSellerSide(user, row.property) || inBranch(user, row.branch)),
    entry: (user: User, row: Assignment) =>
      row.status === "active" && (isSellerSide(user, row.property) || inBranch(user, row.branch)),
    delink: (user: User, event: DelinkEvent) =>
      event.actor === user ||
      (event.branch === null && (isActiveHolder(user, event.property) || isEaAssigned(user, event.property))) ||
      (event.branch !== null && (isSellerSide(user, event.property) || inBranch(user, event.branch))),
    claim: (user: User, row: ClaimRow) => isSellerSide(user, row.property) || isEaAssigned(user, row.property),
    lifecycle: (user: User, property: Property) => isOperationalParticipant(user, property),
    dashboard: (user: User) =>
      assignmentRows.filter((row) => row.status === "active" && inBranch(user, row.branch)).map((row) => addresses[row.property]),
    property: (user: User, property: Property) =>
      isMember(user, property) ||
      isEaAssigned(user, property) ||
      (creators[property] === user &&
        members[property].length === 0 &&
        !assignmentRows.some((row) => row.property === property) &&
        identities[property].length === 0 &&
        !delinkEvents.some((event) => event.property === property)),
    delinkOptions: (user: User, property: Property | "missing"): DelinkOptions => {
      const empty = { ok: true, options: [], signals: { invitation_pending: false, is_operational_homeowner: false } };
      if (property === "missing") return empty;
      const callerBranch = isEaAssigned(user, property);
      if (!(isActiveHolder(user, property) || isSellerSide(user, property) || callerBranch)) return empty;
      const sellerOrBranch = isSellerSide(user, property) || callerBranch;
      return {
        ok: true,
        options: [
          ...(isActiveHolder(user, property) ? ["homeowner_self"] : []),
          ...(isSellerSide(user, property) ? ["homeowner_remove_ea"] : []),
          ...(callerBranch ? ["estate_agent_remove_branch"] : []),
        ],
        signals: {
          invitation_pending: sellerOrBranch && Boolean(invitationPending[property]),
          is_operational_homeowner: isActiveHolder(user, property),
        },
      };
    },
    activityLabel: ((user: User, property: Property | null) =>
      property !== null && !isSellerSide(user, property) && isEaAssigned(user, property)
        ? "estate_agent"
        : "homeowner") as ActivityLabel,
    rpcLabel: ((user: User, property: Property) =>
      !isSellerSide(user, property) && isEaAssigned(user, property) ? "estate_agent" : "homeowner") as RpcLabel,
    chainRow: chainRow(true),
    reconnectList: (() => []) as ReconnectList,
    reconnect: (() => "not_reconnectable") as Reconnect,
    probe: (rpc: Rpc, user: User, target: Target): string => {
      if (rpc === "resolve") {
        const delay = delays.find((row) => row.property === target);
        if (!delay || !canOperate(user, delay.property)) return "forbidden";
        return delay.status === "resolved" ? `already_resolved:${delay.reason}` : "ok";
      }
      const authorised =
        target !== "missing" && (rpc === "assign" ? isSellerSide(user, target) : canOperate(user, target));
      if (!authorised) return rpc === "report" ? "forbidden" : "not_authorized";
      if (rpc === "assign" && searching.includes(target)) return "invalid_property";
      if (rpc === "convert" && searching.includes(target)) return "invalid_sale";
      return "ok";
    },
    assign: (user: User, property: Target, branch: string): string => {
      if (!(branch in branchStaff)) return "branch_not_found";
      if (property === "missing" || !isSellerSide(user, property)) return "not_authorized";
      if (searching.includes(property)) return "invalid_property";
      const existing = assignmentRows.find((row) => row.property === property && row.status === "active");
      return existing?.branch === branch || directory.includes(branch) ? "ok" : "branch_not_found";
    },
  },
};
type Policies = (typeof policies)["proposed"];

/** Branches the user can identify on a property through any narrowed path. */
function branchesVisible(p: Policies, user: User, property: Property): string[] {
  const found = new Set<string>();
  for (const row of assignmentRows.filter((r) => r.property === property)) {
    if (p.assignment(user, row) || p.entry(user, row)) found.add(row.branch);
  }
  for (const event of delinkEvents.filter((e) => e.property === property && e.branch)) {
    if (p.delink(user, event)) found.add(event.branch!);
  }
  return [...found].sort();
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const { current, proposed } = policies;
const everyone: User[] = ["H2", "H4", "H5", "HX", "H9", "E5", "EF", "EO", "E2"];

const [rowBFonS5, rowB5onS5, , rowB5onP4, rowBFonU] = assignmentRows;

// 1. Position 2 trying to identify the agent at position 5.
assert(
  same(branchesVisible(proposed, "H2", "S5"), []) && same(branchesVisible(proposed, "H2", "P4"), []) &&
    !proposed.claim("H2", { property: "S5" }) &&
    same(proposed.delinkOptions("H2", "S5"), proposed.delinkOptions("H2", "missing")),
  "case 1 position 2 -> position 5: no agent, branch or seller identity on any narrowed path, and the options RPC says nothing"
);

// 2. A buyer trying to identify the seller's agent.
assert(
  same(branchesVisible(current, "H4", "S5"), ["B5", "BF"]) && same(branchesVisible(current, "H4", "P4"), ["B5", "BX"]) &&
    current.claim("H4", { property: "S5" }),
  "case 2 buyer -> seller's agent (current): the buyer can identify the seller's agents and read the seller's invite details today"
);
assert(
  same(branchesVisible(proposed, "H4", "S5"), []) && same(branchesVisible(proposed, "H4", "P4"), []) &&
    !proposed.claim("H4", { property: "S5" }) &&
    !proposed.delinkOptions("H4", "S5").options.includes("homeowner_remove_ea"),
  "case 2 buyer -> seller's agent (proposed): nothing on the sale or on the buyer's own purchase row"
);

// 3. A homeowner seeing their own assigned agent.
assert(
  proposed.entry("H5", rowB5onS5) && proposed.entry("H5", rowB5onP4) && proposed.assignment("H5", rowB5onS5) &&
    proposed.claim("H5", { property: "S5" }) && proposed.delinkOptions("H5", "S5").options.includes("homeowner_remove_ea"),
  "case 3 homeowner -> own agent: H5 sees the branch representing them on their sale and on the buyer's purchase row"
);
assert(
  !proposed.assignment("H5", rowBFonS5) && proposed.delink("H5", eRemovedBF),
  "case 3 homeowner -> own history: revoked assignment rows are hidden; removal events about their own sale stay visible"
);

// 4. Current authorised branch staff seeing their own assignments.
assert(
  proposed.assignment("E5", rowB5onS5) && proposed.assignment("E5", rowB5onP4) && proposed.entry("E5", rowB5onS5) &&
    proposed.claim("E5", { property: "S5" }) && proposed.delink("E5", eReleasedB5) &&
    proposed.lifecycle("E5", "S5") && proposed.property("E5", "S5") && proposed.property("E5", "U2") &&
    same(proposed.dashboard("E5"), current.dashboard("E5")) &&
    proposed.delinkOptions("E5", "U2").signals.invitation_pending,
  "case 4 current branch staff: E5 keeps assignments, labels, claim metadata, events, lifecycle, property rows, dashboard and options"
);
assert(
  !proposed.assignment("E5", rowBFonS5) && !proposed.delink("E5", eRemovedBF) && !proposed.delink("E5", eRemovedBX),
  "case 4 current branch staff: E5 cannot see other branches' assignments or removal events"
);

// 5. A former branch being unable to read identifiable property data.
assert(
  current.lifecycle("EF", "S5") && current.property("EF", "U") && current.dashboard("EF").includes("addr-S5") &&
    current.dashboard("EF").includes("addr-U") && current.delink("EF", eGeneric),
  "case 5 former branch (current): BF still reads S5 lifecycle, its dashboard addresses, the unclaimed U row and generic S5 events"
);
assert(
  !proposed.lifecycle("EF", "S5") && !proposed.lifecycle("EF", "U") && !proposed.property("EF", "U") &&
    !proposed.property("EF", "S5") && same(proposed.dashboard("EF"), []) && !proposed.delink("EF", eGeneric) &&
    !proposed.assignment("EF", rowBFonS5) && !proposed.assignment("EF", rowBFonU) &&
    !proposed.claim("EF", { property: "S5" }),
  "case 5 former branch (proposed): no lifecycle, property row, address, dashboard row, generic event, assignment or claim data"
);
assert(
  !proposed.delink("HX", { ...eGeneric, actor: "H5" }) && proposed.delink("HX", eGeneric),
  "case 5 former homeowner: HX no longer reads later S5 events, but still sees the event they made"
);

// 6. A former branch unable to identify its successor through delink metadata.
assert(
  current.delink("EF", eReleasedB5) && !proposed.delink("EF", eReleasedB5) && same(branchesVisible(proposed, "EF", "S5"), ["BF"]),
  "case 6 former branch -> successor: BF can no longer read B5's id from delink metadata; only events about BF itself"
);

// 7 and 8. Branch-access termination: represented homeowner and affected branch
// only; nobody else in the chain.
assert(
  proposed.delink("H5", eAccessEnded) && proposed.delink("EF", eAccessEnded),
  "case 7 branch access ended: the represented homeowner and staff of the affected branch see the event"
);
assert(
  (["H2", "H4", "HX", "H9", "E5", "EO", "E2"] as User[]).every((user) => !proposed.delink(user, eAccessEnded)) &&
    (["H4", "HX", "E5"] as User[]).some((user) => current.delink(user, eAccessEnded)),
  "case 8 branch access ended: buyer, other positions, former holder, successor and unrelated branches do not see it (today some would)"
);

// 9. An unauthorised caller querying arbitrary property ids through the
//    delink-options RPC.
assert(
  !same(current.delinkOptions("EO", "U2"), current.delinkOptions("EO", "missing")) &&
    current.delinkOptions("EO", "U2").signals.invitation_pending,
  "case 9 delink options (current): an unrelated user can tell real ids from missing ones and read invitation_pending"
);
assert(
  (["H2", "H4", "HX", "H9", "EF", "EO"] as User[]).every(
    (user) =>
      same(proposed.delinkOptions(user, "U2"), proposed.delinkOptions(user, "missing")) &&
      same(proposed.delinkOptions(user, "U"), proposed.delinkOptions(user, "missing"))
  ) && same(proposed.delinkOptions("EO", "S5"), proposed.delinkOptions("EO", "missing")),
  "case 9 delink options (proposed): unrelated users, former branches and buyers get an identical empty answer for real and missing ids"
);
assert(
  same(proposed.delinkOptions("H4", "P4").options, ["homeowner_self"]) &&
    !proposed.delinkOptions("H4", "P4").signals.invitation_pending,
  "case 9 delink options: the buyer holding a purchase row keeps only their own leave option, without seller-side signals"
);

// 10. Generic status updates and actor labels remain visible to the chain.
assert(
  (["H2", "H4", "H5", "E5"] as User[]).every((user) => isChainViewer(user)) &&
    (["EF", "EO", "HX", "H9"] as User[]).every((user) => !isChainViewer(user)),
  "case 10 generic status: every current chain participant and the active branch read the timeline; former and unrelated users do not"
);
assert(
  proposed.activityLabel("E5", "S5", "homeowner") === "estate_agent" &&
    proposed.activityLabel("H5", "S5", "estate_agent") === "homeowner" &&
    proposed.activityLabel("H5", "S5", "Acme Estates Bristol") === "homeowner" &&
    proposed.activityLabel("H2", null, "system") === "homeowner" &&
    current.activityLabel("H5", "S5", "Acme Estates Bristol") === "Acme Estates Bristol",
  "case 10 actor labels: generic Homeowner / Estate Agent attribution is derived, so a user cannot claim another role or insert a name"
);
assert(
  everyone.every((user) =>
    CHAIN.every((property) => proposed.lifecycle(user, property) === isOperationalParticipant(user, property))
  ),
  "case 10 generic status: lifecycle state stays readable by every current operational participant"
);

// 11. Homeowner A cannot identify homeowner B.
assert(
  current.chainRow("H2", "S5")?.createdBy === "H5" && current.chainRow("H4", "S2")?.createdBy === "H2",
  "case 11 homeowner A -> homeowner B (current): the shared chain view returns every row's creator id to every chain viewer"
);
assert(
  (["H2", "H4", "H5"] as User[]).every((viewer) =>
    CHAIN.every((property) => {
      const row = proposed.chainRow(viewer, property);
      return row !== null && (row.createdBy === null || row.createdBy === viewer);
    })
  ) &&
    proposed.chainRow("H2", "S5")?.address === null &&
    !proposed.claim("H2", { property: "S5" }) &&
    !proposed.property("H2", "S5") &&
    !proposed.claim("H4", { property: "S2" }) &&
    !proposed.property("H4", "S2"),
  "case 11 homeowner A -> homeowner B (proposed): every chain row stays visible, but no other homeowner's id, address, invite name or email, or row"
);

// 12. An Estate Agent viewing the shared chain cannot identify another agent.
assert(
  current.chainRow("E5", "S1")?.createdBy === "E2",
  "case 12 agent -> agent (current): B5's staff read the creator id of the buyer's agent-originated sale from the shared view"
);
assert(
  proposed.chainRow("E5", "S1") !== null &&
    proposed.chainRow("E5", "S1")?.createdBy === null &&
    same(branchesVisible(proposed, "E5", "S1"), []) &&
    !proposed.claim("E5", { property: "S1" }) &&
    proposed.chainRow("E2", "S5") !== null &&
    proposed.chainRow("E2", "S5")?.createdBy === null &&
    same(branchesVisible(proposed, "E2", "S5"), []) &&
    same(branchesVisible(proposed, "E2", "P4"), []) &&
    !proposed.claim("E2", { property: "S5" }),
  "case 12 agent -> agent (proposed): both agents see the same chain rows and statuses as homeowners, but not each other's id, branch or assignment"
);
assert(
  proposed.chainRow("E2", "S1")?.createdBy === "E2" && proposed.chainRow("H2", "S2")?.createdBy === "H2",
  "case 12 own rows: the creator id is still returned to the creator, so own-row checks keep working"
);

// 13. A removed homeowner or creator gets no data.
const assignmentOnlyBootstrap = (user: User, property: Property) =>
  creators[property] === user &&
  members[property].length === 0 &&
  !assignmentRows.some((row) => row.property === property);
assert(
  current.property("HX", "G") && current.property("HX", "R") && assignmentOnlyBootstrap("HX", "R"),
  "case 13 removed creator (current, and an assignment-only bootstrap): HX still reads rows they created after leaving"
);
assert(
  !proposed.property("HX", "G") &&
    !proposed.property("HX", "R") &&
    !proposed.lifecycle("HX", "G") &&
    !proposed.lifecycle("HX", "R") &&
    !proposed.claim("HX", { property: "R" }) &&
    proposed.chainRow("HX", "S5") === null &&
    (["S5", "G", "R"] as Property[]).every((property) => same(branchesVisible(proposed, "HX", property), [])),
  "case 13 removed creator (proposed): no row, lifecycle, claim, chain or branch data for rows HX created or used to hold"
);
assert(
  proposed.property("H9", "N") && proposed.property("EF", "U") === false && proposed.property("E5", "U2"),
  "case 13 legitimate bootstrap: a new creator still reads their own row before any member, assignment, identity or delink event"
);

// 14. A former branch cannot reconnect, list or identify (Business Rules 7.8, 24.7).
assert(
  same(current.reconnectList("EF"), ["addr-G"]) && current.reconnect("EF", "G", "BF") === "ok",
  "case 14 former branch (current): BF lists G's address and re-appoints itself without any homeowner"
);
assert(
  everyone.every((user) => same(proposed.reconnectList(user), [])) &&
    proposed.reconnect("EF", "G", "BF") === "not_reconnectable" &&
    proposed.reconnect("EF", "G", "BF") === proposed.reconnect("EO", "S5", "BO") &&
    !proposed.property("EF", "G") &&
    same(branchesVisible(proposed, "EF", "G"), []) &&
    same(branchesVisible(proposed, "EF", "S5"), ["BF"]),
  "case 14 former branch (proposed): no reconnect list, no self re-appointment (same answer as any other probe), and no successor branch"
);

// 15. Unauthorised RPC probes reveal nothing.
const rpcs: Rpc[] = ["assign", "report", "break", "convert"];
const outsiders: User[] = ["H2", "HX", "H9", "EF", "EO", "E2"];
const probeTargets: Property[] = ["S5", "P4", "U2", "N", "G", "R"];
assert(
  rpcs.every((rpc) => current.probe(rpc, "EO", "S5") !== current.probe(rpc, "EO", "missing")) &&
    current.probe("convert", "EO", "N") === "invalid_sale" &&
    current.probe("resolve", "EO", "S5") === "already_resolved:searches_delayed",
  "case 15 probes (current): assign, report, break and convert tell real ids from missing ones; resolve returns another property's delay reason"
);
assert(
  rpcs.every((rpc) =>
    outsiders.every((user) =>
      probeTargets
        .filter((property) => (rpc === "assign" ? !isSellerSide(user, property) : !canOperate(user, property)))
        .every((property) => proposed.probe(rpc, user, property) === proposed.probe(rpc, user, "missing"))
    )
  ) &&
    outsiders
      .filter((user) => !canOperate(user, "S5"))
      .every((user) => proposed.probe("resolve", user, "S5") === proposed.probe("resolve", user, "missing")) &&
    (["H2", "EO"] as User[]).every((user) =>
      (["S5", "N", "missing"] as Target[]).every((target) => proposed.assign(user, target, "B5") === "not_authorized")
    ),
  "case 15 probes (proposed): every unauthorised caller gets the same answer for real and missing ids on every RPC"
);

// 16. Appointment does not depend on, or reveal, another household's agent.
// B2 acts for the buyer household's own sale S1, which links into S5.
assert(
  current.assign("H5", "S5", "B2") === "branch_acts_for_buyer",
  "case 16 appoint (current): the seller is refused the branch selling the buyer household's home and is told why"
);
assert(
  proposed.assign("H5", "S5", "B2") === "ok" &&
    proposed.assign("H5", "S5", "B2") === proposed.assign("H5", "S5", "BO") &&
    proposed.assign("H5", "S5", "BF") === proposed.assign("H5", "S5", "NO_SUCH_BRANCH"),
  "case 16 appoint (proposed): the branch selling the buyer household's home is appointed like any eligible branch; ineligible and unknown branches stay branch_not_found"
);

// 17. Client-supplied roles cannot falsify attribution.
assert(
  current.rpcLabel("H5", "S5") === "estate_agent" &&
    proposed.rpcLabel("H5", "S5") === "homeowner" &&
    proposed.rpcLabel("E5", "S5") === "estate_agent" &&
    proposed.rpcLabel("H4", "P4") === "homeowner" &&
    proposed.activityLabel("H5", "S5", "system") === "homeowner" &&
    proposed.activityLabel("E5", "S5", "system") === "estate_agent",
  "case 17 attribution: profiles.account_type and a requested 'system' or role no longer change the label on any write path"
);

// 18. Legitimate workflows remain authorised.
assert(
  proposed.assign("H5", "S5", "BO") === "ok" &&
    proposed.assign("H5", "S5", "B5") === "ok" &&
    proposed.probe("report", "E5", "S5") === "ok" &&
    proposed.probe("report", "H5", "S5") === "ok" &&
    proposed.probe("break", "H5", "S5") === "ok" &&
    proposed.probe("convert", "E5", "S5") === "ok" &&
    proposed.probe("report", "H4", "P4") === "ok" &&
    proposed.probe("resolve", "E5", "S5") === "already_resolved:searches_delayed" &&
    same(proposed.dashboard("E5"), current.dashboard("E5")) &&
    proposed.delinkOptions("H5", "S5").options.includes("homeowner_remove_ea"),
  "case 18 legitimate workflows: appointing, reporting, breaking, converting, resolving, the branch dashboard and removal still work for authorised users"
);

// 19–20. Remaining existence probes (B3, 20261021160000). U is unrepresented
// (seller side unclaimed), so it is the only row with a confirmation clock; H4
// holds the purchase P4 and is its dependent side. Every chain other than the
// shared one holds a single row. H2 created the shared chain.
const relationship = (property: Property) => (property === "P4" ? "purchase" : "sale");
const unrepresented: Property[] = ["U"];
const dependentSide = (user: User, property: Property) => property === "P4" && isActiveHolder(user, "P4");
const chainOf = (property: Property) => (CHAIN.includes(property) ? "C1" : `C-${property}`);
const chainRows = (chain: string) => (["S1", "S2", "S5", "P4", "U", "U2", "N", "G", "R"] as Property[]).filter((p) => chainOf(p) === chain);
const chainCreator: Record<string, User> = { C1: "H2" };
type DelinkOp = "homeowner_self" | "homeowner_remove_ea" | "estate_agent_remove_branch" | "estate_agent_remove_homeowner";

const b3 = (fixed: boolean) => ({
  confirm: (user: User, target: Target): string => {
    if (target === "missing") return fixed ? "not_authorised" : "property_not_found";
    if (!unrepresented.includes(target)) {
      if (fixed && !dependentSide(user, target) && !canOperate(user, target)) return "not_authorised";
      return "ok:managed";
    }
    return dependentSide(user, target) ? "ok" : "not_authorised";
  },
  placeholder: (user: User, target: Target): string => {
    if (target === "missing") return fixed ? "not_authorized" : "sale_not_found";
    if (fixed && !canOperate(user, target)) return "not_authorized";
    if (searching.includes(target)) return "invalid_sale";
    return canOperate(user, target) ? "ok" : "not_authorized";
  },
  link: (user: User, sale: Target, placeholder: Target): string => {
    if (fixed) {
      if (sale === "missing" || !canOperate(user, sale)) return "forbidden";
      if (placeholder === "missing" || chainOf(sale) !== chainOf(placeholder)) return "chain_mismatch";
    } else {
      if (sale === "missing" || placeholder === "missing") return "property_not_found";
      if (chainOf(sale) !== chainOf(placeholder)) return "chain_mismatch";
    }
    if (searching.includes(sale)) return "invalid_sale";
    if (!searching.includes(placeholder)) return "invalid_searching_placeholder";
    return canOperate(user, sale) ? "ok" : "forbidden";
  },
  hop: (user: User, target: Target): string => {
    if (target === "missing") return fixed ? "not_authorized" : "purchase_not_found";
    if (fixed && !canOperate(user, target)) return "not_authorized";
    if (relationship(target) !== "purchase") return "not_purchase";
    return canOperate(user, target) ? "ok" : "not_authorized";
  },
  delink: (op: DelinkOp, user: User, target: Target, branch: string | null): string => {
    if (target === "missing") {
      if (!fixed) return "property_not_found";
      if (op === "homeowner_self" || op === "homeowner_remove_ea") return "not_operational_homeowner";
      return op === "estate_agent_remove_branch" && branch === null ? "branch_required" : "not_assigned_ea";
    }
    const active = assignmentRows.filter((row) => row.property === target && row.status === "active");
    if (op === "homeowner_self") return isActiveHolder(user, target) ? "ok" : "not_operational_homeowner";
    if (op === "homeowner_remove_ea") {
      if (!isSellerSide(user, target)) return "not_operational_homeowner";
      return active.length ? "ok" : "no_active_ea_assignment";
    }
    if (op === "estate_agent_remove_branch") {
      const resolved = branch ?? active.find((row) => inBranch(user, row.branch))?.branch ?? null;
      if (resolved === null) return "branch_required";
      return active.some((row) => row.branch === resolved && inBranch(user, resolved)) ? "ok" : "not_assigned_ea";
    }
    return isEaAssigned(user, target) ? "ok" : "not_assigned_ea";
  },
  eaCreate: (user: User, chain: string, branch: string): string => {
    if (!inBranch(user, branch)) return "not_ea_branch_member";
    const rows = chainRows(chain);
    if (!fixed && rows.length === 0 && chainCreator[chain] === undefined) return "chain_not_found";
    const branchAuthorised = rows.some((p) => assignmentRows.some((row) => row.property === p && row.branch === branch && row.status === "active"));
    const emptySelfOriginated = chainCreator[chain] === user && rows.length === 0;
    return branchAuthorised || emptySelfOriginated ? "ok" : "not_authorised_for_chain";
  },
  nextPosition: (user: User, chain: string): number => {
    const rows = chainRows(chain);
    const mayPlace = chainCreator[chain] === user || rows.some((p) => isMember(user, p));
    const views = rows.some((p) => isMember(user, p) || isEaAssigned(user, p));
    const operates = rows.some((p) => canOperate(user, p));
    if (fixed && !(mayPlace || views || operates)) return 1;
    return rows.length + 1;
  },
});
const b3Current = b3(false);
const b3Proposed = b3(true);
const delinkOps: DelinkOp[] = ["homeowner_self", "homeowner_remove_ea", "estate_agent_remove_branch", "estate_agent_remove_homeowner"];
const allTargets: Property[] = ["S1", "S2", "S5", "P4", "U", "U2", "N", "G", "R"];
const noRole = (user: User, property: Property) =>
  !canOperate(user, property) && !dependentSide(user, property) && !isActiveHolder(user, property) && !isEaAssigned(user, property);

assert(
  b3Current.confirm("EO", "S5") !== b3Current.confirm("EO", "missing") &&
    b3Current.placeholder("EO", "S5") !== b3Current.placeholder("EO", "missing") &&
    b3Current.link("EO", "S5", "N") !== b3Current.link("EO", "missing", "N") &&
    b3Current.hop("EO", "P4") !== b3Current.hop("EO", "missing") &&
    delinkOps.every((op) => b3Current.delink(op, "EO", "S5", null) !== b3Current.delink(op, "EO", "missing", null)) &&
    b3Current.eaCreate("EO", "C1", "BO") !== b3Current.eaCreate("EO", "C-missing", "BO") &&
    b3Current.nextPosition("EO", "C1") !== b3Current.nextPosition("EO", "C-missing"),
  "case 19 probes (current): confirm, create placeholder, link, hop, every delink operation, EA create and next position tell a real id from a missing one"
);
assert(
  outsiders.every((user) =>
    allTargets
      .filter((property) => noRole(user, property))
      .every(
        (property) =>
          b3Proposed.confirm(user, property) === b3Proposed.confirm(user, "missing") &&
          b3Proposed.placeholder(user, property) === b3Proposed.placeholder(user, "missing") &&
          b3Proposed.link(user, property, "N") === b3Proposed.link(user, "missing", "N") &&
          b3Proposed.hop(user, property) === b3Proposed.hop(user, "missing") &&
          delinkOps.every((op) =>
            [null, "B5", "BO"].every((branch) => b3Proposed.delink(op, user, property, branch) === b3Proposed.delink(op, user, "missing", branch))
          )
      )
  ) &&
    (["EO", "EF"] as User[]).every((user) =>
      ["C1", "C-U2", "C-N"].every((chain) => b3Proposed.eaCreate(user, chain, user === "EO" ? "BO" : "BF") === b3Proposed.eaCreate(user, "C-missing", user === "EO" ? "BO" : "BF"))
    ) &&
    outsiders
      .filter((user) => user !== "H2" && !chainRows("C1").some((p) => isMember(user, p) || isEaAssigned(user, p) || canOperate(user, p)))
      .every((user) => b3Proposed.nextPosition(user, "C1") === b3Proposed.nextPosition(user, "C-missing")),
  "case 19 probes (proposed): for every caller with no role on the row, each function gives a real id exactly the answer it gives a missing one"
);
assert(
  b3Proposed.confirm("H4", "P4") === "ok:managed" &&
    b3Proposed.confirm("H5", "P4") === "ok:managed" &&
    b3Proposed.confirm("H4", "U") === "not_authorised" &&
    b3Proposed.placeholder("E5", "S5") === "ok" &&
    b3Proposed.placeholder("E5", "P4") === "ok" &&
    b3Proposed.link("E5", "S5", "N") === "chain_mismatch" &&
    b3Proposed.link("E5", "S5", "S2") === "invalid_searching_placeholder" &&
    b3Proposed.hop("H5", "P4") === "ok" &&
    b3Proposed.hop("H5", "S5") === "not_purchase" &&
    b3Proposed.delink("homeowner_remove_ea", "H5", "S5", null) === "ok" &&
    b3Proposed.delink("homeowner_self", "H4", "P4", null) === "ok" &&
    b3Proposed.delink("estate_agent_remove_branch", "E5", "S5", null) === "ok" &&
    b3Proposed.delink("estate_agent_remove_homeowner", "E5", "S5", null) === "ok" &&
    b3Proposed.eaCreate("E5", "C1", "B5") === "ok" &&
    b3Proposed.eaCreate("EO", "C1", "B5") === "not_ea_branch_member" &&
    b3Proposed.nextPosition("H2", "C1") === 5 &&
    b3Proposed.nextPosition("E5", "C1") === 5 &&
    allTargets.every((property) =>
      everyone
        .filter((user) => !noRole(user, property))
        .every(
          (user) =>
            b3Proposed.confirm(user, property) === b3Current.confirm(user, property) &&
            b3Proposed.placeholder(user, property) === b3Current.placeholder(user, property) &&
            b3Proposed.hop(user, property) === b3Current.hop(user, property) &&
            delinkOps.every((op) => b3Proposed.delink(op, user, property, null) === b3Current.delink(op, user, property, null))
        )
    ),
  "case 20 authorised callers: owners, operators and the dependent side get the same answers and the same useful errors as today"
);

// 21. B1: one branch may represent several selling households in a chain.
// Household X sells SX and buys PX (its onward purchase; SX links to PX).
// Household Y sells PX (the counterparty seller on X's purchase row).
// Household Z sells SZ elsewhere in the chain; QZ is Z's searching
// placeholder. FR is a sale in another chain. An assignment always represents
// a row's seller side; there is no buyer-side assignment.
{
  type B1User = "X" | "Y" | "Z" | "F" | "HO" | "eb" | "ec" | "el" | "eu";
  type B1Row = "SX" | "PX" | "SZ" | "QZ" | "FR";
  type B1Target = B1Row | "missing";
  type B1State = Partial<Record<B1Row, string>>;
  const rows: B1Row[] = ["SX", "PX", "SZ", "QZ", "FR"];
  const staff: Record<string, B1User[]> = { B: ["eb"], C: ["ec"], L: ["el"], U: ["eu"] };
  const listed = ["B", "C", "L"];
  const branchIds = ["B", "C", "L", "U", "NO_SUCH_BRANCH"];
  const households: B1User[] = ["X", "Y", "Z", "F", "HO"];
  const b1Users: B1User[] = [...households, "eb", "ec", "el", "eu"];
  const linkedFrom: Partial<Record<B1Row, B1Row>> = { PX: "SX" };
  const searchingRows: B1Row[] = ["QZ"];
  const sellerOf = (buyerOnly: boolean): Record<B1Row, B1User | null> => ({
    SX: "X",
    PX: buyerOnly ? null : "Y",
    SZ: "Z",
    QZ: null,
    FR: "F",
  });
  const buyerOf: Partial<Record<B1Row, B1User>> = { PX: "X" };

  const assignB1 =
    (fixed: boolean, buyerOnly = false) =>
    (state: B1State, caller: B1User, target: B1Target, branch: string): string => {
      if (!(branch in staff)) return "branch_not_found";
      if (fixed) {
        if (target === "missing" || sellerOf(buyerOnly)[target] !== caller) return "not_authorized";
        if (searchingRows.includes(target)) return "invalid_property";
      } else {
        if (target === "missing") return "property_not_found";
        if (searchingRows.includes(target)) return "invalid_property";
        if (sellerOf(buyerOnly)[target] !== caller) return "not_authorized";
        const linked = linkedFrom[target];
        if (linked && state[linked] === branch) return "branch_acts_for_buyer";
      }
      if (state[target] === branch) return "ok";
      return listed.includes(branch) ? "ok" : "branch_not_found";
    };
  const visibleBranch = (state: B1State, viewer: B1User, row: B1Row, buyerOnly = false): string | null => {
    const branch = state[row];
    if (!branch) return null;
    return sellerOf(buyerOnly)[row] === viewer || staff[branch].includes(viewer) ? branch : null;
  };
  const allStates = (vary: B1Row[]): B1State[] =>
    vary.reduce<B1State[]>(
      (states, row) => states.flatMap((state) => [undefined, "B", "C", "L"].map((branch) => (branch ? { ...state, [row]: branch } : { ...state }))),
      [{}]
    );
  const currentB1 = assignB1(false);
  const proposedB1 = assignB1(true);

  assert(
    currentB1({ SX: "B" }, "Y", "PX", "B") === "branch_acts_for_buyer" &&
      currentB1({ SX: "C" }, "Y", "PX", "B") === "ok" &&
      currentB1({ SX: "B" }, "Y", "PX", "C") === "ok",
    "case 21 B1 (current): Y is refused the branch that sells X's home, and the refusal tells Y which branch X uses"
  );

  let state: B1State = { SX: "B" };
  const yAppoints = proposedB1(state, "Y", "PX", "B");
  state = { ...state, PX: "B" };
  const zAppoints = proposedB1(state, "Z", "SZ", "B");
  state = { ...state, SZ: "B" };
  assert(
    yAppoints === "ok" && zAppoints === "ok" && state.SX === "B" && state.PX === "B" && state.SZ === "B",
    "case 21 B1 (proposed): X, Y and Z, three selling households in one chain, each appoint the same branch independently"
  );
  assert(
    proposedB1({}, "X", "SX", "B") === "ok" && proposedB1({ PX: "B", SZ: "B" }, "X", "SX", "B") === "ok",
    "case 21 B1 (proposed): a household can appoint a branch that already represents other sales in the chain, in either order"
  );

  assert(
    b1Users.every((caller) =>
      (["SX", "PX", "SZ", "QZ", "FR", "missing"] as B1Target[]).every((target) =>
        branchIds.every((branch) => {
          const others = rows.filter((row) => row !== target);
          const answers = new Set(allStates(others).map((other) => proposedB1(other, caller, target, branch)));
          return answers.size === 1;
        })
      )
    ),
    "case 21 B1 (proposed): for every caller, row, branch and every combination of other rows' assignments, the appointment answer is the same (no other household's agent can be inferred)"
  );
  assert(
    (["missing", "SX", "SZ", "FR"] as B1Target[]).every((target) =>
      ["B", "C", "L", "U"].every((branch) => proposedB1(state, "Y", target, branch) === "not_authorized")
    ) &&
      (["HO", "eb", "el"] as B1User[]).every((caller) =>
        (["missing", "SX", "PX", "SZ", "FR"] as B1Target[]).every((target) =>
          ["B", "C", "L", "U"].every((branch) => proposedB1(state, caller, target, branch) === "not_authorized")
        )
      ) &&
      proposedB1(state, "X", "PX", "B") === "not_authorized" &&
      proposedB1(state, "Y", "PX", "B") === "ok" &&
      proposedB1(state, "Y", "PX", "L") === "ok" &&
      proposedB1(state, "Y", "PX", "U") === "branch_not_found" &&
      proposedB1(state, "Y", "PX", "NO_SUCH_BRANCH") === "branch_not_found" &&
      proposedB1(state, "Z", "QZ", "B") === "not_authorized",
    "case 21 B1 (proposed): unknown, foreign, searching and other households' ids all give not_authorized; the authorised seller gets ok for an eligible branch and branch_not_found for an unlisted or unknown one; agents cannot appoint"
  );

  assert(
    visibleBranch(state, "X", "SX") === "B" &&
      visibleBranch(state, "Y", "PX") === "B" &&
      visibleBranch(state, "Z", "SZ") === "B" &&
      (["SX", "PX", "SZ"] as B1Row[]).every((row) => visibleBranch(state, "eb", row) === "B") &&
      households.every((viewer) =>
        rows
          .filter((row) => sellerOf(false)[row] !== viewer)
          .every((row) => allStates([row]).every((variant) => visibleBranch({ ...state, ...variant, [row]: variant[row] }, viewer, row) === null))
      ) &&
      (["ec", "el", "eu"] as B1User[]).every((viewer) => rows.every((row) => visibleBranch(state, viewer, row) === null)),
    "case 21 B1 (proposed): each household sees only its own sale's branch; no household can see another row's branch whatever it is; the shared branch's staff see their own three assignments; other branches see none"
  );
  {
    const probes = read(PROBES);
    const viewStart = probes.indexOf("create or replace view public.chain_properties_participant");
    const view = code(probes.slice(viewStart, probes.indexOf("grant select on public.chain_properties_participant", viewStart)));
    assert(
      viewStart > -1 &&
        !/property_ea_assignments|ea_branch|branch_id|ea_operational_assignments|claim_metadata/.test(view),
      "case 21 B1: the shared chain view (chain_properties_participant) reads no assignment, branch or claim data, so it is the same whichever branches the households appoint"
    );
  }

  const buyerOnlyAssign = assignB1(true, true);
  assert(
    sellerOf(true).PX === null &&
      buyerOf.PX === "X" &&
      ["B", "C", "L", "U"].every(
        (branch) => buyerOnlyAssign({}, "X", "PX", branch) === "not_authorized" && buyerOnlyAssign({}, "X", "PX", branch) === buyerOnlyAssign({}, "X", "missing", branch)
      ) &&
      b1Users.every((caller) => ["B", "C", "L"].every((branch) => buyerOnlyAssign({}, caller, "PX", branch) !== "ok")) &&
      visibleBranch({}, "X", "PX", true) === null,
    "case 21 B1 buyer-only tile: PX has no seller side and needs no assignment; the buyer cannot attach an agent to it and nobody else can either"
  );
}

{
  const sellerSide = squash(functionBody(SELLER_SIDE_MIGRATION, "_property_seller_side_user_id"));
  const latest = latestFunctions([ATOMIC, CLEANUP, VISIBILITY, FORMER_BRANCH, ATTRIBUTION, PROBES, EXISTENCE, CHAINS_GUARD]);
  const startMove = read(ATOMIC);
  const noAssignmentNeeded = [
    "link_start_move_onward_purchase",
    "create_searching_placeholder_for_sale",
    "link_sale_to_searching_placeholder",
    "establish_connected_hop",
    "join_chain_property",
  ];
  assert(
    sellerSide.includes("when 'purchase' then") &&
      /when 'purchase' then \( select case when count\(\*\) = 1 then \(array_agg\(cp\.user_id\)\)\[1\] end from public\.property_counterparty_participants cp where cp\.property_id = p\.id and cp\.counterparty_role = 'seller' and cp\.status = 'active' \)/.test(sellerSide) &&
      !/when 'purchase' then[^)]*property_operational_identities/.test(sellerSide),
    "B1 buyer-only tile: a purchase row's seller side is only its active counterparty seller, so the buyer is never the appointing homeowner"
  );
  assert(
    noAssignmentNeeded.every((name) => latest.has(name) && !/property_ea_assignments/.test(code(latest.get(name)!.body))) &&
      startMove.indexOf("create function public.start_move_create_property(") > -1 &&
      startMove.indexOf("alter function public.start_move_create_property(") > startMove.indexOf("create function public.start_move_create_property(") &&
      !/property_ea_assignments/.test(
        code(
          startMove.slice(
            startMove.indexOf("create function public.start_move_create_property("),
            startMove.indexOf("alter function public.start_move_create_property(")
          )
        )
      ),
    `B1 buyer-only tile: creating, linking and connecting a purchase never reads or writes an Estate Agent assignment (start_move_create_property, ${noAssignmentNeeded.join(", ")})`
  );
}

// 22. A1: the context strip appears only where its labels describe the page.
// The labels come from the viewer's assigned property in the chain (agents)
// or the viewer's own position (homeowners).
const isBranchStaff = (user: User) => Object.values(branchStaff).some((staff) => staff.includes(user));
const labelsDescribe = (user: User): Property | null =>
  isBranchStaff(user)
    ? (CHAIN.find((p) => isEaAssigned(user, p)) ?? null)
    : (CHAIN.find((p) => isActiveHolder(user, p) || isSellerSide(user, p)) ?? null);
const stripShown = (fixed: boolean) => (user: User, page: Property) => {
  const ownPosition = labelsDescribe(user) === page;
  return fixed ? ownPosition : ownPosition || isBranchStaff(user);
};
assert(
  stripShown(false)("E5", "S2") && labelsDescribe("E5") !== "S2",
  "case 22 A1 (current): an agent on another property's page sees its own branch as that property's manager"
);
assert(
  everyone.every((user) => CHAIN.every((page) => !stripShown(true)(user, page) || labelsDescribe(user) === page)) &&
    stripShown(true)("E5", "S5") &&
    stripShown(true)("H5", "S5"),
  "case 22 A1 (proposed): the strip appears only on the page its labels describe; agents and homeowners still see it on their own property"
);
{
  const patch = read(A1_PATCH);
  const files = [...patch.matchAll(/^diff --git a\/(\S+) b\/\1$/gm)].map((match) => match[1]).sort();
  assert(
    JSON.stringify(files) === JSON.stringify(["app/buyer-ready/[chainId]/page.tsx", "app/property/[propertyId]/page.tsx"]) &&
      (patch.match(/^-    isOperationalDisplay \|\|$/gm) ?? []).length === 2 &&
      (patch.match(/^-    access\.viewerRole === "estate_agent";$/gm) ?? []).length === 2 &&
      patch.includes('+    access.viewerRole === "estate_agent"\n+      ? operationalSubject?.assignedPropertyId ===\n+        currentProperty.id\n+      : isOperationalDisplay;') &&
      patch.includes("+  const showOperationalContextStrip = isOperationalDisplay;") &&
      patch
        .split("\n")
        .filter((line) => /^[+-]/.test(line) && !/^(\+\+\+|---) /.test(line))
        .every((line) =>
          /^[+-]\s*\/\/|^-  const showOperationalContextStrip =$|^\+  const showOperationalContextStrip = isOperationalDisplay;$|^-    isOperationalDisplay \|\|$|^-    access\.viewerRole === "estate_agent";$|^\+    access\.viewerRole === "estate_agent"$|^\+      \? operationalSubject\?\.assignedPropertyId ===$|^\+        currentProperty\.id$|^\+      : isOperationalDisplay;$/.test(
            line
          )
        ),
    "A1 patch: only the strip's visibility changes on the property and Buyer Ready pages; labels, manager and badge logic are untouched"
  );
  const propertyPage = read("app/property/[propertyId]/page.tsx");
  const buyerReadyPage = read("app/buyer-ready/[chainId]/page.tsx");
  const resolver = read("hooks/useOperationalWorkspaceLabels.ts");
  assert(
    /assignedPropertyId:\s*operationalSubject\?\.assignedPropertyId \?\? null/.test(propertyPage) &&
      /assignedPropertyId:\s*operationalSubject\?\.assignedPropertyId \?\? null/.test(buyerReadyPage) &&
      /loadAssignmentWithBranchDirectory\(\s*supabase,\s*assignedPropertyId/.test(resolver),
    "A1 patch: the manager label is loaded for operationalSubject.assignedPropertyId, the property the patch compares with"
  );
  const unpatchedStrip = /const showOperationalContextStrip =\s*isOperationalDisplay \|\|\s*access\.viewerRole === "estate_agent";/;
  const a1Unpatched = unpatchedStrip.test(propertyPage) && unpatchedStrip.test(buyerReadyPage);
  const a1Patched =
    !unpatchedStrip.test(propertyPage) &&
    !unpatchedStrip.test(buyerReadyPage) &&
    /const showOperationalContextStrip =\s*access\.viewerRole === "estate_agent"\s*\?\s*operationalSubject\?\.assignedPropertyId ===\s*currentProperty\.id\s*:\s*isOperationalDisplay;/.test(propertyPage) &&
    /const showOperationalContextStrip = isOperationalDisplay;/.test(buyerReadyPage);
  assert(
    a1Unpatched || a1Patched,
    `A1 patch: working tree is unpatched or fully patched, never partially (${a1Patched ? "applied" : a1Unpatched ? "not applied" : "partial"})`
  );
}

{
  const patch = read(B1_PATCH).replace(/\r\n/g, "\n");
  const changed = patch.split("\n").filter((line) => /^[+-]/.test(line) && !/^(\+\+\+|---) /.test(line));
  const assignmentsTs = read("lib/estateAgent/assignments.ts");
  assert(
    [...patch.matchAll(/^diff --git a\/(\S+) b\/\1$/gm)].map((match) => match[1]).join() === "lib/estateAgent/assignments.ts" &&
      JSON.stringify(changed) ===
        JSON.stringify([
          '-    case "branch_acts_for_buyer":',
          '-      return "This branch represents the buyer of this property, so it cannot also act for you as seller.";',
        ]),
    "B1 app patch: only the unreachable buyer-branch message is removed; every other appointment message is unchanged"
  );
  const b1Unpatched =
    assignmentsTs.includes('case "branch_acts_for_buyer":') &&
    assignmentsTs.includes("This branch represents the buyer of this property");
  const b1Patched =
    !assignmentsTs.includes("branch_acts_for_buyer") &&
    !assignmentsTs.includes("This branch represents the buyer of this property");
  assert(
    (b1Unpatched || b1Patched) &&
      !/branch_acts_for_buyer/.test(code(functionBody(read(PROBES), "assign_property_ea_branch"))),
    `B1 app patch: working tree is unpatched or fully patched (${b1Patched ? "applied" : b1Unpatched ? "not applied" : "partial"}); after 20261021150000 the server never returns branch_acts_for_buyer`
  );
}

// 23. chains attribution (20261021170000).
type ChainWrite = { op: "insert" | "update"; column: "created_by" | "recorded_by" | "confirmed_by"; old: User | null; requested: User | null; role: "authenticated" | "owner" };
const storedAttribution = (guarded: boolean) => (user: User, write: ChainWrite): User | null => {
  if (!guarded || write.role !== "authenticated") return write.requested;
  if (write.column === "created_by") return write.op === "insert" ? user : write.old;
  if (write.requested === null) return null;
  return write.op === "insert" || write.requested !== write.old ? user : write.requested;
};
assert(
  storedAttribution(false)("E5", { op: "update", column: "confirmed_by", old: null, requested: "H2", role: "authenticated" }) === "H2" &&
    storedAttribution(false)("E5", { op: "insert", column: "created_by", old: null, requested: "H9", role: "authenticated" }) === "H9",
  "case 23 chains attribution (current): an operator can attribute a completion step, or a new chain, to another user"
);
assert(
  storedAttribution(true)("E5", { op: "update", column: "confirmed_by", old: null, requested: "H2", role: "authenticated" }) === "E5" &&
    storedAttribution(true)("E5", { op: "insert", column: "created_by", old: null, requested: "H9", role: "authenticated" }) === "E5" &&
    storedAttribution(true)("E5", { op: "update", column: "created_by", old: "H2", requested: "E5", role: "authenticated" }) === "H2" &&
    storedAttribution(true)("H5", { op: "update", column: "recorded_by", old: null, requested: "H5", role: "authenticated" }) === "H5" &&
    storedAttribution(true)("H5", { op: "update", column: "recorded_by", old: "E5", requested: "E5", role: "authenticated" }) === "E5" &&
    storedAttribution(true)("H5", { op: "update", column: "recorded_by", old: "E5", requested: null, role: "authenticated" }) === null &&
    storedAttribution(true)("H5", { op: "update", column: "confirmed_by", old: null, requested: "H2", role: "owner" }) === "H2",
  "case 23 chains attribution (proposed): direct writes attribute only the caller and keep the creator; the app's own-id writes, untouched columns and owner-run functions are unchanged"
);

// 24. The owner-id resolver is no longer needed by the update policy.
assert(
  everyone.every((user) =>
    allTargets.every(
      (property) =>
        (identities[property].find((row) => row.active)?.user === user) === isActiveHolder(user, property)
    )
  ),
  "case 24 properties_update_operator: 'active homeowner id = caller' and is_property_operational_homeowner agree for every user and property (one active identity per property)"
);

// ---------------------------------------------------------------------------
// Application patch (not applied)
// ---------------------------------------------------------------------------

{
  const patch = read(APP_PATCH);
  const files = [...patch.matchAll(/^diff --git a\/(\S+) b\/\1$/gm)].map((match) => match[1]).sort();
  assert(
    JSON.stringify(files) ===
      JSON.stringify([
        "app/start-move/page.tsx",
        "lib/ownership/grants.ts",
        "scripts/secdef-user-rpc-allowlist.json",
        "scripts/verify-help-and-start-move-recovery.ts",
        "scripts/verify-operational-authority-migration.ts",
        "scripts/verify-properties-chain-integrity-migration.ts",
        "scripts/verify-start-move-guided-answers.ts",
        "scripts/verify-start-move-onward-purchase-link.ts",
      ]),
    "app patch: touches only Start Move, the grants helper, the allowlist and the verifiers that pin Start Move"
  );
  assert(
    patch.includes('+    { "schema": "public", "name": "start_move_create_property", "args": "bigint, text, text, text, boolean", "reason": "user_facing_product_rpc" },'),
    "app patch: allowlists start_move_create_property(bigint, text, text, text, boolean)"
  );
  assert(
    patch.includes('+  const { data, error } = await supabase.rpc("start_move_create_property", {') &&
      /^-\s*\.from\("properties"\)$/m.test(patch) &&
      !/^\+.*\.from\("properties"\)/m.test(patch),
    "app patch: replaces the Start Move direct inserts with the RPC"
  );

  const page = read("app/start-move/page.tsx");
  const allowlist = read("scripts/secdef-user-rpc-allowlist.json");
  const smUnpatched = !page.includes("createStartMoveProperty") && !allowlist.includes("start_move_create_property");
  const smPatched =
    (page.match(/await createStartMoveProperty\(supabase, \{/g) ?? []).length === 2 &&
    !/\.from\("properties"\)\s*\.insert\(/.test(page) &&
    allowlist.includes('"name": "start_move_create_property", "args": "bigint, text, text, text, boolean"') &&
    read("lib/ownership/grants.ts").includes('supabase.rpc("start_move_create_property", {');
  assert(
    smUnpatched || smPatched,
    `app patch: working tree is unpatched or fully patched, never partially (${smPatched ? "applied" : smUnpatched ? "not applied" : "partial"})`
  );
}

// ---------------------------------------------------------------------------
// Audit of B1, B4 and B6 against the effective definitions
// ---------------------------------------------------------------------------

const ALL_PROPOSALS = [ATOMIC, CLEANUP, VISIBILITY, FORMER_BRANCH, ATTRIBUTION, PROBES, EXISTENCE, CHAINS_GUARD];
const effectiveFunctions = latestFunctions(ALL_PROPOSALS);
const effectiveBody = (name: string) => code(effectiveFunctions.get(name)?.body ?? "");

/** Effective policies: migrations in order, then the proposals, honouring drop/create order within a file. */
function effectivePolicies(proposals: string[]): Map<string, string> {
  const policies = new Map<string, string>();
  const sources = [
    ...migrationFiles.filter((name) => name.endsWith(".sql")).sort().map((name) => `supabase/migrations/${name}`),
    ...proposals,
  ];
  for (const file of sources) {
    const text = code(read(file));
    const events: { at: number; key: string; body: string | null }[] = [];
    for (const match of text.matchAll(/create policy\s+(\w+)\s+on\s+public\.(\w+)([\s\S]*?);/gi)) {
      events.push({ at: match.index ?? 0, key: `${match[2]}.${match[1]}`, body: match[3] });
    }
    for (const match of text.matchAll(/drop policy if exists\s+(\w+)\s+on\s+public\.(\w+)/gi)) {
      events.push({ at: match.index ?? 0, key: `${match[2]}.${match[1]}`, body: null });
    }
    for (const event of events.sort((a, b) => a.at - b.at)) {
      if (event.body === null) policies.delete(event.key);
      else policies.set(event.key, event.body);
    }
  }
  return policies;
}

{
  const assign = effectiveBody("assign_property_ea_branch");
  assert(
    effectiveFunctions.get("assign_property_ea_branch")?.file === PROBES &&
      !/linked_property_id|branch_acts_for_buyer/.test(assign),
    "B1 audit: the effective assign_property_ea_branch (20261021150000) never reads linked_property_id and has no buyer-branch refusal"
  );

  const writers = [...effectiveFunctions]
    .filter(([, fn]) => /insert into public\.property_ea_assignments\b/.test(code(fn.body)))
    .map(([name]) => name)
    .sort();
  const reactivators = [...effectiveFunctions]
    .filter(([, fn]) =>
      [...code(fn.body).matchAll(/update public\.property_ea_assignments\b([\s\S]*?);/g)].some((match) =>
        /\bstatus = 'active'/.test(match[1].split(/\bwhere\b/)[0])
      )
    )
    .map(([name]) => name);
  const originatedCallers = [...effectiveFunctions]
    .filter(([name, fn]) => name !== "_ea_assign_originated_property" && /_ea_assign_originated_property\(/.test(code(fn.body)))
    .map(([name]) => name);
  assert(
    JSON.stringify(writers) === JSON.stringify(["_ea_assign_originated_property", "assign_property_ea_branch"]) &&
      reactivators.length === 0 &&
      JSON.stringify(originatedCallers) === JSON.stringify(["_create_ea_operational_property_core"]) &&
      /insert into public\.properties \(/.test(effectiveBody("_create_ea_operational_property_core")),
    "B4 audit: assignments are created only by the homeowner's appointment or with a new Estate Agent-created property; nothing sets a revoked assignment back to active, so no route reconnects a former branch"
  );
  assert(
    ["reconnect_returning_ea_branch", "list_reconnectable_ea_properties", "connect_ea_to_awaiting_property"].every(
      (name) => !/insert into|update public\./.test(effectiveBody(name))
    ),
    "B4 audit: the reconnection and awaiting-connection entry points change no rows"
  );

  const accessHelpers = [
    "is_ea_assigned_to_property",
    "is_ea_assigned_to_chain",
    "is_ea_delegated_editor_on_property",
    "is_ea_delegated_editor_on_chain",
    "get_property_ea_branch_entry",
  ];
  const teamAdmin = ["remove_ea_branch_member", "transfer_ea_branch_ownership", "is_ea_branch_admin"];
  const policies = effectivePolicies(ALL_PROPOSALS);
  const assignmentPolicy = policies.get("property_ea_assignments.property_ea_assignments_select_scope") ?? "";
  const roleConstraint = read("supabase/migrations/20260610150000_phase1_ea_foundation_schema.sql");
  assert(
    accessHelpers.every((name) => {
      const body = effectiveBody(name);
      return /ea_branch_members/.test(body) && /'active'/.test(body) && !/'branch_admin'|'agent'/.test(body);
    }) &&
      teamAdmin.every((name) => /'branch_admin'/.test(effectiveBody(name))) &&
      /ea_branch_members/.test(assignmentPolicy) &&
      !/'branch_admin'/.test(assignmentPolicy) &&
      /check \(role in \('branch_admin', 'agent'\)\)/.test(roleConstraint),
    "B6 audit: assignment access is granted to every current member of the assigned branch with no role test; branch_admin is required only for team management; roles stay branch_admin and agent"
  );
  assert(
    read("supabase/migrations/20260712200000_ea_branch_team_invitations.sql").includes(
      "create unique index if not exists ea_branch_members_one_branch_per_user_idx\n  on public.ea_branch_members (user_id);"
    ) && !migrationFiles.some((file) => read(`supabase/migrations/${file}`).includes("drop index if exists public.ea_branch_members_one_branch_per_user_idx")),
    "B6 audit: one branch per user is still enforced, so the multi-branch case in 25.46 cannot arise yet; access is checked per branch either way"
  );
}

// ---------------------------------------------------------------------------
// B5: branch entitlement revocation (20261021180000)
// ---------------------------------------------------------------------------

{
  const raw = read(ENTITLEMENT);
  const sql = code(raw);
  const revoke = code(functionBody(raw, "revoke_ea_branch_access_after_entitlement_end"));
  const reconcile = code(functionBody(raw, "reconcile_ea_branch_entitlement_access"));
  const doBlocks = [...sql.matchAll(/do \$\$[\s\S]*?\n\$\$;/g)].map((match) => match[0]);

  assert(raw.startsWith("-- PROPOSED — NOT APPLIED."), "B5 revocation: marked PROPOSED — NOT APPLIED");
  assert(
    doBlocks.length === 2 &&
      sql.indexOf(doBlocks[0]) < sql.search(/\b(alter table|create function)\b/) &&
      sql.indexOf(doBlocks[1]) > sql.lastIndexOf("grant execute on function"),
    "B5 revocation: preflight runs before any change; postflight runs after every grant"
  );
  assert(
    sql.includes("apply 20261021120000 first (assignment visibility)") &&
      sql.includes("apply 20261021120000 first (delink event visibility)"),
    "B5 revocation: refuses to run unless 20261021120000 already limits revoked rows and branch events"
  );
  for (const [name, args] of [
    ["revoke_ea_branch_access_after_entitlement_end", "uuid"],
    ["reconcile_ea_branch_entitlement_access", ""],
  ]) {
    const signature = `public.${name}(${args})`;
    const header = definerHeader(sql, name);
    assert(
      /\bsecurity definer\b/.test(header) &&
        /\bset search_path = public\b/.test(header) &&
        sql.includes(`alter function ${signature} owner to postgres;`) &&
        sql.includes(`revoke all on function ${signature} from public, anon, authenticated;`) &&
        sql.includes(`grant execute on function ${signature} to service_role;`),
      `B5 revocation: ${name} is SECURITY DEFINER, owned by postgres and executable by service_role only`
    );
  }
  assert(
    !/\bgrant\b[^;]*\bto\b[^;]*\b(anon|public|authenticated)\b/i.test(sql),
    "B5 revocation: nothing granted to anon, public or authenticated"
  );

  const lockAt = revoke.indexOf("from public.ea_branches b");
  const smokeAt = revoke.indexOf("public.is_smoke_test_ea_branch(p_branch_id)");
  const historyAt = revoke.indexOf("from public.ea_branch_subscriptions s");
  const entitledAt = revoke.indexOf("public.is_ea_branch_commercially_entitled(p_branch_id)");
  const loopAt = revoke.indexOf("for v_row in");
  assert(
    lockAt > -1 &&
      lockAt < smokeAt &&
      smokeAt < historyAt &&
      historyAt < entitledAt &&
      entitledAt < loopAt &&
      /for update;/.test(revoke.slice(lockAt, smokeAt)),
    "B5 revocation: locks the branch, then skips smoke-test fixtures, branches with no subscription history and entitled branches before revoking anything"
  );
  assert(
    /update public\.property_ea_assignments\s+set\s+status = 'revoked',\s+revoked_at = now\(\),\s+revocation_reason = 'entitlement_expired',\s+updated_at = now\(\)\s+where id = v_row\.id\s+and status = 'active';/.test(revoke) &&
      /where pea\.branch_id = p_branch_id\s+and pea\.status = 'active'/.test(revoke) &&
      (revoke.match(/\bupdate public\./g) ?? []).length === 1,
    "B5 revocation: revokes only this branch's active assignments, with revocation_reason entitlement_expired, and updates no other table directly"
  );
  assert(
    /insert into public\.property_delink_events \([\s\S]*?\)\s+values \(\s+v_row\.property_id,\s+v_row\.chain_id,\s+null,\s+'system',\s+'branch_access_ended',\s+jsonb_build_object\(\s+'operation', 'branch_access_ended',\s+'branch_id', p_branch_id\s+\)\s+\);/.test(revoke) &&
      (revoke.match(/\binsert into\b/g) ?? []).length === 1,
    "B5 revocation: one system branch_access_ended delink event per revoked assignment, naming only the branch"
  );
  assert(
    /public\._revoke_open_property_claim_invitations\(v_row\.property_id\)/.test(revoke),
    "B5 revocation: open claim invitations on each revoked property are invalidated (25.47)"
  );
  const untouched = [
    "activities",
    "_notify_chain_participants_of_delink",
    "_insert_participation_delink_activity",
    "record_property_lifecycle_transition",
    "property_claim_metadata",
    "property_operational_identities",
    "property_members",
    "property_counterparty_participants",
    "update public.properties",
    "reconnect",
    "chain_completion_events",
  ];
  assert(
    untouched.every((word) => !revoke.includes(word) && !reconcile.includes(word)),
    "B5 revocation: no shared-timeline activity, chain notification, lifecycle transition, ownership, claim-metadata or reconnection change (25.27–25.32)"
  );
  assert(
    /public\.apply_ea_branch_grace_expiry_if_due\(v_subscription_id\)/.test(reconcile) &&
      /public\.revoke_ea_branch_access_after_entitlement_end\(v_branch_id\)/.test(reconcile) &&
      /where pea\.status = 'active'\s+and not public\.is_ea_branch_commercially_entitled\(pea\.branch_id\)/.test(reconcile),
    "B5 reconciliation: applies due grace expiry, then revokes every unentitled branch that still holds active assignments"
  );
  const returned = /return jsonb_build_object\(([\s\S]*?)\);\s*end;\s*$/.exec(reconcile)?.[1] ?? "";
  assert(
    JSON.stringify([...returned.matchAll(/'([a-z_]+)',/g)].map((match) => match[1])) ===
      JSON.stringify([
        "ok",
        "grace_expired",
        "unentitled_branches_with_assignments",
        "branches_skipped",
        "assignments_revoked",
        "invitations_revoked",
      ]),
    "B5 reconciliation: returns counts only (no branch, property or user ids)"
  );

  const codes = (text: string | undefined) => [...(text ?? "").matchAll(/'([a-z_]+)'/g)].map((match) => match[1]);
  const reasonList = (text: string) =>
    /property_ea_assignments_revocation_reason_check\s+check \(\s+revocation_reason is null\s+or revocation_reason in \(([\s\S]*?)\)\s+\)/.exec(text)?.[1];
  const delinkList = (text: string) =>
    /add constraint property_delink_events_reason_code_check\s+check \(\s+reason_code in \(([\s\S]*?)\)\s+\)/.exec(text)?.[1];
  const oldReasons = codes(reasonList(AUTH_MIGRATION));
  const newReasons = codes(reasonList(sql));
  const oldDelink = codes(delinkList(read("supabase/migrations/20260714170000_participation_delink_reason_codes.sql")));
  const newDelink = codes(delinkList(sql));
  assert(
    oldReasons.length === 6 &&
      JSON.stringify(newReasons.filter((reason) => reason !== "entitlement_expired")) === JSON.stringify(oldReasons) &&
      newReasons.includes("entitlement_expired") &&
      oldDelink.length === 12 &&
      JSON.stringify(newDelink.filter((reason) => reason !== "branch_access_ended")) === JSON.stringify(oldDelink) &&
      newDelink.includes("branch_access_ended"),
    "B5 reason codes: entitlement_expired is added to the revocation reasons and branch_access_ended to the delink reasons; every existing code is kept"
  );
  assert(
    !read("lib/ownership/participationDelinkReasonCodes.ts").includes("branch_access_ended") &&
      !oldReasons.some((reason) => /entitle|billing|subscri/.test(reason)),
    "B5 reason codes: no existing code fits, and branch_access_ended is not offered to users as a delink reason"
  );

  const statusBlind = [...effectiveFunctions]
    .filter(([, fn]) => /property_ea_assignments/.test(code(fn.body)) && !/'active'/.test(code(fn.body)))
    .map(([name]) => name)
    .sort();
  assert(
    JSON.stringify(statusBlind) === JSON.stringify(["_gdpr_prepare_subject_for_auth_deletion", "is_property_creator_bootstrap_viewer"]) &&
      /not exists \(\s+select 1\s+from public\.property_ea_assignments pea\s+where pea\.property_id = p\.id\s+\)/.test(
        effectiveBody("is_property_creator_bootstrap_viewer")
      ) &&
      !/authenticated/.test(
        (read("supabase/migrations/20260718140000_fix_gdpr_erasure_approval_and_auth_prep.sql").match(
          /grant execute on function public\._gdpr_prepare_subject_for_auth_deletion\([^)]*\) to [^;]+;/g
        ) ?? []).join()
      ),
    "B5 read paths: every function that reads assignments requires an active one, except the creator bootstrap viewer (refuses any property that ever had an assignment) and the service_role GDPR step"
  );
  const propertyTables = new Set([
    "properties",
    "property_ea_assignments",
    "property_claim_metadata",
    "property_claim_invitations",
    "property_delink_events",
    "property_lifecycle_states",
    "activities",
    "chain_nodes",
    "chains",
    "operational_delays",
    "chain_completion_events",
  ]);
  const branchBound = [...effectivePolicies(ALL_PROPOSALS)].filter(
    ([key, body]) => propertyTables.has(key.split(".")[0]) && /property_ea_assignments|ea_branch_members/.test(body)
  );
  assert(
    branchBound.length > 0 &&
      branchBound.every(
        ([key, body]) => /'active'/.test(body) || key === "property_delink_events.property_delink_events_select_involved"
      ),
    `B5 read paths: property and chain policies that name assignments or branch membership require an active assignment, except the notice audience on property_delink_events (${branchBound.map(([key]) => key).join(", ")})`
  );
}

// 25. B5: entitlement revocation, modelled on 20261021180000 and the read
// rules of 20261021120000/130000. Branch BA lapsed (subscription history, not
// entitled); BB is entitled; BG is in unexpired grace; BS is a smoke-test
// fixture; BN has no subscription row. h1 sells P1 (agent BA) in chain K,
// where u1 buys P1 and h3 sells P3 (agent BB; BA was replaced on P3 earlier).
// P2 was created by BA and is unclaimed, with an open claim invitation.
{
  type Branch = "BA" | "BB" | "BS" | "BN" | "BG";
  type Prop = "P1" | "P2" | "P3" | "P4" | "P5" | "P6";
  type Row = { property: Prop; branch: Branch; status: "active" | "revoked"; reason?: string };
  type Event = { property: Prop; actor: "system"; reason: string; branch: Branch };
  type World = {
    entitled: Record<Branch, boolean>;
    rows: Row[];
    invitations: { property: Prop; open: boolean }[];
    events: Event[];
    activities: string[];
    identities: Record<Prop, string | null>;
    chain: Prop[];
  };
  const hasSubscription: Record<Branch, boolean> = { BA: true, BB: true, BS: false, BN: false, BG: true };
  const smoke: Record<Branch, boolean> = { BA: false, BB: false, BS: true, BN: false, BG: false };
  const staff: Record<Branch, string[]> = { BA: ["ea"], BB: ["eb"], BS: ["es"], BN: ["en"], BG: ["eg"] };
  const people = ["h1", "u1", "h3", "ea", "eb", "es", "en", "eg"];
  const fresh = (): World => ({
    entitled: { BA: false, BB: true, BS: false, BN: false, BG: true },
    rows: [
      { property: "P1", branch: "BA", status: "active" },
      { property: "P2", branch: "BA", status: "active" },
      { property: "P3", branch: "BA", status: "revoked", reason: "replaced" },
      { property: "P3", branch: "BB", status: "active" },
      { property: "P4", branch: "BS", status: "active" },
      { property: "P5", branch: "BN", status: "active" },
      { property: "P6", branch: "BG", status: "active" },
    ],
    invitations: [
      { property: "P2", open: true },
      { property: "P3", open: true },
    ],
    events: [],
    activities: ["K: stage updated"],
    identities: { P1: "h1", P2: null, P3: "h3", P4: "h4", P5: "h5", P6: "h6" },
    chain: ["P1", "P3"],
  });
  const revoke = (world: World, branch: Branch) => {
    if (smoke[branch]) return { skipped: true, assignments: 0, invitations: 0 };
    if (!hasSubscription[branch]) return { skipped: true, assignments: 0, invitations: 0 };
    if (world.entitled[branch]) return { skipped: true, assignments: 0, invitations: 0 };
    let assignments = 0;
    let invitations = 0;
    for (const row of world.rows.filter((r) => r.branch === branch && r.status === "active")) {
      for (const invitation of world.invitations.filter((i) => i.property === row.property && i.open)) {
        invitation.open = false;
        invitations += 1;
      }
      row.status = "revoked";
      row.reason = "entitlement_expired";
      assignments += 1;
      world.events.push({ property: row.property, actor: "system", reason: "branch_access_ended", branch });
    }
    return { skipped: false, assignments, invitations };
  };
  const reconcile = (world: World) => {
    const branches = [...new Set(world.rows.filter((r) => r.status === "active" && !world.entitled[r.branch]).map((r) => r.branch))].sort();
    const totals = { branches: branches.length, skipped: 0, assignments: 0, invitations: 0 };
    for (const branch of branches) {
      const result = revoke(world, branch);
      totals.skipped += result.skipped ? 1 : 0;
      totals.assignments += result.assignments;
      totals.invitations += result.invitations;
    }
    return totals;
  };
  const activeRow = (world: World, property: Prop) => world.rows.find((r) => r.property === property && r.status === "active");
  const sellerSide = (world: World, property: Prop) => world.identities[property];
  const isAssigned = (world: World, user: string, property: Prop) => {
    const row = activeRow(world, property);
    return !!row && staff[row.branch].includes(user);
  };
  const assignmentRowsVisible = (world: World, user: string) =>
    world.rows.filter((r) => r.status === "active" && (sellerSide(world, r.property) === user || staff[r.branch].includes(user)));
  const eventVisible = (world: World, user: string, event: Event) =>
    sellerSide(world, event.property) === user || staff[event.branch].includes(user);
  const noticeShown = (world: World, user: string, property: Prop) => {
    if (sellerSide(world, property) !== user || activeRow(world, property)) return false;
    const latest = [...world.events].reverse().find((e) => e.property === property && eventVisible(world, user, e));
    return latest?.reason === "branch_access_ended";
  };

  const world = fresh();
  const before = JSON.stringify({ activities: world.activities, identities: world.identities, chain: world.chain });
  const first = reconcile(world);
  assert(
    first.branches === 3 &&
      first.skipped === 2 &&
      first.assignments === 2 &&
      first.invitations === 1 &&
      world.rows.filter((r) => r.reason === "entitlement_expired").map((r) => r.property).join() === "P1,P2" &&
      ["P3", "P4", "P5", "P6"].every((p) => activeRow(world, p as Prop)) &&
      world.invitations.find((i) => i.property === "P3")?.open === true,
    "case 25 B5: the lapsed branch loses every active assignment and its open claim invitation; entitled, in-grace, smoke-test and no-history branches are untouched (the last two counted as skipped)"
  );
  assert(
    world.events.length === 2 &&
      world.events.every((e) => e.actor === "system" && e.reason === "branch_access_ended" && e.branch === "BA") &&
      JSON.stringify({ activities: world.activities, identities: world.identities, chain: world.chain }) === before,
    "case 25 B5: one neutral system event per property; the shared timeline, homeowner identities and chain are unchanged (25.27–25.29)"
  );
  const snapshot = JSON.stringify(world);
  const second = reconcile(world);
  const afterWebhook = fresh();
  revoke(afterWebhook, "BA");
  reconcile(afterWebhook);
  assert(
    second.assignments === 0 && second.invitations === 0 && JSON.stringify(world) === snapshot && JSON.stringify(afterWebhook) === snapshot,
    "case 25 B5: idempotent — a second run changes nothing, and webhook-then-cron reaches exactly the cron-only state (26.7)"
  );
  const recovered = fresh();
  recovered.entitled.BA = true;
  assert(
    revoke(recovered, "BA").skipped && reconcile(recovered).assignments === 0 && recovered.events.length === 0,
    "case 25 B5: a branch that recovered in grace, or is entitled again, is not revoked"
  );
  world.entitled.BA = true;
  reconcile(world);
  assert(
    !activeRow(world, "P1") && !activeRow(world, "P2"),
    "case 25 B5: resubscribing does not restore the revoked assignments (25.32); the homeowner must appoint again"
  );
  assert(
    !isAssigned(world, "ea", "P1") &&
      !isAssigned(world, "ea", "P2") &&
      assignmentRowsVisible(world, "ea").length === 0 &&
      people.every((user) => assignmentRowsVisible(world, user).every((r) => r.status === "active")),
    "case 25 B5: former branch staff lose every read path keyed on an active assignment; revoked rows (with entitlement_expired) are readable by no end user"
  );
  const p1Event = world.events.find((e) => e.property === "P1")!;
  const p2Event = world.events.find((e) => e.property === "P2")!;
  assert(
    people.filter((user) => eventVisible(world, user, p1Event)).join() === "h1,ea" &&
      people.filter((user) => eventVisible(world, user, p2Event)).join() === "ea" &&
      noticeShown(world, "h1", "P1") &&
      !people.filter((user) => user !== "h1").some((user) => noticeShown(world, user, "P1")),
    "case 25 B5: Branch Access Ended is visible only to the represented homeowner and current staff of the affected branch; the buyer, the other seller and other branches never see it"
  );
  world.rows.push({ property: "P1", branch: "BB", status: "active" });
  assert(
    !noticeShown(world, "h1", "P1") && !eventVisible(world, "eb", p1Event),
    "case 25 B5: after h1 appoints a new branch the notice is no longer shown, and the new branch cannot see the earlier event"
  );

  const patch = read(B5_PATCH).replace(/\r\n/g, "\n");
  const files = [...patch.matchAll(/^diff --git \S+ b\/(\S+)$/gm)].map((match) => match[1]).sort();
  const added = patch.split("\n").filter((line) => line.startsWith("+") && !line.startsWith("+++")).join("\n");
  const body = /body: "([^"]+)"/.exec(added)?.[1] ?? "";
  assert(
    JSON.stringify(files) === JSON.stringify(["components/estate-agents/PropertyEstateAgentAssignment.tsx", "lib/estateAgent/branchAccessNotice.ts"]) &&
      !patch.split("\n").some((line) => line.startsWith("-") && !line.startsWith("---")),
    "B5 notice patch: adds the notice module and renders it in the homeowner's Estate Agent panel; removes nothing"
  );
  assert(
    added.includes('title: "Branch Access Ended"') &&
      /unchanged/.test(body) &&
      !/billing|subscri|payment|paid|cancel|expir|entitle|another agent|new agent|successor|replac|transaction (has )?ended|withdrawn/i.test(body) &&
      !/emails\/|sendEmail|resend/i.test(patch),
    "B5 notice copy: titled Branch Access Ended; no billing reason, no successor agency, says the property and chain are unchanged; no email"
  );
  assert(
    /\.from\("property_delink_events"\)\s*\n\+\s*\.select\("reason_code"\)/.test(patch) &&
      added.includes('.not("metadata->>branch_id", "is", null)') &&
      added.includes("{!currentAssignmentId && branchAccessEnded && ("),
    "B5 notice patch: reads only reason_code of the latest branch event (RLS limits rows to the homeowner and that branch) and shows it only while no agent is assigned"
  );
  const b5Module = "lib/estateAgent/branchAccessNotice.ts";
  const b5ModuleFromPatch =
    /^diff --git \S+ b\/lib\/estateAgent\/branchAccessNotice\.ts\n[\s\S]*?^@@[^\n]*\n([\s\S]*?)(?=^diff --git |(?![\s\S]))/m
      .exec(patch)?.[1]
      .split("\n")
      .filter((line) => line.startsWith("+"))
      .map((line) => line.slice(1))
      .join("\n") ?? null;
  const b5Component = read("components/estate-agents/PropertyEstateAgentAssignment.tsx");
  const b5Unpatched = !existsSync(join(ROOT, b5Module)) && !b5Component.includes("branchAccessNotice");
  const b5Patched =
    existsSync(join(ROOT, b5Module)) &&
    b5ModuleFromPatch !== null &&
    read(b5Module).trimEnd() === b5ModuleFromPatch.trimEnd() &&
    b5Component.includes('} from "@/lib/estateAgent/branchAccessNotice";') &&
    b5Component.includes("{!currentAssignmentId && branchAccessEnded && (");
  assert(
    b5Unpatched || b5Patched,
    `B5 notice patch: working tree is unpatched or fully patched, never partially (${b5Patched ? "applied" : b5Unpatched ? "not applied" : "partial"})`
  );
}

// ---------------------------------------------------------------------------
// B2: shared chain responses without other participants' user ids
// (20261021190000, 20261021200000, b2 app patch)
// ---------------------------------------------------------------------------

const REVOKED_COLUMNS: Record<string, string[]> = {
  "public.chains": [
    "created_by_user_id",
    "completion_date_recorded_by_user_id",
    "completion_date_updated_by_user_id",
    "completion_confirmed_by_user_id",
  ],
  "public.chain_nodes": ["user_id"],
  "public.operational_delays": ["created_by_user_id", "resolved_by_user_id"],
  "public.chain_completion_events": ["actor_user_id"],
};

{
  const raw = read(OWN_NODES);
  const sql = code(raw);
  const view = /create view public\.chain_nodes_own\s+with \(security_invoker = false\)\s+as\s+select([\s\S]*?)from public\.chain_nodes cn\s+where([\s\S]*?);/.exec(sql);
  assert(raw.startsWith("-- PROPOSED — NOT APPLIED."), "B2 own nodes: marked PROPOSED — NOT APPLIED");
  assert(
    sql.indexOf("do $$") > -1 && sql.indexOf("do $$") < sql.indexOf("create view") && sql.lastIndexOf("do $$") > sql.indexOf("grant select"),
    "B2 own nodes: preflight before the view; postflight after the grants"
  );
  assert(
    !!view &&
      squash(view[1]) === "cn.id, cn.chain_id, cn.node_type, cn.linked_property_id, cn.user_id" &&
      /auth\.uid\(\) is not null\s+and cn\.user_id = auth\.uid\(\)\s+and public\.is_chain_operational_viewer\(cn\.chain_id\)$/.test(view[2].trim()),
    "B2 own nodes: the view returns only the caller's own nodes, in chains the caller can still view, so the only user id it returns is the caller's"
  );
  assert(
    sql.includes("revoke all on public.chain_nodes_own from public, anon, authenticated;") &&
      sql.includes("grant select on public.chain_nodes_own to authenticated;") &&
      (sql.match(/\bgrant\b/g) ?? []).length === 1 &&
      !/\b(create|drop) (or replace )?(policy|function)\b|\balter table\b/.test(sql),
    "B2 own nodes: select-only for authenticated (the view is otherwise auto-updatable); no policy, function or table change"
  );
}

{
  const raw = read(USER_ID_COLUMNS);
  const sql = code(raw);
  const specs = [...sql.matchAll(/select \* from \(values([\s\S]*?)\) as t\(tbl, cols\)/g)].map((match) =>
    Object.fromEntries(
      [...match[1].matchAll(/\('([a-z_.]+)', array\[([^\]]*)\]\)/g)].map((row) => [row[1], [...row[2].matchAll(/'([a-z_]+)'/g)].map((c) => c[1])])
    )
  );
  assert(raw.startsWith("-- PROPOSED — NOT APPLIED."), "B2 column privileges: marked PROPOSED — NOT APPLIED");
  assert(
    specs.length === 3 && specs.every((spec) => JSON.stringify(spec) === JSON.stringify(REVOKED_COLUMNS)),
    "B2 column privileges: preflight, change and postflight use the same column list (chains attribution, chain_nodes.user_id, operational_delays attribution, chain_completion_events.actor_user_id)"
  );
  assert(
    sql.includes("apply 20261021190000 and deploy the B2 app patch first") &&
      sql.includes("security_invoker views read"),
    "B2 column privileges: refuses to run before chain_nodes_own exists, or if a security_invoker view reads a column being removed"
  );
  assert(
    /and a\.attname <> all \(v_spec\.cols\);/.test(sql) &&
      sql.includes("execute format('revoke select on table %s from authenticated', v_spec.tbl);") &&
      sql.includes("execute format('grant select (%s) on table %s to authenticated', v_cols, v_spec.tbl);"),
    "B2 column privileges: authenticated keeps SELECT on every other column, computed from the catalog at apply time"
  );
  assert(
    !/\b(create|drop) (or replace )?(policy|function|view|trigger)\b|\balter table\b|\bupdate public\.|\bdelete from\b|\binsert into\b/.test(sql) &&
      !/\bgrant\b[^;]*\bto\b[^;']*\b(anon|public)\b/i.test(sql) &&
      !/\b(revoke|grant) (insert|update|delete|all)\b/.test(sql),
    "B2 column privileges: rows, policies, write privileges and stored attribution are unchanged; nothing granted to anon or public"
  );
  assert(
    sql.includes("has_column_privilege('authenticated', v_spec.tbl, v_col.attname, 'select')") &&
      sql.includes("has_column_privilege('service_role', v_spec.tbl, v_spec.cols[1], 'select')") &&
      sql.includes("write privileges changed"),
    "B2 column privileges: postflight checks every column's readability, service_role access and the write privileges"
  );
}

{
  const patch = read(B2_PATCH).replace(/\r\n/g, "\n");
  const sections = [...patch.matchAll(/^diff --git a\/(\S+) b\/\1\n([\s\S]*?)(?=^diff --git |(?![\s\S]))/gm)].map((match) => ({
    file: match[1],
    removed: match[2].split("\n").filter((line) => line.startsWith("-") && !line.startsWith("---")).map((line) => line.slice(1)),
    added: match[2].split("\n").filter((line) => line.startsWith("+") && !line.startsWith("+++")).map((line) => line.slice(1)),
  }));
  const files = sections.map((section) => section.file).sort();
  const allAdded = sections.flatMap((section) => section.added).join("\n");
  const revokedNames = Object.values(REVOKED_COLUMNS).flat();
  assert(
    JSON.stringify(files) ===
      JSON.stringify([
        "context/ChainContext.tsx",
        "lib/amendChainCompletionDate.ts",
        "lib/completionLifecycle.ts",
        "lib/confirmChainCompletion.ts",
        "lib/ensureBuyerReadyOnJoin.ts",
        "lib/operationalDelays.ts",
        "lib/recordChainCompletionDate.ts",
      ]),
    "B2 app patch: touches only the shared chain loader, the completion writers and their row type, delays and Buyer Ready join"
  );
  assert(
    !/_by_user_id|\.eq\("user_id"|select\("\*"\)|^\s*\*,$/m.test(allAdded) &&
      allAdded.includes('.from("chain_nodes_own")') &&
      allAdded.includes("ownNodeUserIds.get(Number(node.id)) ??") &&
      allAdded.includes(
        '"id, access_code, state, completion_lifecycle_status, completion_scheduled_date, completion_date_recorded_at, completion_confirmed_at, completed_at"'
      ),
    "B2 app patch: no added line requests a user id column, select('*') or a user_id filter; own nodes come from chain_nodes_own"
  );
  const chainsSelect = /"id, access_code, state, [^"]+"/.exec(allAdded)?.[0] ?? "";
  const nodesSelect = sections.find((s) => s.file === "context/ChainContext.tsx")?.added.filter((line) => /^\s{8}[a-z_]+,$/.test(line)).map((line) => line.trim().replace(/,$/, "")) ?? [];
  assert(
    !revokedNames.some((name) => chainsSelect.includes(name)) &&
      JSON.stringify(nodesSelect) ===
        JSON.stringify(["id", "chain_id", "node_type", "linked_property_id", "position", "stage", "status", "progress", "created_at", "stage_entered_at"]),
    "B2 app patch: the shared chain and node reads list only columns that stay readable"
  );
  for (const file of ["lib/recordChainCompletionDate.ts", "lib/amendChainCompletionDate.ts", "lib/confirmChainCompletion.ts"]) {
    const section = sections.find((s) => s.file === file)!;
    const removed = new Set(section.removed);
    const after = read(file).split("\n").filter((line) => !removed.has(line)).join("\n");
    assert(
      section.added.length === 0 &&
        !/\b\w+_by_user_id,\s*$/m.test(after) &&
        /\.update\(\{[\s\S]*?_by_user_id:\s*\n?\s*params\.userId/.test(after),
      `B2 app patch: ${file} no longer reads attribution ids back, and still writes the caller's own id`
    );
  }
  const ensure = sections.find((s) => s.file === "lib/ensureBuyerReadyOnJoin.ts")!;
  assert(
    JSON.stringify(ensure.removed.map((l) => l.trim())) === JSON.stringify(['.from("chain_nodes")', '.eq("user_id", params.userId)']) &&
      JSON.stringify(ensure.added.map((l) => l.trim())) === JSON.stringify(['.from("chain_nodes_own")']) &&
      read("lib/ensureBuyerReadyOnJoin.ts").includes("user_id: params.userId,"),
    "B2 app patch: the Buyer Ready join finds the caller's own node through chain_nodes_own and still inserts with the caller's id"
  );
  const b2Unpatched = read("context/ChainContext.tsx").includes('const chainsQuery = supabase.from("chains").select("*");');
  const b2Patched =
    !b2Unpatched &&
    sections.every((section) => {
      const current = read(section.file).split("\n");
      return section.added.every((line) => current.includes(line));
    }) &&
    !/\.from\("chain_nodes"\)\s*\.select\([^)]*\)\s*\.eq\("user_id"/.test(read("lib/ensureBuyerReadyOnJoin.ts"));
  assert(
    b2Unpatched || b2Patched,
    `B2 app patch: working tree is unpatched or fully patched, never partially (${b2Patched ? "applied" : b2Unpatched ? "not applied" : "partial"})`
  );
}

// 26. B2: who receives which user ids from shared chain reads. Chain C1: A
// sells, B is Buyer Ready (node 1), S is staff of A's branch, R was removed
// (node 3 still names R). Chain C2: A again (node 2) and Z. X exists
// nowhere. Delays, completion steps and events carry the users' ids.
{
  type U = "A" | "B" | "Z" | "S" | "R" | "X";
  const users: U[] = ["A", "B", "Z", "S", "R", "X"];
  const viewers: Record<string, U[]> = { C1: ["A", "B", "S"], C2: ["A", "Z"] };
  const nodes = [
    { id: 1, chain: "C1", owner: "B" as U },
    { id: 2, chain: "C2", owner: "A" as U },
    { id: 3, chain: "C1", owner: "R" as U },
  ];
  const delayRows = [
    { chain: "C1", createdBy: "A" as U, resolvedBy: "B" as U | null },
    { chain: "C2", createdBy: "Z" as U, resolvedBy: null },
  ];
  const chainRows = [
    { chain: "C1", ids: ["A", "A", null, "S"] as (U | null)[] },
    { chain: "C2", ids: ["Z", null, null, null] as (U | null)[] },
  ];
  const completionEvents = [
    { chain: "C1", actor: "A" as U },
    { chain: "C2", actor: "A" as U },
  ];
  const canView = (user: U, chain: string) => viewers[chain]?.includes(user) ?? false;
  const ownNodes = (user: U, chainFilter?: string) =>
    nodes.filter((n) => n.owner === user && canView(user, n.chain) && (!chainFilter || n.chain === chainFilter)).map((n) => n.id);
  const nodeOwnerSeen = (user: U, proposed: boolean) => (n: (typeof nodes)[number]) =>
    proposed ? (ownNodes(user).includes(n.id) ? user : null) : n.owner;
  const idsSeen = (user: U, proposed: boolean): U[] => {
    const ids: (U | null)[] = [];
    for (const n of nodes) if (canView(user, n.chain)) ids.push(nodeOwnerSeen(user, proposed)(n));
    if (!proposed) {
      for (const d of delayRows) if (canView(user, d.chain)) ids.push(d.createdBy, d.resolvedBy);
      for (const c of chainRows) if (canView(user, c.chain)) ids.push(...c.ids);
      for (const e of completionEvents) if (canView(user, e.chain)) ids.push(e.actor);
    }
    return ids.filter((id): id is U => id !== null);
  };
  const foreign = (user: U, proposed: boolean) => idsSeen(user, proposed).filter((id) => id !== user);
  const resolve = (viewer: U, subject: U, chain: string, hasSale: boolean, proposed: boolean, world = nodes) => {
    const buyerReady = world.some((n) => n.chain === chain && canView(viewer, n.chain) && (proposed ? (n.owner === viewer ? viewer : null) : n.owner) === subject);
    if (buyerReady && hasSale) return "ambiguous";
    return buyerReady ? "buyer_ready" : hasSale ? "sale" : "none";
  };

  assert(
    foreign("B", false).includes("A") && foreign("Z", false).includes("A") && !viewers.C1.includes("Z"),
    "case 26 B2 (current): B in C1 and Z in C2 never share a chain, yet both receive A's user id, so A can be correlated across unrelated chains"
  );
  assert(
    users.every((user) => foreign(user, true).length === 0),
    "case 26 B2 (proposed): no viewer receives another participant's user id from shared chain reads, in either chain"
  );
  assert(
    ownNodes("B").join() === "1" &&
      resolve("B", "B", "C1", false, true) === "buyer_ready" &&
      ownNodes("A", "C1").length === 0 &&
      resolve("A", "A", "C1", true, true) === "sale" &&
      nodeOwnerSeen("A", true)(nodes[0]) === null,
    "case 26 B2 two homeowners in one chain: B still finds its own Buyer Ready node; A sees B's node without an owner and resolves to its sale"
  );
  assert(
    foreign("S", false).includes("A") && foreign("S", true).length === 0 && resolve("S", "A", "C1", true, false) === "sale" && resolve("S", "A", "C1", true, true) === "sale",
    "case 26 B2 current agency staff: S no longer receives homeowner ids from shared reads, and its operational position for A's sale is unchanged"
  );
  const withSubjectNode = [...nodes, { id: 4, chain: "C1", owner: "A" as U }];
  assert(
    resolve("S", "A", "C1", true, false, withSubjectNode) === "ambiguous" && resolve("S", "A", "C1", true, true, withSubjectNode) === "sale",
    "case 26 B2 documented dependency: if A also had a Buyer Ready node in C1, the agent's client could no longer flag the ambiguity (server authority is unchanged)"
  );
  assert(
    idsSeen("R", false).length === 0 && idsSeen("R", true).length === 0 && ownNodes("R").length === 0,
    "case 26 B2 removed participant: R reads nothing from C1, and chain_nodes_own does not return R's old node"
  );
  assert(
    ownNodes("B", "C2").length === 0 && ownNodes("B", "C9").length === 0 && ownNodes("X").length === 0 && idsSeen("X", true).length === 0,
    "case 26 B2 unknown ids: a chain the caller cannot view and a chain that does not exist give the same empty answer; an unknown user gets nothing"
  );
}
