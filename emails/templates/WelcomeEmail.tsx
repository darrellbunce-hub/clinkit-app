import { Heading, Text } from "@react-email/components";

import type { WelcomeEmailParams } from "@/lib/communications/types";
import { EMAIL_BRAND } from "@/emails/brand";
import ContentContainer from "@/emails/components/ContentContainer";
import PrimaryButton from "@/emails/components/PrimaryButton";
import EmailSection from "@/emails/components/Section";
import EmailLayout from "@/emails/layout/EmailLayout";

export default function WelcomeEmail(props: WelcomeEmailParams) {
  return (
    <EmailLayout preview="Your Keynetic account is ready">
      <ContentContainer footerReason="You received this email because a Keynetic account was created for you.">
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
            Welcome to Keynetic
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
            Your Keynetic account is ready. Keynetic gives connected participants
            a shared view of progress on property moves — with live updates as
            information is shared.
          </Text>

          <Text
            style={{
              margin: 0,
              color: EMAIL_BRAND.charcoal,
              fontSize: 16,
              lineHeight: "26px",
            }}
          >
            Start your move, join an existing chain, or open your dashboard to
            see connected parts of your property chain. Homeowners use Keynetic
            for free.
          </Text>
        </EmailSection>

        <EmailSection style={{ paddingTop: 8, paddingBottom: 32 }}>
          <PrimaryButton href={props.dashboardLink}>
            Go to your dashboard
          </PrimaryButton>
        </EmailSection>
      </ContentContainer>
    </EmailLayout>
  );
}

export function getWelcomeEmailSubject(): string {
  return "Welcome to Keynetic";
}
