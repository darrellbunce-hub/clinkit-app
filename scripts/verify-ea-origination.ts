import {
  DEFAULT_SELLER_ONWARD_PLAN,
  requiresOnwardPurchaseAddress,
  saleAwaitingBuyerForOnwardPlan,
} from "../lib/estateAgent/sellerOnwardPlan";

let passed = 0;
let failed = 0;

function assert(name: string, condition: boolean) {
  if (condition) {
    console.log(`PASS ${name}`);
    passed += 1;
    return;
  }

  console.error(`FAIL ${name}`);
  failed += 1;
}

assert(
  "default onward plan is searching",
  DEFAULT_SELLER_ONWARD_PLAN === "searching"
);

assert(
  "searching does not require onward address",
  !requiresOnwardPurchaseAddress("searching")
);

assert(
  "purchase agreed requires onward address",
  requiresOnwardPurchaseAddress("purchase_agreed")
);

assert(
  "no onward sets awaiting buyer on sale",
  saleAwaitingBuyerForOnwardPlan("no_onward")
);

assert(
  "searching does not set awaiting buyer on sale",
  !saleAwaitingBuyerForOnwardPlan("searching")
);

assert(
  "purchase agreed does not set awaiting buyer on sale",
  !saleAwaitingBuyerForOnwardPlan("purchase_agreed")
);

console.log(
  `\n${passed}/${passed + failed} EA origination checks passed.`
);

if (failed > 0) {
  process.exit(1);
}
