/**
 * Apply a single migration file to Development ONLY (bbbsxzxcjkmpqsfvmhbo).
 *
 * Requires one of:
 *   SUPABASE_DB_URL
 *   DATABASE_URL
 *   SUPABASE_DB_PASSWORD (+ optional host/user/port/name)
 *
 * Usage:
 *   npx tsx scripts/apply-development-migration.ts supabase/migrations/20260725120000_platform_security_rpc_authorisation_hardening.sql
 */
import { readFileSync } from "fs";
import { join } from "path";

const DEVELOPMENT_SUPABASE_PROJECT_REF = "bbbsxzxcjkmpqsfvmhbo";

function loadEnvLocal(): void {
  const envPath = join(process.cwd(), ".env.local");
  try {
    for (const line of readFileSync(envPath, "utf8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const separatorIndex = trimmed.indexOf("=");
      if (separatorIndex <= 0) continue;
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
  } catch {
    // optional
  }
}

function assertDevelopmentTarget(): void {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const match = url.match(/^https:\/\/([a-z0-9]+)\.supabase\.co/i);
  const projectRef = match?.[1] ?? null;
  if (projectRef !== DEVELOPMENT_SUPABASE_PROJECT_REF) {
    throw new Error(
      `Refusing to apply: Supabase project "${projectRef ?? "unknown"}" is not Development (${DEVELOPMENT_SUPABASE_PROJECT_REF}).`
    );
  }
  if (process.env.VERCEL_ENV === "production") {
    throw new Error("Refusing to apply: VERCEL_ENV=production.");
  }
}

function buildSupabaseDbUrlFromParts(): string | undefined {
  const password =
    process.env.SUPABASE_DB_PASSWORD?.trim() ||
    process.env.POSTGRES_PASSWORD?.trim();
  if (!password) return undefined;

  const host =
    process.env.SUPABASE_DB_HOST?.trim() ||
    `db.${DEVELOPMENT_SUPABASE_PROJECT_REF}.supabase.co`;
  const port = process.env.SUPABASE_DB_PORT?.trim() || "5432";
  const database = process.env.SUPABASE_DB_NAME?.trim() || "postgres";
  const user = process.env.SUPABASE_DB_USER?.trim() || "postgres";

  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}`;
}

function resolveDbUrl(): string | undefined {
  return (
    process.env.SUPABASE_DB_URL?.trim() ||
    process.env.DATABASE_URL?.trim() ||
    buildSupabaseDbUrlFromParts()
  );
}

async function applyViaManagementApi(sql: string): Promise<boolean> {
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN?.trim();
  if (!accessToken) return false;

  const response = await fetch(
    `https://api.supabase.com/v1/projects/${DEVELOPMENT_SUPABASE_PROJECT_REF}/database/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: sql }),
    }
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Management API apply failed (${response.status}): ${body.slice(0, 500)}`
    );
  }

  return true;
}

async function main() {
  loadEnvLocal();
  assertDevelopmentTarget();

  const migrationPath =
    process.argv[2] ??
    "supabase/migrations/20260725120000_platform_security_rpc_authorisation_hardening.sql";

  const sql = readFileSync(join(process.cwd(), migrationPath), "utf8");

  console.log("Applying migration to Development:");
  console.log(`  Project ref: ${DEVELOPMENT_SUPABASE_PROJECT_REF}`);
  console.log(`  Migration: ${migrationPath}`);
  console.log("  Production: NOT targeted");

  if (await applyViaManagementApi(sql)) {
    console.log("Migration applied successfully via Supabase Management API.");
    return;
  }

  const dbUrl = resolveDbUrl();

  if (!dbUrl) {
    throw new Error(
      "Missing database connection (SUPABASE_ACCESS_TOKEN, SUPABASE_DB_URL, DATABASE_URL, or SUPABASE_DB_PASSWORD)."
    );
  }

  if (!dbUrl.includes(DEVELOPMENT_SUPABASE_PROJECT_REF)) {
    throw new Error(
      "Refusing to apply: database URL does not reference Development project ref."
    );
  }

  const pg = await import("pg");
  const client = new pg.Client({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  try {
    await client.query("begin");
    await client.query(sql);
    await client.query("commit");
    console.log("Migration applied successfully.");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
