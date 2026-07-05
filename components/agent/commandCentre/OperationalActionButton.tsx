import Link from "next/link";

import {
  BTN_PRIMARY_SM_CLASS,
  BTN_SECONDARY_OUTLINE_SM_CLASS,
} from "@/lib/theme/themeTokens";

export default function OperationalActionButton({
  href,
  label,
  variant = "primary",
}: {
  href: string;
  label: string;
  variant?: "primary" | "secondary";
}) {
  const className =
    variant === "primary"
      ? `inline-flex flex-1 items-center justify-center px-4 py-2.5 text-sm font-semibold ${BTN_PRIMARY_SM_CLASS}`
      : `inline-flex flex-1 items-center justify-center px-4 py-2.5 text-sm font-semibold ${BTN_SECONDARY_OUTLINE_SM_CLASS}`;

  return (
    <Link href={href} className={className}>
      {label}
    </Link>
  );
}
