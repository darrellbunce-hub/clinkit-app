/**
 * Batch 12 — EA-02 soft-skip expectations + EA-05 Checkout confirmation UX.
 *
 *   npx tsx scripts/verify-ea-soft-skip-checkout-ux-batch12.ts
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  EA_ACCOUNT_SUBSCRIPTION_HREF,
  EA_CHECKOUT_CONFIRMATION_TIMEOUT_NOTICE,
  EA_CHECKOUT_CONFIRMING_DETAIL,
  EA_CHECKOUT_CONFIRMING_TITLE,
  EA_NO_SUBSCRIPTION_DETAIL,
  EA_SOFT_SKIP_CONSEQUENCES_COPY,
  EA_SOFT_SKIP_START_LATER_COPY,
} from "../lib/billing/eaSoftSkipExpectations";
import { EA_BILLING_ENTITLEMENT_ENFORCEMENT_ENABLED } from "../lib/billing/eaBranchEntitlement";
import { ROUTES } from "../lib/auth/routes";

const root = resolve(__dirname, "..");

function read(rel: string) {
  return readFileSync(resolve(root, rel), "utf8");
}

let failed = 0;

function check(label: string, ok: boolean) {
  if (ok) {
    console.log(`PASS: ${label}`);
  } else {
    console.error(`FAIL: ${label}`);
    failed += 1;
  }
}

const expectations = read("lib/billing/eaSoftSkipExpectations.ts");
const billingPage = read(
  "app/estate-agents/onboarding/billing/page.tsx"
);
const accountSection = read(
  "components/account/SubscriptionSection.tsx"
);
const entitlement = read("lib/billing/eaBranchEntitlement.ts");
const directoryMigration = read(
  "supabase/migrations/20261108110000_ea_branch_directory_search_eligibility.sql"
);

// --- EA-02: accurate soft-skip expectations ---

check(
  "soft-skip copy mentions homeowner search invisibility",
  EA_SOFT_SKIP_CONSEQUENCES_COPY.includes(
    "will not appear in homeowner search"
  )
);

check(
  "soft-skip copy does not claim dashboard lockout",
  EA_SOFT_SKIP_CONSEQUENCES_COPY.includes(
    "You can still use your agent dashboard now"
  ) &&
    !EA_SOFT_SKIP_CONSEQUENCES_COPY.toLowerCase().includes(
      "cannot access"
    )
);

check(
  "soft-skip points to Account → Subscription for later trial",
  EA_SOFT_SKIP_START_LATER_COPY.includes(
    "Account → Subscription"
  ) &&
    EA_ACCOUNT_SUBSCRIPTION_HREF ===
      `${ROUTES.accountSettings}#subscription`
);

check(
  "onboarding billing uses shared soft-skip consequences copy",
  billingPage.includes("EA_SOFT_SKIP_CONSEQUENCES_COPY") &&
    billingPage.includes("EA_SOFT_SKIP_BUTTON_LABEL") &&
    billingPage.includes("EA_ACCOUNT_SUBSCRIPTION_HREF")
);

check(
  "onboarding billing links to Account subscription for start-later",
  billingPage.includes("Open Account → Subscription") &&
    billingPage.includes("EA_ACCOUNT_SUBSCRIPTION_HREF")
);

check(
  "Account no-subscription detail includes directory expectation",
  EA_NO_SUBSCRIPTION_DETAIL.includes(
    "will not appear in homeowner search"
  ) &&
    accountSection.includes("EA_NO_SUBSCRIPTION_DETAIL")
);

check(
  "soft-skip does not change entitlement enforcement flag",
  EA_BILLING_ENTITLEMENT_ENFORCEMENT_ENABLED === false &&
    entitlement.includes(
      "EA_BILLING_ENTITLEMENT_ENFORCEMENT_ENABLED = false"
    )
);

check(
  "directory eligibility still requires commercial entitlement",
  directoryMigration.includes(
    "is_ea_branch_commercially_entitled"
  ) &&
    expectations.includes("Rule 25.16")
);

check(
  "soft-skip remains a client redirect only (no fake entitlement write)",
  /Continue to dashboard without starting a trial|EA_SOFT_SKIP_BUTTON_LABEL[\s\S]*ROUTES\.agentHome/.test(
    billingPage
  ) &&
    !billingPage.includes("ea_branch_subscriptions") &&
    !billingPage.includes("insert(")
);

// --- EA-05: Checkout confirmation UX ---

check(
  "confirming view hides soft-skip controls",
  (() => {
    const confirmingBranch =
      billingPage.match(
        /\{view === "confirming" \? \([\s\S]*?\) : \([\s\S]*?\)\}/
      )?.[0] ?? "";
    const confirmingOnly =
      confirmingBranch.split(") : (")[0] ?? "";
    const offerBranch =
      confirmingBranch.split(") : (")[1] ?? "";
    return (
      confirmingOnly.includes("EA_CHECKOUT_CONFIRMING_TITLE") &&
      !confirmingOnly.includes("EA_SOFT_SKIP_BUTTON_LABEL") &&
      offerBranch.includes("EA_SOFT_SKIP_BUTTON_LABEL")
    );
  })()
);

check(
  "confirming copy asks user to wait on the page",
  EA_CHECKOUT_CONFIRMING_TITLE.includes("Confirming") &&
    EA_CHECKOUT_CONFIRMING_DETAIL.includes(
      "Do not leave this page yet"
    ) &&
    billingPage.includes("EA_CHECKOUT_CONFIRMING_TITLE")
);

check(
  "timeout restores offer with recoverable retry",
  billingPage.includes("confirmationTimedOut") &&
    billingPage.includes("Check confirmation again") &&
    billingPage.includes("EA_CHECKOUT_CONFIRMATION_TIMEOUT_NOTICE") &&
    EA_CHECKOUT_CONFIRMATION_TIMEOUT_NOTICE.includes("check again")
);

check(
  "timeout notice still allows soft-skip recovery path",
  EA_CHECKOUT_CONFIRMATION_TIMEOUT_NOTICE.includes(
    "continue to the dashboard"
  ) &&
    EA_CHECKOUT_CONFIRMATION_TIMEOUT_NOTICE.includes(
      "Account → Subscription"
    )
);

check(
  "polling interval and timeout unchanged (4s / 30s)",
  billingPage.includes("POLL_INTERVAL_MS = 4000") &&
    billingPage.includes("POLL_TIMEOUT_MS = 30000")
);

check(
  "Checkout success still uses isCheckoutReturnConfirmed",
  billingPage.includes("isCheckoutReturnConfirmed") &&
    billingPage.includes('billing === "success"')
);

check(
  "cancelled Checkout still returns to offer (soft-skip available)",
  billingPage.includes('billing === "cancelled"') &&
    billingPage.includes('setView("offer")') &&
    billingPage.includes("No subscription was created")
);

check(
  "Account still hides subscribe while confirming completed checkout",
  accountSection.includes("confirmingCompletedCheckout") &&
    accountSection.includes("isConfirmingCheckout")
);

if (failed > 0) {
  console.error(`\n${failed} Batch 12 check(s) failed`);
  process.exit(1);
}

console.log(
  "\nAll Batch 12 EA soft-skip / Checkout confirmation checks passed."
);
