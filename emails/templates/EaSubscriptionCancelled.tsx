import {
  BillingEmailParagraph,
  BillingEmailShell,
} from "@/emails/components/BillingEmailShell";
import type { EaSubscriptionCancelledEmailParams } from "@/lib/communications/types";

export function getEaSubscriptionCancelledSubject(): string {
  return "Your Keynetic subscription cancellation is confirmed";
}

export default function EaSubscriptionCancelledEmail(
  props: EaSubscriptionCancelledEmailParams
) {
  return (
    <BillingEmailShell
      preview="Your Keynetic subscription will end at the close of the current billing period"
      title="Cancellation confirmed"
      footerReason="You received this email because a Keynetic Estate Agent subscription cancellation was scheduled for your branch."
      manageBillingUrl={props.manageBillingUrl}
    >
      <BillingEmailParagraph>
        Hi{props.recipientName ? ` ${props.recipientName}` : ""}, we have
        received your cancellation for <strong>{props.branchName}</strong>.
      </BillingEmailParagraph>

      <BillingEmailParagraph>
        Your subscription remains active until{" "}
        <strong>{props.accessEndsAtLabel}</strong>. Recurring billing will stop
        after that date. You can manage or reverse the cancellation before then
        from Manage billing (Stripe Customer Portal), where Stripe permits it.
      </BillingEmailParagraph>

      {props.isFounding ? (
        <BillingEmailParagraph>
          Because you have a founding subscription, cancelling permanently ends
          your founding status. Your founding price cannot be restored if you
          subscribe again in the future.
        </BillingEmailParagraph>
      ) : null}
    </BillingEmailShell>
  );
}
