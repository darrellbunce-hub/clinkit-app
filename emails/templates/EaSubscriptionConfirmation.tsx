import {
  BillingEmailParagraph,
  BillingEmailShell,
} from "@/emails/components/BillingEmailShell";
import type { EaSubscriptionConfirmationEmailParams } from "@/lib/communications/types";

export function getEaSubscriptionConfirmationSubject(
  props: EaSubscriptionConfirmationEmailParams
): string {
  if (props.isTrialing) {
    return "Your MoveLoop free trial has started";
  }
  return props.isFounding
    ? "Your MoveLoop founding subscription is active"
    : "Your MoveLoop subscription is active";
}

export default function EaSubscriptionConfirmationEmail(
  props: EaSubscriptionConfirmationEmailParams
) {
  if (props.isTrialing) {
    return (
      <BillingEmailShell
        preview="Your MoveLoop free trial has started"
        title="Free trial started"
        footerReason="You received this email because a MoveLoop Estate Agent free trial was started for your branch."
        manageBillingUrl={props.manageBillingUrl}
      >
        <BillingEmailParagraph>
          Hi{props.recipientName ? ` ${props.recipientName}` : ""}, your MoveLoop
          free trial for <strong>{props.branchName}</strong> has started.
          You won&apos;t be charged during the trial.
        </BillingEmailParagraph>

        <BillingEmailParagraph>
          Plan: <strong>{props.planLabel}</strong>
          <br />
          Price after trial: <strong>{props.priceLabel}</strong>
          <br />
          Billing: <strong>Monthly</strong>
          {props.nextBillingDateLabel ? (
            <>
              <br />
              Trial ends and first payment due:{" "}
              <strong>{props.nextBillingDateLabel}</strong>
            </>
          ) : null}
        </BillingEmailParagraph>

        <BillingEmailParagraph>
          When the trial ends, your subscription continues automatically and the
          card you provided is charged {props.priceLabel}, then monthly until
          you cancel. If you cancel before the trial ends, the paid subscription
          does not continue and you are not charged. You can manage billing from
          your MoveLoop account at any time.
        </BillingEmailParagraph>
      </BillingEmailShell>
    );
  }

  return (
    <BillingEmailShell
      preview="Your MoveLoop branch subscription is active"
      title="Subscription confirmed"
      footerReason="You received this email because a MoveLoop Estate Agent subscription was activated for your branch."
      manageBillingUrl={props.manageBillingUrl}
    >
      <BillingEmailParagraph>
        Hi{props.recipientName ? ` ${props.recipientName}` : ""}, your MoveLoop
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
        You can manage billing from your MoveLoop account at any time.
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
