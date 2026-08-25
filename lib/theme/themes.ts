import type { BrandThemeId } from "@/lib/theme/types";

/** Production Keynetic Teal & Mimosa palette — fixed at launch. */
export const DEFAULT_BRAND_THEME_ID: BrandThemeId = "keynetic";

export function isBrandThemeId(
  value: string | null | undefined
): value is BrandThemeId {
  return value === "keynetic";
}
