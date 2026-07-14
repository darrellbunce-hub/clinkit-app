/**
 * Pre-launch ownership audit — detects multiple operational homeowners.
 *
 * Usage:
 *   npx tsx scripts/audit-ownership-violations.ts
 *
 * Requires migration 20260714140000_property_operational_identity_foundation.sql
 * for report_multiple_operational_homeowners RPC (optional — local checks always run).
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

import { detectMultipleOperationalHomeowners } from "../lib/ownership/roles";
import { OWNERSHIP_VIOLATION_REGISTRY } from "../lib/ownership/types";

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const match = line.match(/^([^=]+)=(.*)$/);
  if (match) {
    process.env[match[1]] = match[2].trim().replace(/^"|"$/g, "");
  }
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

function mainLocalChecks() {
  const violation = detectMultipleOperationalHomeowners(
    [
      { userId: "a", role: "seller" },
      { userId: "b", role: "seller" },
    ],
    "sale"
  );

  if (!violation) {
    throw new Error("Expected multi-owner detection for duplicate sellers");
  }

  const ok = detectMultipleOperationalHomeowners(
    [
      { userId: "a", role: "seller" },
      { userId: "b", role: "buyer" },
    ],
    "sale"
  );

  if (ok) {
    throw new Error("Seller + buyer on sale should not flag as multi-owner");
  }

  console.log(`Known violation paths: ${OWNERSHIP_VIOLATION_REGISTRY.length}`);
  for (const entry of OWNERSHIP_VIOLATION_REGISTRY) {
    console.log(`  [${entry.severity}] ${entry.id} — ${entry.location}`);
  }
}

async function mainRemoteAudit() {
  const supabase = createClient(url, anonKey);

  const { data, error } = await supabase.rpc(
    "report_multiple_operational_homeowners"
  );

  if (error) {
    if (error.code === "PGRST202" || error.code === "42883") {
      console.log(
        "Remote audit skipped: report_multiple_operational_homeowners not applied yet."
      );
      return;
    }

    throw error;
  }

  const violations = (data ?? []) as Array<{
    property_id: number;
    relationship_type: string;
    user_count: number;
    user_ids: string[];
  }>;

  if (violations.length > 0) {
    console.error("OWNERSHIP VIOLATIONS DETECTED:");
    console.error(JSON.stringify(violations, null, 2));
    process.exit(1);
  }

  console.log("Remote audit: zero properties with multiple operational homeowners.");
}

async function main() {
  mainLocalChecks();
  await mainRemoteAudit();
  console.log("\n=== OWNERSHIP AUDIT COMPLETE ===");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
