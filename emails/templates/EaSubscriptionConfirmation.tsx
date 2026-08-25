import {
  BillingEmailParagraph,
  BillingEmailShell,
} from "@/emails/components/BillingEmailShell";
import type { EaSubscriptionConfirmationEmailParams } from "@/lib/communications/types";

export function getEaSubscriptionConfirmationSubject(
  props: EaSubscriptionConfirmationEmailParams
): string {
  return props.isFounding
    ? "Your Keynetic founding subscription is active"
    : "Your Keynetic subscription is active";
}

export default function EaSubscriptionConfirmationEmail(
  props: EaSubscriptionConfirmationEmailParams
) {
  return (
    <BillingEmailShell
      preview="Your Keynetic branch subscription is active"
      title="Subscription confirmed"
      footerReason="You received this email because a Keynetic Estate Agent subscription was activated for your branch."
      manageBillingUrl={props.manageBillingUrl}
    >
      <BillingEmailParagraph>
        Hi{props.recipientName ? ` ${props.recipientName}` : ""}, your Keynetic
        subscription for <strong>{props.branchName}</strong> is now active.
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
            Next billing date: <strong>{props.nextBillingDateLabel}</strong>
          </>
        ) : null}
      </BillingEmailParagraph>

      <BillingEmailParagraph>
        Your subscription renews automatically each month until you cancel.
        You can manage billing from your Keynetic account at any time.
      </BillingEmailParagraph>

      {props.isFounding ? (
        <>
          <BillingEmailParagraph>
            Congratulations — you have secured a founding place at the founding
            monthly price.
          </BillingEmailParagraph>
          <BillingEmailParagraph>
            Founding status remains while this branch continuously maintains its
            subscription. If you cancel, founding status ends permanently for
            this branch and cannot be restored if you subscribe again later. A
            cancelled founding place is not offered to another estate agent.
          </BillingEmailParagraph>
        </>
      ) : null}
    </BillingEmailShell>
  );
}
