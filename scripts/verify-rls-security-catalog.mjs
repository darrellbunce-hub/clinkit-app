/**
 * Catalog-oriented RLS security checks via PostgREST/SQL is not available
 * from anon. This script documents how to run the SQL verifier and optionally
 * flags env readiness.
 *
 * Primary verification (authoritative):
 *   Paste scripts/verify-rls-security-catalog.sql into the Supabase SQL Editor
 *   on the target project. Expect no CRITICAL / HIGH rows after hardening.
 *
 * Behavioural IDOR checks (optional, needs test users):
 *   node scripts/verify-participant-privacy-rls.mjs
 *
 * Usage:
 *   node scripts/verify-rls-security-catalog.mjs
 */

import { existsSync, readFileSync } from "fs";
import { resolve } from "path";

const sqlPath = resolve(
  "scripts/verify-rls-security-catalog.sql"
);

if (!existsSync(sqlPath)) {
  console.error("Missing scripts/verify-rls-security-catalog.sql");
  process.exit(1);
}

const sql = readFileSync(sqlPath, "utf8");

console.log("RLS security catalog verifier");
console.log("============================");
console.log(
  "This check is SQL-Editor based (needs privileged catalog read)."
);
console.log("");
console.log("1. Open the target Supabase project → SQL Editor");
console.log(
  "2. Apply migration 20260829210000_rls_legacy_permissive_and_anon_hardening.sql if not applied"
);
console.log("3. Run the full contents of:");
console.log(`   ${sqlPath}`);
console.log("4. Expect zero CRITICAL and HIGH findings.");
console.log("");
console.log(
  `SQL bytes loaded: ${sql.length} (file present and readable)`
);
console.log("");
console.log(
  "Optional behavioural suite: node scripts/verify-participant-privacy-rls.mjs"
);

process.exit(0);
