import { Heading, Text } from "@react-email/components";

import type { ClaimSuccessfulEmailParams } from "@/lib/communications/types";
import { EMAIL_BRAND } from "@/emails/brand";
import ContentContainer from "@/emails/components/ContentContainer";
import PrimaryButton from "@/emails/components/PrimaryButton";
import EmailSection from "@/emails/components/Section";
import EmailLayout from "@/emails/layout/EmailLayout";

export default function PropertyClaimedEmail(
  props: ClaimSuccessfulEmailParams
) {
  return (
    <EmailLayout
      preview={`${props.propertyAddress} is now connected on Keynetic`}
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
            Your property is connected
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
            You have successfully connected{" "}
            <strong>{props.propertyAddress}</strong> on Keynetic with{" "}
            {props.branchName} at {props.companyName}.
          </Text>

          <Text
            style={{
              margin: "0 0 16px",
              color: EMAIL_BRAND.charcoal,
              fontSize: 16,
              lineHeight: "26px",
            }}
          >
            You can now follow progress, view updates, and stay aligned as your move
            continues.
          </Text>
        </EmailSection>

        <EmailSection style={{ paddingTop: 8, paddingBottom: 32 }}>
          <PrimaryButton href={props.dashboardLink}>
            View your property
          </PrimaryButton>
        </EmailSection>
      </ContentContainer>
    </EmailLayout>
  );
}

export function getClaimSuccessfulSubject(
  props: Pick<ClaimSuccessfulEmailParams, "propertyAddress">
): string {
  return `${props.propertyAddress} is now connected on Keynetic`;
}
