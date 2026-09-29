/**
 * Production MoveLoop logo assets — supplied stacked lockup (icon, wordmark, tagline).
 * Source PNGs are 2:1 with transparent canvas; render with a fixed height and
 * `w-auto` so the aspect ratio is preserved. Do not crop or re-export.
 */
export type LogoAssetDimensions = {
  src: string;
  width: number;
  height: number;
};

export const KEYNETIC_LOGO_ASSETS = {
  /** Dark lettering — light backgrounds */
  light: {
    src: "/logos/MoveLoop Logo.png",
    width: 1774,
    height: 887,
  },
  /** White lettering — dark backgrounds */
  dark: {
    src: "/logos/MoveLoop Logo White.png",
    width: 1774,
    height: 887,
  },
} satisfies Record<"light" | "dark", LogoAssetDimensions>;

/**
 * Lockup height (width = 2× height): 60px mobile, 72px from sm, 68px at md so the
 * full desktop nav fits at 768px, 72px again from lg.
 */
export const LOGO_IMAGE_CLASS =
  "block h-15 w-auto max-w-full object-contain sm:h-18 md:h-17 lg:h-18";

export const LOGO_IMAGE_SIZES =
  "(min-width: 1024px) 144px, (min-width: 768px) 136px, (min-width: 640px) 144px, 120px";

export const LOGO_LINK_CLASS = "inline-flex min-w-0 shrink-0 items-center";

/** Brand tagline — FD-039; canonical customer-facing string */
export const KEYNETIC_TAGLINE = "Moving Made Clear";
