/**
 * Offline regression checks for migrateSourceChainOnwardProperties (join-chain
 * source-chain migration). A failed or no-op onward-property update must stop
 * the flow before cleanup_abandoned_onboarding_chain, which deletes every
 * property still on the source chain.
 *
 * Run: npx tsx scripts/verify-join-chain-source-migration-safety.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  migrateSourceChainOnwardProperties,
  SOURCE_CHAIN_MIGRATION_FAILED_MESSAGE,
  SourceChainMigrationError,
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

type Filter = [op: "eq" | "neq", column: string, value: unknown];

type RecordedQuery = {
  table: string;
  op: "select" | "update" | "delete" | "";
  payload?: Record<string, unknown>;
  filters: Filter[];
  returning: boolean;
};

type QueryResult = { data: unknown; error: unknown };

type FakeBuilder = PromiseLike<QueryResult> & {
  select: (columns: string) => FakeBuilder;
  update: (payload: Record<string, unknown>) => FakeBuilder;
  delete: () => FakeBuilder;
  eq: (column: string, value: unknown) => FakeBuilder;
  neq: (column: string, value: unknown) => FakeBuilder;
  maybeSingle: () => Promise<QueryResult>;
};

type UpdateOutcome = "ok" | "error" | "zero_rows";

type Scenario = {
  onwardSearchingId: number | null;
  onwardSaleId: number | null;
  lookupSearchingError?: boolean;
  searchingUpdate?: UpdateOutcome;
  saleUpdate?: UpdateOutcome;
};

const SOURCE_CHAIN_ID = "400";
const USER_ID = "user-under-test";
const JOINED = { id: 99, chain_id: 500, linked_property_id: null };

function filterValue(query: RecordedQuery, column: string): unknown {
  return query.filters.find(([, c]) => c === column)?.[2];
}

function resolveQuery(scenario: Scenario, query: RecordedQuery): QueryResult {
  if (query.op === "select") {
    if (filterValue(query, "stage") === "searching") {
      if (scenario.lookupSearchingError) {
        return { data: null, error: { message: "lookup failed", code: "XX000" } };
      }
      return {
        data: scenario.onwardSearchingId
          ? { id: scenario.onwardSearchingId }
          : null,
        error: null,
      };
    }

    if (filterValue(query, "relationship_type") === "sale") {
      return {
        data: scenario.onwardSaleId ? { id: scenario.onwardSaleId } : null,
        error: null,
      };
    }
  }

  if (query.op === "update") {
    const id = filterValue(query, "id");
    const outcome =
      id === scenario.onwardSearchingId
        ? scenario.searchingUpdate ?? "ok"
        : scenario.saleUpdate ?? "ok";

    if (outcome === "error") {
      return {
        data: null,
        error: { message: "chain integrity guard rejected update", code: "P0001" },
      };
    }

    if (outcome === "zero_rows") {
      return { data: [], error: null };
    }

    return { data: [{ id }], error: null };
  }

  return { data: null, error: { message: "unexpected query" } };
}

function createFakeClient(scenario: Scenario) {
  const queries: RecordedQuery[] = [];
  const rpcCalls: string[] = [];

  function from(table: string): FakeBuilder {
    const query: RecordedQuery = {
      table,
      op: "",
      filters: [],
      returning: false,
    };

    const run = () => {
      queries.push(query);
      return Promise.resolve(resolveQuery(scenario, query));
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
      delete() {
        query.op = "delete";
        return builder;
      },
      eq(column, value) {
        query.filters.push(["eq", column, value]);
        return builder;
      },
      neq(column, value) {
        query.filters.push(["neq", column, value]);
        return builder;
      },
      maybeSingle: run,
      then(onFulfilled, onRejected) {
        return run().then(onFulfilled, onRejected);
      },
    };

    return builder;
  }

  const client = {
    from,
    rpc(fn: string) {
      rpcCalls.push(fn);
      return Promise.resolve({ data: { ok: true }, error: null });
    },
  } as unknown as SupabaseClient;

  return { client, queries, rpcCalls };
}

function migrate(client: SupabaseClient) {
  return migrateSourceChainOnwardProperties(client, {
    sourceChainId: SOURCE_CHAIN_ID,
    userId: USER_ID,
    joinedProperty: JOINED,
    excludePropertyId: JOINED.id,
  });
}

async function captureError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
    return null;
  } catch (error) {
    return error;
  }
}

/** Mirrors the join-chain page ordering: migrate, then cleanup only on success. */
async function simulateSourceChainCompletion(client: SupabaseClient) {
  try {
    await migrate(client);
    await client.rpc("cleanup_abandoned_onboarding_chain", {
      p_chain_id: Number(SOURCE_CHAIN_ID),
    });
    return "completed" as const;
  } catch (error) {
    return error instanceof SourceChainMigrationError
      ? ("migration_failed" as const)
      : ("other_error" as const);
  }
}

function updates(queries: RecordedQuery[]) {
  return queries.filter((q) => q.op === "update");
}

async function main() {
  console.log("Join-chain source migration safety checks\n");

  console.log("a. Successful onward-property migration");
  {
    const fake = createFakeClient({ onwardSearchingId: 11, onwardSaleId: 12 });
    const result = await migrate(fake.client);
    const [searchingUpdate, saleUpdate] = updates(fake.queries);

    assert(result.onwardSearchingId === 11, "returns migrated searching id");
    assert(result.onwardSaleMigrated === true, "reports onward sale migrated");
    assert(updates(fake.queries).length === 2, "performs exactly two updates");
    assert(
      searchingUpdate?.payload?.chain_id === JOINED.chain_id &&
        filterValue(searchingUpdate, "id") === 11,
      "searching placeholder moved to joined chain"
    );
    assert(
      saleUpdate?.payload?.chain_id === JOINED.chain_id &&
        saleUpdate?.payload?.linked_property_id === JOINED.id &&
        filterValue(saleUpdate, "id") === 12,
      "onward sale moved and linked to joined property"
    );
    assert(
      updates(fake.queries).every((q) => q.returning),
      "updates request returned rows for row-count verification"
    );
    assert(fake.rpcCalls.length === 0, "migration itself calls no RPC");
    assert(
      !fake.queries.some((q) => q.op === "delete"),
      "migration itself performs no delete"
    );
    assert(
      (await simulateSourceChainCompletion(
        createFakeClient({ onwardSearchingId: 11, onwardSaleId: 12 }).client
      )) === "completed",
      "successful migration proceeds to completion"
    );
  }

  console.log("\na2. No onward properties");
  {
    const fake = createFakeClient({ onwardSearchingId: null, onwardSaleId: null });
    const result = await migrate(fake.client);
    assert(
      result.onwardSearchingId === null && result.onwardSaleMigrated === false,
      "returns empty migration result"
    );
    assert(updates(fake.queries).length === 0, "performs no updates");
  }

  console.log("\nb. Failed property updates stop the flow");
  {
    const fake = createFakeClient({
      onwardSearchingId: 11,
      onwardSaleId: 12,
      searchingUpdate: "error",
    });
    const error = await captureError(migrate(fake.client));
    assert(
      error instanceof SourceChainMigrationError &&
        error.step === "move_onward_searching",
      "searching update error throws SourceChainMigrationError(move_onward_searching)"
    );
    assert(
      updates(fake.queries).length === 1,
      "onward sale update is not attempted after searching update fails"
    );
  }
  {
    const fake = createFakeClient({
      onwardSearchingId: 11,
      onwardSaleId: 12,
      saleUpdate: "error",
    });
    const error = await captureError(migrate(fake.client));
    assert(
      error instanceof SourceChainMigrationError &&
        error.step === "move_onward_sale",
      "sale update error throws SourceChainMigrationError(move_onward_sale)"
    );
  }
  {
    const fake = createFakeClient({
      onwardSearchingId: 11,
      onwardSaleId: null,
      searchingUpdate: "zero_rows",
    });
    const error = await captureError(migrate(fake.client));
    assert(
      error instanceof SourceChainMigrationError &&
        error.step === "move_onward_searching" &&
        error.sourceError === "no_row_updated",
      "zero-row (RLS-filtered) update is treated as failure"
    );
  }
  {
    const fake = createFakeClient({
      onwardSearchingId: 11,
      onwardSaleId: 12,
      lookupSearchingError: true,
    });
    const error = await captureError(migrate(fake.client));
    assert(
      error instanceof SourceChainMigrationError &&
        error.step === "lookup_onward_searching",
      "lookup error throws SourceChainMigrationError(lookup_onward_searching)"
    );
    assert(updates(fake.queries).length === 0, "no updates after lookup error");
  }

  console.log("\nc. Source-chain cleanup does not run after a failed update");
  for (const scenario of [
    { onwardSearchingId: 11, onwardSaleId: 12, searchingUpdate: "error" },
    { onwardSearchingId: 11, onwardSaleId: 12, saleUpdate: "error" },
    { onwardSearchingId: 11, onwardSaleId: null, searchingUpdate: "zero_rows" },
    { onwardSearchingId: 11, onwardSaleId: 12, lookupSearchingError: true },
  ] satisfies Scenario[]) {
    const fake = createFakeClient(scenario);
    const outcome = await simulateSourceChainCompletion(fake.client);
    assert(
      outcome === "migration_failed" &&
        !fake.rpcCalls.includes("cleanup_abandoned_onboarding_chain") &&
        !fake.queries.some((q) => q.op === "delete"),
      `no cleanup/delete after failure (${JSON.stringify(scenario)})`
    );
  }

  console.log("\nc2. Join-chain page wiring");
  {
    const page = readFileSync(
      join(process.cwd(), "app", "join-chain", "page.tsx"),
      "utf8"
    );
    const tryIndex = page.indexOf("let joinCompleted = false;");
    const migrateIndex = page.indexOf(
      "await migrateSourceChainOnwardProperties(",
      tryIndex
    );
    const cleanupIndex = page.indexOf(
      '"cleanup_abandoned_onboarding_chain"',
      tryIndex
    );
    const redirectIndex = page.indexOf("window.location.href", tryIndex);
    const catchIndex = page.indexOf("} catch (error) {", cleanupIndex);

    assert(
      tryIndex >= 0 && migrateIndex > tryIndex,
      "migration runs inside the join-completion try block"
    );
    assert(
      cleanupIndex > migrateIndex && catchIndex > cleanupIndex,
      "cleanup is after migration and before the catch (skipped on throw)"
    );
    assert(
      redirectIndex > cleanupIndex && redirectIndex < catchIndex,
      "success redirect is only reached after cleanup, inside the try block"
    );
    assert(
      page.indexOf("cleanup_abandoned_onboarding_chain", catchIndex) === -1,
      "catch block does not run cleanup"
    );
    assert(
      page.includes("error instanceof SourceChainMigrationError") &&
        page.includes("SOURCE_CHAIN_MIGRATION_FAILED_MESSAGE"),
      "catch block shows the source-chain migration failure message"
    );
  }

  console.log("\nd. User-facing failure message");
  assert(
    !/success|completed/i.test(SOURCE_CHAIN_MIGRATION_FAILED_MESSAGE),
    "message does not report the join as successful"
  );
  assert(
    /nothing was removed/i.test(SOURCE_CHAIN_MIGRATION_FAILED_MESSAGE),
    "message states original details were kept"
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
