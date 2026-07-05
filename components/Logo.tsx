"use client";

import Link from "next/link";

import KeyneticLogoMark from "@/components/brand/KeyneticLogoMark";
import {
  LOGO_TAGLINE_LIGHT_CLASS,
  LOGO_WORDMARK_DARK_CLASS,
  LOGO_WORDMARK_LIGHT_CLASS,
  FONT_HEADING_CLASS,
} from "@/lib/theme/themeTokens";

export type LogoVariant = "light" | "dark" | "reversed";

/**
 * Keynetic logo — standard (teal on white) or reversed (white on teal/dark).
 * Mimosa node is always retained on the mark.
 */
export default function Logo({
  href = "/",
  variant = "light",
}: {
  href?: string;
  variant?: LogoVariant;
}) {
  const isReversed =
    variant === "dark" || variant === "reversed";
  const markVariant = isReversed
    ? "reversed"
    : "standard";

  return (
    <Link
      href={href}
      className="group flex min-w-0 shrink-0 items-center gap-2 sm:gap-3"
      aria-label="Keynetic home"
    >
      <KeyneticLogoMark
        variant={markVariant}
        className="h-10 w-10 sm:h-12 sm:w-12"
      />

      <div
        className={`min-w-0 leading-tight ${FONT_HEADING_CLASS} ${
          isReversed ? "space-y-1 sm:space-y-1.5" : ""
        }`}
      >
        <span
          className={`block truncate tracking-tight ${
            isReversed
              ? "text-xl font-extrabold sm:text-[1.65rem] sm:leading-none"
              : "text-xl font-bold sm:text-2xl"
          } ${
            isReversed
              ? LOGO_WORDMARK_DARK_CLASS
              : LOGO_WORDMARK_LIGHT_CLASS
          }`}
        >
          Keynetic
        </span>

        <p
          className={`hidden uppercase sm:block ${
            isReversed
              ? "text-[11px] font-semibold tracking-[0.24em] text-brand-secondary"
              : `text-[10px] font-medium tracking-[0.2em] ${LOGO_TAGLINE_LIGHT_CLASS}`
          }`}
        >
          Moving made clear
        </p>
      </div>
    </Link>
  );
}
