import {
  BillingEmailParagraph,
  BillingEmailShell,
} from "@/emails/components/BillingEmailShell";
import type { EaSubscriptionCancelledEmailParams } from "@/lib/communications/types";

export function getEaSubscriptionCancelledSubject(): string {
  return "Your MoveLoop subscription cancellation is confirmed";
}

export default function EaSubscriptionCancelledEmail(
  props: EaSubscriptionCancelledEmailParams
) {
  return (
    <BillingEmailShell
      preview={
        props.isTrialing
          ? "Your MoveLoop subscription will end when your free trial ends"
          : "Your MoveLoop subscription will end at the close of the current billing period"
      }
      title="Cancellation confirmed"
      footerReason="You received this email because a MoveLoop Estate Agent subscription cancellation was scheduled for your branch."
      manageBillingUrl={props.manageBillingUrl}
    >
      <BillingEmailParagraph>
        Hi{props.recipientName ? ` ${props.recipientName}` : ""}, we have
        received your cancellation for <strong>{props.branchName}</strong>.
      </BillingEmailParagraph>

      {props.isTrialing ? (
        <BillingEmailParagraph>
          Your free trial continues until{" "}
          <strong>{props.accessEndsAtLabel}</strong>, then the subscription
          ends. You will not be charged. You can manage or reverse the
          cancellation before then from Manage billing (Stripe Customer
          Portal), where Stripe permits it.
        </BillingEmailParagraph>
      ) : (
        <BillingEmailParagraph>
          Your subscription remains active until{" "}
          <strong>{props.accessEndsAtLabel}</strong>. Recurring billing will stop
          after that date. You can manage or reverse the cancellation before then
          from Manage billing (Stripe Customer Portal), where Stripe permits it.
        </BillingEmailParagraph>
      )}
    </BillingEmailShell>
  );
}
