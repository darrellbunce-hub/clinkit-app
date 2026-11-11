import {
  BillingEmailParagraph,
  BillingEmailShell,
} from "@/emails/components/BillingEmailShell";
import type { EaSubscriptionCancellationReversedEmailParams } from "@/lib/communications/types";

export function getEaSubscriptionCancellationReversedSubject(): string {
  return "Your MoveLoop subscription will continue";
}

export default function EaSubscriptionCancellationReversedEmail(
  props: EaSubscriptionCancellationReversedEmailParams
) {
  return (
    <BillingEmailShell
      preview={
        props.isTrialing
          ? "Your cancellation has been withdrawn — your MoveLoop free trial continues"
          : "Your cancellation has been withdrawn — your MoveLoop subscription continues"
      }
      title="Cancellation withdrawn"
      footerReason="You received this email because a scheduled MoveLoop Estate Agent subscription cancellation was withdrawn for your branch."
      manageBillingUrl={props.manageBillingUrl}
    >
      <BillingEmailParagraph>
        Hi{props.recipientName ? ` ${props.recipientName}` : ""}, the scheduled
        cancellation for <strong>{props.branchName}</strong> has been withdrawn.
        Your subscription will continue.
      </BillingEmailParagraph>

      <BillingEmailParagraph>
        Plan: <strong>{props.planLabel}</strong>
        <br />
        Price: <strong>{props.priceLabel}</strong>
        <br />
        Billing: <strong>Monthly</strong>
        {props.nextBillingDateLabel ? (
          <>
            <br />
            {props.isTrialing
              ? "Trial ends and first payment due: "
              : "Next billing date: "}
            <strong>{props.nextBillingDateLabel}</strong>
          </>
        ) : null}
      </BillingEmailParagraph>

      {props.isTrialing ? (
        <BillingEmailParagraph>
          Your free trial continues. When it ends, your subscription continues
          automatically and the card you provided is charged {props.priceLabel},
          then monthly until you cancel. If you cancel before the trial ends,
          you are not charged.
        </BillingEmailParagraph>
      ) : (
        <BillingEmailParagraph>
          Your subscription renews automatically each month until you cancel.
        </BillingEmailParagraph>
      )}

      {props.isFounding ? (
        <BillingEmailParagraph>
          Your founding subscription and founding price continue unchanged.
        </BillingEmailParagraph>
      ) : null}

      <BillingEmailParagraph>
        You can manage billing from your MoveLoop account at any time.
      </BillingEmailParagraph>
    </BillingEmailShell>
  );
}
