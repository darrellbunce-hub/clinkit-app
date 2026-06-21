import type { BrandThemeDefinition, BrandThemeId } from "@/lib/theme/types";

/** Default production theme — existing Keynetic colours. */
export const DEFAULT_BRAND_THEME_ID: BrandThemeId = "keynetic";

export const BRAND_THEMES: Record<
  BrandThemeId,
  BrandThemeDefinition
> = {
  keynetic: {
    id: "keynetic",
    label: "Current",
    description: "Existing Keynetic palette (slate product + blue marketing)",
    primary: "#0f172a",
    secondary: "#2563eb",
  },
  "teal-mimosa": {
    id: "teal-mimosa",
    label: "Teal & Mimosa",
    description: "Deep teal primary with warm mimosa accent",
    primary: "#00555A",
    secondary: "#FFC94B",
  },
  "butter-green": {
    id: "butter-green",
    label: "Butter & Green",
    description: "Forest green primary with soft butter highlight",
    primary: "#013E37",
    secondary: "#FFEFB3",
  },
};

export const BRAND_THEME_LIST = Object.values(BRAND_THEMES);

export function isBrandThemeId(
  value: string | null | undefined
): value is BrandThemeId {
  return (
    value === "keynetic" ||
    value === "teal-mimosa" ||
    value === "butter-green"
  );
}
