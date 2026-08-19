import {
  BillingEmailParagraph,
  BillingEmailShell,
} from "@/emails/components/BillingEmailShell";
import type { EaGraceReminderEmailParams } from "@/lib/communications/types";

export function getEaGraceReminderSubject(): string {
  return "Reminder: update your Keynetic payment details";
}

export default function EaGraceReminderEmail(props: EaGraceReminderEmailParams) {
  return (
    <BillingEmailShell
      preview="Reminder: Keynetic payment recovery grace period is still open"
      title="Payment recovery reminder"
      footerReason="You received this email because your Keynetic Estate Agent subscription is still in a payment-recovery grace period."
      manageBillingUrl={props.manageBillingUrl}
    >
      <BillingEmailParagraph>
        Hi{props.recipientName ? ` ${props.recipientName}` : ""}, this is a
        reminder that the recurring payment for{" "}
        <strong>{props.branchName}</strong> has not yet been recovered.
      </BillingEmailParagraph>

      <BillingEmailParagraph>
        Your grace period
        {props.graceEndsAtLabel ? (
          <>
            {" "}
            ends on <strong>{props.graceEndsAtLabel}</strong>
          </>
        ) : (
          " is still open"
        )}
        . Please update your payment method so your branch subscription can
        continue.
      </BillingEmailParagraph>
    </BillingEmailShell>
  );
}
