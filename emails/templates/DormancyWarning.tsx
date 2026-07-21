import { Heading, Link, Text } from "@react-email/components";

import type { DormancyWarningEmailParams } from "@/lib/communications/types";
import { EMAIL_BRAND } from "@/emails/brand";
import ContentContainer from "@/emails/components/ContentContainer";
import PrimaryButton from "@/emails/components/PrimaryButton";
import EmailSection from "@/emails/components/Section";
import EmailLayout from "@/emails/layout/EmailLayout";

export default function DormancyWarningEmail(props: DormancyWarningEmailParams) {
  return (
    <EmailLayout preview="Confirm whether your Keynetic property transaction is still active">
      <ContentContainer footerReason="You received this email because your property transaction on Keynetic has entered a dormancy warning period.">
        <EmailSection style={{ paddingTop: 32, paddingBottom: 8 }}>
          <Heading
            as="h1"
            style={{
              margin: "0 0 16px",
              color: EMAIL_BRAND.charcoal,
              fontSize: 24,
              lineHeight: "32px",
              fontWeight: 700,
            }}
          >
            Is your property transaction still active?
          </Heading>

          <Text
            style={{
              margin: "0 0 16px",
              color: EMAIL_BRAND.charcoal,
              fontSize: 16,
              lineHeight: "26px",
            }}
          >
            Your property transaction on Keynetic has not had any recent activity.
          </Text>

          <Text
            style={{
              margin: "0 0 16px",
              color: EMAIL_BRAND.charcoal,
              fontSize: 16,
              lineHeight: "26px",
            }}
          >
            If your move is still progressing, please confirm that your transaction
            is still active. This helps us keep property chains accurate and prevents
            inactive properties from remaining linked indefinitely.
          </Text>

          <Text
            style={{
              margin: "0 0 16px",
              color: EMAIL_BRAND.charcoal,
              fontSize: 16,
              lineHeight: "26px",
            }}
          >
            If we don&apos;t receive confirmation, your participation may eventually
            be released from the transaction after the confirmation period.
          </Text>

          <Text
            style={{
              margin: "0 0 16px",
              color: EMAIL_BRAND.charcoal,
              fontSize: 16,
              lineHeight: "26px",
            }}
          >
            No action is required if you no longer wish to participate.
          </Text>
        </EmailSection>

        <EmailSection style={{ paddingTop: 8, paddingBottom: 24 }}>
          <PrimaryButton href={props.confirmationLink}>
            Confirm my transaction is still active
          </PrimaryButton>
        </EmailSection>

        <EmailSection style={{ paddingBottom: 32 }}>
          <Text
            style={{
              margin: 0,
              color: "#64748B",
              fontSize: 14,
              lineHeight: "22px",
            }}
          >
            If the button does not work, copy and paste this link into your browser:
          </Text>

          <Text
            style={{
              margin: "12px 0 0",
              color: EMAIL_BRAND.teal,
              fontSize: 13,
              lineHeight: "20px",
              wordBreak: "break-all",
            }}
          >
            <Link
              href={props.confirmationLink}
              style={{ color: EMAIL_BRAND.teal }}
            >
              {props.confirmationLink}
            </Link>
          </Text>
        </EmailSection>
      </ContentContainer>
    </EmailLayout>
  );
}

export function getDormancyWarningSubject(): string {
  return "Is your property transaction still active?";
}
