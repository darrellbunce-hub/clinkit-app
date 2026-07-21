"use client";

import Image from "next/image";
import Link from "next/link";

import {
  KEYNETIC_LOGO_ASSETS,
  KEYNETIC_TAGLINE,
  LOGO_ICON_CLASS,
  LOGO_LOCKUP_CLASS,
  LOGO_TAGLINE_DARK_CLASS,
  LOGO_TAGLINE_LIGHT_CLASS,
  LOGO_WORDMARK_CLASS,
} from "@/lib/theme/logoAssets";

export type LogoVariant = "light" | "dark";

export default function Logo({
  href = "/",
  variant = "light",
  priority = false,
  showTagline = false,
}: {
  href?: string;
  variant?: LogoVariant;
  priority?: boolean;
  showTagline?: boolean;
}) {
  const assets = KEYNETIC_LOGO_ASSETS[variant];
  const taglineClass =
    variant === "dark"
      ? LOGO_TAGLINE_DARK_CLASS
      : LOGO_TAGLINE_LIGHT_CLASS;

  if (!showTagline) {
    return (
      <Link
        href={href}
        className={LOGO_LOCKUP_CLASS}
        aria-label="Keynetic"
      >
        <Image
          src={assets.icon.src}
          alt=""
          width={assets.icon.width}
          height={assets.icon.height}
          className={LOGO_ICON_CLASS}
          priority={priority}
          aria-hidden
        />

        <Image
          src={assets.wordmark.src}
          alt=""
          width={assets.wordmark.width}
          height={assets.wordmark.height}
          className={LOGO_WORDMARK_CLASS}
          priority={priority}
          aria-hidden
        />
      </Link>
    );
  }

  return (
    <Link
      href={href}
      className={`${LOGO_LOCKUP_CLASS} max-w-[min(100%,14rem)] sm:max-w-none`}
      aria-label={`Keynetic — ${KEYNETIC_TAGLINE}`}
    >
      <Image
        src={assets.icon.src}
        alt=""
        width={assets.icon.width}
        height={assets.icon.height}
        className={`${LOGO_ICON_CLASS} shrink-0`}
        priority={priority}
        aria-hidden
      />

      <span className="flex min-w-0 flex-col justify-center">
        <Image
          src={assets.wordmark.src}
          alt=""
          width={assets.wordmark.width}
          height={assets.wordmark.height}
          className={LOGO_WORDMARK_CLASS}
          priority={priority}
          aria-hidden
        />

        <span className={`${taglineClass} truncate sm:whitespace-normal`}>
          {KEYNETIC_TAGLINE}
        </span>
      </span>
    </Link>
  );
}
