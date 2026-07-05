import { Heading, Hr, Link, Text } from "@react-email/components";

import type { PasswordResetEmailParams } from "@/lib/communications/types";
import { EMAIL_BRAND } from "@/emails/brand";
import ContentContainer from "@/emails/components/ContentContainer";
import PrimaryButton from "@/emails/components/PrimaryButton";
import EmailSection from "@/emails/components/Section";
import EmailLayout from "@/emails/layout/EmailLayout";

export default function PasswordResetEmail(
  props: PasswordResetEmailParams
) {
  return (
    <EmailLayout preview="Reset your Keynetic password">
      <ContentContainer>
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
            Reset your password
          </Heading>

          <Text
            style={{
              margin: "0 0 16px",
              color: EMAIL_BRAND.charcoal,
              fontSize: 16,
              lineHeight: "26px",
            }}
          >
            Hi {props.recipientName},
          </Text>

          <Text
            style={{
              margin: "0 0 16px",
              color: EMAIL_BRAND.charcoal,
              fontSize: 16,
              lineHeight: "26px",
            }}
          >
            We received a request to reset the password for your Keynetic account.
            Use the button below to choose a new password.
          </Text>
        </EmailSection>

        <EmailSection style={{ paddingTop: 8, paddingBottom: 24 }}>
          <PrimaryButton href={props.resetLink}>
            Reset password
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
            This link will expire shortly for security. If the button does not work,
            copy and paste this link into your browser:
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
            <Link href={props.resetLink} style={{ color: EMAIL_BRAND.teal }}>
              {props.resetLink}
            </Link>
          </Text>

          <Hr
            style={{
              borderColor: EMAIL_BRAND.mist,
              margin: "24px 0 16px",
            }}
          />

          <Text
            style={{
              margin: 0,
              color: "#64748B",
              fontSize: 13,
              lineHeight: "20px",
            }}
          >
            If you did not request a password reset, you can safely ignore this email.
          </Text>
        </EmailSection>
      </ContentContainer>
    </EmailLayout>
  );
}

export function getPasswordResetSubject(): string {
  return "Reset your Keynetic password";
}
