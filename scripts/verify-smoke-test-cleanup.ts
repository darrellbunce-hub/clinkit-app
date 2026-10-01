/**
 * Smoke-fixture cleanup behavioural verifier (in-memory mock — no Production).
 *
 * Covers:
 *   A normal cleanup
 *   B branch/member owner-invariant ordering
 *   C already-absent DB object
 *   D already-absent Auth user
 *   E genuine failure
 *   F linked object never hard-deleted
 *   G non-fixture isolation
 *   H resumability after partial run
 *
 * Usage:
 *   npx tsx scripts/verify-smoke-test-cleanup.ts
 *
 * Does NOT connect to Production. Does NOT use live Supabase.
 */
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";

const require = createRequire(import.meta.url);
const Module = require("module") as typeof import("module") & {
  _load: (...args: unknown[]) => unknown;
};
const originalLoad = Module._load;
Module._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === "server-only") return {};
  return originalLoad.apply(this, arguments as unknown as [string, unknown, boolean]);
};

const {
  cleanupSmokeTestFixture,
  planSmokeTestFixtureCleanup,
  isAuthUserNotFoundError,
} = require("../lib/smokeTest/cleanup.ts") as typeof import("../lib/smokeTest/cleanup");

type Row = Record<string, unknown>;

type Store = {
  fixtures: Map<string, Row>;
  objects: Map<string, Row>;
  audits: Row[];
  tables: Record<string, Map<string, Row>>;
  authUsers: Map<string, { id: string }>;
  /** Force next delete on this table/id to fail with message. */
  failDeletes: Map<string, string>;
};

function keyFor(fixtureId: string, objectType: string, objectId: string) {
  return `${fixtureId}|${objectType}|${objectId}`;
}

function createStore(): Store {
  return {
    fixtures: new Map(),
    objects: new Map(),
    audits: [],
    tables: {
      property_ea_assignments: new Map(),
      ea_branch_invitations: new Map(),
      activities: new Map(),
      chain_nodes: new Map(),
      property_members: new Map(),
      properties: new Map(),
      chains: new Map(),
      ea_branch_members: new Map(),
      ea_branches: new Map(),
      ea_companies: new Map(),
      profiles: new Map(),
    },
    authUsers: new Map(),
    failDeletes: new Map(),
  };
}

function createMockAdmin(store: Store) {
  function from(table: string) {
    if (table === "smoke_test_fixtures") {
      return fixtureQuery();
    }
    if (table === "smoke_test_fixture_objects") {
      return objectsQuery();
    }
    if (table === "smoke_test_fixture_audit_events") {
      return {
        insert: async (row: Row | Row[]) => {
          const rows = Array.isArray(row) ? row : [row];
          for (const r of rows) {
            store.audits.push({
              id: randomUUID(),
              created_at: new Date().toISOString(),
              ...r,
            });
          }
          return { data: null, error: null };
        },
      };
    }

    const map = store.tables[table];
    if (!map) {
      throw new Error(`unexpected_table:${table}`);
    }
    return tableQuery(table, map);
  }

  function fixtureQuery() {
    let eqId: string | null = null;
    const api = {
      select: (_cols?: string) => api,
      eq: (col: string, val: string) => {
        if (col === "id") eqId = val;
        return api;
      },
      maybeSingle: async () => {
        if (!eqId) return { data: null, error: null };
        return { data: store.fixtures.get(eqId) ?? null, error: null };
      },
      update: (patch: Row) => ({
        eq: async (col: string, val: string) => {
          if (col !== "id") return { data: null, error: null };
          const existing = store.fixtures.get(val);
          if (existing) {
            store.fixtures.set(val, { ...existing, ...patch });
          }
          return { data: null, error: null };
        },
      }),
      insert: async () => ({ data: null, error: null }),
    };
    return api;
  }

  function objectsQuery() {
    let fixtureId: string | null = null;
    const api = {
      select: (_cols?: string) => api,
      eq: (col: string, val: string) => {
        if (col === "fixture_id") fixtureId = val;
        return api;
      },
      order: async () => {
        const rows = [...store.objects.values()].filter(
          (o) => !fixtureId || o.fixture_id === fixtureId
        );
        rows.sort((a, b) =>
          String(a.created_at).localeCompare(String(b.created_at))
        );
        return { data: rows, error: null };
      },
    };
    return api;
  }

  function tableQuery(table: string, map: Map<string, Row>) {
    let eqId: string | null = null;
    let neqStatus: string | null = null;
    let updatePatch: Row | null = null;
    let mode: "select" | "delete" | "update" = "select";

    const runSelect = () => {
      if (!eqId) return { data: null, error: null };
      const row = map.get(eqId) ?? null;
      return { data: row, error: null };
    };

    const api = {
      select: (_cols?: string) => {
        if (mode === "delete" || mode === "update") {
          // chained after delete/update — execute now
          return executeMutation();
        }
        mode = "select";
        return api;
      },
      eq: (col: string, val: string) => {
        if (col === "id") eqId = val;
        return api;
      },
      neq: (col: string, val: string) => {
        if (col === "status") neqStatus = val;
        return api;
      },
      maybeSingle: async () => runSelect(),
      delete: () => {
        mode = "delete";
        return api;
      },
      update: (patch: Row) => {
        mode = "update";
        updatePatch = patch;
        return api;
      },
    };

    async function executeMutation() {
      if (!eqId) {
        return { data: [], error: null };
      }

      const failKey = `${table}:${eqId}`;
      if (mode === "delete" && store.failDeletes.has(failKey)) {
        const message = store.failDeletes.get(failKey)!;
        return { data: null, error: { message } };
      }

      if (mode === "delete") {
        // Owner invariant: cannot delete last/sole branch_admin while branch exists.
        if (table === "ea_branch_members") {
          const member = map.get(eqId);
          if (member) {
            const branchId = String(member.branch_id);
            const branchExists = store.tables.ea_branches.has(branchId);
            if (branchExists) {
              const ownerCountAfter = [...map.values()].filter(
                (m) =>
                  String(m.branch_id) === branchId &&
                  m.role === "branch_admin" &&
                  String(m.id) !== eqId
              ).length;
              if (ownerCountAfter !== 1) {
                return {
                  data: null,
                  error: {
                    message: `ea_branch_owner_invariant_violation: branch ${branchId} has ${ownerCountAfter} owners`,
                  },
                };
              }
            }
          }
        }

        const existing = map.get(eqId);
        if (!existing) {
          return { data: [], error: null };
        }
        map.delete(eqId);

        // CASCADE: deleting ea_branches removes members
        if (table === "ea_branches") {
          for (const [id, member] of [...store.tables.ea_branch_members.entries()]) {
            if (String(member.branch_id) === eqId) {
              store.tables.ea_branch_members.delete(id);
            }
          }
        }

        return { data: [{ id: eqId }], error: null };
      }

      if (mode === "update") {
        const existing = map.get(eqId);
        if (!existing) {
          return { data: [], error: null };
        }
        if (neqStatus != null && existing.status === neqStatus) {
          return { data: [], error: null };
        }
        const next = { ...existing, ...(updatePatch ?? {}) };
        map.set(eqId, next);
        return { data: [{ id: eqId }], error: null };
      }

      return { data: null, error: null };
    }

    // Allow await on delete().eq() without select by making thenable — but cleanup always .select("id")
    return api;
  }

  return {
    from,
    auth: {
      admin: {
        deleteUser: async (userId: string) => {
          if (!store.authUsers.has(userId)) {
            return {
              data: null,
              error: { message: "User not found", status: 404, code: "user_not_found" },
            };
          }
          store.authUsers.delete(userId);
          return { data: { user: null }, error: null };
        },
        getUserById: async (userId: string) => {
          const user = store.authUsers.get(userId);
          if (!user) {
            return {
              data: { user: null },
              error: { message: "User not found", status: 404, code: "user_not_found" },
            };
          }
          return { data: { user }, error: null };
        },
      },
    },
  };
}

function seedFixture(store: Store, label: string) {
  const fixtureId = randomUUID();
  store.fixtures.set(fixtureId, {
    id: fixtureId,
    label,
    status: "active",
    notes: null,
    created_by_admin_user_id: null,
    created_at: new Date().toISOString(),
    cleaned_at: null,
    cleaned_by_admin_user_id: null,
  });
  return fixtureId;
}

function register(
  store: Store,
  fixtureId: string,
  objectType: string,
  objectId: string,
  ownership: "owned" | "linked" = "owned"
) {
  const id = randomUUID();
  store.objects.set(keyFor(fixtureId, objectType, objectId), {
    id,
    fixture_id: fixtureId,
    object_type: objectType,
    object_id: objectId,
    ownership,
    created_at: new Date().toISOString(),
  });
}

function put(store: Store, table: string, row: Row) {
  store.tables[table].set(String(row.id), row);
}

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string, detail?: string) {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
    return;
  }
  failed += 1;
  console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
}

async function testA_normalCleanup() {
  console.log("\nTest A — normal cleanup");
  const store = createStore();
  const admin = createMockAdmin(store);
  const fixtureId = seedFixture(store, "A");

  const companyId = randomUUID();
  const branchId = randomUUID();
  const memberId = randomUUID();
  const chainId = "1001";
  const propertyId = "2001";
  const userId = randomUUID();

  put(store, "ea_companies", { id: companyId, created_by_user_id: userId });
  put(store, "ea_branches", { id: branchId, company_id: companyId });
  put(store, "ea_branch_members", {
    id: memberId,
    branch_id: branchId,
    user_id: userId,
    role: "branch_admin",
  });
  put(store, "chains", { id: chainId });
  put(store, "properties", { id: propertyId, chain_id: chainId });
  put(store, "profiles", { id: userId });
  store.authUsers.set(userId, { id: userId });

  for (const [t, id] of [
    ["ea_company", companyId],
    ["ea_branch", branchId],
    ["ea_branch_member", memberId],
    ["chain", chainId],
    ["property", propertyId],
    ["profile", userId],
    ["auth_user", userId],
  ] as const) {
    register(store, fixtureId, t, id);
  }

  const plan = await planSmokeTestFixtureCleanup(admin as never, fixtureId);
  const memberAction = plan.actions.find(
    (a) => a.object_type === "ea_branch_member" && a.object_id === memberId
  );
  assert(
    memberAction?.action === "expect_cascade",
    "plans expect_cascade for owned member under owned branch"
  );

  const result = await cleanupSmokeTestFixture(admin as never, {
    fixtureId,
    dryRun: false,
    confirmFixtureId: fixtureId,
  });

  assert(result.ok === true, "cleanup succeeds");
  assert(
    store.fixtures.get(fixtureId)?.status === "cleaned",
    "fixture marked cleaned"
  );
  assert(!store.tables.ea_branches.has(branchId), "branch deleted");
  assert(!store.tables.ea_branch_members.has(memberId), "member cascaded away");
  assert(!store.authUsers.has(userId), "auth user deleted");
  assert(
    store.audits.some((a) => a.event_type === "cleanup_execute"),
    "cleanup_execute audit written"
  );
  assert(
    store.audits.some((a) => a.event_type === "cleanup_execution_result"),
    "cleanup_execution_result audit written"
  );
  assert(
    store.audits.some((a) => a.event_type === "fixture_cleaned"),
    "fixture_cleaned audit written"
  );
}

async function testB_branchMemberInvariant() {
  console.log("\nTest B — branch/member invariant");
  const store = createStore();
  const admin = createMockAdmin(store);
  const fixtureId = seedFixture(store, "B");
  const branchId = randomUUID();
  const memberId = randomUUID();

  put(store, "ea_branches", { id: branchId });
  put(store, "ea_branch_members", {
    id: memberId,
    branch_id: branchId,
    role: "branch_admin",
  });
  register(store, fixtureId, "ea_branch", branchId);
  register(store, fixtureId, "ea_branch_member", memberId);

  const plan = await planSmokeTestFixtureCleanup(admin as never, fixtureId);
  assert(
    !plan.actions.some(
      (a) =>
        a.object_type === "ea_branch_member" &&
        a.action === "delete" &&
        a.object_id === memberId
    ),
    "does not plan explicit delete of cascade-covered member"
  );
  assert(
    plan.actions.some((a) => a.action === "expect_cascade"),
    "plans expect_cascade instead"
  );

  // Prove explicit delete while branch exists would fail (invariant simulation)
  const direct = await admin
    .from("ea_branch_members")
    .delete()
    .eq("id", memberId)
    .select("id");
  assert(
    Boolean(direct.error?.message?.includes("ea_branch_owner_invariant")),
    "mock invariant still blocks naked member delete",
    direct.error?.message
  );
  assert(
    store.tables.ea_branch_members.has(memberId),
    "member still present after blocked delete"
  );

  const result = await cleanupSmokeTestFixture(admin as never, {
    fixtureId,
    dryRun: false,
    confirmFixtureId: fixtureId,
  });
  assert(result.ok === true, "cleanup succeeds via branch cascade");
  assert(!store.tables.ea_branch_members.has(memberId), "member removed by cascade");

  // B2: owned member whose parent branch is NOT fixture-owned → never expect_cascade
  const store2 = createStore();
  const admin2 = createMockAdmin(store2);
  const fixture2 = seedFixture(store2, "B2");
  const foreignBranch = randomUUID();
  const ownedMember = randomUUID();
  put(store2, "ea_branches", { id: foreignBranch });
  put(store2, "ea_branch_members", {
    id: ownedMember,
    branch_id: foreignBranch,
    role: "branch_admin",
  });
  // Register member as owned, but do NOT register the foreign branch as owned.
  register(store2, fixture2, "ea_branch_member", ownedMember);
  // Also register an unrelated owned branch so ownedBranchIds is non-empty
  const otherOwnedBranch = randomUUID();
  put(store2, "ea_branches", { id: otherOwnedBranch });
  register(store2, fixture2, "ea_branch", otherOwnedBranch);

  const plan2 = await planSmokeTestFixtureCleanup(admin2 as never, fixture2);
  const memberPlan = plan2.actions.find(
    (a) => a.object_type === "ea_branch_member" && a.object_id === ownedMember
  );
  assert(
    memberPlan?.action === "delete",
    "non-owned parent branch never yields expect_cascade"
  );
  assert(
    !plan2.actions.some(
      (a) =>
        a.action === "expect_cascade" && a.object_id === ownedMember
    ),
    "expect_cascade absent for member of non-owned branch"
  );

  // B3: missing member cannot invent a parent for expect_cascade
  const store3 = createStore();
  const admin3 = createMockAdmin(store3);
  const fixture3 = seedFixture(store3, "B3");
  const ghostMember = randomUUID();
  const ownedBranch = randomUUID();
  put(store3, "ea_branches", { id: ownedBranch });
  register(store3, fixture3, "ea_branch", ownedBranch);
  register(store3, fixture3, "ea_branch_member", ghostMember);
  // ghostMember row intentionally absent

  const plan3 = await planSmokeTestFixtureCleanup(admin3 as never, fixture3);
  const ghostPlan = plan3.actions.find(
    (a) => a.object_type === "ea_branch_member" && a.object_id === ghostMember
  );
  assert(
    ghostPlan?.action === "delete",
    "missing member plans idempotent delete, not expect_cascade"
  );
  assert(
    ghostPlan?.action !== "expect_cascade",
    "missing member never infers parent for cascade"
  );
}

async function testC_alreadyAbsentDb() {
  console.log("\nTest C — already-absent database object");
  const store = createStore();
  const admin = createMockAdmin(store);
  const fixtureId = seedFixture(store, "C");
  const chainId = "3001";
  register(store, fixtureId, "chain", chainId);
  // chain row intentionally missing

  const result = await cleanupSmokeTestFixture(admin as never, {
    fixtureId,
    dryRun: false,
    confirmFixtureId: fixtureId,
  });
  assert(result.ok === true, "cleanup succeeds");
  assert(
    result.ok &&
      result.results.some(
        (r) =>
          r.object_type === "chain" &&
          r.object_id === chainId &&
          r.outcome === "already_absent"
      ),
    "reports already_absent for missing chain"
  );
  assert(store.fixtures.get(fixtureId)?.status === "cleaned", "fixture cleaned");
}

async function testD_alreadyAbsentAuth() {
  console.log("\nTest D — already-absent Auth user");
  const store = createStore();
  const admin = createMockAdmin(store);
  const fixtureId = seedFixture(store, "D");
  const userId = randomUUID();
  register(store, fixtureId, "auth_user", userId);
  // auth user intentionally missing

  assert(
    isAuthUserNotFoundError({ message: "User not found", status: 404 }),
    "classifier accepts User not found + 404"
  );
  assert(
    isAuthUserNotFoundError({ code: "user_not_found", message: "anything" }),
    "classifier accepts user_not_found code"
  );
  assert(
    !isAuthUserNotFoundError({ message: "Database error deleting user", status: 500 }),
    "classifier rejects unrelated Auth errors"
  );
  assert(
    !isAuthUserNotFoundError({ status: 404, message: "Route not found" }),
    "classifier rejects bare 404 without user-not-found semantics"
  );
  assert(
    !isAuthUserNotFoundError({ code: "not_found", message: "resource missing" }),
    "classifier rejects generic not_found code without user context"
  );

  const result = await cleanupSmokeTestFixture(admin as never, {
    fixtureId,
    dryRun: false,
    confirmFixtureId: fixtureId,
  });
  assert(result.ok === true, "cleanup succeeds");
  assert(
    result.ok &&
      result.results.some(
        (r) =>
          r.object_type === "auth_user" &&
          r.outcome === "already_absent"
      ),
    "reports already_absent for missing Auth user"
  );
}

async function testE_genuineFailure() {
  console.log("\nTest E — genuine failure");
  const store = createStore();
  const admin = createMockAdmin(store);
  const fixtureId = seedFixture(store, "E");
  const chainId = "4001";
  put(store, "chains", { id: chainId });
  register(store, fixtureId, "chain", chainId);
  store.failDeletes.set(`chains:${chainId}`, "simulated_delete_failure");

  const result = await cleanupSmokeTestFixture(admin as never, {
    fixtureId,
    dryRun: false,
    confirmFixtureId: fixtureId,
  });

  assert(result.ok === false, "returns failure");
  assert(
    !result.ok && result.error === "cleanup_partial_failure",
    "error is cleanup_partial_failure"
  );
  assert(
    !result.ok &&
      Array.isArray(result.results) &&
      result.results.some(
        (r) => r.outcome === "failed" && r.error === "simulated_delete_failure"
      ),
    "structured failed result included"
  );
  assert(
    !result.ok &&
      Array.isArray(result.errors) &&
      result.errors.some((e) => e.includes("simulated_delete_failure")),
    "errors array retained"
  );
  assert(
    store.fixtures.get(fixtureId)?.status === "active",
    "fixture remains active"
  );
  assert(
    !store.audits.some((a) => a.event_type === "fixture_cleaned"),
    "fixture_cleaned not written"
  );
  assert(
    store.audits.some(
      (a) =>
        a.event_type === "cleanup_execution_result" &&
        Array.isArray((a.payload as Row).results)
    ),
    "execution result audit records failure"
  );
  assert(store.tables.chains.has(chainId), "failed object still present");
}

async function testF_linkedObject() {
  console.log("\nTest F — linked object");
  const store = createStore();
  const admin = createMockAdmin(store);
  const fixtureId = seedFixture(store, "F");
  const assignmentId = randomUUID();
  put(store, "property_ea_assignments", {
    id: assignmentId,
    status: "active",
  });
  register(store, fixtureId, "property_ea_assignment", assignmentId, "linked");

  const result = await cleanupSmokeTestFixture(admin as never, {
    fixtureId,
    dryRun: false,
    confirmFixtureId: fixtureId,
  });

  assert(result.ok === true, "cleanup succeeds");
  assert(
    store.tables.property_ea_assignments.has(assignmentId),
    "linked assignment row not hard-deleted"
  );
  assert(
    store.tables.property_ea_assignments.get(assignmentId)?.status === "revoked",
    "linked assignment revoked"
  );
  assert(
    result.ok &&
      result.results.some(
        (r) => r.action === "revoke_assignment" && r.outcome === "revoked"
      ),
    "reports revoked outcome"
  );
}

async function testG_nonFixtureIsolation() {
  console.log("\nTest G — non-fixture object isolation");
  const store = createStore();
  const admin = createMockAdmin(store);
  const fixtureId = seedFixture(store, "G");

  const ownedChain = "5001";
  const foreignChain = "690";
  put(store, "chains", { id: ownedChain });
  put(store, "chains", { id: foreignChain });
  register(store, fixtureId, "chain", ownedChain);

  const result = await cleanupSmokeTestFixture(admin as never, {
    fixtureId,
    dryRun: false,
    confirmFixtureId: fixtureId,
  });

  assert(result.ok === true, "cleanup succeeds");
  assert(!store.tables.chains.has(ownedChain), "owned chain deleted");
  assert(store.tables.chains.has(foreignChain), "unrelated chain 690 untouched");
  assert(
    !result.ok ||
      !result.results.some((r) => r.object_id === foreignChain),
    "plan never targeted foreign chain"
  );
}

async function testH_resumability() {
  console.log("\nTest H — resumability");
  const store = createStore();
  const admin = createMockAdmin(store);
  const fixtureId = seedFixture(store, "H");

  const companyId = randomUUID();
  const branchId = randomUUID();
  const memberId = randomUUID();
  const userId = randomUUID();

  put(store, "ea_companies", { id: companyId });
  put(store, "ea_branches", { id: branchId, company_id: companyId });
  put(store, "ea_branch_members", {
    id: memberId,
    branch_id: branchId,
    role: "branch_admin",
  });
  put(store, "profiles", { id: userId });
  store.authUsers.set(userId, { id: userId });

  register(store, fixtureId, "ea_company", companyId);
  register(store, fixtureId, "ea_branch", branchId);
  register(store, fixtureId, "ea_branch_member", memberId);
  register(store, fixtureId, "profile", userId);
  register(store, fixtureId, "auth_user", userId);

  // Simulate partial first run: branch deleted (member cascaded), company/profile/auth remain
  // Then "fail" company on first full run by pre-deleting branch+member only
  store.tables.ea_branches.delete(branchId);
  store.tables.ea_branch_members.delete(memberId);

  const first = await cleanupSmokeTestFixture(admin as never, {
    fixtureId,
    dryRun: false,
    confirmFixtureId: fixtureId,
  });
  assert(first.ok === true, "first resumable run completes");
  assert(store.fixtures.get(fixtureId)?.status === "cleaned", "cleaned after resume");

  // Second scenario: force failure mid-way, then resume
  const store2 = createStore();
  const admin2 = createMockAdmin(store2);
  const fixture2 = seedFixture(store2, "H2");
  const company2 = randomUUID();
  const branch2 = randomUUID();
  const member2 = randomUUID();
  const user2 = randomUUID();

  put(store2, "ea_companies", { id: company2 });
  put(store2, "ea_branches", { id: branch2 });
  put(store2, "ea_branch_members", {
    id: member2,
    branch_id: branch2,
    role: "branch_admin",
  });
  put(store2, "profiles", { id: user2 });
  store2.authUsers.set(user2, { id: user2 });
  register(store2, fixture2, "ea_company", company2);
  register(store2, fixture2, "ea_branch", branch2);
  register(store2, fixture2, "ea_branch_member", member2);
  register(store2, fixture2, "profile", user2);
  register(store2, fixture2, "auth_user", user2);

  store2.failDeletes.set(`ea_companies:${company2}`, "boom_company");
  const partial = await cleanupSmokeTestFixture(admin2 as never, {
    fixtureId: fixture2,
    dryRun: false,
    confirmFixtureId: fixture2,
  });
  assert(partial.ok === false, "partial run fails on company");
  assert(!store2.tables.ea_branches.has(branch2), "branch already removed in partial");
  assert(!store2.tables.ea_branch_members.has(member2), "member cascaded in partial");
  assert(store2.tables.ea_companies.has(company2), "company still present");
  assert(store2.fixtures.get(fixture2)?.status === "active", "still active after partial");

  store2.failDeletes.delete(`ea_companies:${company2}`);
  const resumed = await cleanupSmokeTestFixture(admin2 as never, {
    fixtureId: fixture2,
    dryRun: false,
    confirmFixtureId: fixture2,
  });
  assert(resumed.ok === true, "second run completes after fixing failure");
  assert(
    resumed.ok &&
      resumed.results.some(
        (r) => r.object_type === "ea_branch" && r.outcome === "already_absent"
      ),
    "second run treats absent branch as already_absent"
  );
  assert(
    resumed.ok &&
      resumed.results.some(
        (r) =>
          r.object_type === "ea_branch_member" &&
          (r.outcome === "already_absent" || r.outcome === "cascaded")
      ),
    "second run treats absent member as success"
  );
  assert(store2.fixtures.get(fixture2)?.status === "cleaned", "finalised on resume");
  assert(!store2.authUsers.has(user2), "auth removed on resume");
}

async function main() {
  console.log("Smoke-test cleanup behavioural verification (mock — no Production)\n");

  await testA_normalCleanup();
  await testB_branchMemberInvariant();
  await testC_alreadyAbsentDb();
  await testD_alreadyAbsentAuth();
  await testE_genuineFailure();
  await testF_linkedObject();
  await testG_nonFixtureIsolation();
  await testH_resumability();

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
  console.log("\nSmoke-test cleanup verification PASSED");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
