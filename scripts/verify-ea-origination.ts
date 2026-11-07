import {
  requiresOnwardPurchaseAddress,
  resolveSellerOnwardPlan,
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
  "no default onward plan: unanswered resolves to nothing",
  resolveSellerOnwardPlan({ buying: null, offerAccepted: null }) === null
);

assert(
  "buying without an offer answer resolves to nothing",
  resolveSellerOnwardPlan({ buying: "yes", offerAccepted: null }) === null
);

assert(
  "not buying resolves to no onward purchase",
  resolveSellerOnwardPlan({ buying: "no", offerAccepted: "yes" }) ===
    "no_onward"
);

assert(
  "buying with an accepted offer resolves to purchase agreed",
  resolveSellerOnwardPlan({ buying: "yes", offerAccepted: "yes" }) ===
    "purchase_agreed"
);

assert(
  "buying without an accepted offer resolves to searching",
  resolveSellerOnwardPlan({ buying: "yes", offerAccepted: "no" }) ===
    "searching"
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
