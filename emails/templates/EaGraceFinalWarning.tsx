import {
  BillingEmailParagraph,
  BillingEmailShell,
} from "@/emails/components/BillingEmailShell";
import type { EaGraceFinalWarningEmailParams } from "@/lib/communications/types";

export function getEaGraceFinalWarningSubject(): string {
  return "Final warning: Keynetic access ending soon";
}

export default function EaGraceFinalWarningEmail(
  props: EaGraceFinalWarningEmailParams
) {
  return (
    <BillingEmailShell
      preview="Final warning: Keynetic grace period ending soon"
      title="Final payment warning"
      footerReason="You received this email because your Keynetic Estate Agent payment-recovery grace period is ending soon."
      manageBillingUrl={props.manageBillingUrl}
    >
      <BillingEmailParagraph>
        Hi{props.recipientName ? ` ${props.recipientName}` : ""}, the
        payment-recovery grace period for <strong>{props.branchName}</strong>{" "}
        is ending soon
        {props.graceEndsAtLabel ? (
          <>
            {" "}
            (<strong>{props.graceEndsAtLabel}</strong>)
          </>
        ) : null}
        .
      </BillingEmailParagraph>

      <BillingEmailParagraph>
        If payment is not successfully recovered before the grace period ends,
        commercial subscription access for this branch will end. Update your
        payment method now to keep access.
      </BillingEmailParagraph>
    </BillingEmailShell>
  );
}
