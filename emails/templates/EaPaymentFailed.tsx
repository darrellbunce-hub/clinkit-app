import {
  BillingEmailParagraph,
  BillingEmailShell,
} from "@/emails/components/BillingEmailShell";
import type { EaPaymentFailedEmailParams } from "@/lib/communications/types";

export function getEaPaymentFailedSubject(): string {
  return "Action needed: Keynetic payment failed";
}

export default function EaPaymentFailedEmail(props: EaPaymentFailedEmailParams) {
  return (
    <BillingEmailShell
      preview="Your Keynetic payment failed — update your payment method"
      title="Payment failed"
      footerReason="You received this email because a recurring payment for your Keynetic Estate Agent subscription failed."
      manageBillingUrl={props.manageBillingUrl}
    >
      <BillingEmailParagraph>
        Hi{props.recipientName ? ` ${props.recipientName}` : ""}, the latest
        recurring payment for <strong>{props.branchName}</strong> could not be
        collected.
      </BillingEmailParagraph>

      <BillingEmailParagraph>
        Your branch is now in a payment-recovery grace period
        {props.graceEndsAtLabel ? (
          <>
            {" "}
            until <strong>{props.graceEndsAtLabel}</strong>
          </>
        ) : null}
        . You keep access during this grace period while you update your payment
        details.
      </BillingEmailParagraph>

      <BillingEmailParagraph>
        Please update your payment method as soon as possible using Manage
        billing. If payment is not successfully recovered by the end of the
        grace period, commercial subscription access for this branch will end.
      </BillingEmailParagraph>
    </BillingEmailShell>
  );
}
