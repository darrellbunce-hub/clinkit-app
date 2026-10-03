import {
  PARTICIPATION_DELINK_OPERATION,
  type ParticipationDelinkOperation,
} from "@/lib/ownership/participationDelinkTypes";

export type ParticipationDelinkConfirmationCopy = {
  title: string;
  body: string;
  confirmLabel: string;
  destructive: boolean;
};

export function getParticipationDelinkConfirmationCopy(
  operation: ParticipationDelinkOperation
): ParticipationDelinkConfirmationCopy {
  switch (operation) {
    case PARTICIPATION_DELINK_OPERATION.homeownerSelf:
      return {
        title: "Leave this transaction?",
        body:
          "You will be removed from this property and your delegates will be revoked. " +
          "If an estate agent manages it, they continue to manage it. Otherwise it stays in the chain " +
          "waiting for its seller, unless you choose \"wrong property\" and nobody else depends on it: " +
          "then it is released. Chain participants will be notified. Transaction history and analytics are retained.",
        confirmLabel: "Leave transaction",
        destructive: true,
      };

    case PARTICIPATION_DELINK_OPERATION.homeownerRemoveEa:
      return {
        title: "Remove estate agent?",
        body:
          "The assigned estate agent branch will lose access to this property. " +
          "You remain the operational homeowner and can assign another branch later.",
        confirmLabel: "Remove estate agent",
        destructive: true,
      };

    case PARTICIPATION_DELINK_OPERATION.estateAgentRemoveBranch:
      return {
        title: "Release branch management?",
        body:
          "Your branch will no longer manage this property operationally. " +
          "The homeowner (if present) retains their participation. " +
          "With no homeowner connected, the property stays in the chain waiting for its seller; " +
          "it is released straight away only if you choose \"added by mistake\" or " +
          "\"duplicate property\" and nobody else depends on it.",
        confirmLabel: "Release management",
        destructive: true,
      };

    case PARTICIPATION_DELINK_OPERATION.estateAgentRemoveHomeowner:
      return {
        title: "Withdraw homeowner association?",
        body:
          "The homeowner will be removed from this property and the invitation can be re-sent. " +
          "This is only available while the invitation is pending or before meaningful participation.",
        confirmLabel: "Withdraw association",
        destructive: true,
      };

    default:
      return {
        title: "Confirm de-link",
        body: "This action cannot be undone from the app without re-joining or re-inviting.",
        confirmLabel: "Confirm",
        destructive: true,
      };
  }
}

export type ParticipationDelinkOutcome = {
  lifecycleState?: string;
  eaRetained?: boolean;
  placeholder?: boolean;
};

export function getParticipationDelinkSuccessMessage(
  operation: ParticipationDelinkOperation,
  outcome: ParticipationDelinkOutcome = {}
): string {
  const released = outcome.lifecycleState === "released";

  switch (operation) {
    case PARTICIPATION_DELINK_OPERATION.homeownerSelf:
      if (released) {
        return "You have left this transaction. The property has been released.";
      }

      if (outcome.eaRetained) {
        return "You have left this transaction. The estate agent continues to manage the property.";
      }

      return "You have left this transaction. The property stays in the chain for the other participants.";
    case PARTICIPATION_DELINK_OPERATION.homeownerRemoveEa:
      return "Estate agent removed from this property.";
    case PARTICIPATION_DELINK_OPERATION.estateAgentRemoveBranch:
      if (released) {
        return "Branch management released. The property has been released.";
      }

      if (outcome.placeholder) {
        return "Branch management released. The property stays in the chain until its seller connects.";
      }

      return "Branch management released.";
    case PARTICIPATION_DELINK_OPERATION.estateAgentRemoveHomeowner:
      return "Homeowner association withdrawn. You can send a new invitation.";
    default:
      return "Participation updated.";
  }
}

export const PARTICIPATION_DELINK_PANEL_TITLE = "Participation";
export const PARTICIPATION_DELINK_PANEL_DESCRIPTION =
  "End your operational participation without deleting transaction history. " +
  "Select a predefined reason — no personal notes are stored. " +
  "All de-link actions are audited and chain participants may be notified.";
