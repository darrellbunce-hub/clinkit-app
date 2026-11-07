/**
 * Offline checks for the 20261021130000 INSERT ... RETURNING regression.
 *
 * properties_select_member_or_agent (130000) authorises creators through
 * is_property_creator_bootstrap_viewer(id), which looks the row up by id. The
 * SELECT policy is evaluated for a RETURNING row before that row is visible,
 * so a homeowner's .from("properties").insert(...).select() is refused with
 * 42501. Homeowner property creation must therefore go through the
 * SECURITY DEFINER RPCs, which derive the creator from auth.uid(), and the
 * policy must not be widened to make direct inserts work.
 *
 * Run: npx tsx scripts/verify-property-insert-returning-fix.ts
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  formatTopologyConflictMessage,
  resolveSearchingFromJoinIntent,
} from "../lib/joinChainSearching";
import { createSearchingPlaceholderForSale } from "../lib/searchingPlaceholder";

const ROOT = process.cwd();

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

function read(path: string) {
  return readFileSync(join(ROOT, path), "utf8");
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(ROOT, dir))) {
    const rel = join(dir, entry);
    if (statSync(join(ROOT, rel)).isDirectory()) {
      out.push(...sourceFiles(rel));
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(rel);
    }
  }
  return out;
}

type Rpc = { fn: string; args: Record<string, unknown> };
type Query = {
  table: string;
  op: "select" | "insert" | "update" | "";
  payload?: Record<string, unknown>;
  filters: Array<[string, unknown]>;
  returning: boolean;
};

type FakeOptions = {
  existingPlaceholderId?: number | null;
  rpc?: { data: unknown; error: unknown };
  racedPlaceholderId?: number | null;
};

function createFakeClient(options: FakeOptions) {
  const rpcs: Rpc[] = [];
  const queries: Query[] = [];
  let lookups = 0;

  function resolve(query: Query) {
    if (query.op === "select") {
      lookups += 1;
      const id =
        lookups === 1 ? options.existingPlaceholderId : options.racedPlaceholderId;
      return { data: id == null ? null : { id }, error: null };
    }

    if (query.op === "update") {
      const id = query.filters.find(([column]) => column === "id")?.[1];
      return { data: query.returning ? [{ id }] : null, error: null };
    }

    return { data: null, error: { code: "42501", message: "unexpected direct write" } };
  }

  function from(table: string) {
    const query: Query = { table, op: "", filters: [], returning: false };
    const run = () => {
      queries.push(query);
      return Promise.resolve(resolve(query));
    };
    const builder = {
      select() {
        if (query.op === "") query.op = "select";
        else query.returning = true;
        return builder;
      },
      insert(payload: Record<string, unknown>) {
        query.op = "insert";
        query.payload = payload;
        return builder;
      },
      update(payload: Record<string, unknown>) {
        query.op = "update";
        query.payload = payload;
        return builder;
      },
      eq(column: string, value: unknown) {
        query.filters.push([column, value]);
        return builder;
      },
      single: run,
      maybeSingle: run,
      then(onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) {
        return run().then(onFulfilled, onRejected);
      },
    };
    return builder;
  }

  function rpc(fn: string, args: Record<string, unknown>) {
    rpcs.push({ fn, args });
    return Promise.resolve(options.rpc ?? { data: null, error: null });
  }

  const client = { from, rpc } as unknown as SupabaseClient;
  return { client, rpcs, queries };
}

const USER_ID = "user-under-test";
const JOINED = { id: 99, chain_id: 500, linked_property_id: null };

function joinIntent(client: SupabaseClient, joinedProperty = JOINED) {
  return resolveSearchingFromJoinIntent(client, {
    userId: USER_ID,
    joinedProperty,
    searchingIntent: true,
    migratedSearchingId: null,
  });
}

async function main() {
  console.log("Property INSERT ... RETURNING regression checks\n");

  console.log("a. No homeowner-side direct property insert in application code");
  {
    const files = ["app", "lib", "components", "context"].flatMap(sourceFiles);
    const writers = files.filter((file) =>
      /\.from\(\s*["']properties["']\s*\)\s*\.(insert|upsert)\(/.test(read(file))
    );
    const allowed = "lib/smokeTest/createSyntheticFixture.ts";
    const unexpected = writers
      .map((file) => relative(ROOT, join(ROOT, file)).replace(/\\/g, "/"))
      .filter((file) => file !== allowed);

    assert(
      unexpected.length === 0,
      `only the service-role smoke fixture inserts into properties directly${
        unexpected.length ? ` (found: ${unexpected.join(", ")})` : ""
      }`
    );
    assert(
      /await admin\s*\.from\("properties"\)\s*\.insert\(/.test(read(allowed)),
      "smoke fixture insert uses the service-role admin client"
    );
  }

  console.log("\nb. Start Move creates through SECURITY DEFINER RPCs");
  {
    const startMove = read("app/start-move/page.tsx");
    const grants = read("lib/ownership/grants.ts");
    assert(
      grants.includes('supabase.rpc("start_move_create_property", {') &&
        !/p_created_by|p_user_id/.test(grants),
      "sale and purchase via start_move_create_property; creator from auth.uid()"
    );
    assert(
      (startMove.match(/await createStartMoveProperty\(supabase, \{/g) ?? []).length === 2,
      "Start Move creates both the sale and the purchase through createStartMoveProperty"
    );
    assert(
      /createSearchingPlaceholderForSale\(\s*supabase,\s*\{\s*salePropertyId:\s*sellingPropertyId,\s*\}\s*\)/.test(startMove),
      "searching placeholder via create_searching_placeholder_for_sale with the sale id only"
    );
    assert(
      !/\.from\("properties"\)\s*\.insert\(/.test(startMove),
      "no direct property insert in Start Move"
    );
  }

  console.log("\nc. Placeholder wrapper sends only the sale id");
  {
    const fake = createFakeClient({
      rpc: { data: { ok: true, property_id: 41, created: true }, error: null },
    });
    const result = await createSearchingPlaceholderForSale(fake.client, { salePropertyId: 7 });
    assert(
      result.ok === true && result.placeholderId === 41 && result.created === true,
      "returns the created placeholder id to the caller"
    );
    assert(
      fake.rpcs.length === 1 &&
        fake.rpcs[0].fn === "create_searching_placeholder_for_sale" &&
        JSON.stringify(fake.rpcs[0].args) === JSON.stringify({ p_sale_property_id: 7 }),
      "RPC arguments carry no user id or actor"
    );

    const again = await createSearchingPlaceholderForSale(
      createFakeClient({
        rpc: { data: { ok: true, property_id: 41, created: false }, error: null },
      }).client,
      { salePropertyId: 7 }
    );
    assert(
      again.ok === true && again.placeholderId === 41 && again.created === false,
      "retry returns the existing linked placeholder (no duplicate)"
    );

    const transport = await createSearchingPlaceholderForSale(
      createFakeClient({ rpc: { data: null, error: { message: "boom" } } }).client,
      { salePropertyId: 7 }
    );
    assert(transport.ok === false && transport.error === "boom", "transport error is surfaced");

    const refused = await createSearchingPlaceholderForSale(
      createFakeClient({ rpc: { data: { ok: false, error: "not_authorized" }, error: null } }).client,
      { salePropertyId: 7 }
    );
    assert(
      refused.ok === false && refused.error === "not_authorized",
      "application refusal is surfaced (no false success)"
    );
  }

  console.log("\nd. Join Chain searching intent");
  {
    const fake = createFakeClient({
      rpc: { data: { ok: true, property_id: 52, created: true }, error: null },
    });
    const result = await joinIntent(fake.client);
    assert(
      result?.ok === true && result.searchingId === 52 && result.created === true,
      "new placeholder created and returned by the RPC"
    );
    assert(
      fake.rpcs.length === 1 &&
        JSON.stringify(fake.rpcs[0].args) === JSON.stringify({ p_sale_property_id: JOINED.id }),
      "RPC anchored on the joined property id only"
    );
    assert(
      !fake.queries.some((q) => q.op === "insert" || q.op === "update"),
      "no direct insert or separate relink write (RPC links atomically)"
    );
  }
  {
    const fake = createFakeClient({ existingPlaceholderId: 31 });
    const result = await joinIntent(fake.client);
    assert(
      result?.ok === true && result.searchingId === 31 && result.created === false,
      "existing placeholder reused and relinked"
    );
    assert(fake.rpcs.length === 0, "no RPC when a placeholder already exists");
  }
  {
    const fake = createFakeClient({
      rpc: { data: { ok: false, error: "sale_already_linked" }, error: null },
    });
    const result = await joinIntent(fake.client);
    assert(
      result?.ok === false &&
        result.reason === "downstream_link_exists" &&
        formatTopologyConflictMessage(result.existingLinkedPropertyId!) !== "",
      "sale_already_linked → downstream_link_exists with a visible message"
    );
    assert(
      !fake.queries.some((q) => q.op === "update"),
      "no relink attempted over an existing link"
    );
  }
  {
    const fake = createFakeClient({
      rpc: { data: { ok: false, error: "searching_placeholder_exists" }, error: null },
      racedPlaceholderId: 33,
    });
    const result = await joinIntent(fake.client);
    assert(
      result?.ok === true && result.searchingId === 33 && result.created === false,
      "concurrent creation: raced placeholder reused"
    );
  }
  {
    const fake = createFakeClient({
      rpc: { data: { ok: false, error: "not_authorized" }, error: null },
    });
    const result = await joinIntent(fake.client);
    assert(
      result?.ok === false && result.reason === "insert_failed" && result.error === "not_authorized",
      "refusal reported as insert_failed, not success"
    );
  }

  console.log("\ne. Policy is not widened");
  {
    const m130 = read("docs/prelaunch/stage2/20261021130000_former_branch_scope_and_delink_options.sql");
    const m160 = read("docs/prelaunch/stage2/20261021160000_existence_probes_and_helper_grants.sql");
    assert(
      /create policy properties_select_member_or_agent[\s\S]*?using \(\s*public\.is_property_member\(id\)\s+or public\.is_ea_assigned_to_property\(id\)\s+or public\.is_property_creator_bootstrap_viewer\(id\)\s*\);/.test(m130),
      "130000 SELECT policy unchanged (bootstrap viewer helper only)"
    );
    assert(
      /is_property_creator_bootstrap_viewer[\s\S]*?p\.created_by_user_id = auth\.uid\(\)/.test(m130),
      "bootstrap helper still requires the caller to be the creator (no id probe)"
    );
    const stage2Sql = readdirSync(join(ROOT, "docs/prelaunch/stage2"))
      .filter((file) => file.endsWith(".sql"))
      .map((file) => read(join("docs/prelaunch/stage2", file)))
      .join("\n");
    assert(
      !/grant\s+execute\s+on\s+function\s+public\.property_has_any_member\([^)]*\)\s+to\s+[^;]*authenticated/i.test(stage2Sql),
      "no Stage 2 SQL re-grants property_has_any_member to authenticated"
    );
    assert(
      m160.includes("property_has_any_member"),
      "160000 still covers property_has_any_member"
    );
  }

  console.log("\nf. Live trial script is rolled back");
  {
    const trial = read("docs/prelaunch/stage2/property-insert-returning-trial.development-rollback.sql");
    assert(
      /raise exception 'TRIAL_RESULT: %'/.test(trial.trim().split("\n").slice(-3).join("\n")),
      "trial ends by raising, so the transaction rolls back"
    );
    assert(!trial.includes("qguwzsdonffgfebchfqy"), "trial does not reference Production");
  }

  console.log(`\n${passed} passed, ${failed} failed`);

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
