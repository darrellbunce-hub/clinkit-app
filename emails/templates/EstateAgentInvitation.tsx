import { Heading, Hr, Link, Text } from "@react-email/components";

import type { EstateAgentInvitationEmailParams } from "@/lib/communications/types";
import { EMAIL_BRAND } from "@/emails/brand";
import ContentContainer from "@/emails/components/ContentContainer";
import PrimaryButton from "@/emails/components/PrimaryButton";
import EmailSection from "@/emails/components/Section";
import EmailLayout from "@/emails/layout/EmailLayout";

export default function EstateAgentInvitationEmail(
  props: EstateAgentInvitationEmailParams
) {
  return (
    <EmailLayout
      preview={`Join ${props.branchName} on Keynetic`}
    >
      <ContentContainer
        footerReason={`You received this invitation to join ${props.branchName} at ${props.companyName} on Keynetic.`}
      >
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
            You&apos;ve been invited to join your branch on Keynetic
          </Heading>

          <Text
            style={{
              margin: "0 0 16px",
              color: EMAIL_BRAND.charcoal,
              fontSize: 16,
              lineHeight: "26px",
            }}
          >
            Hi {props.agentName},
          </Text>

          <Text
            style={{
              margin: "0 0 16px",
              color: EMAIL_BRAND.charcoal,
              fontSize: 16,
              lineHeight: "26px",
            }}
          >
            You&apos;ve been invited to join {props.companyName} on Keynetic —
            a shared property chain coordination platform for the{" "}
            {props.branchName} operational workspace.
          </Text>

          <Text
            style={{
              margin: 0,
              color: EMAIL_BRAND.charcoal,
              fontSize: 16,
              lineHeight: "26px",
            }}
          >
            Keynetic works alongside your CRM, giving your branch shared
            operational visibility across connected chains. Accepting this
            invitation lets you collaborate on property moves with homeowners
            from the same workspace.
          </Text>
        </EmailSection>

        <EmailSection style={{ paddingTop: 8, paddingBottom: 24 }}>
          <PrimaryButton href={props.invitationLink}>
            Accept invitation
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
              href={props.invitationLink}
              style={{ color: EMAIL_BRAND.teal }}
            >
              {props.invitationLink}
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
            If you were not expecting this invitation, you can safely ignore this
            email.
          </Text>
        </EmailSection>
      </ContentContainer>
    </EmailLayout>
  );
}

export function getEstateAgentInvitationSubject(
  props: Pick<EstateAgentInvitationEmailParams, "companyName">
): string {
  return `You've been invited to join ${props.companyName} on Keynetic`;
}
