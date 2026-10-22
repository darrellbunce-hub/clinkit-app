/**
 * Start Move outcomes where at least one property was created and its
 * homeowner access granted. The chain and everything saved must be kept;
 * the user is told which step is incomplete and where to go next.
 */
export type StartMoveRecoveryReason =
  | "purchase_not_added"
  | "purchase_address_reserved"
  | "purchase_already_on_moveloop"
  | "purchase_not_linked"
  | "searching_not_added"
  | "buyer_ready_not_added"
  | "step_incomplete";

export type StartMoveRecovery = {
  chainId: number;
  reason: StartMoveRecoveryReason;
};

export const START_MOVE_RECOVERY_TITLE =
  "Your chain was created, but one step didn't finish";

const KEEP_SALE =
  "Your sale is kept. Please don't start a new move for the same sale — open your chain to check what has been saved.";

export const START_MOVE_RECOVERY_COPY: Record<
  StartMoveRecoveryReason,
  readonly string[]
> = {
  purchase_not_added: [
    "Your sale has been added to your chain, but we couldn't add the property you're buying.",
    KEEP_SALE,
  ],
  purchase_address_reserved: [
    "Your sale has been added to your chain, but the property you're buying has just been added to MoveLoop by someone else, so it couldn't be added again.",
    KEEP_SALE,
  ],
  purchase_already_on_moveloop: [
    "Your sale has been added to your chain. The property you're buying is already on MoveLoop, so it hasn't been added to your chain.",
    KEEP_SALE,
  ],
  purchase_not_linked: [
    "Your sale and the property you're buying have both been added, but we couldn't finish connecting them to each other.",
    "Both are kept. Please don't add them again — open your chain to check them.",
  ],
  searching_not_added: [
    "Your sale has been added to your chain, but we couldn't add your next-home search.",
    KEEP_SALE,
  ],
  buyer_ready_not_added: [
    "Your purchase has been added, but we couldn't finish showing you as a buyer with no property to sell.",
    "Your purchase is kept. Please don't add it again — open your chain to check it.",
  ],
  step_incomplete: [
    "Part of your move was saved, but we couldn't finish setting it up.",
    "What was saved is kept. Please open your chain to check it before trying anything else.",
  ],
};
