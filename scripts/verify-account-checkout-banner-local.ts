/**
 * LOCAL verifier — account Subscription section, Checkout return banner.
 *
 * Usage:
 *   npx tsx scripts/verify-account-checkout-banner-local.ts
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

const BRANCH = "4644d987-0160-4fbb-a040-47423c53febd";

function summary(
  overrides: Partial<EaBranchSubscriptionSummary> = {}
): EaBranchSubscriptionSummary {
  return {
    ok: true,
    branch_id: BRANCH,
    has_subscription: true,
    stripe_status: "trialing",
    entitlement_status: "entitled",
    ended_at: null,
    ...overrides,
  };
}

async function main() {
  console.log("Account Checkout return banner — LOCAL verification\n");
  const {
    isCheckoutReturnConfirmed,
    readCheckoutReturn,
    urlWithoutCheckoutReturnParams,
  } = await import("../components/account/SubscriptionSection");

  const returned = readCheckoutReturn(`?billing=success&branch=${BRANCH}`);
  record(
    "RETURN reads billing=success and the branch from the return URL",
    returned.billing === "success" && returned.branchId === BRANCH
  );

  record(
    "CONFIRM successful checkout followed by a confirmed trial subscription",
    isCheckoutReturnConfirmed(summary(), BRANCH)
  );
  record(
    "CONFIRM active subscription also confirms",
    isCheckoutReturnConfirmed(summary({ stripe_status: "active" }), BRANCH)
  );
  record(
    "PENDING genuine checkout_pending row is never treated as confirmed",
    !isCheckoutReturnConfirmed(
      summary({ stripe_status: "checkout_pending", entitlement_status: "none" }),
      BRANCH
    )
  );
  record(
    "FAILURE missing summary (failed load) does not confirm",
    !isCheckoutReturnConfirmed(null, BRANCH)
  );
  record(
    "FAILURE summary error (ok: false) does not confirm",
    !isCheckoutReturnConfirmed({ ok: false, error: "not_branch_member" }, BRANCH)
  );
  record(
    "FAILURE no subscription row (not_started) does not confirm",
    !isCheckoutReturnConfirmed(
      summary({ has_subscription: false, stripe_status: "not_started" }),
      BRANCH
    )
  );
  record(
    "SAFETY summary for a different branch does not confirm",
    !isCheckoutReturnConfirmed(summary({ branch_id: "other-branch" }), BRANCH)
  );
  record(
    "SAFETY ended / previous subscription row does not confirm",
    !isCheckoutReturnConfirmed(
      summary({ stripe_status: "canceled", ended_at: "2026-11-01T00:00:00Z" }),
      BRANCH
    ) &&
      !isCheckoutReturnConfirmed(
        summary({ stripe_status: "canceled", entitlement_status: "ended" }),
        BRANCH
      )
  );
  record(
    "SAFETY missing branch ID in the return URL does not confirm",
    !isCheckoutReturnConfirmed(summary(), null)
  );
  record(
    "SAFETY empty branch ID in the return URL does not confirm",
    !isCheckoutReturnConfirmed(summary(), "") &&
      !isCheckoutReturnConfirmed(
        summary(),
        readCheckoutReturn("?billing=success").branchId
      )
  );

  const polled: (EaBranchSubscriptionSummary | null)[] = [
    summary({ stripe_status: "checkout_pending", entitlement_status: "none" }),
    null,
    { ok: false, error: "not_authenticated" },
    summary(),
  ];
  record(
    "POLLING pending → failed load → error → trialing clears only on the trialing poll",
    polled.findIndex((s) => isCheckoutReturnConfirmed(s, BRANCH)) === 3
  );

  const base = "https://stage.moveloop.co.uk/account";
  const cleaned = urlWithoutCheckoutReturnParams(
    `${base}?billing=success&branch=${BRANCH}#subscription`
  );
  record(
    "URL billing and branch removed, pathname and hash kept",
    cleaned === "/account#subscription",
    String(cleaned)
  );
  const withOthers = urlWithoutCheckoutReturnParams(
    `${base}?tab=billing&billing=success&utm_source=email&branch=${BRANCH}#subscription`
  );
  record(
    "URL unrelated query parameters and hash preserved",
    withOthers === "/account?tab=billing&utm_source=email#subscription",
    String(withOthers)
  );
  record(
    "URL nothing to remove → null (no history write)",
    urlWithoutCheckoutReturnParams(`${base}?tab=billing#subscription`) === null &&
      urlWithoutCheckoutReturnParams(base) === null
  );
  const afterRefresh = readCheckoutReturn(
    new URL(cleaned ?? "/", "https://stage.moveloop.co.uk").search
  );
  record(
    "REFRESH after cleanup the URL no longer triggers the banner",
    afterRefresh.billing === null && afterRefresh.branchId === null
  );

  const src = readFileSync(
    join(ROOT, "components/account/SubscriptionSection.tsx"),
    "utf8"
  ).replace(/\r\n/g, "\n");
  const reloadBody = src.slice(
    src.indexOf("const reload = useCallback("),
    src.indexOf("}, [userId]);")
  );
  const confirmedBlockAt = reloadBody.indexOf("isCheckoutReturnConfirmed(loaded");
  const confirmedBlock = reloadBody.slice(confirmedBlockAt);
  record(
    "WIRING banner cleared and URL replaced only inside the confirmed branch, after the summary loads",
    confirmedBlockAt > reloadBody.indexOf("setSummary(loaded)") &&
      confirmedBlock.includes('setNotice("")') &&
      confirmedBlock.includes("window.history.replaceState(") &&
      (src.match(/window\.history\.replaceState\(/g) ?? []).length === 1 &&
      (src.match(/setNotice\(""\)/g) ?? []).length === 1
  );
  record(
    "WIRING confirmation stops the 4s polling",
    confirmedBlock.includes("window.clearInterval(checkoutPollRef.current.interval)")
  );
  record(
    "PRESERVED pending card copy, Continue checkout and portal behaviour",
    src.includes('title: "Subscription confirmation pending"') &&
      src.includes('"Continue checkout"') &&
      src.includes('fetch("/api/billing/ea/portal-session"') &&
      src.includes('summary?.stripe_status === "checkout_pending"')
  );

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed\n`);
  if (failed.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
