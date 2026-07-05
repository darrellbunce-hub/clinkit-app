"use client";

import Image from "next/image";
import Link from "next/link";

import {
  KEYNETIC_LOGO_ASSETS,
  LOGO_ICON_CLASS,
  LOGO_LOCKUP_CLASS,
  LOGO_WORDMARK_CLASS,
} from "@/lib/theme/logoAssets";

export type LogoVariant = "light" | "dark";

export default function Logo({
  href = "/",
  variant = "light",
  priority = false,
}: {
  href?: string;
  variant?: LogoVariant;
  priority?: boolean;
}) {
  const assets = KEYNETIC_LOGO_ASSETS[variant];

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
