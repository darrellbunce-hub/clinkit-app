/**
 * Guided Start Move: answers → existing flags, required addresses and the
 * Join Chain address hand-over. Pure and static; no database, network or
 * address-provider calls.
 * Run: npx tsx scripts/verify-start-move-guided-answers.ts
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import {
  EMPTY_START_MOVE_ANSWERS,
  findMissingStartMoveAddress,
  nextStartMoveStep,
  resolveStartMovePlan,
  selectStartMoveAddresses,
  type StartMoveAnswers,
  type StartMoveStep,
} from "../lib/onboarding/startMoveJourney";
import {
  clearJoinAddressHandoff,
  isJoinAddressHandoffUsable,
  JOIN_ADDRESS_HANDOFF_TTL_MS,
  peekJoinAddressHandoff,
  setJoinAddressHandoff,
} from "../lib/onboarding/joinAddressHandoff";
import { buildJoinExistingChainHref } from "../lib/onboarding/joinChainIntent";
import {
  classifyOnwardPurchaseConversion,
  onwardPurchaseOutcomeMessage,
  planCarriedOnwardPurchase,
  shouldAddCarriedOnwardPurchase,
  type OnwardPurchaseConversionResult,
  type OnwardPurchaseOutcome,
} from "../lib/onboarding/joinOnwardPurchase";

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

function answers(partial: Partial<StartMoveAnswers>): StartMoveAnswers {
  return { ...EMPTY_START_MOVE_ANSWERS, ...partial };
}

const SALE = { address: "1 Sale Street", postcode: "AA1 1AA" };
const PURCHASE = { address: "2 Purchase Road", postcode: "BB2 2BB" };
const ENTERED = { selling: SALE, buying: PURCHASE };

// ---------------------------------------------------------------------------
// 1. Required outcomes
// ---------------------------------------------------------------------------

type Expected =
  | { stop: "sale_not_agreed" | "nothing_to_add" | "no_offer_accepted" }
  | {
      notSelling: boolean;
      notBuying: boolean;
      searchingForProperty: boolean;
      sale: boolean;
      purchase: boolean;
    };

const OUTCOMES: { name: string; answers: StartMoveAnswers; expected: Expected }[] = [
  {
    name: "Sale not agreed → stop",
    answers: answers({ selling: "yes", saleAgreed: "no" }),
    expected: { stop: "sale_not_agreed" },
  },
  {
    name: "Not selling, not buying → stop",
    answers: answers({ selling: "no", buying: "no" }),
    expected: { stop: "nothing_to_add" },
  },
  {
    name: "Not selling, buying, no offer accepted → stop",
    answers: answers({ selling: "no", buying: "yes", offerAccepted: "no" }),
    expected: { stop: "no_offer_accepted" },
  },
  {
    name: "Not selling, buying, offer accepted → purchase + linked Buyer Ready",
    answers: answers({ selling: "no", buying: "yes", offerAccepted: "yes" }),
    expected: {
      notSelling: true,
      notBuying: false,
      searchingForProperty: false,
      sale: false,
      purchase: true,
    },
  },
  {
    name: "Sale agreed, buying, offer accepted → sale + purchase",
    answers: answers({
      selling: "yes",
      saleAgreed: "yes",
      buying: "yes",
      offerAccepted: "yes",
    }),
    expected: {
      notSelling: false,
      notBuying: false,
      searchingForProperty: false,
      sale: true,
      purchase: true,
    },
  },
  {
    name: "Sale agreed, buying, no offer accepted → sale + Searching",
    answers: answers({
      selling: "yes",
      saleAgreed: "yes",
      buying: "yes",
      offerAccepted: "no",
    }),
    expected: {
      notSelling: false,
      notBuying: false,
      searchingForProperty: true,
      sale: true,
      purchase: false,
    },
  },
  {
    name: "Sale agreed, not buying → sale only",
    answers: answers({ selling: "yes", saleAgreed: "yes", buying: "no" }),
    expected: {
      notSelling: false,
      notBuying: true,
      searchingForProperty: false,
      sale: true,
      purchase: false,
    },
  },
];

for (const outcome of OUTCOMES) {
  const plan = resolveStartMovePlan(outcome.answers);

  if ("stop" in outcome.expected) {
    assert(
      outcome.name,
      plan.kind === "stop" && plan.reason === outcome.expected.stop
    );
    continue;
  }

  const expected = outcome.expected;
  const selected =
    plan.kind === "move" ? selectStartMoveAddresses(plan.flags, ENTERED) : null;

  assert(
    outcome.name,
    plan.kind === "move" &&
      plan.flags.notSelling === expected.notSelling &&
      plan.flags.notBuying === expected.notBuying &&
      plan.flags.searchingForProperty === expected.searchingForProperty &&
      selected != null &&
      (selected.selling != null) === expected.sale &&
      (selected.buying != null) === expected.purchase
  );
}

assert(
  "No answers yet → incomplete (nothing can be submitted)",
  resolveStartMovePlan(EMPTY_START_MOVE_ANSWERS).kind === "incomplete"
);
assert(
  "Selling without the agreed-sale answer → incomplete",
  resolveStartMovePlan(answers({ selling: "yes" })).kind === "incomplete"
);
assert(
  "Buying without the offer answer → incomplete",
  resolveStartMovePlan(
    answers({ selling: "yes", saleAgreed: "yes", buying: "yes" })
  ).kind === "incomplete"
);

// ---------------------------------------------------------------------------
// 2. Hidden or backed-out addresses are never selected
// ---------------------------------------------------------------------------

{
  const plan = resolveStartMovePlan(
    answers({
      selling: "yes",
      saleAgreed: "yes",
      buying: "yes",
      offerAccepted: "no",
    })
  );
  const selected =
    plan.kind === "move" ? selectStartMoveAddresses(plan.flags, ENTERED) : null;
  assert(
    "Back + Searching: a previously entered purchase address is not submitted",
    selected?.buying === null && selected?.selling === SALE
  );
}

{
  const plan = resolveStartMovePlan(
    answers({ selling: "yes", saleAgreed: "yes", buying: "no", offerAccepted: "yes" })
  );
  const selected =
    plan.kind === "move" ? selectStartMoveAddresses(plan.flags, ENTERED) : null;
  assert(
    "Back + not buying: a stale offer answer and purchase address are ignored",
    plan.kind === "move" &&
      plan.flags.notBuying &&
      selected?.buying === null
  );
}

{
  const plan = resolveStartMovePlan(
    answers({ selling: "no", saleAgreed: "yes", buying: "yes", offerAccepted: "yes" })
  );
  const selected =
    plan.kind === "move" ? selectStartMoveAddresses(plan.flags, ENTERED) : null;
  assert(
    "Back + not selling: a previously entered sale address is not submitted",
    selected?.selling === null && selected?.buying === PURCHASE
  );
}

{
  const plan = resolveStartMovePlan(
    answers({ selling: "yes", saleAgreed: "yes", buying: "yes", offerAccepted: "yes" })
  );
  const flags = plan.kind === "move" ? plan.flags : null;
  const empty = { address: "", postcode: "" };
  assert(
    "Missing required sale address is detected before any write",
    flags != null &&
      findMissingStartMoveAddress(
        flags,
        selectStartMoveAddresses(flags, { selling: empty, buying: PURCHASE })
      ) === "sale"
  );
  assert(
    "Missing required purchase postcode is detected before any write",
    flags != null &&
      findMissingStartMoveAddress(
        flags,
        selectStartMoveAddresses(flags, {
          selling: SALE,
          buying: { address: PURCHASE.address, postcode: " " },
        })
      ) === "purchase"
  );
  assert(
    "Complete required addresses pass",
    flags != null &&
      findMissingStartMoveAddress(
        flags,
        selectStartMoveAddresses(flags, ENTERED)
      ) === null
  );
}

// ---------------------------------------------------------------------------
// 3. Step sequence (one question at a time)
// ---------------------------------------------------------------------------

function walk(final: StartMoveAnswers, order: StartMoveStep[]): StartMoveStep[] {
  const steps: StartMoveStep[] = ["selling"];
  let current: StartMoveStep = "selling";
  for (let i = 0; i < 8; i += 1) {
    const next = nextStartMoveStep(current, final);
    if (next === current) break;
    steps.push(next);
    current = next;
    if (next === "review" || next.startsWith("stop_")) break;
  }
  return steps.length === order.length &&
    steps.every((step, index) => step === order[index])
    ? steps
    : [];
}

assert(
  "Steps: agreed sale + accepted offer",
  walk(
    answers({ selling: "yes", saleAgreed: "yes", buying: "yes", offerAccepted: "yes" }),
    ["selling", "saleAgreed", "saleAddress", "buying", "offerAccepted", "purchaseAddress", "review"]
  ).length > 0
);
assert(
  "Steps: sale not agreed stops before any address",
  walk(answers({ selling: "yes", saleAgreed: "no" }), [
    "selling",
    "saleAgreed",
    "stop_sale_not_agreed",
  ]).length > 0
);
assert(
  "Steps: not selling + not buying stops",
  walk(answers({ selling: "no", buying: "no" }), [
    "selling",
    "buying",
    "stop_nothing_to_add",
  ]).length > 0
);
assert(
  "Steps: not selling + no accepted offer stops",
  walk(answers({ selling: "no", buying: "yes", offerAccepted: "no" }), [
    "selling",
    "buying",
    "offerAccepted",
    "stop_no_offer_accepted",
  ]).length > 0
);
assert(
  "Steps: agreed sale + Searching goes to review without a purchase address",
  walk(
    answers({ selling: "yes", saleAgreed: "yes", buying: "yes", offerAccepted: "no" }),
    ["selling", "saleAgreed", "saleAddress", "buying", "offerAccepted", "review"]
  ).length > 0
);

// ---------------------------------------------------------------------------
// 4. Join Chain address hand-over (in memory, user-scoped, time-limited)
// ---------------------------------------------------------------------------

{
  const now = 1_000_000;
  clearJoinAddressHandoff();
  setJoinAddressHandoff({ userId: "user-a", ...PURCHASE }, now);
  const held = peekJoinAddressHandoff(now + 1);
  assert(
    "Hand-over: held for the user who set it",
    isJoinAddressHandoffUsable(held, "user-a", now + 1) &&
      held?.address === PURCHASE.address &&
      held?.postcode === PURCHASE.postcode
  );
  assert(
    "Hand-over: not usable by another user",
    !isJoinAddressHandoffUsable(held, "user-b", now + 1)
  );
  assert(
    "Hand-over: not usable when signed out",
    !isJoinAddressHandoffUsable(held, null, now + 1)
  );
  assert(
    "Hand-over: expires after the time limit",
    peekJoinAddressHandoff(now + JOIN_ADDRESS_HANDOFF_TTL_MS) === null
  );

  setJoinAddressHandoff({ userId: "user-a", ...PURCHASE }, now);
  clearJoinAddressHandoff();
  assert("Hand-over: clear removes it", peekJoinAddressHandoff(now + 1) === null);

  setJoinAddressHandoff({ userId: "user-a", address: "", postcode: "" }, now);
  assert(
    "Hand-over: an empty address is not held",
    peekJoinAddressHandoff(now + 1) === null
  );
}

{
  const now = 2_000_000;
  clearJoinAddressHandoff();
  setJoinAddressHandoff(
    { userId: "user-a", ...SALE, onwardPurchase: PURCHASE },
    now
  );
  const held = peekJoinAddressHandoff(now + 1);
  assert(
    "Hand-over: carries the accepted onward purchase with the sale address",
    held?.address === SALE.address &&
      held?.onwardPurchase?.address === PURCHASE.address &&
      held?.onwardPurchase?.postcode === PURCHASE.postcode
  );
  assert(
    "Hand-over: onward purchase is user-scoped with the rest of the hand-over",
    !isJoinAddressHandoffUsable(held, "user-b", now + 1)
  );
  assert(
    "Hand-over: onward purchase expires with the hand-over",
    peekJoinAddressHandoff(now + JOIN_ADDRESS_HANDOFF_TTL_MS) === null
  );

  setJoinAddressHandoff(
    {
      userId: "user-a",
      ...SALE,
      onwardPurchase: { address: PURCHASE.address, postcode: "" },
    },
    now
  );
  assert(
    "Hand-over: an incomplete onward purchase is not carried",
    peekJoinAddressHandoff(now + 1)?.onwardPurchase === null
  );

  setJoinAddressHandoff({ userId: "user-a", ...SALE }, now);
  assert(
    "Hand-over: no onward purchase unless one is given",
    peekJoinAddressHandoff(now + 1)?.onwardPurchase === null
  );
  clearJoinAddressHandoff();
}

assert(
  "Onward purchase plan: no onward link yet → Searching step, then convert",
  planCarriedOnwardPurchase({
    joiningRole: "seller",
    hasCarriedOnwardPurchase: true,
    joinedPropertyLinkedId: null,
  }) === "searching_then_convert"
);
assert(
  "Onward purchase plan: existing onward link → convert it directly (no new Searching step)",
  planCarriedOnwardPurchase({
    joiningRole: "seller",
    hasCarriedOnwardPurchase: true,
    joinedPropertyLinkedId: 77,
  }) === "convert_existing_link"
);
assert(
  "Onward purchase plan: buyer-side join or nothing carried → ordinary join",
  planCarriedOnwardPurchase({
    joiningRole: "buyer",
    hasCarriedOnwardPurchase: true,
    joinedPropertyLinkedId: null,
  }) === "none" &&
    planCarriedOnwardPurchase({
      joiningRole: "seller",
      hasCarriedOnwardPurchase: false,
      joinedPropertyLinkedId: 77,
    }) === "none"
);
assert(
  "Onward purchase: converted for an existing link, or once the Searching step linked a placeholder",
  shouldAddCarriedOnwardPurchase({
    plan: "convert_existing_link",
    searchingPlaceholderLinked: false,
  }) &&
    shouldAddCarriedOnwardPurchase({
      plan: "searching_then_convert",
      searchingPlaceholderLinked: true,
    })
);
assert(
  "Onward purchase: not attempted without a linked Searching placeholder, or for the ordinary join",
  !shouldAddCarriedOnwardPurchase({
    plan: "searching_then_convert",
    searchingPlaceholderLinked: false,
  }) &&
    !shouldAddCarriedOnwardPurchase({
      plan: "none",
      searchingPlaceholderLinked: true,
    })
);
{
  const rpcFailure = (
    reason: string,
    error: string
  ): OnwardPurchaseConversionResult => ({
    ok: false,
    reason,
    error: { applicationPayload: { ok: false, error } },
  });
  const transportFailure = (
    reason: string,
    code: string | null
  ): OnwardPurchaseConversionResult => ({
    ok: false,
    reason,
    error: { transportError: { code, message: "x" }, applicationPayload: null },
  });
  const cases: [string, OnwardPurchaseConversionResult | null, OnwardPurchaseOutcome][] = [
    ["converted", { ok: true }, "added"],
    ["duplicate address", rpcFailure("duplicate_address", "duplicate_address"), "duplicate_address"],
    ["reserved address (23505)", transportFailure("duplicate_address", "23505"), "duplicate_address"],
    ["already converted / full purchase", rpcFailure("update_failed", "not_searching_placeholder"), "already_linked"],
    ["not authorised", rpcFailure("not_authorized", "not_authorized"), "support"],
    ["placeholder owner mismatch", rpcFailure("update_failed", "placeholder_owner_mismatch"), "support"],
    ["grant failure", rpcFailure("update_failed", "address_reserved"), "support"],
    ["session expired", rpcFailure("update_failed", "not_authenticated"), "retry"],
    ["server-side error with a code", transportFailure("update_failed", "57014"), "retry"],
    ["network failure (no code)", transportFailure("update_failed", ""), "uncertain"],
    ["gateway error (null code)", transportFailure("update_failed", null), "uncertain"],
    ["guarded update matched no row", rpcFailure("update_failed", "update_failed"), "uncertain"],
    ["empty response", { ok: false, reason: "update_failed", error: { applicationPayload: null } }, "uncertain"],
    ["exception", null, "uncertain"],
  ];

  for (const [label, result, expected] of cases) {
    const actual = classifyOnwardPurchaseConversion(result);
    assert(
      `Onward purchase outcome: ${label} → ${expected}${actual === expected ? "" : ` (got ${actual})`}`,
      actual === expected
    );
  }
}
{
  const message = (outcome: OnwardPurchaseOutcome) =>
    onwardPurchaseOutcomeMessage(outcome) ?? "";
  const failures: OnwardPurchaseOutcome[] = [
    "already_linked",
    "duplicate_address",
    "retry",
    "support",
    "uncertain",
  ];

  assert(
    "Onward purchase messages: none when added; otherwise confirm the join",
    onwardPurchaseOutcomeMessage("added") === null &&
      failures.every((outcome) =>
        message(outcome).startsWith("You have joined the chain")
      )
  );
  assert(
    "Onward purchase messages: duplicate points to Help (no promise to connect it)",
    message("duplicate_address").includes("see Help & FAQs") &&
      !/support/i.test(message("duplicate_address")) &&
      !/so it can be connected/.test(message("duplicate_address"))
  );
  assert(
    "Onward purchase messages: unfixable failures point to the chain and Help, not a retry or a support channel",
    message("support").includes("Open your chain") &&
      message("support").includes("see Help & FAQs") &&
      !/support/i.test(message("support")) &&
      !message("support").includes("Add Onward Purchase") &&
      !message("support").includes("try again")
  );
  assert(
    "Onward purchase messages: an existing or already-converted purchase is not called Searching",
    !message("already_linked").includes("Searching") &&
      message("already_linked").includes("Open your chain")
  );
  assert(
    "Onward purchase messages: an uncertain outcome asks to check the chain, without claiming failure",
    message("uncertain").includes("could not confirm whether") &&
      message("uncertain").includes("check before trying again") &&
      !message("uncertain").includes("could not add")
  );
  assert(
    "Onward purchase messages: a retryable failure points to Add Onward Purchase",
    message("retry").includes("Add Onward Purchase")
  );
}

for (const params of [
  { sourceChainId: null, searching: false, notSelling: true },
  { sourceChainId: 42, searching: true, notSelling: false },
  { sourceChainId: null, searching: false, notSelling: false },
]) {
  const href = buildJoinExistingChainHref(params);
  assert(
    `Join href carries no address or postcode (${href})`,
    !/address|postcode/i.test(href)
  );
}

// ---------------------------------------------------------------------------
// 5. Source wiring
// ---------------------------------------------------------------------------

const root = path.resolve(__dirname, "..");
const read = (relative: string) =>
  readFileSync(path.join(root, relative), "utf8").replace(/\r\n/g, "\n");

const startMove = read("app/start-move/page.tsx");
const joinChain = read("app/join-chain/page.tsx");
const lookup = read("components/address/PropertyAddressLookup.tsx");
const handoff = read("lib/onboarding/joinAddressHandoff.ts");

assert(
  "Start Move: checkboxes replaced by guided answers",
  !startMove.includes('type="checkbox"') &&
    startMove.includes("resolveStartMovePlan(answers)") &&
    startMove.includes("selectStartMoveAddresses(moveFlags")
);
assert(
  "Start Move: answers and required addresses are checked before any write",
  /if \(!moveFlags\) \{[\s\S]*?return;[\s\S]*?findMissingStartMoveAddress\(moveFlags, selectedAddresses\)[\s\S]*?return;[\s\S]*?setIsSubmitting\(true\)/.test(
    startMove
  ) &&
    startMove.indexOf("findMissingStartMoveAddress(moveFlags") <
      startMove.indexOf("createChainForOnboarding(")
);
{
  const createPayloads = [
    ...startMove.matchAll(/await createStartMoveProperty\(supabase, \{([\s\S]*?)\}\)/g),
  ].map((match) => match[1]);
  assert(
    "Start Move: sale and purchase writes use only the selected addresses",
    startMove.includes("if (selling) {") &&
      startMove.includes("if (buying) {") &&
      !/\.from\("properties"\)\s*\.insert\(/.test(startMove) &&
      createPayloads.length === 2 &&
      /address: selling\.address,/.test(createPayloads[0]) &&
      /address: buying\.address,/.test(createPayloads[1]) &&
      startMove.includes("p_address: selling.address") &&
      startMove.includes("p_address: buying.address") &&
      !/p_address: (sellingAddress|buyingAddress)/.test(startMove)
  );
}
assert(
  "Start Move: Join Chain redirects use client navigation (in-memory hand-over survives)",
  startMove.includes("router.push(") &&
    startMove.includes("setJoinAddressHandoff(options.carried)") &&
    !/window\.location\.href = buildJoinExistingChainHref/.test(startMove)
);
{
  const buyerReadyStart = startMove.indexOf('.from("chain_nodes")');
  const buyerReadyBlock = startMove.slice(
    buyerReadyStart,
    startMove.indexOf("redirected = true;\n        window.location.href", buyerReadyStart)
  );
  assert(
    "Start Move: Buyer Ready only with a purchase, result checked, no cleanup on failure",
    startMove.includes("if (notSelling && buyerReadyPropertyId != null) {") &&
      buyerReadyStart > -1 &&
      buyerReadyBlock.includes("if (buyerReadyError) {") &&
      buyerReadyBlock.includes('setRecovery({ chainId, reason: "buyer_ready_not_added" })') &&
      !buyerReadyBlock.includes("fail(") &&
      !buyerReadyBlock.includes("cleanupOnboardingChain(")
  );
}
assert(
  "Join Chain: carried address is read once, shown read-only with Change address",
  joinChain.includes("useState(() => peekJoinAddressHandoff())") &&
    joinChain.includes("Change address") &&
    joinChain.includes("isJoinAddressHandoffUsable(carriedAddress, user.id)")
);
assert(
  "Join Chain: hand-over cleared after a successful join and on leaving the page",
  /if \(!joinResult\?\.ok\) \{[\s\S]*?return;\s*\}\s*clearJoinAddressHandoff\(\);/.test(
    joinChain
  ) && /return \(\) => \{\s*clearJoinAddressHandoff\(\);\s*\};/.test(joinChain)
);
assert(
  "Start Move: awaiting seller with an accepted purchase carries it and uses the matching dialog",
  /const onwardPurchase = buyingSelection\s*\?/.test(startMove) &&
    /onwardPurchase\s*\?\s*"awaiting_seller_with_purchase"\s*:\s*"awaiting_seller"/.test(
      startMove
    ) &&
    /notSelling: false,\s*carried: \{[\s\S]*?onwardPurchase,\s*\}/.test(startMove)
);
assert(
  "Start Move: a sale that fails validation also carries the accepted purchase",
  /address: selling\.address,\s*postcode: sellingPostcodeStored,\s*onwardPurchase: buying/.test(
    startMove
  )
);
assert(
  "Start Move: carrying a purchase sets the existing Searching intent (refresh fallback)",
  /searching:\s*moveFlags\?\.searchingForProperty === true \|\|\s*options\.carried\?\.onwardPurchase != null/.test(
    startMove
  )
);
{
  const joinCall = joinChain.indexOf('supabase.rpc("join_chain_property"');
  const intent = joinChain.indexOf("resolveSearchingFromJoinIntent(");
  const convert = joinChain.indexOf("await convertSearchingPlaceholder(supabase, {");
  const cleanup = joinChain.indexOf('"cleanup_abandoned_onboarding_chain"');
  const convertBlock = joinChain.slice(convert, cleanup);
  assert(
    "Join Chain: onward purchase converted only after the join and Searching step, before source cleanup",
    joinCall > -1 &&
      intent > joinCall &&
      convert > intent &&
      cleanup > convert &&
      joinChain.includes("carriedAddress?.onwardPurchase ?? null") &&
      /salePropertyId: property\.id,\s*address: carriedOnwardPurchase\.address,\s*postcode: carriedOnwardPurchase\.postcode/.test(
        joinChain
      )
  );
  assert(
    "Join Chain: a failed onward conversion keeps the join (no return, no cleanup, no address logged)",
    !/\breturn;/.test(convertBlock) &&
      !convertBlock.includes("cleanup_abandoned_onboarding_chain") &&
      /console\.error\(\s*"\[join-chain\] onward purchase not added:",\s*onwardPurchaseOutcome\s*\)/.test(
        convertBlock
      ) &&
      convertBlock.includes("classifyOnwardPurchaseConversion(convertResult)") &&
      convertBlock.includes("alert(onwardPurchaseMessage)")
  );

  const plan = joinChain.indexOf("planCarriedOnwardPurchase({");
  assert(
    "Join Chain: an existing onward link is checked before any Searching step and skips it",
    plan > joinCall &&
      plan < intent &&
      /joinedPropertyLinkedId: property\.linked_property_id,/.test(joinChain) &&
      /searchingIntent:\s*searchingIntent &&\s*onwardPurchasePlan !== "convert_existing_link",/.test(
        joinChain
      ) &&
      /shouldAddCarriedOnwardPurchase\(\{\s*plan: onwardPurchasePlan,/.test(joinChain)
  );
}
assert(
  "Join Chain: one submission at a time; the guard resets unless the page is leaving",
  /if \(joinInProgress\.current\) \{\s*return;\s*\}\s*joinInProgress\.current = true;\s*setIsJoining\(true\);/.test(
    joinChain
  ) &&
    /finally \{\s*if \(!leavingAfterJoin\.current\) \{\s*joinInProgress\.current = false;\s*setIsJoining\(false\);/.test(
      joinChain
    ) &&
    /leavingAfterJoin\.current = true;\s*window\.location\.href =/.test(joinChain) &&
    joinChain.includes("disabled={isJoining}")
);
assert(
  "Join Chain: Change address clears the hand-over and keeps the Searching note visible",
  /function handleChangeAddress\(\) \{\s*if \(carriedAddress\?\.onwardPurchase\) \{\s*setOnwardPurchaseRemoved\(true\);\s*\}\s*discardCarriedAddress\(\);/.test(
    joinChain
  ) &&
    joinChain.includes("onClick={handleChangeAddress}") &&
    /\{onwardPurchaseRemoved \? \(\s*<p[^>]*>\s*After you join, your next home will show as\s+Searching\./.test(
      joinChain
    )
);
assert(
  "Hand-over module: no storage, cookies, URLs or logging",
  !/localStorage|sessionStorage|document\.cookie|console\.|URLSearchParams/.test(
    handoff
  )
);
assert(
  "Address lookup: a held selection is shown after remount (no provider call)",
  lookup.includes("const heldSelection = address && postcode ? address : null;") &&
    lookup.includes("useState(heldSelection ?? \"\")") &&
    /useState<string \| null>\(\s*heldSelection\s*\)/.test(lookup)
);

console.log(
  `\n${passed}/${passed + failed} guided Start Move checks passed.`
);

if (failed > 0) {
  process.exit(1);
}
