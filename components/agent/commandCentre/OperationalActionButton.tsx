import Link from "next/link";

import {
  BTN_PRIMARY_SM_CLASS,
  SURFACE_PANEL_HOVER_CLASS,
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
  if (variant === "primary") {
    return (
      <Link
        href={href}
        className={`inline-flex items-center justify-center rounded-xl px-4 py-2.5 text-sm font-semibold ${BTN_PRIMARY_SM_CLASS}`}
      >
        {label}
      </Link>
    );
  }

  return (
    <Link
      href={href}
      className={`inline-flex items-center justify-center rounded-xl border border-surface-card-border px-4 py-2.5 text-sm font-semibold text-slate-900 ${SURFACE_PANEL_HOVER_CLASS}`}
    >
      {label}
    </Link>
  );
}
