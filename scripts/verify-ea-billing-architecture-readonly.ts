/**
 * READ-ONLY Estate Agent billing architecture verifier (Stage 2-aware).
 *
 * Usage:
 *   npx tsx scripts/verify-ea-billing-architecture-readonly.ts
 *
 * Does NOT print Stripe secret values.
 */
import { existsSync, readFileSync } from "fs";
import { join } from "path";

import {
  EA_FOUNDING_BRANCH_LIMIT,
  EA_FOUNDING_BRANCH_MONTHLY_GBP_MINOR,
  EA_STANDARD_BRANCH_MONTHLY_GBP_MINOR,
} from "../lib/billing/eaBranchPricing";
import { EA_BILLING_ENTITLEMENT_ENFORCEMENT_ENABLED } from "../lib/billing/eaBranchEntitlement";

const ROOT = join(import.meta.dirname, "..");
type TestResult = { name: string; pass: boolean; detail?: string };
const results: TestResult[] = [];

function record(name: string, pass: boolean, detail?: string) {
  results.push({ name, pass, detail });
  console.log(pass ? `✓ ${name}` : `✗ ${name}${detail ? `: ${detail}` : ""}`);
}

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

function loadEnvLocalKeys(): string[] {
  const envPath = join(ROOT, ".env.local");
  if (!existsSync(envPath)) return [];
  const keys: string[] = [];
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    keys.push(trimmed.slice(0, eq).trim());
  }
  return keys;
}

function main() {
  console.log("EA Billing Architecture — READ-ONLY Verification (Stage 2)\n");

  const pkg = JSON.parse(read("package.json")) as {
    dependencies?: Record<string, string>;
  };
  record("package.json declares stripe SDK", !!pkg.dependencies?.stripe);

  record(
    "Checkout/Portal/webhook API routes exist",
    existsSync(join(ROOT, "app/api/billing/ea/checkout-session/route.ts")) &&
      existsSync(join(ROOT, "app/api/billing/ea/portal-session/route.ts")) &&
      existsSync(join(ROOT, "app/api/billing/stripe/webhook/route.ts"))
  );

  record(
    "Pricing constants £99 / £129 / limit 20",
    EA_FOUNDING_BRANCH_MONTHLY_GBP_MINOR === 9900 &&
      EA_STANDARD_BRANCH_MONTHLY_GBP_MINOR === 12900 &&
      EA_FOUNDING_BRANCH_LIMIT === 20
  );
  record(
    "Entitlement enforcement disabled",
    EA_BILLING_ENTITLEMENT_ENFORCEMENT_ENABLED === false
  );

  const landing = read("components/estate-agents/EaLandingPage.tsx");
  record(
    "Active marketing £99 founding / £129 standard",
    landing.includes("£99") && landing.includes("£129/month")
  );

  const keys = loadEnvLocalKeys().filter((k) => /stripe/i.test(k));
  const allowed = new Set([
    "STRIPE_SECRET_KEY",
    "STRIPE_EA_FOUNDING_PRICE_ID",
    "STRIPE_EA_STANDARD_PRICE_ID",
    "STRIPE_API_MODE",
    "STRIPE_WEBHOOK_SECRET",
  ]);
  const unexpected = keys.filter((k) => !allowed.has(k) || k.startsWith("NEXT_PUBLIC_"));
  record(
    "No NEXT_PUBLIC Stripe secrets; only expected STRIPE_* names",
    unexpected.length === 0,
    keys.join(",") || "none"
  );
  record(
    "Stage 1 + Stage 2 migrations exist",
    existsSync(
      join(
        ROOT,
        "supabase/migrations/20260729200000_billing_stage1_ea_branch_subscriptions.sql"
      )
    ) &&
      existsSync(
        join(
          ROOT,
          "supabase/migrations/20260729210000_billing_stage2_checkout_grace_foundation.sql"
        )
      )
  );

  const failed = results.filter((r) => !r.pass);
  console.log(
    `\n${results.length - failed.length}/${results.length} architecture checks passed\n`
  );
  if (failed.length) {
    process.exitCode = 1;
  }
}

main();
