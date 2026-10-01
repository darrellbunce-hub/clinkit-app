/**
 * Development verifier for data retention + structured activity controls.
 *
 * Static by default. Use --execute against Development only after migration
 * 20260910210000_data_retention_and_activity_controls.sql is applied.
 *
 *   npm run verify:data-retention
 *   npm run verify:data-retention -- --execute
 *   npm run verify:data-retention -- --execute --use-linked-dev
 *
 * --use-linked-dev loads Dev URL + keys from `supabase projects api-keys`
 * for the Development project ref (does not modify .env.local).
 */
import { spawnSync } from "child_process";
import { readFileSync, writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { isAuthorizedLifecycleCronRequest } from "../lib/lifecycle/cronAuth";
import { COMPLETION_CONFIRMATION_ACTIVITY_UPDATE } from "../lib/confirmChainCompletion";
import {
  formatDelayReportedActivity,
  OPERATIONAL_DELAY_REASONS,
} from "../lib/operationalDelays";
import { formatCompletionAmendmentActivityUpdate } from "../lib/completionLifecycle";

const DEVELOPMENT_SUPABASE_PROJECT_REF = "bbbsxzxcjkmpqsfvmhbo";
const MIGRATION =
  "supabase/migrations/20260910210000_data_retention_and_activity_controls.sql";
const CRON_ROUTE = "app/api/cron/data-retention/route.ts";
const WORKER = "lib/retention/dataRetention.ts";
const FIXTURE_TEMPLATE = "retention-verify-dev";

type TestResult = { name: string; pass: boolean; detail?: string };
const results: TestResult[] = [];
const createdEmailIds: string[] = [];
const createdDispatchKeys: string[] = [];
const createdJobRunIds: string[] = [];
let stats = {
  emailsCreated: 0,
  emailsModified: 0,
  emailsDeleted: 0,
  dispatchesCreated: 0,
  dispatchesModified: 0,
  jobRunsCreated: 0,
};

function record(name: string, pass: boolean, detail?: string) {
  results.push({ name, pass, detail });
  console.log(pass ? `✓ ${name}` : `✗ ${name}${detail ? `: ${detail}` : ""}`);
}

function loadEnvLocal(): void {
  try {
    for (const line of readFileSync(join(process.cwd(), ".env.local"), "utf8").split(
      "\n"
    )) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const i = trimmed.indexOf("=");
      if (i <= 0) continue;
      const key = trimmed.slice(0, i).trim();
      let value = trimmed.slice(i + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  } catch {
    // optional
  }
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    const json = Buffer.from(parts[1], "base64url").toString("utf8");
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function assertServiceRoleKey(key: string): void {
  if (key.startsWith("sb_secret_")) return;
  const payload = decodeJwtPayload(key);
  if (!payload) {
    throw new Error(
      "Development service role key is not a usable JWT or sb_secret key"
    );
  }
  if (payload.role !== "service_role") {
    throw new Error(
      `Refusing to run: expected JWT role service_role, got ${String(payload.role)}`
    );
  }
  if (
    typeof payload.ref === "string" &&
    payload.ref !== DEVELOPMENT_SUPABASE_PROJECT_REF
  ) {
    throw new Error(
      `Refusing to run: service role JWT ref ${payload.ref} is not Development`
    );
  }
}

function loadLinkedDevCredentials(): void {
  const result = spawnSync(
    "npx",
    [
      "supabase",
      "projects",
      "api-keys",
      "--project-ref",
      DEVELOPMENT_SUPABASE_PROJECT_REF,
      "--reveal",
      "-o",
      "json",
    ],
    { encoding: "utf8", shell: true }
  );
  if (result.status !== 0) {
    throw new Error(
      `Failed to load Development API keys via CLI: ${result.stderr || result.stdout}`
    );
  }
  const raw = (result.stdout || "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("npm "))
    .join("\n")
    .trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Failed to parse Development API keys JSON from CLI");
  }
  const rows = Array.isArray(parsed) ? parsed : [];
  let anon: string | undefined;
  let serviceLegacy: string | undefined;
  let serviceSecret: string | undefined;
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const rec = row as Record<string, unknown>;
    const name = String(rec.name ?? rec.type ?? rec.id ?? "").toLowerCase();
    const apiKey = String(rec.api_key ?? rec.apiKey ?? rec.key ?? "");
    if (!apiKey) continue;
    if (
      name === "anon" ||
      name === "publishable" ||
      name.includes("anon") ||
      name.includes("publishable")
    ) {
      // Prefer legacy JWT anon for supabase-js compatibility when both exist.
      if (apiKey.startsWith("eyJ") || !anon) anon = apiKey;
    }
    if (name === "service_role" || name.includes("service_role")) {
      serviceLegacy = apiKey;
    }
    if (name === "secret" || name === "service_role_secret" || name === "sb_secret") {
      serviceSecret = apiKey;
    }
    if (apiKey.startsWith("sb_secret_")) {
      serviceSecret = apiKey;
    }
  }
  const service = serviceSecret ?? serviceLegacy;
  if (!anon || !service) {
    throw new Error(
      "Development API keys JSON missing anon/publishable or service_role/secret"
    );
  }
  assertServiceRoleKey(service);
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = anon;
  process.env.SUPABASE_SERVICE_ROLE_KEY = service;
  process.env.NEXT_PUBLIC_SUPABASE_URL = `https://${DEVELOPMENT_SUPABASE_PROJECT_REF}.supabase.co`;
  console.log(
    `Loaded linked Dev keys (anon=${anon.startsWith("eyJ") ? "legacy_jwt" : anon.startsWith("sb_") ? "sb_*" : "other"}, service=${service.startsWith("sb_secret_") ? "sb_secret" : service.startsWith("eyJ") ? "legacy_jwt" : "other"})`
  );
}

function assertLinkedDevelopment(): void {
  const ref = readFileSync(
    join(process.cwd(), "supabase", ".temp", "project-ref"),
    "utf8"
  ).trim();
  if (ref !== DEVELOPMENT_SUPABASE_PROJECT_REF) {
    throw new Error(
      `Refusing linked SQL: CLI project "${ref}" is not Development (${DEVELOPMENT_SUPABASE_PROJECT_REF}).`
    );
  }
}

function linkedSqlRows<T extends Record<string, unknown> = Record<string, unknown>>(
  sql: string
): T[] {
  assertLinkedDevelopment();
  const file = join(
    process.cwd(),
    `tmp-retention-verify-${Date.now()}-${randomUUID()}.sql`
  );
  writeFileSync(file, sql, "utf8");
  try {
    const result = spawnSync(
      "npx",
      ["supabase", "db", "query", "--linked", "-f", file],
      { encoding: "utf8", shell: true }
    );
    if (result.status !== 0) {
      throw new Error(
        `linked SQL failed: ${result.stderr || result.stdout || "unknown error"}`
      );
    }
    const text = (result.stdout || "").trim();
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end < start) {
      throw new Error("linked SQL returned no JSON payload");
    }
    const parsed = JSON.parse(text.slice(start, end + 1)) as {
      rows?: T[];
    };
    return parsed.rows ?? [];
  } finally {
    try {
      unlinkSync(file);
    } catch {
      // ignore
    }
  }
}

function sqlQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function assertDevelopment(url: string): void {
  const match = url.match(/^https:\/\/([a-z0-9]+)\.supabase\.co/i);
  const ref = match?.[1] ?? null;
  if (ref !== DEVELOPMENT_SUPABASE_PROJECT_REF) {
    throw new Error(
      `Refusing: project "${ref}" is not Development (${DEVELOPMENT_SUPABASE_PROJECT_REF}).`
    );
  }
}

function runStaticChecks(): void {
  const migration = readFileSync(join(process.cwd(), MIGRATION), "utf8");
  const cron = readFileSync(join(process.cwd(), CRON_ROUTE), "utf8");
  const worker = readFileSync(join(process.cwd(), WORKER), "utf8");
  const vercel = readFileSync(join(process.cwd(), "vercel.json"), "utf8");
  const lifecycleCron = readFileSync(
    join(process.cwd(), "app/api/cron/property-lifecycle/route.ts"),
    "utf8"
  );

  record(
    "Migration defines retention RPCs",
    migration.includes("retain_email_events_batch") &&
      migration.includes("retain_billing_email_dispatches_batch") &&
      migration.includes("retain_invitation_pii_batch") &&
      migration.includes("maintenance_job_runs")
  );
  record(
    "Migration enforces structured activities",
    migration.includes("is_allowed_structured_activity_update") &&
      migration.includes("trg_enforce_structured_activity_update")
  );
  record(
    "Migration revokes client EXECUTE on retention RPCs",
    migration.includes("revoke all on function public.retain_email_events_batch") &&
      migration.includes(
        "grant execute on function public.retain_email_events_batch(integer) to service_role"
      )
  );
  record(
    "GDPR billing dispatch redaction helper present",
    migration.includes("_gdpr_redact_billing_customer_email_dispatches") &&
      migration.includes("v_billing_rows")
  );
  record(
    "Preview dry-run RPCs present (no public endpoint)",
    migration.includes("preview_retain_email_events_batch") &&
      !cron.includes("preview_retain")
  );
  record(
    "Retention cron uses CRON_SECRET gate",
    cron.includes("isAuthorizedLifecycleCronRequest") &&
      cron.includes("createServiceRoleSupabaseClient") &&
      !cron.includes("p_record") &&
      !cron.includes("recordIds")
  );
  record(
    "Worker orchestrates separate batches",
    worker.includes("retainEmailEventsBatch") &&
      worker.includes("retainBillingEmailDispatchesBatch") &&
      worker.includes("retainInvitationPiiBatch") &&
      worker.includes("begin_maintenance_job_run")
  );
  record(
    "vercel.json schedules data-retention separately",
    vercel.includes("/api/cron/data-retention") &&
      vercel.includes("/api/cron/property-lifecycle")
  );
  record(
    "Lifecycle cron remains separate",
    lifecycleCron.includes("runPropertyLifecycleWorkerBatch") &&
      !lifecycleCron.includes("runDataRetentionBatch")
  );

  const prev = process.env.CRON_SECRET;
  process.env.CRON_SECRET = "retention-test-secret-value";
  record(
    "Missing Authorization rejected",
    isAuthorizedLifecycleCronRequest(null) === false
  );
  record(
    "Wrong secret rejected",
    isAuthorizedLifecycleCronRequest("Bearer wrong") === false
  );
  record(
    "Correct secret accepted",
    isAuthorizedLifecycleCronRequest("Bearer retention-test-secret-value") ===
      true
  );
  if (prev === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = prev;

  record(
    "Delay activity formatter matches allowlist prefix",
    formatDelayReportedActivity(OPERATIONAL_DELAY_REASONS[0]).startsWith(
      "Delay reported — "
    )
  );
  record(
    "Completion confirmation activity is fixed template",
    COMPLETION_CONFIRMATION_ACTIVITY_UPDATE.includes("Completion Confirmed")
  );
  record(
    "Completion amendment template starts correctly",
    formatCompletionAmendmentActivityUpdate(
      "2030-01-15",
      "2030-01-20",
      "administrative_correction"
    ).startsWith("Completion date updated")
  );
}

async function runDataRetentionBatchViaRpc(
  admin: SupabaseClient,
  limit = 500
): Promise<{
  ok: boolean;
  runId: string | null;
  status: string;
  scanned: number;
  redacted: number;
  deleted: number;
  serviceRoleRetainOk: boolean;
  serviceRoleBeginOk: boolean;
  beginError?: string;
}> {
  // Probe service_role EXECUTE via PostgREST (expected for production worker path).
  const beginProbe = await admin.rpc("begin_maintenance_job_run", {
    p_job_type: "data_retention",
    p_detail: { batch_limit: limit, source: "verify-script-probe" },
  });
  const serviceRoleBeginOk = beginProbe.error == null && !!beginProbe.data;
  // If PostgREST denies begin (observed on Dev after migration), fall back to linked SQL
  // for audit-row orchestration while still exercising retain_* via service_role.
  let runId: string | null = serviceRoleBeginOk
    ? ((beginProbe.data as string) ?? null)
    : null;
  if (!runId) {
    runId =
      linkedSqlRows<{ run_id: string }>(`
        select public.begin_maintenance_job_run(
          'data_retention',
          jsonb_build_object('batch_limit', ${limit}, 'source', 'verify-script-linked')
        )::text as run_id;
      `)[0]?.run_id ?? null;
  }
  if (!runId) {
    throw new Error(
      beginProbe.error?.message ?? "failed to begin maintenance job run"
    );
  }

  const email = await admin.rpc("retain_email_events_batch", { p_limit: limit });
  const billing = await admin.rpc("retain_billing_email_dispatches_batch", {
    p_limit: limit,
  });
  const invitations = await admin.rpc("retain_invitation_pii_batch", {
    p_limit: limit,
  });

  async function retainViaLinked(
    fn: string
  ): Promise<{ data: unknown; error: null }> {
    const row = linkedSqlRows<{ result: unknown }>(`
      select to_jsonb(public.${fn}(${limit})) as result;
    `)[0]?.result;
    return { data: row, error: null };
  }

  const emailFinal =
    email.error || (email.data as { ok?: boolean })?.ok !== true
      ? await retainViaLinked("retain_email_events_batch")
      : email;
  const billingFinal =
    billing.error || (billing.data as { ok?: boolean })?.ok !== true
      ? await retainViaLinked("retain_billing_email_dispatches_batch")
      : billing;
  const invitationsFinal =
    invitations.error || (invitations.data as { ok?: boolean })?.ok !== true
      ? await retainViaLinked("retain_invitation_pii_batch")
      : invitations;

  const batches = [emailFinal, billingFinal, invitationsFinal];
  const serviceRoleRetainOk =
    email.error == null &&
    (email.data as { ok?: boolean })?.ok === true &&
    billing.error == null &&
    (billing.data as { ok?: boolean })?.ok === true &&
    invitations.error == null &&
    (invitations.data as { ok?: boolean })?.ok === true;
  const errorCount = batches.filter(
    (b) => b.error || (b.data as { ok?: boolean })?.ok !== true
  ).length;
  const scanned = batches.reduce(
    (sum, b) => sum + Number((b.data as { scanned?: number })?.scanned ?? 0),
    0
  );
  const redacted = batches.reduce(
    (sum, b) => sum + Number((b.data as { redacted?: number })?.redacted ?? 0),
    0
  );
  const deleted = batches.reduce(
    (sum, b) => sum + Number((b.data as { deleted?: number })?.deleted ?? 0),
    0
  );
  const status =
    errorCount === 0 ? "succeeded" : errorCount === 3 ? "failed" : "partial";

  const completeProbe = await admin.rpc("complete_maintenance_job_run", {
    p_run_id: runId,
    p_status: status,
    p_records_scanned: scanned,
    p_records_redacted: redacted,
    p_records_deleted: deleted,
    p_error_count: errorCount,
    p_detail: { source: "verify-script" },
    p_error_summary: null,
  });
  if (completeProbe.error) {
    linkedSqlRows(`
      select public.complete_maintenance_job_run(
        ${sqlQuote(runId)}::uuid,
        ${sqlQuote(status)},
        ${scanned},
        ${redacted},
        ${deleted},
        ${errorCount},
        '{"source":"verify-script-linked"}'::jsonb,
        null
      );
      select 1 as ok;
    `);
  }

  return {
    ok: errorCount === 0,
    runId,
    status,
    scanned,
    redacted,
    deleted,
    serviceRoleRetainOk,
    serviceRoleBeginOk,
    beginError: beginProbe.error?.message,
  };
}

async function cleanupFixtures(_admin: SupabaseClient): Promise<void> {
  const emailIds =
    createdEmailIds.length > 0
      ? createdEmailIds.map(sqlQuote).join(", ")
      : null;
  const dispatchKeys =
    createdDispatchKeys.length > 0
      ? createdDispatchKeys.map(sqlQuote).join(", ")
      : null;
  const jobIds =
    createdJobRunIds.length > 0
      ? createdJobRunIds.map(sqlQuote).join(", ")
      : null;

  linkedSqlRows(`
    ${
      emailIds
        ? `delete from public.email_events where id in (${emailIds});`
        : ""
    }
    delete from public.email_events
    where template = ${sqlQuote(FIXTURE_TEMPLATE)}
       or template like ${sqlQuote(`${FIXTURE_TEMPLATE}%`)};

    ${
      dispatchKeys
        ? `delete from public.billing_customer_email_dispatches
           where dispatch_key in (${dispatchKeys});`
        : ""
    }
    delete from public.billing_customer_email_dispatches
    where dispatch_key like 'retention-verify-%';

    ${
      jobIds
        ? `delete from public.maintenance_job_runs where id in (${jobIds});`
        : ""
    }
    select 1 as cleaned;
  `);
}

async function runExecuteChecks(): Promise<void> {
  loadEnvLocal();
  if (process.argv.includes("--use-linked-dev")) {
    loadLinkedDevCredentials();
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !serviceKey || !anonKey) {
    throw new Error("Missing Supabase env for --execute");
  }
  assertDevelopment(url);
  assertServiceRoleKey(serviceKey);
  console.log(`Target Development project: ${DEVELOPMENT_SUPABASE_PROJECT_REF}`);
  console.log(
    `Service key kind: ${
      serviceKey.startsWith("sb_secret_")
        ? "sb_secret"
        : decodeJwtPayload(serviceKey)?.role === "service_role"
          ? "legacy_jwt_service_role"
          : "unknown"
    }`
  );

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const anon = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const { data: allowed, error: allowErr } = await admin.rpc(
      "is_allowed_structured_activity_update",
      { p_update: "Offer Accepted" }
    );
    record(
      "RPC allows Offer Accepted",
      allowErr == null && allowed === true,
      allowErr?.message
    );

    const { data: denied, error: denyErr } = await admin.rpc(
      "is_allowed_structured_activity_update",
      { p_update: "hello friend please read this" }
    );
    record(
      "RPC denies arbitrary free text",
      denyErr == null && denied === false,
      denyErr?.message
    );

    const { data: preview, error: previewErr } = await admin.rpc(
      "preview_retain_email_events_batch",
      { p_limit: 10 }
    );
    record(
      "preview_retain_email_events_batch dry-run",
      previewErr == null && (preview as { dry_run?: boolean })?.dry_run === true,
      previewErr?.message
    );

    const { error: anonRetainErr } = await anon.rpc("retain_email_events_batch", {
      p_limit: 1,
    });
    record(
      "anon cannot execute retain_email_events_batch",
      anonRetainErr != null,
      anonRetainErr?.message ?? "unexpected success"
    );

    const { data: authData, error: authErr } = await anon.auth.signUp({
      email: `retention-authz-${Date.now()}@example.test`,
      password: "RetentionAuthzDev123!",
    });
    if (!authErr && authData.session) {
      const userClient = createClient(url, anonKey, {
        global: {
          headers: {
            Authorization: `Bearer ${authData.session.access_token}`,
          },
        },
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { error: userRetainErr } = await userClient.rpc(
        "retain_email_events_batch",
        { p_limit: 1 }
      );
      record(
        "authenticated user cannot execute retain_email_events_batch",
        userRetainErr != null,
        userRetainErr?.message ?? "unexpected success"
      );
      if (authData.user?.id) {
        await admin.auth.admin.deleteUser(authData.user.id);
      }
    } else {
      record(
        "authenticated user cannot execute retain_email_events_batch",
        false,
        authErr?.message ?? "signup failed for negative authz test"
      );
    }

    // --- Email fixtures (linked SQL: email_events has no PostgREST INSERT policy) ---
    const stamp = Date.now();
    const recentEmail = `recent-${stamp}@example.test`;
    const agedEmail = `aged-${stamp}@example.test`;
    const gdprEmail = `gdpr-${stamp}@example.test`;
    const d89Email = `d89-${stamp}@example.test`;

    const seeded = linkedSqlRows<{
      recent_id: string;
      aged_id: string;
      gdpr_id: string;
      d89_id: string;
    }>(`
      with recent as (
        insert into public.email_events (
          template, recipient_email, provider, status, provider_message_id
        ) values (
          ${sqlQuote(FIXTURE_TEMPLATE)},
          ${sqlQuote(recentEmail)},
          'test',
          'sent',
          'msg-recent'
        )
        returning id
      ),
      aged as (
        insert into public.email_events (
          template, recipient_email, provider, status, provider_message_id, error_message, created_at
        ) values (
          ${sqlQuote(FIXTURE_TEMPLATE)},
          ${sqlQuote(agedEmail)},
          'test',
          'sent',
          'msg-aged',
          ${sqlQuote(`failure for ${agedEmail}`)},
          now() - interval '91 days'
        )
        returning id
      ),
      gdpr as (
        insert into public.email_events (
          template, recipient_email, provider, status, created_at
        ) values (
          ${sqlQuote(FIXTURE_TEMPLATE)},
          ${sqlQuote(gdprEmail)},
          'test',
          'sent',
          now() - interval '120 days'
        )
        returning id
      ),
      d89 as (
        insert into public.email_events (
          template, recipient_email, status, created_at
        ) values (
          ${sqlQuote(FIXTURE_TEMPLATE)},
          ${sqlQuote(d89Email)},
          'sent',
          now() - interval '89 days'
        )
        returning id
      ),
      gdpr_redacted as (
        update public.email_events ee
        set
          recipient_email = 'redacted+' || gdpr.id::text || '@erased.local',
          provider_message_id = null,
          error_message = '[redacted]',
          provider_events = '[]'::jsonb
        from gdpr
        where ee.id = gdpr.id
        returning ee.id
      )
      select
        (select id::text from recent) as recent_id,
        (select id::text from aged) as aged_id,
        (select id::text from gdpr) as gdpr_id,
        (select id::text from d89) as d89_id;
    `);

    const recentId = seeded[0]?.recent_id;
    const agedId = seeded[0]?.aged_id;
    const gdprId = seeded[0]?.gdpr_id;
    const d89Id = seeded[0]?.d89_id;
    if (!recentId || !agedId || !gdprId || !d89Id) {
      record("Insert email fixtures via linked SQL", false, "missing ids");
      return;
    }
    createdEmailIds.push(recentId, agedId, gdprId, d89Id);
    stats.emailsCreated += 4;
    stats.emailsModified += 2;
    record("Insert email fixtures via linked SQL", true);
    record("Simulate GDPR-redacted email fixture", true);

    const runResult = await runDataRetentionBatchViaRpc(admin, 500);
    if (runResult.runId) createdJobRunIds.push(runResult.runId);
    stats.jobRunsCreated += 1;
    record(
      "service_role can execute begin_maintenance_job_run via PostgREST",
      runResult.serviceRoleBeginOk,
      runResult.beginError
    );
    record(
      "service_role can execute retain_* batches via PostgREST",
      runResult.serviceRoleRetainOk
    );
    record(
      "runDataRetentionBatch succeeds",
      runResult.ok && runResult.status === "succeeded",
      `status=${runResult.status} scanned=${runResult.scanned}`
    );

    const jobRows = linkedSqlRows<{
      status: string;
      job_type: string;
      completed_at: string | null;
      records_redacted: number;
      records_deleted: number;
    }>(`
      select status, job_type, completed_at, records_redacted, records_deleted
      from public.maintenance_job_runs
      where id = ${sqlQuote(runResult.runId as string)}::uuid;
    `);
    const jobRow = jobRows[0];
    record(
      "maintenance_job_runs records success",
      !!jobRow &&
        jobRow.status === "succeeded" &&
        jobRow.job_type === "data_retention" &&
        jobRow.completed_at != null &&
        Number(jobRow.records_redacted) >= 1,
      jobRow
        ? `redacted=${jobRow.records_redacted} deleted=${jobRow.records_deleted}`
        : "missing row"
    );

    const emailState = linkedSqlRows<{
      id: string;
      recipient_email: string;
      provider_message_id: string | null;
      error_message: string | null;
    }>(`
      select id::text, recipient_email, provider_message_id, error_message
      from public.email_events
      where id in (
        ${sqlQuote(recentId)}::uuid,
        ${sqlQuote(agedId)}::uuid,
        ${sqlQuote(gdprId)}::uuid,
        ${sqlQuote(d89Id)}::uuid
      );
    `);
    const byId = new Map(emailState.map((r) => [r.id, r]));

    const recentAfter = byId.get(recentId);
    record(
      "Recent email remains untouched",
      recentAfter?.recipient_email === recentEmail &&
        recentAfter?.provider_message_id === "msg-recent"
    );

    const d89After = byId.get(d89Id);
    record(
      "89-day email remains identifiable",
      d89After?.recipient_email === d89Email
    );

    const agedAfter = byId.get(agedId);
    const agedRedacted =
      typeof agedAfter?.recipient_email === "string" &&
      agedAfter.recipient_email.startsWith("redacted+") &&
      agedAfter.recipient_email.endsWith("@erased.local") &&
      agedAfter.provider_message_id == null &&
      agedAfter.error_message === "[redacted]";
    record("≥90d email is redacted", agedRedacted);
    if (agedRedacted) stats.emailsModified += 1;

    const gdprAfter = byId.get(gdprId);
    record(
      "GDPR-redacted values remain redacted",
      gdprAfter?.recipient_email === `redacted+${gdprId}@erased.local`
    );

    const again = await runDataRetentionBatchViaRpc(admin, 500);
    if (again.runId) createdJobRunIds.push(again.runId);
    stats.jobRunsCreated += 1;
    const agedAgain = linkedSqlRows<{ recipient_email: string }>(`
      select recipient_email from public.email_events
      where id = ${sqlQuote(agedId)}::uuid;
    `)[0];
    record(
      "Duplicate/retry does not restore recipient_email",
      again.ok && agedAgain?.recipient_email === agedAfter?.recipient_email
    );

    linkedSqlRows(`
      update public.email_events
      set created_at = now() - interval '800 days'
      where id = ${sqlQuote(agedId)}::uuid;
      select 1 as ok;
    `);
    stats.emailsModified += 1;
    const deleteRun = await runDataRetentionBatchViaRpc(admin, 500);
    if (deleteRun.runId) createdJobRunIds.push(deleteRun.runId);
    stats.jobRunsCreated += 1;
    const deletedRow = linkedSqlRows<{ id: string }>(`
      select id::text from public.email_events
      where id = ${sqlQuote(agedId)}::uuid;
    `)[0];
    record("≥24mo already-redacted email deleted", deletedRow == null);
    if (deletedRow == null) {
      stats.emailsDeleted += 1;
      const idx = createdEmailIds.indexOf(agedId);
      if (idx >= 0) createdEmailIds.splice(idx, 1);
    }

    // Billing dispatch via linked SQL (FK + ownership)
    const branchRows = linkedSqlRows<{ id: string }>(`
      select id::text from public.ea_branches limit 1;
    `);
    const branchId = branchRows[0]?.id;

    if (branchId) {
      const dispatchKey = `retention-verify-${stamp}`;
      const billingEmail = `billing-${stamp}@example.test`;
      linkedSqlRows(`
        insert into public.billing_customer_email_dispatches (
          dispatch_key, template, branch_id, recipient_email, status, completed_at, created_at, claimed_at
        ) values (
          ${sqlQuote(dispatchKey)},
          'ea-subscription-confirmation',
          ${sqlQuote(branchId)}::uuid,
          ${sqlQuote(billingEmail)},
          'sent',
          now(),
          now() - interval '800 days',
          now() - interval '800 days'
        );
        select 1 as ok;
      `);
      createdDispatchKeys.push(dispatchKey);
      stats.dispatchesCreated += 1;
      stats.dispatchesModified += 1;
      record("Insert billing dispatch fixture", true);

      const billRun = await admin.rpc("retain_billing_email_dispatches_batch", {
        p_limit: 500,
      });
      let billRunOk =
        billRun.error == null && (billRun.data as { ok?: boolean })?.ok === true;
      if (!billRunOk) {
        const linkedBill = linkedSqlRows<{ result: { ok?: boolean } }>(`
          select to_jsonb(public.retain_billing_email_dispatches_batch(500)) as result;
        `)[0]?.result;
        billRunOk = linkedBill?.ok === true;
        record(
          "retain_billing_email_dispatches_batch via PostgREST",
          false,
          billRun.error?.message ?? "rpc returned not ok; used linked SQL fallback"
        );
      } else {
        record("retain_billing_email_dispatches_batch via PostgREST", true);
      }
      record(
        "retain_billing_email_dispatches_batch runs",
        billRunOk,
        billRun.error?.message
      );

      const billAfter = linkedSqlRows<{
        dispatch_key: string;
        recipient_email: string;
        template: string;
        status: string;
        branch_id: string;
      }>(`
        select dispatch_key, recipient_email, template, status, branch_id::text
        from public.billing_customer_email_dispatches
        where dispatch_key = ${sqlQuote(dispatchKey)};
      `)[0];

      const billRedacted =
        !!billAfter &&
        billAfter.dispatch_key === dispatchKey &&
        billAfter.template === "ea-subscription-confirmation" &&
        billAfter.status === "sent" &&
        billAfter.branch_id === branchId &&
        typeof billAfter.recipient_email === "string" &&
        billAfter.recipient_email.startsWith("redacted+") &&
        billAfter.recipient_email.endsWith("@erased.local");
      record(
        "Billing recipient redacted; ledger integrity preserved",
        billRedacted
      );
      if (billRedacted) stats.dispatchesModified += 1;

      const { data: gdprBillRows, error: gdprBillErr } = await admin.rpc(
        "_gdpr_redact_billing_customer_email_dispatches",
        { p_email: billingEmail }
      );
      let gdprOk = gdprBillErr == null && Number(gdprBillRows ?? 0) === 0;
      if (gdprBillErr) {
        const linkedGdpr = linkedSqlRows<{ n: number }>(`
          select public._gdpr_redact_billing_customer_email_dispatches(
            ${sqlQuote(billingEmail)}
          )::int as n;
        `)[0]?.n;
        gdprOk = Number(linkedGdpr ?? -1) === 0;
        record(
          "GDPR billing helper via PostgREST",
          false,
          gdprBillErr.message
        );
      } else {
        record("GDPR billing helper via PostgREST", true);
      }
      record(
        "GDPR billing helper idempotent on already-redacted",
        gdprOk,
        gdprBillErr?.message
      );
    } else {
      record(
        "Billing dispatch fixture",
        false,
        "No ea_branches row available on Development for FK"
      );
    }

    // Activity trigger via linked SQL (fires regardless of RLS)
    const propertyRows = linkedSqlRows<{ id: string }>(`
      select id::text from public.properties limit 1;
    `);
    const propertyId = propertyRows[0]?.id;
    if (propertyId) {
      let badRejected = false;
      let badDetail = "";
      try {
        linkedSqlRows(`
          insert into public.activities (property_id, update, updated_by)
          values (${propertyId}::bigint, 'arbitrary free text message', 'homeowner');
          select 1 as ok;
        `);
        badDetail = "unexpected success";
      } catch (err) {
        badRejected = true;
        badDetail = err instanceof Error ? err.message : String(err);
      }
      record(
        "Arbitrary activities.update rejected",
        badRejected,
        badRejected ? badDetail.slice(0, 160) : badDetail
      );

      try {
        const good = linkedSqlRows<{ id: string }>(`
          insert into public.activities (property_id, update, updated_by)
          values (${propertyId}::bigint, 'Offer Accepted', 'homeowner')
          returning id::text;
        `);
        record(
          "Valid structured activity allowed",
          !!good[0]?.id,
          good[0]?.id ? undefined : "missing id"
        );
        if (good[0]?.id) {
          linkedSqlRows(`
            delete from public.activities where id = ${good[0].id}::bigint;
            select 1 as ok;
          `);
        }
      } catch (err) {
        record(
          "Valid structured activity allowed",
          false,
          err instanceof Error ? err.message : String(err)
        );
      }
    } else {
      record(
        "Arbitrary activities.update rejected",
        false,
        "No properties row available for trigger test"
      );
      record(
        "Valid structured activity allowed",
        false,
        "No properties row available for trigger test"
      );
    }

    const recentFinal = linkedSqlRows<{ recipient_email: string }>(`
      select recipient_email from public.email_events
      where id = ${sqlQuote(recentId)}::uuid;
    `)[0];
    record(
      "Active/unrelated recent email still untouched after all runs",
      recentFinal?.recipient_email === recentEmail
    );
  } finally {
    await cleanupFixtures(admin);
    const leftoverEmails = linkedSqlRows<{ n: number }>(`
      select count(*)::int as n from public.email_events
      where template like ${sqlQuote(`${FIXTURE_TEMPLATE}%`)};
    `)[0]?.n;
    const leftoverDispatches = linkedSqlRows<{ n: number }>(`
      select count(*)::int as n from public.billing_customer_email_dispatches
      where dispatch_key like 'retention-verify-%';
    `)[0]?.n;
    record(
      "All email fixtures cleaned up",
      (leftoverEmails ?? 0) === 0,
      `leftover=${leftoverEmails ?? 0}`
    );
    record(
      "All billing fixtures cleaned up",
      (leftoverDispatches ?? 0) === 0,
      `leftover=${leftoverDispatches ?? 0}`
    );
    if (createdJobRunIds.length > 0) {
      linkedSqlRows(`
        delete from public.maintenance_job_runs
        where id in (${createdJobRunIds
          .map((id) => `${sqlQuote(id)}::uuid`)
          .join(", ")});
        select 1 as ok;
      `);
    }
    const leftoverJobs =
      createdJobRunIds.length === 0
        ? 0
        : linkedSqlRows<{ n: number }>(`
            select count(*)::int as n from public.maintenance_job_runs
            where id in (${createdJobRunIds
              .map((id) => `${sqlQuote(id)}::uuid`)
              .join(", ")});
          `)[0]?.n;
    record("Test maintenance_job_runs cleaned up", (leftoverJobs ?? 0) === 0);
  }
}

async function main() {
  console.log("Data retention + activity controls verifier\n");
  runStaticChecks();

  if (process.argv.includes("--execute")) {
    console.log("\n--execute Development checks\n");
    await runExecuteChecks();
    console.log("\nFixture stats (approx during run):");
    console.log(JSON.stringify(stats, null, 2));
  } else {
    console.log("\n(static only — pass --execute for Development DB checks)\n");
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
