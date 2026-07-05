import { Link, Section, Text } from "@react-email/components";

import { getAppBaseUrl } from "@/lib/communications/config";
import { EMAIL_BRAND, EMAIL_LAYOUT } from "@/emails/brand";

export default function Footer() {
  const appUrl = getAppBaseUrl();

  return (
    <Section
      style={{
        backgroundColor: EMAIL_BRAND.charcoal,
        borderBottomLeftRadius: EMAIL_LAYOUT.cardRadius,
        borderBottomRightRadius: EMAIL_LAYOUT.cardRadius,
        padding: "24px 32px",
      }}
    >
      <Text
        style={{
          margin: "0 0 8px",
          color: EMAIL_BRAND.white,
          fontSize: 14,
          lineHeight: "22px",
          fontWeight: 600,
        }}
      >
        Keynetic
      </Text>

      <Text
        style={{
          margin: "0 0 16px",
          color: "#CBD5E1",
          fontSize: 13,
          lineHeight: "20px",
        }}
      >
        Clear visibility across your property move.
      </Text>

      <Text
        style={{
          margin: 0,
          color: "#94A3B8",
          fontSize: 12,
          lineHeight: "18px",
        }}
      >
        <Link
          href={appUrl}
          style={{
            color: EMAIL_BRAND.mimosa,
            textDecoration: "underline",
          }}
        >
          {appUrl.replace(/^https?:\/\//, "")}
        </Link>
        {" · "}
        <Link
          href={`${appUrl}/account`}
          style={{
            color: EMAIL_BRAND.mimosa,
            textDecoration: "underline",
          }}
        >
          Account settings
        </Link>
      </Text>

      <Text
        style={{
          margin: "16px 0 0",
          color: "#64748B",
          fontSize: 11,
          lineHeight: "16px",
        }}
      >
        You received this email because of activity on your Keynetic account.
      </Text>
    </Section>
  );
}
