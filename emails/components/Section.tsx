import { Section } from "@react-email/components";
import type { CSSProperties, ReactNode } from "react";

type EmailSectionProps = {
  children: ReactNode;
  style?: CSSProperties;
};

export default function EmailSection({
  children,
  style,
}: EmailSectionProps) {
  return (
    <Section
      style={{
        padding: "0 32px",
        ...style,
      }}
    >
      {children}
    </Section>
  );
}
