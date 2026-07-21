/**
 * Production Keynetic logo assets — do not modify icon sources.
 * Wordmark PNGs are trimmed to visible letterforms (no excess canvas padding).
 */
export type LogoAssetDimensions = {
  src: string;
  width: number;
  height: number;
};

export type LogoVariantAssets = {
  icon: LogoAssetDimensions;
  wordmark: LogoAssetDimensions;
};

export const KEYNETIC_LOGO_ASSETS = {
  light: {
    icon: {
      src: "/logos/keynetic-icon-teal.png",
      width: 743,
      height: 760,
    },
    wordmark: {
      src: "/logos/keynetic-wordmark-teal-v2.png",
      width: 199,
      height: 53,
    },
  },
  dark: {
    icon: {
      src: "/logos/keynetic-icon-white.png",
      width: 743,
      height: 760,
    },
    wordmark: {
      src: "/logos/keynetic-wordmark-white-v2.png",
      width: 199,
      height: 53,
    },
  },
} satisfies Record<"light" | "dark", LogoVariantAssets>;

/** Icon: 36px mobile → 40px from sm (nav target ~64px) */
export const LOGO_ICON_CLASS =
  "block h-9 w-auto sm:h-10";

/** Wordmark: 26px mobile → 30px from sm — balanced against icon, not equal height */
export const LOGO_WORDMARK_CLASS =
  "block h-[26px] w-auto sm:h-[30px]";

/** Icon + wordmark lockup — vertically centred, 10–12px gap */
export const LOGO_LOCKUP_CLASS =
  "inline-flex min-w-0 shrink-0 items-center gap-[10px] sm:gap-3";

/** Brand tagline — FD-039; canonical customer-facing string */
export const KEYNETIC_TAGLINE = "Moving Made Clear";

const LOGO_TAGLINE_BASE_CLASS =
  "block font-normal tracking-wide leading-tight";

/** Tagline beneath wordmark — dark backgrounds (navbar, dark footer) */
export const LOGO_TAGLINE_DARK_CLASS = `${LOGO_TAGLINE_BASE_CLASS} mt-0.5 text-[11px] sm:text-xs text-slate-400`;

/** Tagline beneath wordmark — light backgrounds (EA marketing header) */
export const LOGO_TAGLINE_LIGHT_CLASS = `${LOGO_TAGLINE_BASE_CLASS} mt-0.5 text-[11px] sm:text-xs text-slate-500`;

/** @deprecated alias — use LOGO_TAGLINE_DARK_CLASS */
export const LOGO_TAGLINE_CLASS = LOGO_TAGLINE_DARK_CLASS;
