import { Heading, Hr, Link, Text } from "@react-email/components";

import type { HomeownerInvitationEmailParams } from "@/lib/communications/types";
import { EMAIL_BRAND } from "@/emails/brand";
import ContentContainer from "@/emails/components/ContentContainer";
import PrimaryButton from "@/emails/components/PrimaryButton";
import EmailSection from "@/emails/components/Section";
import EmailLayout from "@/emails/layout/EmailLayout";

function formatExpiryDate(expiresAt: string): string {
  const date = new Date(expiresAt);

  if (Number.isNaN(date.getTime())) {
    return "soon";
  }

  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export default function HomeownerInvitationEmail(
  props: HomeownerInvitationEmailParams
) {
  const expiryLabel = formatExpiryDate(props.expiresAt);

  return (
    <EmailLayout
      preview={`${props.companyName} invited you to connect ${props.propertyAddress} on Keynetic`}
    >
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
            You&apos;re invited to connect your property
          </Heading>

          <Text
            style={{
              margin: "0 0 16px",
              color: EMAIL_BRAND.charcoal,
              fontSize: 16,
              lineHeight: "26px",
            }}
          >
            Hi {props.homeownerName},
          </Text>

          <Text
            style={{
              margin: "0 0 16px",
              color: EMAIL_BRAND.charcoal,
              fontSize: 16,
              lineHeight: "26px",
            }}
          >
            {props.branchName} at {props.companyName} has invited you to connect{" "}
            <strong>{props.propertyAddress}</strong> on Keynetic so you can follow
            progress on your move with clear, shared visibility.
          </Text>
        </EmailSection>

        <EmailSection style={{ paddingTop: 8, paddingBottom: 24 }}>
          <PrimaryButton href={props.invitationLink}>
            Accept invitation
          </PrimaryButton>
        </EmailSection>

        <EmailSection style={{ paddingBottom: 24 }}>
          <Text
            style={{
              margin: 0,
              color: "#64748B",
              fontSize: 14,
              lineHeight: "22px",
            }}
          >
            This invitation expires on {expiryLabel}. If the button does not work,
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
            <Link
              href={props.invitationLink}
              style={{ color: EMAIL_BRAND.teal }}
            >
              {props.invitationLink}
            </Link>
          </Text>
        </EmailSection>

        <EmailSection style={{ paddingBottom: 32 }}>
          <Hr
            style={{
              borderColor: EMAIL_BRAND.mist,
              margin: "0 0 16px",
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
            If you were not expecting this invitation, you can safely ignore this
            email.
          </Text>
        </EmailSection>
      </ContentContainer>
    </EmailLayout>
  );
}

export function getHomeownerInvitationSubject(
  props: Pick<HomeownerInvitationEmailParams, "propertyAddress">
): string {
  return `Connect ${props.propertyAddress} on Keynetic`;
}
