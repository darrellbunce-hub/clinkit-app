/**
 * Batch 8 static checks: Start Move session recovery, purchase-only path,
 * Join Chain validation/recovery, and empty dashboard CTAs.
 *
 *   npx tsx scripts/verify-homeowner-journey-discoverability-batch8.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  mapJoinChainFailureMessage,
  validateJoinChainInputs,
} from "../lib/onboarding/joinChainErrors";
import {
  nextStartMoveStep,
  resolveStartMovePlan,
  type StartMoveAnswers,
} from "../lib/onboarding/startMoveJourney";
import { EMPTY_START_MOVE_ANSWERS } from "../lib/onboarding/startMoveJourney";

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

function answers(partial: Partial<StartMoveAnswers>): StartMoveAnswers {
  return { ...EMPTY_START_MOVE_ANSWERS, ...partial };
}

const startMove = read("app/start-move/page.tsx");
const joinChain = read("app/join-chain/page.tsx");
const dashboard = read("app/dashboard/page.tsx");
const journey = read("lib/onboarding/startMoveJourney.ts");

// HO-07
check(
  "Start Move redirects missing session to login with next=/start-move",
  startMove.includes('next: "/start-move"') &&
    startMove.includes("buildHomeownerLoginHref") &&
    !/if \(!user\) \{\s*return;\s*\}/.test(startMove)
);

// HO-08
check(
  "Sale not agreed continues to buying step",
  nextStartMoveStep(
    "saleAgreed",
    answers({ selling: "yes", saleAgreed: "no" })
  ) === "buying"
);

check(
  "Sale not agreed + accepted purchase is purchase-only move",
  (() => {
    const plan = resolveStartMovePlan(
      answers({
        selling: "yes",
        saleAgreed: "no",
        buying: "yes",
        offerAccepted: "yes",
      })
    );
    return (
      plan.kind === "move" &&
      plan.flags.notSelling === true &&
      plan.flags.notBuying === false &&
      plan.flags.searchingForProperty === false
    );
  })()
);

check(
  "Journey no longer hard-stops on saleAgreed=no alone",
  !journey.includes('if (answers.saleAgreed === "no")') &&
    journey.includes("isPreparingSaleNotYetAgreed")
);

// HO-09 / HO-12
check(
  "Join Chain uses inline errors instead of alert()",
  !joinChain.includes("alert(") &&
    joinChain.includes("setErrorMessage") &&
    joinChain.includes("showPartialSuccess")
);

check(
  "Join Chain validates required inputs client-side",
  validateJoinChainInputs({
    accessCode: "",
    address: "",
    postcode: "",
  }) != null &&
    validateJoinChainInputs({
      accessCode: "ABC",
      address: "1 High Street",
      postcode: "AA1 1AA",
    }) == null &&
    joinChain.includes("validateJoinChainInputs")
);

check(
  "Join Chain maps match failures without inventing claimed/role oracles",
  mapJoinChainFailureMessage("join_details_not_matched").includes(
    "access code"
  ) &&
    mapJoinChainFailureMessage("email_verification_required").includes(
      "Verify your email"
    ) &&
    !mapJoinChainFailureMessage("join_details_not_matched")
      .toLowerCase()
      .includes("already claimed")
);

check(
  "Join Chain partial success offers dashboard and chain routes",
  joinChain.includes("Go to dashboard") &&
    joinChain.includes("View chain") &&
    joinChain.includes("joinChainViewHref") &&
    joinChain.includes("do not retry the join")
);

check(
  "Join Chain disables submit while joining and blocks repeats",
  joinChain.includes("disabled={isJoining}") &&
    joinChain.includes("joinInProgress.current || partialSuccess")
);

// HO-10
check(
  "Empty dashboard has Start a move and Join a chain CTAs",
  dashboard.includes('href="/start-move"') &&
    dashboard.includes('href="/join-chain"') &&
    dashboard.includes("Start a move") &&
    dashboard.includes("Join a chain")
);

check(
  "Recommended Next Steps only render when chains exist",
  /hasChains \? \([\s\S]*Recommended Next Steps/.test(dashboard) ||
    (/!hasChains \? \([\s\S]*No Active Moves Yet[\s\S]*\) : \([\s\S]*Recommended Next Steps/.test(
      dashboard
    ) &&
      dashboard.includes("const hasChains = chains.length > 0"))
);

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}

console.log("\nAll Batch 8 homeowner journey discoverability checks passed.");
