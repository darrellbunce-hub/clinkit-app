/**
 * LOCAL verifier — account Subscription section status after the billing
 * portal (cancellation scheduled / withdrawn) and the portal-return refresh.
 *
 * Usage:
 *   npx tsx scripts/verify-account-subscription-status-local.ts
 *
 * Pure helpers exported from components/account/SubscriptionSection.tsx plus
 * source checks of how the component wires them. No network, no database.
 */
import { readFileSync } from "fs";
import Module from "module";
import { join } from "path";

import type { EaBranchSubscriptionSummary } from "../lib/billing/eaBranchSubscription";

const moduleWithLoad = Module as typeof Module & {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown;
};
const originalLoad = moduleWithLoad._load.bind(Module);
moduleWithLoad._load = function patchedLoad(
  request: string,
  parent: unknown,
  isMain: boolean
) {
  if (request === "@/lib/supabase" || request.endsWith("/lib/supabase")) {
    return { supabase: {} };
  }
  return originalLoad(request, parent, isMain);
};

const ROOT = join(import.meta.dirname, "..");
type TestResult = { name: string; pass: boolean; detail?: string };
const results: TestResult[] = [];

function record(name: string, pass: boolean, detail?: string) {
  results.push({ name, pass, detail });
  console.log(pass ? `✓ ${name}` : `✗ ${name}${detail ? `: ${detail}` : ""}`);
}

const TRIAL_END = new Date(Date.now() + 20 * 86400000).toISOString();

function summary(
  overrides: Partial<EaBranchSubscriptionSummary> = {}
): EaBranchSubscriptionSummary {
  return {
    ok: true,
    branch_id: "branch-1",
    has_subscription: true,
    pricing_tier: "standard",
    amount_gbp_minor: 12900,
    stripe_status: "trialing",
    entitlement_status: "entitled",
    current_period_end: TRIAL_END,
    cancel_at_period_end: false,
    cancelled_at: null,
    grace_ends_at: null,
    ended_at: null,
    ...overrides,
  };
}

async function main() {
  console.log("Account subscription status after the billing portal — LOCAL verification\n");
  const {
    describeSummary,
    isRefreshDue,
    PORTAL_RETURN_REFRESH_DELAYS_MS,
    readCheckoutReturn,
    subscriptionStatusFingerprint,
    urlWithoutCheckoutReturnParams,
    VISIBILITY_REFRESH_MIN_INTERVAL_MS,
  } = await import("../components/account/SubscriptionSection");

  const scheduledTrial = describeSummary(
    summary({ cancel_at_period_end: true, cancelled_at: new Date().toISOString() })
  );
  record(
    "STATUS trial with a scheduled cancellation shows cancellation scheduled",
    scheduledTrial.title === "Free trial — cancellation scheduled" &&
      scheduledTrial.tone === "warning",
    JSON.stringify(scheduledTrial)
  );
  const reversedTrial = describeSummary(summary());
  record(
    "STATUS trial after reversal shows the normal trial (continues at £129/month)",
    reversedTrial.title.startsWith("Free trial — ") &&
      !reversedTrial.title.includes("cancellation") &&
      reversedTrial.detail.includes("£129/month") &&
      reversedTrial.tone === "success",
    JSON.stringify(reversedTrial)
  );
  const scheduledPaid = describeSummary(
    summary({ stripe_status: "active", cancel_at_period_end: true })
  );
  const reversedPaid = describeSummary(summary({ stripe_status: "active" }));
  record(
    "STATUS paid subscription: scheduled shows Cancels on; after reversal shows Next payment date",
    scheduledPaid.detail.includes("Cancels on") &&
      reversedPaid.title === "Active — Standard £129/month" &&
      reversedPaid.detail.includes("Next payment date") &&
      !reversedPaid.detail.includes("Cancels"),
    JSON.stringify({ scheduledPaid, reversedPaid })
  );
  const reversedFounding = describeSummary(
    summary({
      stripe_status: "active",
      pricing_tier: "founding",
      amount_gbp_minor: 9900,
      founding_slot_number: 7,
    })
  );
  record(
    "STATUS historical £99 founding subscription after reversal keeps founding price copy",
    reversedFounding.title === "Active — Founding £99/month" &&
      reversedFounding.detail.includes("Founding price remains"),
    JSON.stringify(reversedFounding)
  );

  const before = subscriptionStatusFingerprint(
    summary({ cancel_at_period_end: true })
  );
  record(
    "FINGERPRINT changes when the cancellation is withdrawn",
    before !== subscriptionStatusFingerprint(summary())
  );
  record(
    "FINGERPRINT ignores fields the status does not show",
    subscriptionStatusFingerprint(summary()) ===
      subscriptionStatusFingerprint(summary({ subscription_id: "other", currency: "gbp" }))
  );
  record(
    "FINGERPRINT for a missing or failed summary is stable",
    subscriptionStatusFingerprint(null) === "none" &&
      subscriptionStatusFingerprint({ ok: false }) === "none"
  );

  record(
    "REFRESH portal follow-ups are few and bounded",
    PORTAL_RETURN_REFRESH_DELAYS_MS.length <= 3 &&
      PORTAL_RETURN_REFRESH_DELAYS_MS.every((d, i, all) => d > 0 && (i === 0 || d > all[i - 1]!)) &&
      PORTAL_RETURN_REFRESH_DELAYS_MS[PORTAL_RETURN_REFRESH_DELAYS_MS.length - 1]! <= 30000
  );
  record(
    "REFRESH visibility refresh is throttled",
    isRefreshDue(null, 1000, VISIBILITY_REFRESH_MIN_INTERVAL_MS) &&
      !isRefreshDue(1000, 1000 + VISIBILITY_REFRESH_MIN_INTERVAL_MS - 1, VISIBILITY_REFRESH_MIN_INTERVAL_MS) &&
      isRefreshDue(1000, 1000 + VISIBILITY_REFRESH_MIN_INTERVAL_MS, VISIBILITY_REFRESH_MIN_INTERVAL_MS)
  );

  record(
    "RETURN reads billing=portal",
    readCheckoutReturn("?billing=portal").billing === "portal"
  );
  record(
    "RETURN the portal parameter is removed, keeping the #subscription hash",
    urlWithoutCheckoutReturnParams(
      "https://stage.moveloop.co.uk/account?billing=portal#subscription"
    ) === "/account#subscription"
  );

  const portalSource = readFileSync(join(ROOT, "lib/billing/eaPortal.ts"), "utf8");
  record(
    "PORTAL return_url marks the return with billing=portal",
    portalSource.includes("/account?billing=portal#subscription")
  );
  const source = readFileSync(
    join(ROOT, "components/account/SubscriptionSection.tsx"),
    "utf8"
  );
  record(
    "WIRING portal return reloads, follows up on the bounded delays and stops on change",
    source.includes('billing === "portal"') &&
      source.includes("PORTAL_RETURN_REFRESH_DELAYS_MS") &&
      source.includes("stopFollowUps()") &&
      source.includes("return stopFollowUps;")
  );
  record(
    "WIRING visibility and back/forward-cache restores refresh (throttled), listeners removed",
    source.includes('addEventListener("visibilitychange"') &&
      source.includes('removeEventListener("visibilitychange"') &&
      source.includes('addEventListener("pageshow"') &&
      source.includes('removeEventListener("pageshow"') &&
      source.includes("event.persisted")
  );
  record(
    "WIRING no unbounded polling was added (only the existing Checkout interval)",
    (source.match(/setInterval\(/g) ?? []).length === 1
  );

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
