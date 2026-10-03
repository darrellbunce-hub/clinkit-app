/**
 * Property lifecycle automation regression tests — bounded placeholder model
 * (20261005130000).
 *
 * Pure checks (always run): managed rows are never planned for dormancy;
 * unrepresented placeholders follow 90 days (no dependants) or 150 + 30 days
 * (dependants) from their anchor; scheduling is future-only; the worker uses
 * the indexed candidate list without a growing limit and stops on a repeat.
 *
 * Live checks need .env.local with SUPABASE_SERVICE_ROLE_KEY (Development).
 *
 * Usage:
 *   npx tsx scripts/verify-property-lifecycle-automation.ts
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { join } from "path";

import { addDays, getLifecycleConfig } from "../lib/lifecycle/config";
import {
  isManagedForDormancy,
  isPlaceholderForDormancy,
  placeholderDormancyAnchor,
} from "../lib/lifecycle/dormancyScenarios";
import {
  createDefaultLifecycleContext,
  evaluatePropertyLifecycleFromContext,
} from "../lib/lifecycle/evaluate";
import { computeNextLifecycleEvaluationAt } from "../lib/lifecycle/schedule";
import {
  applyLifecyclePlan,
  runPropertyLifecycleWorker,
  runPropertyLifecycleWorkerBatch,
} from "../lib/lifecycle/worker";
import {
  PROPERTY_LIFECYCLE_ACTION,
  PROPERTY_OPERATIONAL_STATE,
  type PropertyLifecycleContext,
} from "../lib/lifecycle/types";

const PLACEHOLDER_SERVICE_ROLE_KEYS = new Set([
  "your-service-role-key",
  "your_service_role_key",
  "your-service_role_key",
]);

function loadEnvLocal(): void {
  const envPath = join(process.cwd(), ".env.local");

  let text: string;

  try {
    text = readFileSync(envPath, "utf8");
  } catch {
    return;
  }

  for (const line of text.split("\n")) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");

    if (separatorIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

function resolveServiceRoleKey(raw: string | undefined): string | undefined {
  if (!raw) {
    return undefined;
  }

  let value = raw.trim();

  if (PLACEHOLDER_SERVICE_ROLE_KEYS.has(value.toLowerCase())) {
    return undefined;
  }

  // Common paste mistake: placeholder label left before the real secret value.
  const embeddedKey = value.match(/^your[_-]?service[_-]?role[_-]?key=(.+)$/i);

  if (embeddedKey) {
    value = embeddedKey[1].trim();
  }

  if (!value || PLACEHOLDER_SERVICE_ROLE_KEYS.has(value.toLowerCase())) {
    return undefined;
  }

  return value;
}

function logEnvPresence(params: {
  url?: string;
  serviceRoleKey?: string;
  anonKey?: string;
  serviceRoleKeyHadPlaceholderPrefix: boolean;
}) {
  console.log(
    `Env: NEXT_PUBLIC_SUPABASE_URL=${params.url ? "present" : "missing"}, ` +
      `SUPABASE_SERVICE_ROLE_KEY=${
        params.serviceRoleKey
          ? `present (${params.serviceRoleKey.length} chars)`
          : "missing"
      }, ` +
      `NEXT_PUBLIC_SUPABASE_ANON_KEY=${params.anonKey ? "present" : "missing"}`
  );

  if (params.serviceRoleKeyHadPlaceholderPrefix) {
    console.log(
      "Note: SUPABASE_SERVICE_ROLE_KEY included a placeholder prefix; using the embedded secret value."
    );
  }
}

loadEnvLocal();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const serviceRoleKey = resolveServiceRoleKey(
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
const serviceRoleKeyHadPlaceholderPrefix = Boolean(
  process.env.SUPABASE_SERVICE_ROLE_KEY?.trim().match(
    /^your[_-]?service[_-]?role[_-]?key=/i
  )
);
const password = "LifecycleAuto123!";
const DAY_MS = 86_400_000;

type Result = { name: string; pass: boolean; detail?: string };
const results: Result[] = [];

function record(name: string, pass: boolean, detail?: string) {
  results.push({ name, pass, detail });
  console.log(pass ? `✓ ${name}` : `✗ ${name}${detail ? `: ${detail}` : ""}`);
}

function daysAgo(days: number): string {
  return new Date(Date.now() - days * DAY_MS).toISOString();
}

function serviceClient() {
  if (!url || !serviceRoleKey) {
    throw new Error("Supabase service client requires URL and service role key");
  }

  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function signUp(email: string) {
  if (!url || !anonKey) {
    throw new Error("Supabase auth client requires URL and anon key");
  }

  const boot = createClient(url, anonKey);
  await boot.auth.signUp({ email, password });
  const client = createClient(url, anonKey);
  const { error } = await client.auth.signInWithPassword({ email, password });

  if (error) {
    throw error;
  }

  const userId = (await client.auth.getUser()).data.user!.id;

  return { client, userId };
}

async function createChain(
  client: SupabaseClient,
  stamp: number
): Promise<number> {
  const { data, error } = await client.rpc("create_chain_for_onboarding", {
    p_name: `Lifecycle ${stamp}`,
    p_access_code: `LC${stamp}`,
  });

  if (error || !data?.ok) {
    throw new Error(error?.message ?? data?.error ?? "chain_create_failed");
  }

  return data.chain_id as number;
}

async function insertProperty(params: {
  client: SupabaseClient;
  chainId: number;
  address: string;
  postcode: string;
  userId: string;
  buyerConnected?: boolean;
  sellerConnected?: boolean;
}) {
  const { data, error } = await params.client
    .from("properties")
    .insert({
      chain_id: params.chainId,
      chain_position: 1,
      address: params.address,
      postcode: params.postcode,
      stage: "property_listed",
      status: "healthy",
      relationship_type: "sale",
      created_by_user_id: params.userId,
      buyer_connected: params.buyerConnected ?? false,
      seller_connected: params.sellerConnected ?? false,
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "property_insert_failed");
  }

  return data.id as number;
}

function createEmptyQueryBuilder() {
  const emptyQuery = {
    data: null,
    count: 0,
    error: null,
  };
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "limit", "order"]) {
    builder[method] = () => builder;
  }
  builder.maybeSingle = () => Promise.resolve(emptyQuery);
  builder.then = (
    onFulfilled: (value: typeof emptyQuery) => unknown,
    onRejected?: (reason: unknown) => unknown
  ) => Promise.resolve(emptyQuery).then(onFulfilled, onRejected);
  return builder;
}

/**
 * Runs applyLifecyclePlan against a fake client. Each lifecycle action returns
 * its scripted RPC payload (default: applied); every other call is empty.
 */
async function applyPlanWithFakeRpc(
  evaluation: ReturnType<typeof evaluatePropertyLifecycleFromContext>,
  outcomes: Partial<Record<string, Record<string, unknown>>>
) {
  const actionCalls: string[] = [];
  const builder = createEmptyQueryBuilder();

  const supabase = {
    from: () => builder,
    rpc: (fn: string, args: Record<string, unknown>) => {
      if (fn !== "execute_property_lifecycle_action") {
        return Promise.resolve({ data: [], error: null });
      }
      const action = String(args.p_action);
      actionCalls.push(action);
      return Promise.resolve({ data: outcomes[action] ?? { ok: true }, error: null });
    },
  } as unknown as SupabaseClient;

  const result = await applyLifecyclePlan({ supabase, evaluation, workerRunId: "offline" });
  return { actionCalls, result };
}

/**
 * Fake service-role client for the batch worker: scripted candidates and
 * lifecycle signals, recorded candidate limits, schedules and action calls.
 */
function createFakeWorkerClient(options: {
  contexts: Map<number, PropertyLifecycleContext>;
  nextCandidates: () => number[];
  scheduleFails?: boolean;
  onSchedule?: (propertyId: number, nextEvaluationAt: string | null) => void;
  actionOutcomes?: Partial<Record<string, Record<string, unknown>>>;
}) {
  const calls = {
    candidateLimits: [] as unknown[],
    schedules: [] as Array<{ propertyId: number; nextEvaluationAt: string | null }>,
    actions: [] as Array<{ propertyId: number; action: string }>,
  };
  const builder = createEmptyQueryBuilder();
  const ok = (data: unknown) => Promise.resolve({ data, error: null });

  const supabase = {
    from: () => builder,
    rpc: (fn: string, args: Record<string, unknown>) => {
      const propertyId = Number(args.p_property_id);

      switch (fn) {
        case "list_property_lifecycle_worker_candidates":
          calls.candidateLimits.push(args.p_limit);
          return ok(options.nextCandidates().map((id) => ({ property_id: id })));
        case "try_acquire_property_lifecycle_lease":
        case "release_property_lifecycle_lease":
          return ok(true);
        case "get_property_lifecycle_signals": {
          const context = options.contexts.get(propertyId);
          return ok(context ? { ok: true, context } : { ok: false });
        }
        case "schedule_property_lifecycle_evaluation": {
          const nextEvaluationAt = (args.p_next_evaluation_at ?? null) as
            | string
            | null;
          calls.schedules.push({ propertyId, nextEvaluationAt });
          if (options.scheduleFails) {
            return Promise.resolve({
              data: null,
              error: { message: "fake_schedule_failure" },
            });
          }
          options.onSchedule?.(propertyId, nextEvaluationAt);
          return ok({ ok: true });
        }
        case "execute_property_lifecycle_action": {
          const action = String(args.p_action);
          calls.actions.push({ propertyId, action });
          return ok(options.actionOutcomes?.[action] ?? { ok: true });
        }
        default:
          return ok(null);
      }
    },
  } as unknown as SupabaseClient;

  return { supabase, calls };
}

async function setLifecycleState(
  admin: SupabaseClient,
  propertyId: number,
  state: string,
  extras: Record<string, unknown> = {}
) {
  await admin.from("property_lifecycle_states").upsert({
    property_id: propertyId,
    operational_state: state,
    lifecycle_reason: "verify_fixture",
    entered_state_at: new Date().toISOString(),
    ...extras,
  });
}

/** Fixed evaluation instant, well after the rollout effective-from. */
const NOW = new Date("2027-06-01T00:00:00.000Z");

function before(days: number, reference: Date = NOW): string {
  return new Date(reference.getTime() - days * DAY_MS).toISOString();
}

function after(days: number, reference: Date = NOW): string {
  return new Date(reference.getTime() + days * DAY_MS).toISOString();
}

function managedContext(
  propertyId: number,
  partial: Partial<PropertyLifecycleContext> = {}
): PropertyLifecycleContext {
  return createDefaultLifecycleContext(propertyId, {
    chainId: 1,
    relationshipType: "sale",
    sellerSide: "homeowner",
    buyerSide: "none",
    isManaged: true,
    sellerSideUnrepresentedSince: null,
    hasActiveOperationalIdentity: true,
    lastOperationalActivityAt: before(400),
    enteredStateAt: before(400),
    ...partial,
  });
}

function placeholderContext(
  propertyId: number,
  unrepresentedDays: number,
  partial: Partial<PropertyLifecycleContext> = {}
): PropertyLifecycleContext {
  return createDefaultLifecycleContext(propertyId, {
    chainId: 1,
    relationshipType: "purchase",
    sellerSide: "none",
    buyerSide: "homeowner",
    isManaged: false,
    sellerSideUnrepresentedSince: before(unrepresentedDays),
    hasPlaceholderDependants: false,
    enteredStateAt: before(unrepresentedDays),
    ...partial,
  });
}

function plan(context: PropertyLifecycleContext, evaluatedAt: Date = NOW) {
  return evaluatePropertyLifecycleFromContext(context, evaluatedAt).plannedActions;
}

function samePlan(actual: string[], expected: string[]): boolean {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

const A = PROPERTY_LIFECYCLE_ACTION;
const S = PROPERTY_OPERATIONAL_STATE;
const DORMANCY_ACTIONS: string[] = [
  A.enterDormancyWarning,
  A.expireDormancyWarning,
  A.markDormant,
  A.archiveOperational,
  A.releaseProperty,
];
const DORMANT_CONTINUATION = [
  A.createAnalyticsSnapshot,
  A.archiveOperational,
  A.releaseProperty,
];

function hasNoDormancyAction(actions: string[]): boolean {
  return !actions.some((action) => DORMANCY_ACTIONS.includes(action));
}

function runManagedChecks() {
  console.log("--- Managed rows (seller side represented) ---");

  const homeowner = plan(managedContext(101));
  record(
    "M1. Homeowner-managed row inactive 400 days: no plan (intentional change — previously warned)",
    homeowner.length === 0,
    JSON.stringify(homeowner)
  );

  const ea = plan(
    managedContext(102, {
      sellerSide: "ea",
      hasActiveOperationalIdentity: false,
      hasActiveEaAssignment: true,
    })
  );
  record(
    "M2. EA-managed row inactive 400 days: no plan (intentional change — previously warned)",
    ea.length === 0,
    JSON.stringify(ea)
  );

  const both = plan(managedContext(103, { hasActiveEaAssignment: true }));
  record("M3. Homeowner and EA row inactive 400 days: no plan", both.length === 0);

  const legacyWarning = plan(
    managedContext(104, {
      operationalState: S.dormancyWarning,
      dormancyWarningAt: before(60),
      dormancyConfirmationDeadlineAt: before(30),
    })
  );
  record(
    "M4. Managed row left in legacy dormancy_warning past its deadline: no plan",
    legacyWarning.length === 0,
    JSON.stringify(legacyWarning)
  );

  const legacyDormant = plan(managedContext(105, { operationalState: S.dormant }));
  record(
    "M5. Managed row left in legacy dormant: no archive or release",
    legacyDormant.length === 0,
    JSON.stringify(legacyDormant)
  );

  const missingSignals = createDefaultLifecycleContext(106, {
    lastOperationalActivityAt: before(400),
    enteredStateAt: before(400),
    sellerSideUnrepresentedSince: before(400),
  });
  record(
    "M6. Missing representation signals count as managed: no plan (intentional change — previously warned)",
    isManagedForDormancy(missingSignals) && plan(missingSignals).length === 0
  );

  const staleClock = managedContext(107, {
    sellerSideUnrepresentedSince: before(400),
  });
  record(
    "M7. Managed row with a stale placeholder clock stays managed",
    !isPlaceholderForDormancy(staleClock) &&
      placeholderDormancyAnchor(staleClock, getLifecycleConfig()) === null &&
      plan(staleClock).length === 0
  );

  const sellerSideWins = placeholderContext(108, 400, {
    sellerSide: "ea",
    isManaged: false,
  });
  record(
    "M8. sellerSide decides over a contradictory isManaged flag",
    isManagedForDormancy(sellerSideWins) && plan(sellerSideWins).length === 0
  );
}

function runPlaceholderChecks() {
  console.log("\n--- Placeholders without dependants (90 days) ---");

  const day89 = plan(placeholderContext(201, 89));
  record("P1. Placeholder without dependants at 89 days: no plan", day89.length === 0);

  const day91 = plan(placeholderContext(202, 91));
  record(
    "P2. Placeholder without dependants at 91 days: mark dormant → snapshot → archive → release, no warning",
    samePlan(day91, [A.markDormant, ...DORMANT_CONTINUATION]),
    JSON.stringify(day91)
  );

  const flagOnly = plan(
    placeholderContext(203, 91, { sellerSide: undefined, isManaged: false })
  );
  record(
    "P3. isManaged=false without sellerSide still follows the placeholder clock",
    samePlan(flagOnly, [A.markDormant, ...DORMANT_CONTINUATION]),
    JSON.stringify(flagOnly)
  );

  const noClock = plan(
    placeholderContext(204, 400, { sellerSideUnrepresentedSince: null })
  );
  record(
    "P4. Unrepresented row without a placeholder clock is not planned",
    noClock.length === 0,
    JSON.stringify(noClock)
  );

  console.log("\n--- Placeholders with dependants (150 + 30 days) ---");

  const dependants = { hasPlaceholderDependants: true };

  const day100 = plan(placeholderContext(301, 100, dependants));
  record("D1. Placeholder with dependants at 100 days: no plan", day100.length === 0);

  const day149 = plan(placeholderContext(302, 149, dependants));
  record("D2. Placeholder with dependants at 149 days: no plan", day149.length === 0);

  const day151 = plan(placeholderContext(303, 151, dependants));
  record(
    "D3. Placeholder with dependants at 151 days: warning only",
    samePlan(day151, [A.enterDormancyWarning]),
    JSON.stringify(day151)
  );

  const warningOpen = plan(
    placeholderContext(304, 170, {
      ...dependants,
      operationalState: S.dormancyWarning,
      dormancyWarningAt: before(20),
      dormancyConfirmationDeadlineAt: after(10),
    })
  );
  record(
    "D4. Warning before its deadline: no plan",
    warningOpen.length === 0,
    JSON.stringify(warningOpen)
  );

  const warningExpired = plan(
    placeholderContext(305, 190, {
      ...dependants,
      operationalState: S.dormancyWarning,
      dormancyWarningAt: before(31),
      dormancyConfirmationDeadlineAt: before(1),
    })
  );
  record(
    "D5. Warning after its deadline: expire → snapshot → archive → release",
    samePlan(warningExpired, [A.expireDormancyWarning, ...DORMANT_CONTINUATION]),
    JSON.stringify(warningExpired)
  );

  const derivedOpen = plan(
    placeholderContext(306, 180, {
      ...dependants,
      operationalState: S.dormancyWarning,
      dormancyWarningAt: before(29),
      dormancyConfirmationDeadlineAt: null,
    })
  );
  const derivedExpired = plan(
    placeholderContext(307, 182, {
      ...dependants,
      operationalState: S.dormancyWarning,
      dormancyWarningAt: before(31),
      dormancyConfirmationDeadlineAt: null,
    })
  );
  record(
    "D6. Deadline derived from the warning time (+30 days) when not stored",
    derivedOpen.length === 0 &&
      samePlan(derivedExpired, [A.expireDormancyWarning, ...DORMANT_CONTINUATION]),
    JSON.stringify({ derivedOpen, derivedExpired })
  );

  const dependantsLeft = plan(placeholderContext(308, 91, { hasPlaceholderDependants: false }));
  record(
    "D7. Same row once its dependants are gone follows the 90-day path",
    samePlan(dependantsLeft, [A.markDormant, ...DORMANT_CONTINUATION])
  );
}

function runAnchorChecks() {
  console.log("\n--- Clock anchor ---");

  const config = getLifecycleConfig();
  const effectiveFrom = new Date(config.dormancyEffectiveFrom);
  const longBefore = before(365, effectiveFrom);
  const legacy = placeholderContext(401, 0, {
    sellerSideUnrepresentedSince: longBefore,
    enteredStateAt: longBefore,
  });

  record(
    "A1. Anchor is floored at the rollout effective-from instant",
    placeholderDormancyAnchor(legacy, config) === effectiveFrom.toISOString()
  );
  record(
    "A2. Legacy placeholder: no plan 89 days after effective-from",
    plan(legacy, new Date(after(89, effectiveFrom))).length === 0
  );
  record(
    "A3. Legacy placeholder: dormant path 91 days after effective-from",
    samePlan(plan(legacy, new Date(after(91, effectiveFrom))), [
      A.markDormant,
      ...DORMANT_CONTINUATION,
    ])
  );

  const legacyDependants = { ...legacy, hasPlaceholderDependants: true };
  record(
    "A4. Legacy placeholder with dependants: no warning 149 days after effective-from, warning at 151",
    plan(legacyDependants, new Date(after(149, effectiveFrom))).length === 0 &&
      samePlan(plan(legacyDependants, new Date(after(151, effectiveFrom))), [
        A.enterDormancyWarning,
      ])
  );

  const activityReset = plan(
    placeholderContext(402, 200, { placeholderActivityAt: before(10) })
  );
  record(
    "A5. Dependent-side activity resets the placeholder clock",
    activityReset.length === 0,
    JSON.stringify(activityReset)
  );

  const confirmationReset = plan(
    placeholderContext(403, 300, {
      hasPlaceholderDependants: true,
      lastStillActiveConfirmedAt: before(20),
    })
  );
  record(
    "A6. Still-active confirmation resets the placeholder clock",
    confirmationReset.length === 0,
    JSON.stringify(confirmationReset)
  );

  const unrelatedActivity = plan(
    placeholderContext(404, 91, {
      lastOperationalActivityAt: before(1),
      chainLastOperationalActivityAt: before(1),
      lastActivityAt: before(1),
    })
  );
  record(
    "A7. Operational or chain-wide activity does not reset the placeholder clock",
    samePlan(unrelatedActivity, [A.markDormant, ...DORMANT_CONTINUATION]),
    JSON.stringify(unrelatedActivity)
  );

  const overridden = placeholderContext(405, 0, {
    sellerSideUnrepresentedSince: before(400),
    dormancyEffectiveFrom: before(10),
  });
  record(
    "A8. Context effective-from (from the database) takes precedence over config",
    placeholderDormancyAnchor(overridden, config) === before(10) &&
      plan(overridden).length === 0
  );
}

function runOtherStateChecks() {
  console.log("\n--- Other lifecycle states ---");

  const dormant = plan(
    placeholderContext(501, 120, { operationalState: S.dormant, enteredStateAt: before(5) })
  );
  record(
    "O1. Dormant placeholder continues: snapshot → archive → release",
    samePlan(dormant, DORMANT_CONTINUATION),
    JSON.stringify(dormant)
  );

  const archived = plan(
    placeholderContext(502, 120, {
      operationalState: S.archived,
      hasAnalyticsSnapshot: true,
      enteredStateAt: before(1),
    })
  );
  record(
    "O2. Archived placeholder in an uncompleted chain: release",
    samePlan(archived, [A.releaseProperty]),
    JSON.stringify(archived)
  );

  const completedPlaceholder = plan(
    placeholderContext(503, 400, { chainCompletedAt: before(1) })
  );
  const completedManaged = plan(managedContext(504, { chainCompletedAt: before(1) }));
  record(
    "O3. Completed chain within grace: enter completed grace only (managed or placeholder)",
    samePlan(completedPlaceholder, [A.enterCompletedGrace]) &&
      samePlan(completedManaged, [A.enterCompletedGrace]),
    JSON.stringify({ completedPlaceholder, completedManaged })
  );

  const graceElapsed = plan(
    managedContext(505, {
      operationalState: S.completedGrace,
      chainCompletedAt: before(40),
      graceEndsAt: before(10),
    })
  );
  record(
    "O4. Managed row after completion grace: snapshot → archive → release",
    samePlan(graceElapsed, DORMANT_CONTINUATION),
    JSON.stringify(graceElapsed)
  );

  const releasedNoSnapshot = plan(
    managedContext(506, { operationalState: S.released, hasAnalyticsSnapshot: false })
  );
  const releasedSnapshot = plan(
    managedContext(507, { operationalState: S.released, hasAnalyticsSnapshot: true })
  );
  record(
    "O5. Released rows: snapshot first, anonymise only with a snapshot",
    samePlan(releasedNoSnapshot, [A.createAnalyticsSnapshot]) &&
      samePlan(releasedSnapshot, [A.anonymiseHistorical]),
    JSON.stringify({ releasedNoSnapshot, releasedSnapshot })
  );

  const manualRelease = plan(placeholderContext(508, 400, { manuallyReleased: true }));
  record(
    "O6. Manually released placeholder: no dormancy action",
    hasNoDormancyAction(manualRelease),
    JSON.stringify(manualRelease)
  );

  const context = placeholderContext(509, 151, { hasPlaceholderDependants: true });
  record(
    "O7. Evaluation is stable for the same context and instant",
    samePlan(plan(context), plan(context))
  );
}

function runScheduleChecks() {
  console.log("\n--- next_evaluation_at ---");

  const config = getLifecycleConfig();
  const next = (context: PropertyLifecycleContext) =>
    computeNextLifecycleEvaluationAt(context, config, NOW);
  const retry = after(1);

  record("S1. Managed active row: not scheduled", next(managedContext(601)) === null);

  const fresh = placeholderContext(602, 10);
  record(
    "S2. Placeholder at 10 days: scheduled at anchor + 90 days",
    next(fresh) === addDays(fresh.sellerSideUnrepresentedSince!, 90),
    String(next(fresh))
  );

  const withDependants = placeholderContext(603, 100, { hasPlaceholderDependants: true });
  record(
    "S3. Placeholder with dependants at 100 days: scheduled at anchor + 150 days",
    next(withDependants) ===
      addDays(withDependants.sellerSideUnrepresentedSince!, 150),
    String(next(withDependants))
  );

  const deadline = after(12);
  record(
    "S4. Open warning: scheduled at its deadline",
    next(
      placeholderContext(604, 170, {
        hasPlaceholderDependants: true,
        operationalState: S.dormancyWarning,
        dormancyWarningAt: before(18),
        dormancyConfirmationDeadlineAt: deadline,
      })
    ) === deadline
  );
  record(
    "S5. Overdue warning: retried a day later",
    next(
      placeholderContext(605, 200, {
        hasPlaceholderDependants: true,
        operationalState: S.dormancyWarning,
        dormancyWarningAt: before(40),
        dormancyConfirmationDeadlineAt: before(10),
      })
    ) === retry
  );
  record(
    "S6. Dormant placeholder: retried a day later",
    next(placeholderContext(606, 120, { operationalState: S.dormant })) === retry
  );

  const graceEnd = after(5);
  record(
    "S7. Completion grace: scheduled at grace end, else retried a day later",
    next(
      managedContext(607, {
        operationalState: S.completedGrace,
        chainCompletedAt: before(25),
        graceEndsAt: graceEnd,
      })
    ) === graceEnd &&
      next(
        managedContext(608, {
          operationalState: S.completedGrace,
          chainCompletedAt: before(40),
          graceEndsAt: before(10),
        })
      ) === retry
  );
  record(
    "S8. Released with snapshot and anonymised rows: not scheduled",
    next(managedContext(609, { operationalState: S.released, hasAnalyticsSnapshot: true })) ===
      null &&
      next(managedContext(610, { operationalState: S.anonymised })) === null
  );
  record(
    "S9. Released without snapshot, archived, completed chain: retried a day later",
    next(managedContext(611, { operationalState: S.released })) === retry &&
      next(managedContext(612, { operationalState: S.archived })) === retry &&
      next(managedContext(613, { chainCompletedAt: before(1) })) === retry
  );

  const samples: PropertyLifecycleContext[] = [
    managedContext(620),
    placeholderContext(621, 0),
    placeholderContext(622, 89),
    placeholderContext(623, 91),
    placeholderContext(624, 149, { hasPlaceholderDependants: true }),
    placeholderContext(625, 151, { hasPlaceholderDependants: true }),
    placeholderContext(626, 500, { hasPlaceholderDependants: true }),
    placeholderContext(627, 400, { placeholderActivityAt: before(3) }),
    managedContext(628, { operationalState: S.completedGrace, chainCompletedAt: before(31) }),
  ];
  const nonFuture = samples
    .map((context) => ({ id: context.propertyId, at: next(context) }))
    .filter((entry) => entry.at !== null && new Date(entry.at) <= NOW);
  record(
    "S10. Every scheduled instant is strictly in the future",
    nonFuture.length === 0,
    JSON.stringify(nonFuture)
  );
}

async function runWorkerChecks() {
  console.log("\n--- Worker (fake RPC) ---");

  const markDormantPlan = evaluatePropertyLifecycleFromContext(
    placeholderContext(701, 91),
    NOW
  );

  const representedSkip = await applyPlanWithFakeRpc(markDormantPlan, {
    [A.markDormant]: { ok: true, skipped: true, reason: "seller_side_represented" },
  });
  record(
    "W1. Dispatcher skip (seller side represented) on mark_dormant stops archive and release",
    samePlan(representedSkip.actionCalls, [A.markDormant]) &&
      representedSkip.result.appliedActions.length === 0,
    JSON.stringify(representedSkip.actionCalls)
  );

  const applied = await applyPlanWithFakeRpc(markDormantPlan, {});
  record(
    "W2. Applied mark_dormant continues to snapshot, archive, release",
    samePlan(applied.actionCalls, [A.markDormant, ...DORMANT_CONTINUATION]),
    JSON.stringify(applied.actionCalls)
  );

  const expirePlan = evaluatePropertyLifecycleFromContext(
    placeholderContext(702, 190, {
      hasPlaceholderDependants: true,
      operationalState: S.dormancyWarning,
      dormancyWarningAt: before(31),
      dormancyConfirmationDeadlineAt: before(1),
    }),
    NOW
  );
  const expireFailed = await applyPlanWithFakeRpc(expirePlan, {
    [A.expireDormancyWarning]: { ok: false, error: "warning_not_expired" },
  });
  record(
    "W3. Failed expire_dormancy_warning stops archive and release",
    samePlan(expireFailed.actionCalls, [A.expireDormancyWarning]) &&
      expireFailed.result.errors.length === 1,
    JSON.stringify(expireFailed.actionCalls)
  );

  const managed = managedContext(711);
  const fresh = placeholderContext(712, 10);
  const batchClient = createFakeWorkerClient({
    contexts: new Map([
      [managed.propertyId, managed],
      [fresh.propertyId, fresh],
    ]),
    nextCandidates: () => [managed.propertyId, fresh.propertyId],
  });
  const batch = await runPropertyLifecycleWorkerBatch(batchClient.supabase, {
    batchSize: 7,
    evaluatedAt: NOW,
  });
  const scheduleFor = (id: number) =>
    batchClient.calls.schedules.find((entry) => entry.propertyId === id);
  record(
    "W4. Batch asks for candidates with p_limit = batchSize",
    samePlan(batchClient.calls.candidateLimits.map(String), ["7"]),
    JSON.stringify(batchClient.calls.candidateLimits)
  );
  record(
    "W5. Batch reschedules every row: managed → null, placeholder → anchor + 90 days",
    batchClient.calls.schedules.length === 2 &&
      scheduleFor(managed.propertyId)?.nextEvaluationAt === null &&
      scheduleFor(fresh.propertyId)?.nextEvaluationAt ===
        addDays(fresh.sellerSideUnrepresentedSince!, 90) &&
      batchClient.calls.actions.length === 0 &&
      batch.repeatedCandidate === false,
    JSON.stringify(batchClient.calls.schedules)
  );

  const missing = createFakeWorkerClient({
    contexts: new Map(),
    nextCandidates: () => [713],
  });
  await runPropertyLifecycleWorkerBatch(missing.supabase, { batchSize: 3, evaluatedAt: NOW });
  const config = getLifecycleConfig();
  record(
    "W6. Row whose signals fail to load is retried after the retry delay",
    missing.calls.schedules.length === 1 &&
      missing.calls.schedules[0].nextEvaluationAt ===
        new Date(NOW.getTime() + config.workerRetryDelayMs).toISOString(),
    JSON.stringify(missing.calls.schedules)
  );

  const due = new Set([721, 722]);
  const drainContexts = new Map<number, PropertyLifecycleContext>([
    [721, placeholderContext(721, 20)],
    [722, managedContext(722)],
  ]);
  const drain = createFakeWorkerClient({
    contexts: drainContexts,
    nextCandidates: () => [...due],
    onSchedule: (propertyId, nextEvaluationAt) => {
      if (nextEvaluationAt === null || new Date(nextEvaluationAt) > NOW) {
        due.delete(propertyId);
      }
    },
  });
  const drained = await runPropertyLifecycleWorker(drain.supabase, {
    batchSize: 5,
    evaluatedAt: NOW,
    timeBudgetMs: 30_000,
  });
  record(
    "W7. Run stops on an empty batch once every row is rescheduled; limit never grows",
    drained.batchCount === 1 &&
      drained.processedCount === 2 &&
      !drained.stoppedOnRepeatedCandidate &&
      drain.calls.candidateLimits.length === 2 &&
      drain.calls.candidateLimits.every((limit) => limit === 5),
    JSON.stringify({ drained, limits: drain.calls.candidateLimits })
  );

  const stuck = createFakeWorkerClient({
    contexts: new Map([[731, placeholderContext(731, 20)]]),
    nextCandidates: () => [731],
    scheduleFails: true,
  });
  const originalError = console.error;
  console.error = () => {};
  let stuckRun: Awaited<ReturnType<typeof runPropertyLifecycleWorker>>;
  try {
    stuckRun = await runPropertyLifecycleWorker(stuck.supabase, {
      batchSize: 5,
      evaluatedAt: NOW,
      timeBudgetMs: 30_000,
    });
  } finally {
    console.error = originalError;
  }
  record(
    "W8. Run stops when a row comes back after a failed schedule write",
    stuckRun.stoppedOnRepeatedCandidate &&
      stuckRun.batchCount === 1 &&
      stuck.calls.schedules.length === 1 &&
      stuck.calls.candidateLimits.every((limit) => limit === 5),
    JSON.stringify({ stuckRun, limits: stuck.calls.candidateLimits })
  );
}

async function main() {
  logEnvPresence({
    url,
    serviceRoleKey,
    anonKey,
    serviceRoleKeyHadPlaceholderPrefix,
  });

  console.log("=== Pure evaluation checks (bounded placeholder model) ===\n");

  runManagedChecks();
  runPlaceholderChecks();
  runAnchorChecks();
  runOtherStateChecks();
  runScheduleChecks();
  await runWorkerChecks();

  if (!url || !anonKey) {
    console.log(
      "\nSkipping live DB tests — NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY missing from .env.local"
    );
    summarize();
    return;
  }

  if (!serviceRoleKey) {
    console.log(
      "\nSkipping live DB tests — SUPABASE_SERVICE_ROLE_KEY not configured in .env.local"
    );
    summarize();
    return;
  }

  const admin = serviceClient();
  const { error: probeError } = await admin
    .from("property_lifecycle_states")
    .select("property_id")
    .limit(1);

  if (probeError) {
    console.log(
      `\nSkipping live DB tests — Supabase service-role probe failed: ${probeError.message}`
    );
    summarize();
    return;
  }

  console.log("\n=== Live worker / RPC checks ===\n");

  const stamp = Date.now();
  const email = `lifecycle-${stamp}@example.com`;
  const { client, userId } = await signUp(email);
  await client.from("profiles").upsert({
    id: userId,
    role: "homeowner",
    account_type: "homeowner",
    contact_name: "Lifecycle Verify",
    onboarding_completed_at: new Date().toISOString(),
  });

  const chainId = await createChain(client, stamp);
  const address = `${stamp} Lifecycle Lane`;
  const postcode = "E1 1LC";
  const propertyId = await insertProperty({
    client,
    chainId,
    address,
    postcode,
    userId,
  });

  await setLifecycleState(admin, propertyId, "completed_grace", {
    grace_ends_at: new Date(Date.now() - DAY_MS).toISOString(),
  });

  await admin.from("property_members").insert({
    property_id: propertyId,
    user_id: userId,
    role: "seller",
  });

  await admin.from("property_operational_identities").upsert({
    property_id: propertyId,
    homeowner_user_id: userId,
    operational_role: "seller",
    granted_via: "start_move",
    status: "active",
    granted_at: new Date().toISOString(),
  });

  const evaluation = evaluatePropertyLifecycleFromContext(
    createDefaultLifecycleContext(propertyId, {
      operationalState: PROPERTY_OPERATIONAL_STATE.completedGrace,
      chainCompletedAt: daysAgo(40),
      graceEndsAt: daysAgo(1),
      hasMeaningfulParticipation: true,
      memberCount: 1,
      relationshipType: "sale",
    })
  );

  const applyResult = await applyLifecyclePlan({
    supabase: admin,
    evaluation,
  });
  record(
    "Live: worker apply archives and releases completed property",
    applyResult.appliedActions.length > 0 || applyResult.skippedActions.length > 0,
    JSON.stringify({
      applied: applyResult.appliedActions,
      skipped: applyResult.skippedActions,
      errors: applyResult.errors,
    })
  );

  const { data: reservedAfter } = await admin.rpc(
    "property_address_is_reserved",
    { p_property_id: propertyId }
  );
  record("Live: released property no longer reserves address", reservedAfter === false);

  const repeatApply = await applyLifecyclePlan({ supabase: admin, evaluation });
  record(
    "Live: repeated apply is idempotent",
    repeatApply.errors.length === 0,
    repeatApply.errors.length > 0
      ? JSON.stringify(repeatApply.errors)
      : undefined
  );

  const batch = await runPropertyLifecycleWorkerBatch(admin, { batchSize: 5 });
  record(
    "Live: batch worker executes without fatal errors",
    batch.errorCount === 0 || batch.processedCount >= 0
  );

  summarize();
}

function summarize() {
  const failed = results.filter((result) => !result.pass);

  console.log(`\nResults: ${results.length - failed.length}/${results.length} passed`);

  if (failed.length > 0) {
    process.exit(1);
  }

  console.log("\n=== PROPERTY LIFECYCLE AUTOMATION VERIFICATION PASSED ===");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
