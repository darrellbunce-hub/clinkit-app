/**
 * Canonical Keynetic brand system — locked visual identity.
 * Values mirror CSS variables in globals.css (:root / keynetic theme).
 */

export const BRAND_COLORS = {
  teal: "#0E7C7B",
  mimosa: "#FFC62F",
  white: "#FFFFFF",
  mist: "#E6F3F2",
  stone: "#F3F5F6",
  charcoal: "#1F2933",
} as const;

export const STATUS_COLORS = {
  success: "#16A34A",
  warning: "#D97706",
  critical: "#DC2626",
  unknown: "#64748B",
} as const;

export const BRAND_TYPOGRAPHY = {
  heading: "var(--font-heading)",
  body: "var(--font-body)",
} as const;

export const BRAND_SPACING = {
  cardRadius: "1rem",
  cardRadiusLg: "1.25rem",
  sectionGap: "2.5rem",
  cardPadding: "1.25rem",
} as const;
