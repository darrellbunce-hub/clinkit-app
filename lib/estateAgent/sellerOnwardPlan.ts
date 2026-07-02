export type SellerOnwardPlan =
  | "searching"
  | "purchase_agreed"
  | "no_onward";

export const DEFAULT_SELLER_ONWARD_PLAN: SellerOnwardPlan =
  "searching";

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
