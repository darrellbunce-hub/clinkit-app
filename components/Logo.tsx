"use client";

import Image from "next/image";
import Link from "next/link";

import {
  LOGO_ACCENT_BAR_CLASS,
  LOGO_TAGLINE_DARK_CLASS,
  LOGO_TAGLINE_LIGHT_CLASS,
  LOGO_WORDMARK_DARK_CLASS,
  LOGO_WORDMARK_LIGHT_CLASS,
} from "@/lib/theme/themeTokens";

export type LogoVariant = "dark" | "light";

/**
 * Logo wordmark variant:
 * - `dark` — for dark headers/backgrounds
 * - `light` — for light headers/backgrounds
 *
 * Wordmark and tagline colours follow the active brand theme via CSS variables.
 */
export default function Logo({
  href = "/",
  variant = "dark",
}: {
  href?: string;
  variant?: LogoVariant;
}) {
  const isDarkBackground = variant === "dark";

  return (
    <Link
      href={href}
      className="flex items-center gap-2 sm:gap-3 lg:gap-4 shrink-0 min-w-0 group"
      aria-label="Keynetic home"
    >
      <div className="relative shrink-0">
        <div
          className="
            relative
            w-12 h-12
            sm:w-16 sm:h-16
            lg:w-20 lg:h-20
          "
        >
          <Image
            src="/logo.png"
            alt=""
            fill
            className="object-contain"
            priority
            aria-hidden
          />
        </div>

        <span
          className={`absolute -bottom-0.5 left-0 right-0 h-1 rounded-full ${LOGO_ACCENT_BAR_CLASS} opacity-0 group-hover:opacity-100 transition-opacity hidden sm:block`}
          aria-hidden
        />
      </div>

      <div className="leading-tight min-w-0">
        <span
          className={`
            block
            text-2xl
            sm:text-3xl
            lg:text-5xl
            font-black
            tracking-tight
            truncate
            ${
              isDarkBackground
                ? LOGO_WORDMARK_DARK_CLASS
                : LOGO_WORDMARK_LIGHT_CLASS
            }
          `}
        >
          Keynetic
        </span>

        <p
          className={`
            text-[10px]
            sm:text-xs
            lg:text-base
            uppercase
            tracking-[0.18em]
            sm:tracking-[0.24em]
            lg:tracking-[0.28em]
            font-medium
            ${
              isDarkBackground
                ? LOGO_TAGLINE_DARK_CLASS
                : LOGO_TAGLINE_LIGHT_CLASS
            }
          `}
        >
          MOVING MADE CLEAR
        </p>
      </div>
    </Link>
  );
}
