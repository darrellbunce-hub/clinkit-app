"use client";

import Image from "next/image";
import Link from "next/link";

import {
  KEYNETIC_LOGO_ASSETS,
  KEYNETIC_TAGLINE,
  LOGO_IMAGE_CLASS,
  LOGO_IMAGE_SIZES,
  LOGO_LINK_CLASS,
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
  const asset = KEYNETIC_LOGO_ASSETS[variant];

  return (
    <Link
      href={href}
      className={LOGO_LINK_CLASS}
      aria-label={
        showTagline ? `MoveLoop — ${KEYNETIC_TAGLINE}` : "MoveLoop"
      }
    >
      <Image
        src={asset.src}
        alt=""
        width={asset.width}
        height={asset.height}
        sizes={LOGO_IMAGE_SIZES}
        className={LOGO_IMAGE_CLASS}
        priority={priority}
        aria-hidden
      />
    </Link>
  );
}
