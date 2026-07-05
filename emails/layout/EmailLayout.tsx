import {
  Body,
  Head,
  Html,
  Preview,
} from "@react-email/components";
import type { ReactNode } from "react";

import { EMAIL_BRAND, EMAIL_FONT_STACK } from "@/emails/brand";

type EmailLayoutProps = {
  preview: string;
  children: ReactNode;
};

export default function EmailLayout({
  preview,
  children,
}: EmailLayoutProps) {
  return (
    <Html lang="en">
      <Head />
      <Preview>{preview}</Preview>
      <Body
        style={{
          margin: 0,
          padding: 0,
          backgroundColor: EMAIL_BRAND.stone,
          fontFamily: EMAIL_FONT_STACK,
          color: EMAIL_BRAND.charcoal,
        }}
      >
        {children}
      </Body>
    </Html>
  );
}
