import { Link } from "@react-email/components";

import { EMAIL_BRAND } from "@/emails/brand";

type PrimaryButtonProps = {
  href: string;
  children: string;
};

export default function PrimaryButton({
  href,
  children,
}: PrimaryButtonProps) {
  return (
    <Link
      href={href}
      style={{
        display: "inline-block",
        backgroundColor: EMAIL_BRAND.mimosa,
        color: EMAIL_BRAND.charcoal,
        fontSize: 15,
        fontWeight: 700,
        lineHeight: "20px",
        textDecoration: "none",
        borderRadius: 10,
        padding: "14px 24px",
      }}
    >
      {children}
    </Link>
  );
}
