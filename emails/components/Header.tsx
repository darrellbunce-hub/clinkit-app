import { Img, Section } from "@react-email/components";

import { buildAbsoluteAssetUrl } from "@/lib/communications/config";
import { EMAIL_BRAND, EMAIL_LAYOUT } from "@/emails/brand";

export default function Header() {
  const iconUrl = buildAbsoluteAssetUrl("/logos/keynetic-icon-white.png");
  const wordmarkUrl = buildAbsoluteAssetUrl(
    "/logos/keynetic-wordmark-white-v2.png"
  );

  return (
    <Section
      style={{
        backgroundColor: EMAIL_BRAND.teal,
        borderTopLeftRadius: EMAIL_LAYOUT.cardRadius,
        borderTopRightRadius: EMAIL_LAYOUT.cardRadius,
        padding: "28px 32px",
      }}
    >
      <table
        role="presentation"
        cellPadding={0}
        cellSpacing={0}
        style={{ borderCollapse: "collapse" }}
      >
        <tbody>
          <tr>
            <td style={{ paddingRight: 12, verticalAlign: "middle" }}>
              <Img
                src={iconUrl}
                alt="Keynetic"
                width={36}
                height={37}
                style={{
                  display: "block",
                  width: 36,
                  height: "auto",
                }}
              />
            </td>
            <td style={{ verticalAlign: "middle" }}>
              <Img
                src={wordmarkUrl}
                alt="Keynetic"
                width={112}
                height={30}
                style={{
                  display: "block",
                  width: 112,
                  height: "auto",
                }}
              />
            </td>
          </tr>
        </tbody>
      </table>
    </Section>
  );
}
