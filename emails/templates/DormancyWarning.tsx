import { Heading, Link, Text } from "@react-email/components";

import type {
  DormancyWarningAudience,
  DormancyWarningEmailParams,
} from "@/lib/communications/types";
import { EMAIL_BRAND } from "@/emails/brand";
import ContentContainer from "@/emails/components/ContentContainer";
import PrimaryButton from "@/emails/components/PrimaryButton";
import EmailSection from "@/emails/components/Section";
import EmailLayout from "@/emails/layout/EmailLayout";

const COPY: Record<
  DormancyWarningAudience,
  {
    preview: string;
    footerReason: string;
    heading: string;
    paragraphs: string[];
    button: string;
  }
> = {
  buyer: {
    preview: "Confirm whether your MoveLoop property transaction is still active",
    footerReason:
      "You received this email because a property linked to your transaction on MoveLoop has entered a dormancy warning period.",
    heading: "Is your property transaction still active?",
    paragraphs: [
      "A property linked to your transaction on MoveLoop is still waiting for its seller to connect, and it has not had any recent activity.",
      "If the transaction is still going ahead, please confirm that it is still active. This helps us keep property chains accurate and prevents properties nobody is acting for from remaining linked indefinitely.",
      "If we don't receive confirmation, that property will be released after the confirmation period and removed from your chain. Confirming does not give you any control over the property.",
      "No action is required if the transaction is no longer going ahead.",
    ],
    button: "Confirm my transaction is still active",
  },
  estate_agent: {
    preview: "Confirm whether a transaction your branch is involved in on MoveLoop is still active",
    footerReason:
      "You received this email because a property linked to a sale your branch manages on MoveLoop has entered a dormancy warning period.",
    heading: "Is this onward purchase still going ahead?",
    paragraphs: [
      "Your client's onward purchase on MoveLoop is still waiting for its seller to connect, and it has not had any recent activity.",
      "If the purchase is still going ahead, please confirm that it is still active.",
      "If we don't receive confirmation, the onward purchase will be released after the confirmation period and removed from the chain. Confirming does not give your branch any control over that property.",
      "No action is required if the purchase is no longer going ahead.",
    ],
    button: "Confirm this purchase is still active",
  },
};

const PARAGRAPH_STYLE = {
  margin: "0 0 16px",
  color: EMAIL_BRAND.charcoal,
  fontSize: 16,
  lineHeight: "26px",
};

export default function DormancyWarningEmail(props: DormancyWarningEmailParams) {
  const copy = COPY[props.audience ?? "buyer"];

  return (
    <EmailLayout preview={copy.preview}>
      <ContentContainer footerReason={copy.footerReason}>
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
            {copy.heading}
          </Heading>

          {copy.paragraphs.map((paragraph) => (
            <Text key={paragraph} style={PARAGRAPH_STYLE}>
              {paragraph}
            </Text>
          ))}
        </EmailSection>

        <EmailSection style={{ paddingTop: 8, paddingBottom: 24 }}>
          <PrimaryButton href={props.confirmationLink}>
            {copy.button}
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

export function getDormancyWarningSubject(
  audience: DormancyWarningAudience = "buyer"
): string {
  return audience === "estate_agent"
    ? "Is this onward purchase still active on MoveLoop?"
    : "Is your property transaction still active?";
}
