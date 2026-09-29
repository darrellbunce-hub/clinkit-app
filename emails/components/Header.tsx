import { Img, Section } from "@react-email/components";

import { buildAbsoluteAssetUrl } from "@/lib/communications/config";
import { EMAIL_BRAND, EMAIL_LAYOUT } from "@/emails/brand";

export default function Header() {
  // Encoded: email clients do not reliably handle raw spaces in image URLs.
  const logoUrl = buildAbsoluteAssetUrl("/logos/MoveLoop%20Logo%20White.png");

  return (
    <Section
      style={{
        backgroundColor: EMAIL_BRAND.teal,
        borderTopLeftRadius: EMAIL_LAYOUT.cardRadius,
        borderTopRightRadius: EMAIL_LAYOUT.cardRadius,
        padding: "28px 32px",
      }}
    >
      <Img
        src={logoUrl}
        alt="MoveLoop"
        width={160}
        height={80}
        style={{
          display: "block",
          width: 160,
          height: "auto",
        }}
      />
    </Section>
  );
}
