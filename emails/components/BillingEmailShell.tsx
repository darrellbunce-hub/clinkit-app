import type { ReactNode } from "react";
import { Heading, Link, Text } from "@react-email/components";

import { EMAIL_BRAND } from "@/emails/brand";
import ContentContainer from "@/emails/components/ContentContainer";
import PrimaryButton from "@/emails/components/PrimaryButton";
import EmailSection from "@/emails/components/Section";
import EmailLayout from "@/emails/layout/EmailLayout";
import { LEGAL_ROUTES } from "@/lib/legal/constants";
import { getAppBaseUrl } from "@/lib/communications/config";

const textStyle = {
  margin: "0 0 16px",
  color: EMAIL_BRAND.charcoal,
  fontSize: 16,
  lineHeight: "26px",
} as const;

type BillingEmailShellProps = {
  preview: string;
  title: string;
  footerReason: string;
  manageBillingUrl: string;
  children: ReactNode;
};

export function BillingEmailShell({
  preview,
  title,
  footerReason,
  manageBillingUrl,
  children,
}: BillingEmailShellProps) {
  const appUrl = getAppBaseUrl();

  return (
    <EmailLayout preview={preview}>
      <ContentContainer footerReason={footerReason}>
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
            {title}
          </Heading>
          {children}
        </EmailSection>

        <EmailSection style={{ paddingTop: 8, paddingBottom: 16 }}>
          <PrimaryButton href={manageBillingUrl}>
            Manage billing
          </PrimaryButton>
        </EmailSection>

        <EmailSection style={{ paddingTop: 0, paddingBottom: 24 }}>
          <Text style={{ ...textStyle, marginBottom: 8, fontSize: 14 }}>
            <Link
              href={`${appUrl}${LEGAL_ROUTES.estateAgentTerms}`}
              style={{ color: EMAIL_BRAND.teal, textDecoration: "underline" }}
            >
              Estate Agent Terms
            </Link>
            {" · "}
            <Link
              href={`${appUrl}${LEGAL_ROUTES.privacy}`}
              style={{ color: EMAIL_BRAND.teal, textDecoration: "underline" }}
            >
              Privacy Policy
            </Link>
          </Text>
        </EmailSection>
      </ContentContainer>
    </EmailLayout>
  );
}

export function BillingEmailParagraph({
  children,
}: {
  children: ReactNode;
}) {
  return <Text style={textStyle}>{children}</Text>;
}
