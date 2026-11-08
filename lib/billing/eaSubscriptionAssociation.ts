/**
 * Pure decision logic for linking a Stripe subscription (from a webhook) to a
 * Keynetic subscription row. No I/O.
 */

/** Stripe statuses that can never bill or resume again. */
export const TERMINAL_STRIPE_SUBSCRIPTION_STATUSES: ReadonlySet<string> = new Set([
  "canceled",
  "incomplete_expired",
]);

export type SubscriptionAssociationDecision =
  /** Row is unlinked or already linked to this subscription. */
  | { kind: "link" }
  /**
   * Row is linked to an older subscription that is terminal (or no longer
   * exists in Stripe); the new subscription may take over the row.
   */
  | { kind: "replace_terminal" }
  /** A late event for a terminal subscription that no longer owns the row. */
  | { kind: "ignore_superseded" }
  /** Caller must fetch the currently linked subscription's Stripe status. */
  | { kind: "lookup_previous" }
  | {
      kind: "conflict";
      reason:
        | "row_linked_to_other_live_subscription"
        | "founding_row_linked_to_other_subscription"
        | "branch_has_other_open_row";
    };

export function decideSubscriptionAssociation(input: {
  rowStripeSubscriptionId: string | null;
  incomingStripeSubscriptionId: string;
  incomingStatus: string;
  rowIsConfirmedFounding: boolean;
  /**
   * Status of the subscription currently linked to the row: undefined = not
   * fetched yet, null = Stripe reports it missing.
   */
  previousLinkedStatus?: string | null;
  /**
   * Another open row for the branch, only supplied when the row being
   * reconciled is ended (one open row per branch).
   */
  otherOpenRow?: { id: string } | null;
}): SubscriptionAssociationDecision {
  const incomingTerminal = TERMINAL_STRIPE_SUBSCRIPTION_STATUSES.has(
    input.incomingStatus
  );
  const linked = input.rowStripeSubscriptionId;

  if (linked && linked !== input.incomingStripeSubscriptionId) {
    if (incomingTerminal) return { kind: "ignore_superseded" };
    if (input.rowIsConfirmedFounding) {
      return { kind: "conflict", reason: "founding_row_linked_to_other_subscription" };
    }
    if (input.previousLinkedStatus === undefined) return { kind: "lookup_previous" };
    if (
      input.previousLinkedStatus === null ||
      TERMINAL_STRIPE_SUBSCRIPTION_STATUSES.has(input.previousLinkedStatus)
    ) {
      return { kind: "replace_terminal" };
    }
    return { kind: "conflict", reason: "row_linked_to_other_live_subscription" };
  }

  if (input.otherOpenRow && !incomingTerminal) {
    return { kind: "conflict", reason: "branch_has_other_open_row" };
  }

  return { kind: "link" };
}
