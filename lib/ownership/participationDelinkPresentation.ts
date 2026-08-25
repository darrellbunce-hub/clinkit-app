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
          "You will be removed as the operational homeowner on this property. " +
          "Delegates will be revoked, the property will be released for future use, " +
          "and chain participants will be notified. Transaction history and analytics are retained.",
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
          "The homeowner (if present) retains their participation.",
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

export function getParticipationDelinkSuccessMessage(
  operation: ParticipationDelinkOperation
): string {
  switch (operation) {
    case PARTICIPATION_DELINK_OPERATION.homeownerSelf:
      return "You have left this transaction. The property has been released.";
    case PARTICIPATION_DELINK_OPERATION.homeownerRemoveEa:
      return "Estate agent removed from this property.";
    case PARTICIPATION_DELINK_OPERATION.estateAgentRemoveBranch:
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
