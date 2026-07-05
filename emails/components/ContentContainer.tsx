import { Container } from "@react-email/components";
import type { ReactNode } from "react";

import { EMAIL_BRAND, EMAIL_LAYOUT } from "@/emails/brand";
import Footer from "@/emails/components/Footer";
import Header from "@/emails/components/Header";

type ContentContainerProps = {
  children: ReactNode;
};

export default function ContentContainer({
  children,
}: ContentContainerProps) {
  return (
    <Container
      style={{
        maxWidth: EMAIL_LAYOUT.maxWidth,
        margin: "0 auto",
        padding: `${EMAIL_LAYOUT.outerPadding}px 0`,
      }}
    >
      <table
        role="presentation"
        width="100%"
        cellPadding={0}
        cellSpacing={0}
        style={{
          width: "100%",
          borderCollapse: "collapse",
          backgroundColor: EMAIL_BRAND.white,
          borderRadius: EMAIL_LAYOUT.cardRadius,
          overflow: "hidden",
          boxShadow: "0 8px 24px rgba(31, 41, 51, 0.08)",
        }}
      >
        <tbody>
          <tr>
            <td>
              <Header />
              {children}
              <Footer />
            </td>
          </tr>
        </tbody>
      </table>
    </Container>
  );
}
