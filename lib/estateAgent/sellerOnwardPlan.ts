export type SellerOnwardPlan =
  | "searching"
  | "purchase_agreed"
  | "no_onward";

export type SellerOnwardAnswer = "yes" | "no";

/**
 * There is no default plan: the branch must say whether the seller is buying
 * and, if so, whether their offer has been accepted. Unanswered → null.
 */
export function resolveSellerOnwardPlan(answers: {
  buying: SellerOnwardAnswer | null;
  offerAccepted: SellerOnwardAnswer | null;
}): SellerOnwardPlan | null {
  if (answers.buying === "no") return "no_onward";
  if (answers.buying !== "yes") return null;
  if (answers.offerAccepted === "yes") return "purchase_agreed";
  if (answers.offerAccepted === "no") return "searching";
  return null;
}

export function saleAwaitingBuyerForOnwardPlan(
  onwardPlan: SellerOnwardPlan
): boolean {
  return onwardPlan === "no_onward";
}

export function requiresOnwardPurchaseAddress(
  onwardPlan: SellerOnwardPlan
): boolean {
  return onwardPlan === "purchase_agreed";
}
