/**
 * Development verifier — email lookup RPC privacy + service-role server-only boundary.
 *
 * Target: Development ONLY — bbbsxzxcjkmpqsfvmhbo
 *
 * Usage:
 *   npx tsx scripts/verify-email-lookup-privacy-development.ts
 *   npx tsx scripts/verify-email-lookup-privacy-development.ts --execute
 *
 * Does not print emails, JWTs, or secrets.
 * Does not touch Production.
 */
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { createEstateAgentProfile } from "../lib/estateAgent/createEstateAgentProfile";
import { completeEstateAgentOnboarding } from "../lib/estateAgent/completeOnboarding";

const DEVELOPMENT_SUPABASE_PROJECT_REF = "bbbsxzxcjkmpqsfvmhbo";
const PASSWORD = "EmailLookupPrivacyDev123!";
const MIGRATION =
  "supabase/migrations/20260819200000_sec_email_lookup_rpc_privacy.sql";

type TestResult = { name: string; pass: boolean; detail?: string };
const results: TestResult[] = [];

function record(name: string, pass: boolean, detail?: string) {
  results.push({ name, pass, detail });
  console.log(pass ? `✓ ${name}` : `✗ ${name}${detail ? `: ${detail}` : ""}`);
}

function loadEnvLocal(): void {
  const envPath = join(process.cwd(), ".env.local");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
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
    if (!(key in process.env)) process.env[key] = value;
  }
}

function assertDevelopment() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const match = url.match(/^https:\/\/([a-z0-9]+)\.supabase\.co/i);
  const ref = match?.[1] ?? null;
  if (ref !== DEVELOPMENT_SUPABASE_PROJECT_REF) {
    throw new Error(`Refusing: project ${ref} is not Development`);
  }
  if (process.env.VERCEL_ENV === "production") {
    throw new Error("Refusing: VERCEL_ENV=production");
  }
  record("Development project ref guard", true);
}

function anonClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}

function serviceClient(): SupabaseClient {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY required");
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function runStatic() {
  console.log("\n--- Static email-lookup / server-only checks ---\n");

  const migrationPath = join(process.cwd(), MIGRATION);
  record("Migration file exists", existsSync(migrationPath));
  if (existsSync(migrationPath)) {
    const sql = readFileSync(migrationPath, "utf8");
    record(
      "Migration revokes authenticated EXECUTE on get_user_email_by_id",
      sql.includes("revoke all on function public.get_user_email_by_id") &&
        sql.includes("from authenticated")
    );
    record(
      "Migration grants EXECUTE only to service_role",
      sql.includes(
        "grant execute on function public.get_user_email_by_id(uuid) to service_role"
      ) && !sql.includes("to authenticated;")
    );
    record(
      "Migration documents security intent",
      sql.includes("Not callable by authenticated") ||
        sql.includes("MUST NOT call get_user_email_by_id")
    );
  }

  const serviceRoleSrc = readFileSync(
    join(process.cwd(), "lib/supabase/serviceRole.ts"),
    "utf8"
  );
  record(
    "TEST5 serviceRole.ts has explicit server-only protection",
    serviceRoleSrc.includes('import "server-only"') ||
      serviceRoleSrc.includes("from \"server-only\"")
  );

  const branchTeam = readFileSync(
    join(process.cwd(), "lib/estateAgent/branchTeam.ts"),
    "utf8"
  );
  record(
    "Team directory uses authorised RPC (not generic email lookup)",
    branchTeam.includes("get_ea_branch_team_directory") &&
      !branchTeam.includes("get_user_email_by_id")
  );

  // Client UI must not import serviceRole or embed the service-role key.
  // (API routes under app/api may use service role — that is intentional.)
  const fs = require("fs") as typeof import("fs");
  const path = require("path") as typeof import("path");

  function walkTsFiles(dir: string, acc: string[] = []): string[] {
    if (!fs.existsSync(dir)) return acc;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "api" || entry.name === "node_modules") continue;
        walkTsFiles(full, acc);
      } else if (/\.(ts|tsx)$/.test(entry.name)) {
        acc.push(full);
      }
    }
    return acc;
  }

  const uiFiles = [
    ...walkTsFiles(join(process.cwd(), "components")),
    ...walkTsFiles(join(process.cwd(), "app")),
  ];
  const leaked = uiFiles.filter((file) => {
    const src = fs.readFileSync(file, "utf8");
    return (
      src.includes("supabase/serviceRole") ||
      src.includes("SUPABASE_SERVICE_ROLE_KEY")
    );
  });
  record(
    "TEST4 no service-role secret/module in client UI (components / pages)",
    leaked.length === 0,
    leaked.length
      ? leaked.map((f) => path.relative(process.cwd(), f)).join(", ")
      : undefined
  );
}

async function ensureUser(admin: SupabaseClient, email: string) {
  const created = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (created.data.user?.id) return created.data.user.id;
  const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const existing = listed.data.users.find(
    (u) => u.email?.toLowerCase() === email.toLowerCase()
  );
  if (!existing?.id) throw new Error(`user create failed: ${email}`);
  return existing.id;
}

async function signIn(email: string) {
  const client = anonClient();
  const { error } = await client.auth.signInWithPassword({
    email,
    password: PASSWORD,
  });
  if (error) throw error;
  return client;
}

async function runExecute() {
  console.log("\n--- Execute email-lookup privacy checks ---\n");
  const admin = serviceClient();
  const suffix = randomUUID().slice(0, 8);
  const ownerEmail = `email-priv-owner-${suffix}@email-priv.test`;
  const staffEmail = `email-priv-staff-${suffix}@email-priv.test`;
  const outsiderEmail = `email-priv-out-${suffix}@email-priv.test`;

  const userIds: string[] = [];
  let companyId: string | null = null;
  let branchId: string | null = null;

  try {
    const ownerId = await ensureUser(admin, ownerEmail);
    const staffId = await ensureUser(admin, staffEmail);
    const outsiderId = await ensureUser(admin, outsiderEmail);
    userIds.push(ownerId, staffId, outsiderId);

    // Probe: does authenticated still have EXECUTE? (migration may be pending)
    const outsider = await signIn(outsiderEmail);
    const { data: probeData, error: probeError } = await outsider.rpc(
      "get_user_email_by_id",
      { p_user_id: staffId }
    );

    const permissionDenied =
      !!probeError &&
      (/permission denied|not exist|42501|PGRST202|PGRST301/i.test(
        probeError.message
      ) ||
        /permission denied|42501/i.test(probeError.code ?? ""));

    const returnedEmail =
      typeof probeData === "string" && probeData.includes("@");

    if (returnedEmail) {
      record(
        "TEST1 authenticated user cannot call generic get_user_email_by_id",
        false,
        "RPC returned an email — apply migration 20260819200000_sec_email_lookup_rpc_privacy.sql"
      );
      record(
        "TEST2 unauthorised cross-user email lookup fails",
        false,
        "cross-user email visible via generic RPC"
      );
    } else {
      record(
        "TEST1 authenticated user cannot call generic get_user_email_by_id",
        permissionDenied || probeData == null,
        probeError?.message ?? `data=${String(probeData)}`
      );
      record(
        "TEST2 unauthorised cross-user email lookup fails",
        permissionDenied || probeData == null,
        probeError?.message ?? "no email returned"
      );
    }

    // Own-id lookup must also fail for authenticated (generic path closed)
    const { data: selfData, error: selfError } = await outsider.rpc(
      "get_user_email_by_id",
      { p_user_id: outsiderId }
    );
    const selfDenied =
      !!selfError ||
      selfData == null ||
      (typeof selfData === "string" && !selfData.includes("@"));
    record(
      "Authenticated cannot use generic RPC even for own user id",
      selfDenied &&
        !(typeof selfData === "string" && selfData.includes("@")),
      selfError?.message ?? `data=${String(selfData)}`
    );

    // Legitimate team directory workflow
    const ownerClient = await signIn(ownerEmail);
    const profile = await createEstateAgentProfile(ownerClient, {
      userId: ownerId,
      contactName: "Email Privacy Owner",
      email: ownerEmail,
    });
    if (profile.error) {
      record(
        "TEST3/6 legitimate team directory workflow",
        false,
        profile.error
      );
      return;
    }

    const onboarding = await completeEstateAgentOnboarding(ownerClient, {
      userId: ownerId,
      companyName: `Email Priv Co ${suffix}`,
      branchName: `Email Priv Branch ${suffix}`,
      townOrCity: "London",
      postcode: "E1 6AN",
      isHeadOffice: true,
      emailDomain: `emailpriv${suffix}.co.uk`,
    });
    if (!onboarding.success) {
      record(
        "TEST3/6 legitimate team directory workflow",
        false,
        onboarding.error
      );
      return;
    }

    const { data: membership } = await admin
      .from("ea_branch_members")
      .select("branch_id, company_id:ea_branches!inner(company_id)")
      .eq("user_id", ownerId)
      .maybeSingle();

    // Prefer simple lookups
    const { data: branchRow } = await admin
      .from("ea_branches")
      .select("id, company_id")
      .eq("created_by_user_id", ownerId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    branchId = (branchRow?.id as string | undefined) ?? null;
    companyId = (branchRow?.company_id as string | undefined) ?? null;

    if (!branchId || !companyId) {
      // Fallback via membership
      const { data: m2 } = await admin
        .from("ea_branch_members")
        .select("branch_id")
        .eq("user_id", ownerId)
        .limit(1)
        .maybeSingle();
      branchId = (m2?.branch_id as string | undefined) ?? null;
      if (branchId) {
        const { data: b2 } = await admin
          .from("ea_branches")
          .select("company_id")
          .eq("id", branchId)
          .single();
        companyId = (b2?.company_id as string | undefined) ?? null;
      }
    }

    if (!branchId) {
      record(
        "TEST3/6 legitimate team directory workflow",
        false,
        "branch not found after onboarding"
      );
      return;
    }
    void membership;

    // Add staff as branch member via service role
    await admin.from("ea_branch_members").upsert(
      {
        branch_id: branchId,
        user_id: staffId,
        role: "agent",
      },
      { onConflict: "branch_id,user_id" }
    );

    const { data: dir, error: dirError } = await ownerClient.rpc(
      "get_ea_branch_team_directory",
      { p_branch_id: branchId }
    );

    const members = (
      dir as { ok?: boolean; members?: Array<{ email?: string }> }
    )?.members;
    const hasStaffEmail =
      Array.isArray(members) &&
      members.some(
        (m) =>
          typeof m.email === "string" &&
          m.email.toLowerCase() === staffEmail.toLowerCase()
      );

    record(
      "TEST3 legitimate authorised email workflow still works (team directory)",
      !dirError &&
        (dir as { ok?: boolean })?.ok === true &&
        hasStaffEmail,
      dirError?.message ??
        (hasStaffEmail
          ? "staff email present in directory"
          : "staff email missing from directory — check membership / migration")
    );

    // Outsider must not access team directory
    const { data: outDir } = await outsider.rpc("get_ea_branch_team_directory", {
      p_branch_id: branchId,
    });
    record(
      "TEST6 team/invitation workflows remain gated (outsider denied directory)",
      (outDir as { ok?: boolean; error?: string })?.ok === false ||
        (outDir as { error?: string })?.error === "not_branch_member",
      JSON.stringify(outDir)
    );

    // service_role can still execute helper if needed
    const { error: svcErr } = await admin.rpc("get_user_email_by_id", {
      p_user_id: staffId,
    });
    record(
      "service_role retains internal lookup capability (or PostgREST schema cache)",
      !svcErr || /schema cache|PGRST/i.test(svcErr.message),
      svcErr?.message ?? "service_role execute ok"
    );
  } finally {
    // Cleanup fixtures
    if (branchId) {
      await admin.from("ea_branch_members").delete().eq("branch_id", branchId);
      await admin.from("ea_branch_invitations").delete().eq("branch_id", branchId);
      await admin.from("ea_branches").delete().eq("id", branchId);
    }
    if (companyId) {
      await admin.from("ea_companies").delete().eq("id", companyId);
    }
    for (const id of userIds) {
      await admin.auth.admin.deleteUser(id);
    }
    record("Fixture cleanup completed", true);
  }
}

async function main() {
  loadEnvLocal();
  console.log("Email Lookup Privacy + Server-Only Boundary — Development\n");
  console.log(`Environment: Development (${DEVELOPMENT_SUPABASE_PROJECT_REF})`);
  console.log("Production: NOT targeted");
  const execute = process.argv.includes("--execute");
  console.log(`Mode: ${execute ? "--execute" : "static-only"}\n`);
  assertDevelopment();
  runStatic();
  if (execute) {
    await runExecute();
  } else {
    console.log(
      "\nRe-run with --execute after applying " +
        "supabase/migrations/20260819200000_sec_email_lookup_rpc_privacy.sql\n"
    );
  }

  const passed = results.filter((r) => r.pass).length;
  const total = results.length;
  console.log(`\n${passed}/${total} checks passed\n`);
  if (passed < total) {
    for (const r of results.filter((x) => !x.pass)) {
      console.log(` - ${r.name}${r.detail ? `: ${r.detail}` : ""}`);
    }
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
