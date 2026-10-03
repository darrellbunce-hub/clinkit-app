/**
 * Offline regression checks for the final Join Chain write: linking the joined
 * property to the joiner's searching placeholder. An update that RLS filters to
 * zero rows (or that errors) must fail visibly instead of reporting success,
 * and the join page must stop before source-chain cleanup.
 *
 * Run: npx tsx scripts/verify-join-chain-relink-row-count.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  formatJoinedPropertyRelinkFailure,
  JOINED_PROPERTY_RELINK_NOT_APPLIED_MESSAGE,
  relinkJoinedPropertyToSearching,
  resolveSearchingFromJoinIntent,
} from "../lib/joinChainSearching";

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

type RecordedQuery = {
  table: string;
  op: "select" | "update" | "";
  payload?: Record<string, unknown>;
  filters: Array<[column: string, value: unknown]>;
  returning: boolean;
};

type QueryResult = { data: unknown; error: unknown };

type FakeBuilder = PromiseLike<QueryResult> & {
  select: (columns: string) => FakeBuilder;
  update: (payload: Record<string, unknown>) => FakeBuilder;
  eq: (column: string, value: unknown) => FakeBuilder;
  maybeSingle: () => Promise<QueryResult>;
};

type UpdateOutcome = "ok" | "error" | "zero_rows";

const USER_ID = "user-under-test";
const SEARCHING_ID = 31;
const JOINED = { id: 99, chain_id: 500, linked_property_id: null };

function createFakeClient(outcome: UpdateOutcome) {
  const queries: RecordedQuery[] = [];

  function resolve(query: RecordedQuery): QueryResult {
    if (query.op === "select") {
      return { data: { id: SEARCHING_ID }, error: null };
    }

    if (outcome === "error") {
      return {
        data: null,
        error: { message: "chain integrity guard rejected update", code: "P0001" },
      };
    }

    if (outcome === "zero_rows") {
      return { data: query.returning ? [] : null, error: null };
    }

    const id = query.filters.find(([column]) => column === "id")?.[1];
    return { data: query.returning ? [{ id }] : null, error: null };
  }

  function from(table: string): FakeBuilder {
    const query: RecordedQuery = { table, op: "", filters: [], returning: false };

    const run = () => {
      queries.push(query);
      return Promise.resolve(resolve(query));
    };

    const builder: FakeBuilder = {
      select() {
        if (query.op === "") {
          query.op = "select";
        } else {
          query.returning = true;
        }
        return builder;
      },
      update(payload) {
        query.op = "update";
        query.payload = payload;
        return builder;
      },
      eq(column, value) {
        query.filters.push([column, value]);
        return builder;
      },
      maybeSingle: run,
      then(onFulfilled, onRejected) {
        return run().then(onFulfilled, onRejected);
      },
    };

    return builder;
  }

  const client = { from } as unknown as SupabaseClient;
  return { client, queries };
}

async function captureError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
    return null;
  } catch (error) {
    return error;
  }
}

function updates(queries: RecordedQuery[]) {
  return queries.filter((q) => q.op === "update");
}

async function main() {
  console.log("Join Chain relink row-count checks\n");

  console.log("a. One row updated → linked");
  {
    const fake = createFakeClient("ok");
    const result = await relinkJoinedPropertyToSearching(fake.client, JOINED, SEARCHING_ID);
    const [update] = updates(fake.queries);
    assert(
      result.ok === true && "linkedSearchingId" in result && result.linkedSearchingId === SEARCHING_ID,
      "returns linkedSearchingId"
    );
    assert(
      update?.payload?.linked_property_id === SEARCHING_ID &&
        update.filters.some(([column, value]) => column === "id" && value === JOINED.id),
      "updates the joined property's linked_property_id"
    );
    assert(update?.returning === true, "update requests returned rows for the row count");
  }

  console.log("\nb. Zero rows updated (RLS-filtered) → relink_not_applied");
  {
    const fake = createFakeClient("zero_rows");
    const result = await relinkJoinedPropertyToSearching(fake.client, JOINED, SEARCHING_ID);
    assert(
      result.ok === false && result.reason === "relink_not_applied",
      "zero-row update is reported as relink_not_applied, not success"
    );
    assert(
      result.ok === false &&
        formatJoinedPropertyRelinkFailure(result) === JOINED_PROPERTY_RELINK_NOT_APPLIED_MESSAGE,
      "failure maps to the relink-not-applied message"
    );
  }

  console.log("\nc. Update error → throws");
  {
    const fake = createFakeClient("error");
    const error = await captureError(
      relinkJoinedPropertyToSearching(fake.client, JOINED, SEARCHING_ID)
    );
    assert(
      typeof error === "object" && error !== null && (error as { code?: string }).code === "P0001",
      "database error propagates"
    );
  }

  console.log("\nd. Existing downstream link → no write");
  {
    const fake = createFakeClient("ok");
    const result = await relinkJoinedPropertyToSearching(
      fake.client,
      { ...JOINED, linked_property_id: 77 },
      SEARCHING_ID
    );
    assert(
      result.ok === false && result.reason === "downstream_link_exists",
      "downstream_link_exists returned"
    );
    assert(updates(fake.queries).length === 0, "no update attempted");
  }
  {
    const fake = createFakeClient("zero_rows");
    const result = await relinkJoinedPropertyToSearching(
      fake.client,
      { ...JOINED, linked_property_id: SEARCHING_ID },
      SEARCHING_ID
    );
    assert(
      result.ok === true && "alreadyLinked" in result,
      "already linked to the placeholder → idempotent success without a write"
    );
    assert(updates(fake.queries).length === 0, "no update attempted when already linked");
  }

  console.log("\ne. resolveSearchingFromJoinIntent propagates the row count");
  {
    const ok = await resolveSearchingFromJoinIntent(createFakeClient("ok").client, {
      userId: USER_ID,
      joinedProperty: JOINED,
      searchingIntent: true,
      migratedSearchingId: null,
    });
    assert(
      ok?.ok === true && ok.searchingId === SEARCHING_ID && ok.created === false,
      "existing placeholder linked → ok"
    );

    const zero = await resolveSearchingFromJoinIntent(createFakeClient("zero_rows").client, {
      userId: USER_ID,
      joinedProperty: JOINED,
      searchingIntent: true,
      migratedSearchingId: null,
    });
    assert(
      zero?.ok === false && zero.reason === "relink_not_applied",
      "zero-row relink → relink_not_applied (not ok)"
    );
  }

  console.log("\nf. Join page wiring");
  {
    const page = readFileSync(join(process.cwd(), "app", "join-chain", "page.tsx"), "utf8");
    const migrationRelinkIndex = page.indexOf("const migrationRelinkResult");
    const migrationFailureIndex = page.indexOf(
      "formatJoinedPropertyRelinkFailure(",
      migrationRelinkIndex
    );
    const intentFailureIndex = page.indexOf('"relink_not_applied"');
    const cleanupIndex = page.indexOf('"cleanup_abandoned_onboarding_chain"');

    assert(
      migrationRelinkIndex >= 0 && migrationFailureIndex > migrationRelinkIndex,
      "migration relink failure uses formatJoinedPropertyRelinkFailure"
    );
    assert(
      intentFailureIndex >= 0 &&
        page.indexOf("JOINED_PROPERTY_RELINK_NOT_APPLIED_MESSAGE", intentFailureIndex) > intentFailureIndex,
      "intent relink_not_applied shows the safe message"
    );
    assert(
      cleanupIndex > intentFailureIndex && cleanupIndex > migrationFailureIndex,
      "both failure paths are handled before source-chain cleanup"
    );
  }

  console.log("\ng. User-facing message");
  assert(
    /nothing was removed/i.test(JOINED_PROPERTY_RELINK_NOT_APPLIED_MESSAGE),
    "message states nothing was removed"
  );
  assert(
    /could not link/i.test(JOINED_PROPERTY_RELINK_NOT_APPLIED_MESSAGE),
    "message says the link was not made"
  );

  console.log(`\n${passed} passed, ${failed} failed`);

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
