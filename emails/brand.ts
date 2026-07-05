import { BRAND_COLORS } from "@/lib/theme/brandSystem";

export const EMAIL_BRAND = {
  teal: BRAND_COLORS.teal,
  mimosa: BRAND_COLORS.mimosa,
  charcoal: BRAND_COLORS.charcoal,
  white: BRAND_COLORS.white,
  mist: BRAND_COLORS.mist,
  stone: BRAND_COLORS.stone,
} as const;

export const EMAIL_FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

export const EMAIL_LAYOUT = {
  maxWidth: 600,
  outerPadding: 24,
  cardRadius: 16,
  sectionGap: 24,
} as const;
