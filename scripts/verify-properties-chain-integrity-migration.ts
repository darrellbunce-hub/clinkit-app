/**
 * Offline static checks for the properties chain-integrity migration
 * (20261001120000_properties_chain_integrity_guard.sql). Reads repository files
 * only; does not connect to Supabase.
 *
 * Run: npx tsx scripts/verify-properties-chain-integrity-migration.ts
 */

import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const MIGRATIONS_DIR = join(ROOT, "supabase", "migrations");
const MIGRATION_FILE = "20261001120000_properties_chain_integrity_guard.sql";
// Sequenced after this migration in the same change set (searching placeholder ownership).
const DEPENDENT_FOLLOW_UP_MIGRATIONS = [
  "20261001130000_searching_placeholder_ownership_enforcement.sql",
  "20261005100000_address_reservation_classifier.sql",
  "20261005110000_seller_side_authority_and_awaiting_connection.sql",
  "20261005120000_operational_authority_enforcement.sql",
  "20261005130000_lifecycle_bounded_dormancy.sql",
  "20261005140000_reservation_placeholders_awaiting_seller.sql",
  "20261005150000_dashboard_last_update_at.sql",
  "20261005160000_drop_properties_address_match_key_idx.sql",
];

const HELPERS = [
  { name: "caller_owns_unshared_chain", args: "bigint" },
  { name: "caller_may_place_property_in_chain", args: "bigint" },
  { name: "property_in_caller_accessible_chain", args: "bigint, bigint" },
] as const;

const PROTECTED_COLUMNS = [
  "chain_id",
  "linked_property_id",
  "created_by_user_id",
] as const;

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string) {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
    return;
  }

  failed += 1;
  console.error(`  ✗ ${label}`);
}

function read(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), "utf8").replace(/\r\n/g, "\n");
}

function normalize(sql: string): string {
  return sql.replace(/\s+/g, " ").trim().toLowerCase();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

type SqlFunction = {
  args: string;
  header: string;
  body: string;
};

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

function requireFunction(
  functions: Map<string, SqlFunction>,
  name: string
): SqlFunction {
  const fn = functions.get(name);

  if (!fn) {
    throw new Error(`Function public.${name} not found`);
  }

  return fn;
}

function isSecurityDefiner(fn: SqlFunction): boolean {
  return /\bsecurity\s+definer\b/i.test(fn.header);
}

function writesProperties(body: string): boolean {
  return /\b(insert\s+into|update)\s+(public\.)?properties\b/i.test(body);
}

function listSourceFiles(dir: string): string[] {
  const files: string[] = [];

  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) {
      continue;
    }

    const fullPath = join(dir, entry);

    if (statSync(fullPath).isDirectory()) {
      files.push(...listSourceFiles(fullPath));
    } else if (/\.(ts|tsx)$/.test(entry)) {
      files.push(fullPath);
    }
  }

  return files;
}

function main() {
  const migrationPath = `supabase/migrations/${MIGRATION_FILE}`;
  const migration = read(migrationPath);
  const functions = extractFunctions(migration);

  console.log("a. Forward-only migration");
  {
    const otherFiles = readdirSync(MIGRATIONS_DIR).filter(
      (file) => file.endsWith(".sql") && file !== MIGRATION_FILE
    );
    const versions = otherFiles.map((file) => file.split("_")[0]);
    const ownVersion = MIGRATION_FILE.split("_")[0];

    assert(
      otherFiles.every(
        (file) =>
          file.split("_")[0] < ownVersion ||
          DEPENDENT_FOLLOW_UP_MIGRATIONS.includes(file)
      ),
      "migration version is later than every existing migration (except its dependent follow-ups)"
    );
    assert(
      !versions.includes(ownVersion),
      "migration version does not collide with another file"
    );

    let changedHistorical: string[] | null = null;

    try {
      changedHistorical = execFileSync(
        "git",
        ["diff", "--name-only", "HEAD", "--", "supabase/migrations"],
        { cwd: ROOT, encoding: "utf8" }
      )
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
    } catch {
      changedHistorical = null;
    }

    assert(
      changedHistorical !== null && changedHistorical.length === 0,
      "no tracked historical migration is modified (git diff HEAD)"
    );
    assert(
      !/\b(create|drop|alter)\s+policy\b/i.test(migration),
      "migration does not change RLS policies"
    );
    assert(
      !/\balter\s+table\b/i.test(migration) &&
        !/\bgrant\b[^;]*\bon\s+(table\s+)?public\.[a-z_]+\s+to\b/i.test(
          migration.replace(/grant\s+execute\s+on\s+function[^;]*;/gi, "")
        ),
      "migration does not alter tables or table grants"
    );
    assert(
      !/\b(delete\s+from|truncate)\b/i.test(migration) &&
        !/^\s*(update|insert\s+into)\s+public\./im.test(
          migration.replace(/\$\$[\s\S]*?\$\$/g, "")
        ),
      "migration does not modify data outside function bodies"
    );
  }

  console.log("\nb. Preflight");
  {
    assert(
      /not\s+p\.prosecdef/i.test(migration) &&
        /SECURITY INVOKER functions write properties/.test(migration),
      "aborts if any SECURITY INVOKER function writes properties"
    );
    assert(
      /body differs from 20260727100000/.test(migration) &&
        /body differs from 20260930200000/.test(migration),
      "aborts if either replaced function body has drifted"
    );
    assert(
      /has_function_privilege\('authenticated',\s*'public\.is_chain_participant\(bigint\)',\s*'EXECUTE'\)/.test(
        migration
      ),
      "checks authenticated can execute is_chain_participant (called by the invoker trigger)"
    );
    assert(
      /'public\._is_estate_agent_account\(uuid\)'/.test(migration) &&
        !/'public\.is_ea_assigned_to_chain\(bigint\)'/.test(migration),
      "preflight requires _is_estate_agent_account(uuid) (20261001110000), not is_ea_assigned_to_chain"
    );
  }

  console.log("\nc. Trigger function (SECURITY INVOKER)");
  const trigger = requireFunction(functions, "_trg_properties_guard_direct_writes");
  const triggerBody = trigger.body;
  const triggerBodyLower = triggerBody.toLowerCase();
  {
    assert(/^\s*trigger\b/i.test(trigger.header), "returns trigger");
    assert(/\bsecurity\s+invoker\b/i.test(trigger.header), "declared SECURITY INVOKER");
    assert(!isSecurityDefiner(trigger), "not SECURITY DEFINER");
    assert(/set\s+search_path\s*=\s*public\b/i.test(trigger.header), "pins search_path = public");
    assert(
      !/\b(from|join|into|update)\s+public\.[a-z_]+/i.test(triggerBody) &&
        !/\b(select|perform)\b/i.test(triggerBody),
      "trigger body reads no tables directly (lookups go through SECURITY DEFINER helpers)"
    );

    const anonIndex = triggerBodyLower.indexOf("if current_user = 'anon' then");
    const passthroughIndex = triggerBodyLower.indexOf("if current_user <> 'authenticated' then");
    const uidIndex = triggerBodyLower.indexOf("v_uid := auth.uid();");
    const insertIndex = triggerBodyLower.indexOf("if tg_op = 'insert' then");

    assert(anonIndex >= 0, "rejects anon direct writes");
    assert(
      passthroughIndex > anonIndex &&
        /if current_user <> 'authenticated' then\s+return new;/i.test(triggerBody),
      "passes through every role other than authenticated (SECURITY DEFINER, service_role, cascades)"
    );
    assert(
      uidIndex > passthroughIndex &&
        /if v_uid is null then\s+raise exception 'properties_direct_write_not_authenticated'/i.test(
          triggerBody
        ),
      "rejects authenticated writes without auth.uid()"
    );
    assert(insertIndex > uidIndex, "column rules run only after the direct-caller checks");
  }

  console.log("\nd. Trigger timing and events");
  {
    const match = migration.match(
      /create\s+trigger\s+trg_properties_guard_direct_writes\s+before\s+insert\s+or\s+update\s+of\s+([a-z_,\s]+?)\s+on\s+public\.properties\s+for\s+each\s+row\s+execute\s+function\s+public\._trg_properties_guard_direct_writes\(\);/i
    );

    assert(match !== null, "BEFORE INSERT OR UPDATE OF … ON public.properties FOR EACH ROW");

    const columns = (match?.[1] ?? "")
      .split(",")
      .map((column) => column.trim())
      .filter(Boolean)
      .sort();

    assert(
      JSON.stringify(columns) === JSON.stringify([...PROTECTED_COLUMNS].sort()),
      "UPDATE OF chain_id, linked_property_id, created_by_user_id"
    );
    assert(
      /drop\s+trigger\s+if\s+exists\s+trg_properties_guard_direct_writes\s+on\s+public\.properties;/i.test(
        migration
      ),
      "re-runnable (drop trigger if exists)"
    );
  }

  console.log("\ne. SECURITY DEFINER helpers");
  for (const helper of HELPERS) {
    const fn = requireFunction(functions, helper.name);
    const signature = `public.${helper.name}(${helper.args})`;

    assert(isSecurityDefiner(fn), `${helper.name}: SECURITY DEFINER`);
    assert(/\blanguage\s+sql\b/i.test(fn.header) && /\bstable\b/i.test(fn.header), `${helper.name}: language sql stable`);
    assert(/set\s+search_path\s*=\s*public\b/i.test(fn.header), `${helper.name}: search_path = public`);
    assert(/^\s*boolean\b/i.test(fn.header), `${helper.name}: returns boolean`);
    assert(
      new RegExp(`alter\\s+function\\s+${escapeRegExp(signature)}\\s+owner\\s+to\\s+postgres;`, "i").test(migration),
      `${helper.name}: owner postgres`
    );
    assert(/auth\.uid\(\)\s+is\s+not\s+null/i.test(fn.body), `${helper.name}: fails closed without auth.uid()`);
    assert(!/current_user/i.test(fn.body), `${helper.name}: does not decide direct-caller status`);
  }
  {
    const owns = requireFunction(functions, "caller_owns_unshared_chain").body;
    assert(/c\.created_by_user_id\s*=\s*auth\.uid\(\)/i.test(owns), "caller_owns_unshared_chain: caller created the chain");
    assert(/p\.created_by_user_id\s+is\s+distinct\s+from\s+auth\.uid\(\)/i.test(owns), "caller_owns_unshared_chain: every property created by the caller");
    assert(/pm\.user_id\s+is\s+distinct\s+from\s+auth\.uid\(\)/i.test(owns), "caller_owns_unshared_chain: no other member (covers 'only member of the row')");
    assert(/pea\.status\s*=\s*'active'/i.test(owns), "caller_owns_unshared_chain: no active EA assignment");
    assert(/pd\.status\s*=\s*'active'/i.test(owns), "caller_owns_unshared_chain: no active delegate");

    const place = requireFunction(functions, "caller_may_place_property_in_chain").body;
    assert(/c\.created_by_user_id\s*=\s*auth\.uid\(\)/i.test(place), "caller_may_place_property_in_chain: chain creator (start-move)");
    assert(/public\.is_chain_participant\(p_chain_id\)/i.test(place), "caller_may_place_property_in_chain: chain participant (join placeholder)");
    assert(!/is_ea_assigned_to_chain/i.test(place), "caller_may_place_property_in_chain: no assigned-EA direct-insert arm");

    const linked = requireFunction(functions, "property_in_caller_accessible_chain").body;
    assert(/p\.id\s*=\s*p_property_id/i.test(linked) && /p\.chain_id\s*=\s*p_chain_id/i.test(linked), "property_in_caller_accessible_chain: property is in the given chain");
    assert(/public\.caller_may_place_property_in_chain\(p_chain_id\)/i.test(linked), "property_in_caller_accessible_chain: chain is accessible to the caller");
  }

  console.log("\nf. EXECUTE grants");
  {
    assert(
      !/\bgrant\b[^;]*\bto\b[^;]*\banon\b/i.test(migration),
      "no GRANT to anon anywhere in the migration"
    );

    for (const helper of HELPERS) {
      const signature = escapeRegExp(`public.${helper.name}(${helper.args})`);
      assert(
        new RegExp(`revoke\\s+all\\s+on\\s+function\\s+${signature}\\s+from\\s+public,\\s*anon,\\s*authenticated;`, "i").test(migration),
        `${helper.name}: revoked from public and anon`
      );
      assert(
        new RegExp(`grant\\s+execute\\s+on\\s+function\\s+${signature}\\s+to\\s+authenticated,\\s*service_role;`, "i").test(migration),
        `${helper.name}: granted to authenticated and service_role`
      );
    }

    assert(
      /revoke\s+all\s+on\s+function\s+public\._trg_properties_guard_direct_writes\(\)\s+from\s+public,\s*anon,\s*authenticated;/i.test(
        migration
      ),
      "trigger function: revoked from public, anon, authenticated"
    );
    assert(
      !/grant\s+execute\s+on\s+function\s+public\._trg_properties_guard_direct_writes/i.test(migration),
      "trigger function: no EXECUTE grants (not needed at fire time)"
    );
  }

  console.log("\ng. created_by_user_id protection");
  {
    const insertBranch = triggerBody.slice(
      triggerBodyLower.indexOf("if tg_op = 'insert' then"),
      triggerBodyLower.indexOf("return new;", triggerBodyLower.indexOf("if tg_op = 'insert' then"))
    );

    assert(
      /if new\.created_by_user_id is distinct from v_uid then\s+raise exception 'properties_insert_creator_mismatch'/i.test(insertBranch),
      "INSERT: created_by_user_id must equal auth.uid()"
    );
    assert(
      /if new\.created_by_user_id is distinct from old\.created_by_user_id then\s+raise exception 'properties_created_by_immutable'/i.test(triggerBody),
      "UPDATE: created_by_user_id is immutable"
    );
  }

  console.log("\nh. chain_id protection");
  {
    const insertStart = triggerBodyLower.indexOf("if tg_op = 'insert' then");
    const insertBranch = triggerBody.slice(insertStart, triggerBodyLower.indexOf("return new;", insertStart));

    assert(
      /if not public\.caller_may_place_property_in_chain\(new\.chain_id\) then\s+raise exception 'properties_insert_chain_not_authorised'/i.test(insertBranch),
      "INSERT: caller must be allowed to place the property in chain_id"
    );

    const moveBlock =
      triggerBody.match(/if new\.chain_id is distinct from old\.chain_id then([\s\S]*?)end if;\s*end if;/i)?.[1] ?? "";

    assert(/new\.chain_id is null/i.test(moveBlock), "UPDATE: chain_id cannot be cleared");
    assert(/old\.created_by_user_id is distinct from v_uid/i.test(moveBlock), "UPDATE: caller created the property");
    assert(/not public\.caller_owns_unshared_chain\(old\.chain_id\)/i.test(moveBlock), "UPDATE: caller owns the unshared source chain (and is the row's only member)");
    assert(/not public\.is_chain_participant\(new\.chain_id\)/i.test(moveBlock), "UPDATE: caller already participates in the destination chain");
    assert(/raise exception 'properties_chain_move_not_authorised'/i.test(moveBlock), "UPDATE: any failed condition raises");
  }

  console.log("\ni. linked_property_id same-chain protection");
  {
    const insertStart = triggerBodyLower.indexOf("if tg_op = 'insert' then");
    const insertBranch = triggerBody.slice(insertStart, triggerBodyLower.indexOf("return new;", insertStart));

    assert(
      /new\.linked_property_id is not null\s+and not public\.property_in_caller_accessible_chain\(\s*new\.linked_property_id,\s*new\.chain_id\s*\)/i.test(insertBranch),
      "INSERT: linked_property_id is null or in the same accessible chain"
    );

    const updatePart = triggerBody.slice(triggerBodyLower.indexOf("return new;", insertStart) + 1);
    assert(
      /new\.linked_property_id is not null\s+and \(\s*new\.linked_property_id is distinct from old\.linked_property_id\s+or new\.chain_id is distinct from old\.chain_id\s*\)\s+and not public\.property_in_caller_accessible_chain\(\s*new\.linked_property_id,\s*new\.chain_id\s*\)/i.test(updatePart),
      "UPDATE: changed link (or moved row) must point into the row's new chain"
    );
  }

  console.log("\nj. establish_operational_homeowner_for_created_property");
  {
    const updated = requireFunction(functions, "establish_operational_homeowner_for_created_property");
    const original = requireFunction(
      extractFunctions(read("supabase/migrations/20260727100000_chain_join_security_remediation.sql")),
      "establish_operational_homeowner_for_created_property"
    );
    const chainCheck = updated.body.match(
      /\n  if not exists \(\n    select 1\n    from public\.properties p\n    where p\.id = p_property_id\n      and public\.caller_may_place_property_in_chain\(p\.chain_id\)\n  \) then\n    return jsonb_build_object\('ok', false, 'error', 'not_authorized'\);\n  end if;\n/
    );

    const eaCheck = updated.body.match(
      /\n  if public\._is_estate_agent_account\(auth\.uid\(\)\) then\n    return jsonb_build_object\('ok', false, 'error', 'estate_agent_cannot_be_homeowner'\);\n  end if;\n/
    );

    assert(isSecurityDefiner(updated), "still SECURITY DEFINER");
    assert(chainCheck !== null, "adds caller_may_place_property_in_chain(p.chain_id) check");
    assert(eaCheck !== null, "rejects estate-agent accounts (estate_agent_cannot_be_homeowner)");

    const eaIndex = updated.body.indexOf("_is_estate_agent_account(auth.uid())");
    const creatorIndex = updated.body.indexOf("p.created_by_user_id = auth.uid()");
    const chainIndex = updated.body.indexOf("caller_may_place_property_in_chain");
    const coreIndex = updated.body.indexOf("_establish_operational_homeowner_core(");

    assert(
      eaIndex >= 0 && creatorIndex > eaIndex,
      "estate-agent rejection runs before the creator check"
    );
    assert(
      creatorIndex >= 0 && chainIndex > creatorIndex && coreIndex > chainIndex,
      "chain check runs after the creator check and before the homeowner grant"
    );
    assert(
      chainCheck !== null &&
        eaCheck !== null &&
        normalize(
          updated.body.replace(chainCheck[0], "\n").replace(eaCheck[0], "\n")
        ) === normalize(original.body),
      "rest of the body is identical to 20260727100000"
    );
    assert(
      normalize(updated.header) === normalize(original.header),
      "header (returns, language, security, search_path) unchanged"
    );
    assert(
      /revoke all on function public\.establish_operational_homeowner_for_created_property\(bigint\) from public;\s*grant execute on function public\.establish_operational_homeowner_for_created_property\(bigint\) to authenticated;/i.test(migration),
      "ACL restated as in 20260727100000"
    );
  }

  console.log("\nk. break_chain_connection");
  {
    const updated = requireFunction(functions, "break_chain_connection");
    const original = requireFunction(
      extractFunctions(read("supabase/migrations/20260610300000_phase5a_ea_delegated_mutations.sql")),
      "break_chain_connection"
    );

    assert(isSecurityDefiner(updated), "still SECURITY DEFINER");
    assert(
      /update public\.properties\s+set buyer_connected = false\s+where id = v_upstream_id\s+and chain_id = v_property\.chain_id;/i.test(updated.body),
      "seller side: upstream update constrained to the property's chain"
    );
    assert(
      /select \*\s+from public\.properties\s+where linked_property_id = v_property\.id\s+and chain_id = v_property\.chain_id\s+loop/i.test(updated.body),
      "buyer side: inbound updates constrained to the property's chain"
    );

    const addedClauses = updated.body.match(/\n\s+and chain_id = v_property\.chain_id/g) ?? [];

    assert(addedClauses.length === 2, "exactly two same-chain clauses added");
    assert(
      normalize(updated.body.replace(/\n\s+and chain_id = v_property\.chain_id/g, "")) ===
        normalize(original.body),
      "rest of the body is identical to 20260610300000"
    );
    assert(
      normalize(updated.header) === normalize(original.header),
      "header (returns, language, security, search_path) unchanged"
    );
    assert(
      /revoke all on function public\.break_chain_connection\(bigint, text\) from public;\s*grant execute on function public\.break_chain_connection\(bigint, text\) to authenticated;/i.test(migration),
      "ACL restated as in 20260610300000"
    );
  }

  console.log("\nl. Database writers of properties (latest definitions)");
  {
    const latest = new Map<string, SqlFunction & { file: string }>();

    for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort()) {
      for (const [name, fn] of extractFunctions(read(`supabase/migrations/${file}`))) {
        latest.set(`${name}(${normalize(fn.args)})`, { ...fn, file });
      }
    }

    const writers = [...latest.entries()].filter(([, fn]) => writesProperties(fn.body));
    const invokerWriters = writers.filter(([, fn]) => !isSecurityDefiner(fn));

    assert(writers.length > 0, `found ${writers.length} database functions that write properties`);
    assert(
      invokerWriters.length === 0,
      invokerWriters.length === 0
        ? "every database writer of properties is SECURITY DEFINER (bypasses the direct-write rules)"
        : `SECURITY INVOKER writers: ${invokerWriters.map(([key]) => key).join(", ")}`
    );
  }

  console.log("\nm. Application write paths (unchanged)");
  {
    const startMove = read("app/start-move/page.tsx");
    const startMoveInserts = [
      ...startMove.matchAll(/\.from\("properties"\)\s*\.insert\(\{([\s\S]*?)\}\)/g),
    ].map((match) => match[1]);

    assert(startMoveInserts.length === 2, "start-move: sale and purchase direct inserts present");
    assert(
      startMoveInserts.every(
        (payload) =>
          /chain_id:\s*chainId/.test(payload) &&
          /created_by_user_id:\s*user\.id/.test(payload) &&
          !/linked_property_id/.test(payload)
      ),
      "start-move: inserts use the caller's onboarding chain, creator = user, no link"
    );
    assert(
      startMove.indexOf("createChainForOnboarding(") < startMove.indexOf('.from("properties")'),
      "start-move: chain is created (caller = chain creator) before property inserts"
    );

    const placeholder = read("lib/searchingPlaceholder.ts");
    const placeholderInsert =
      placeholder.match(/\.from\("properties"\)\s*\.insert\(\{([\s\S]*?)\}\)/)?.[1] ?? "";

    assert(
      /chain_id:\s*params\.chainId/.test(placeholderInsert) &&
        /created_by_user_id:\s*params\.userId/.test(placeholderInsert) &&
        /linked_property_id:\s*null/.test(placeholderInsert),
      "searching placeholder: insert with creator = user and null link"
    );
    assert(
      /establishOperationalHomeowner\(supabase,\s*\{\s*propertyId:\s*placeholder\.id,\s*grantedVia:\s*OPERATIONAL_IDENTITY_GRANT_VIA\.startMove/.test(placeholder),
      "searching placeholder: grant via establish_operational_homeowner_for_created_property"
    );

    const grants = read("lib/ownership/grants.ts");
    assert(
      grants.includes('"establish_operational_homeowner_for_created_property"'),
      "startMove grant maps to establish_operational_homeowner_for_created_property"
    );

    const joinSearching = read("lib/joinChainSearching.ts");
    assert(
      /\.update\(\{\s*chain_id:\s*params\.joinedProperty\.chain_id,\s*\}\)\s*\.eq\("id",\s*onwardSearching\.id\)\s*\.select\("id"\)/.test(joinSearching),
      "join migration: onward searching chain_id update (returns rows)"
    );
    assert(
      /\.update\(\{\s*linked_property_id:\s*params\.joinedProperty\.id,\s*chain_id:\s*params\.joinedProperty\.chain_id,\s*\}\)\s*\.eq\("id",\s*onwardSale\.id\)\s*\.select\("id"\)/.test(joinSearching),
      "join migration: onward sale chain_id + linked_property_id update (returns rows)"
    );
    assert(
      /moveSearchingError \|\| movedSearching\?\.length !== 1/.test(joinSearching) &&
        /moveSaleError \|\| movedSale\?\.length !== 1/.test(joinSearching) &&
        (joinSearching.match(/throw new SourceChainMigrationError\(/g) ?? []).length === 4,
      "join migration: application fix intact (rejected or zero-row updates throw)"
    );
    assert(
      /\.update\(\{\s*linked_property_id:\s*searchingId,\s*\}\)\s*\.eq\("id",\s*joinedProperty\.id\)\s*\.select\("id"\);\s*if \(error\) \{\s*throw error;\s*\}\s*if \(relinked\?\.length !== 1\) \{\s*return \{ ok: false, reason: "relink_not_applied" \};/.test(joinSearching),
      "join relink: joined property linked_property_id update throws on error and fails on zero rows"
    );
    assert(
      /if \(relinkResult\.reason === "relink_not_applied"\) \{\s*return \{ ok: false, reason: "relink_not_applied" \};/.test(joinSearching),
      "join relink: resolveSearchingFromJoinIntent propagates relink_not_applied"
    );

    const joinPage = read("app/join-chain/page.tsx");
    const order = [
      'supabase.rpc("join_chain_property"',
      "migrateSourceChainOnwardProperties(",
      "relinkJoinedPropertyToSearching(",
      "resolveSearchingFromJoinIntent(",
      '"cleanup_abandoned_onboarding_chain"',
      "error instanceof SourceChainMigrationError",
    ].map((needle) => joinPage.indexOf(needle));

    assert(
      order.every((index, i) => index >= 0 && (i === 0 || index > order[i - 1])),
      "join page: join → migrate → relink → placeholder → cleanup → catch order intact"
    );
    assert(
      joinPage.includes("formatJoinedPropertyRelinkFailure(") &&
        /intentResult\.reason ===\s*"relink_not_applied"[\s\S]*?JOINED_PROPERTY_RELINK_NOT_APPLIED_MESSAGE[\s\S]*?return;[\s\S]*?"cleanup_abandoned_onboarding_chain"/.test(joinPage),
      "join page: a relink that updates no row stops before source-chain cleanup with a safe message"
    );

    const finalize = read("lib/estateAgent/finalizeOperationalSaleCreation.ts");
    assert(
      finalize.includes("createSearchingPlaceholderForSale(supabase") &&
        !finalize.includes("attachSearchingPlaceholderToSale"),
      "EA sale origination: searching placeholder via create_searching_placeholder_for_sale (no direct insert)"
    );
    assert(
      placeholder.includes('"create_searching_placeholder_for_sale"'),
      "createSearchingPlaceholderForSale calls the SECURITY DEFINER RPC"
    );

    const originate = read("lib/estateAgent/originateOperationalProperty.ts");
    assert(
      ["create_ea_operational_chain", "create_ea_operational_property", "join_ea_operational_chain"].every(
        (rpc) => originate.includes(`"${rpc}"`)
      ),
      "EA origination: chain/property creation via SECURITY DEFINER RPCs"
    );

    const fixture = read("lib/smokeTest/createSyntheticFixture.ts");
    assert(
      /admin\s*\.from\("properties"\)\s*\.insert\(/.test(fixture),
      "smoke fixture: properties insert uses the service-role admin client"
    );
  }

  console.log("\nn. Direct properties write inventory");
  {
    const expected = new Map<string, number>([
      ["app/start-move/page.tsx", 2],
      ["lib/searchingPlaceholder.ts", 1],
      ["lib/joinChainSearching.ts", 3],
      ["lib/recordChainCompletionDate.ts", 1],
      ["context/ChainContext.tsx", 1],
      ["lib/smokeTest/createSyntheticFixture.ts", 1],
    ]);
    const stageOnly = new Set(["lib/recordChainCompletionDate.ts", "context/ChainContext.tsx"]);
    const found = new Map<string, number>();
    let stageOnlyClean = true;

    const files = ["app", "lib", "components", "context", "hooks"]
      .map((dir) => join(ROOT, dir))
      .filter((dir) => {
        try {
          return statSync(dir).isDirectory();
        } catch {
          return false;
        }
      })
      .flatMap((dir) => listSourceFiles(dir));

    for (const file of files) {
      const source = readFileSync(file, "utf8").replace(/\r\n/g, "\n");
      const rel = relative(ROOT, file).replace(/\\/g, "/");
      const writes = [
        ...source.matchAll(
          /\.from\(\s*["']properties["']\s*\)\s*\.(insert|update|upsert)\(\s*\{([\s\S]*?)\}\s*\)/g
        ),
      ];

      if (writes.length === 0) {
        continue;
      }

      found.set(rel, writes.length);

      if (stageOnly.has(rel)) {
        for (const write of writes) {
          if (PROTECTED_COLUMNS.some((column) => write[2].includes(column))) {
            stageOnlyClean = false;
          }
        }
      }
    }

    const unexpected = [...found.entries()].filter(
      ([file, count]) => expected.get(file) !== count
    );
    const missing = [...expected.keys()].filter((file) => !found.has(file));

    assert(
      unexpected.length === 0 && missing.length === 0,
      unexpected.length === 0 && missing.length === 0
        ? "direct properties writes match the reviewed inventory"
        : `inventory drift: unexpected=${JSON.stringify(unexpected)} missing=${JSON.stringify(missing)}`
    );
    assert(stageOnlyClean, "stage updates (ChainContext, recordChainCompletionDate) do not touch protected columns");
  }

  console.log("\no. SECURITY DEFINER allowlist");
  {
    const allowlist = JSON.parse(read("scripts/secdef-user-rpc-allowlist.json")) as {
      allowlist: { name: string; args: string }[];
    };

    for (const helper of HELPERS) {
      assert(
        allowlist.allowlist.some((entry) => entry.name === helper.name && entry.args === helper.args),
        `${helper.name}(${helper.args}) allowlisted for authenticated EXECUTE`
      );
    }

    assert(
      !allowlist.allowlist.some((entry) => entry.name === "_trg_properties_guard_direct_writes"),
      "trigger function is not allowlisted"
    );
  }

  console.log(`\n${passed} passed, ${failed} failed`);

  if (failed > 0) {
    process.exit(1);
  }
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exit(1);
}
