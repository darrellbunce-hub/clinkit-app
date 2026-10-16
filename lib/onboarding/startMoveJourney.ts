/**
 * Start Move guided questions → the existing onboarding flags.
 *
 * Answers decide which addresses are required and which existing operations
 * run. Nothing is created unless the answers describe an agreed sale and/or an
 * accepted purchase offer; a hope to move in future creates nothing.
 */

export type YesNo = "yes" | "no";

export type StartMoveAnswers = {
  selling: YesNo | null;
  saleAgreed: YesNo | null;
  buying: YesNo | null;
  offerAccepted: YesNo | null;
};

export type StartMoveQuestion = keyof StartMoveAnswers;

export type StartMoveStopReason =
  | "sale_not_agreed"
  | "nothing_to_add"
  | "no_offer_accepted";

export type StartMoveStep =
  | StartMoveQuestion
  | "saleAddress"
  | "purchaseAddress"
  | "review"
  | `stop_${StartMoveStopReason}`;

/** The flags Start Move has always used; only their source changes. */
export type StartMoveFlags = {
  notSelling: boolean;
  notBuying: boolean;
  searchingForProperty: boolean;
};

export type StartMovePlan =
  | { kind: "incomplete" }
  | { kind: "stop"; reason: StartMoveStopReason }
  | { kind: "move"; flags: StartMoveFlags };

export type StartMoveAddressInput = {
  address: string;
  postcode: string;
};

export type StartMoveSelectedAddresses = {
  selling: StartMoveAddressInput | null;
  buying: StartMoveAddressInput | null;
};

export const EMPTY_START_MOVE_ANSWERS: StartMoveAnswers = {
  selling: null,
  saleAgreed: null,
  buying: null,
  offerAccepted: null,
};

export const START_MOVE_FIRST_STEP: StartMoveStep = "selling";

function hasAgreedSale(answers: StartMoveAnswers): boolean {
  return answers.selling === "yes" && answers.saleAgreed === "yes";
}

/** Only answers on the path actually taken are read; stale ones are ignored. */
export function resolveStartMovePlan(
  answers: StartMoveAnswers
): StartMovePlan {
  if (answers.selling == null) return { kind: "incomplete" };

  if (answers.selling === "yes") {
    if (answers.saleAgreed == null) return { kind: "incomplete" };
    if (answers.saleAgreed === "no") {
      return { kind: "stop", reason: "sale_not_agreed" };
    }
  }

  const sale = hasAgreedSale(answers);

  if (answers.buying == null) return { kind: "incomplete" };

  if (answers.buying === "no") {
    return sale
      ? {
          kind: "move",
          flags: {
            notSelling: false,
            notBuying: true,
            searchingForProperty: false,
          },
        }
      : { kind: "stop", reason: "nothing_to_add" };
  }

  if (answers.offerAccepted == null) return { kind: "incomplete" };

  if (answers.offerAccepted === "yes") {
    return {
      kind: "move",
      flags: {
        notSelling: !sale,
        notBuying: false,
        searchingForProperty: false,
      },
    };
  }

  return sale
    ? {
        kind: "move",
        flags: {
          notSelling: false,
          notBuying: false,
          searchingForProperty: true,
        },
      }
    : { kind: "stop", reason: "no_offer_accepted" };
}

/** The step shown after answering or completing `step`. */
export function nextStartMoveStep(
  step: StartMoveStep,
  answers: StartMoveAnswers
): StartMoveStep {
  switch (step) {
    case "selling":
      return answers.selling === "yes" ? "saleAgreed" : "buying";
    case "saleAgreed":
      return answers.saleAgreed === "yes"
        ? "saleAddress"
        : "stop_sale_not_agreed";
    case "saleAddress":
      return "buying";
    case "buying":
      if (answers.buying === "yes") return "offerAccepted";
      return hasAgreedSale(answers) ? "review" : "stop_nothing_to_add";
    case "offerAccepted":
      if (answers.offerAccepted === "yes") return "purchaseAddress";
      return hasAgreedSale(answers) ? "review" : "stop_no_offer_accepted";
    case "purchaseAddress":
      return "review";
    default:
      return step;
  }
}

export function requiresStartMoveSaleAddress(flags: StartMoveFlags): boolean {
  return !flags.notSelling;
}

export function requiresStartMovePurchaseAddress(
  flags: StartMoveFlags
): boolean {
  return !flags.notBuying && !flags.searchingForProperty;
}

/**
 * Only the addresses the final answers require are returned; anything entered
 * on a path the user backed out of is never submitted.
 */
export function selectStartMoveAddresses(
  flags: StartMoveFlags,
  entered: {
    selling: StartMoveAddressInput;
    buying: StartMoveAddressInput;
  }
): StartMoveSelectedAddresses {
  return {
    selling: requiresStartMoveSaleAddress(flags) ? entered.selling : null,
    buying: requiresStartMovePurchaseAddress(flags) ? entered.buying : null,
  };
}

export function isStartMoveAddressComplete(
  value: StartMoveAddressInput
): boolean {
  return value.address.trim() !== "" && value.postcode.trim() !== "";
}

export function findMissingStartMoveAddress(
  flags: StartMoveFlags,
  selected: StartMoveSelectedAddresses
): "sale" | "purchase" | null {
  if (
    requiresStartMoveSaleAddress(flags) &&
    (!selected.selling || !isStartMoveAddressComplete(selected.selling))
  ) {
    return "sale";
  }

  if (
    requiresStartMovePurchaseAddress(flags) &&
    (!selected.buying || !isStartMoveAddressComplete(selected.buying))
  ) {
    return "purchase";
  }

  return null;
}
