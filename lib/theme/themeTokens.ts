import { CARD_PADDING_CLASS } from "@/components/mobileStandards";

/**
 * Semantic Tailwind classes backed by CSS variables in globals.css.
 * Prefer these over hard-coded brand colours in new work.
 */

export const PAGE_BG_CLASS = "min-h-screen bg-surface-page";

/** Thin identity strip — visible immediately below nav on product pages */
export const PAGE_HEADER_BAND_CLASS =
  "h-1.5 w-full bg-gradient-to-r from-brand-hero-from via-brand-primary to-brand-hero-to shrink-0";

export const SECTION_BG_CLASS =
  "relative overflow-hidden bg-surface-section border-y border-surface-section-border";

export const SECTION_CONTENT_CLASS = "max-w-6xl mx-auto px-6 py-24";

export const SURFACE_MUTED_CLASS = "bg-surface-muted rounded-2xl";

export const SURFACE_INSET_CLASS = "bg-surface-inset rounded-2xl";

export const SURFACE_PANEL_CLASS = "bg-surface-panel";

export const SURFACE_PANEL_HOVER_CLASS =
  "hover:bg-surface-panel-hover transition";

export const CARD_CLASS = `bg-surface-card rounded-3xl border border-surface-card-border shadow-sm ${CARD_PADDING_CLASS}`;

export const CARD_CLASS_NO_PADDING =
  "bg-surface-card rounded-3xl border border-surface-card-border shadow-sm";

export const DASHBOARD_LIST_CLASS =
  "divide-y divide-surface-divider border border-surface-divider rounded-2xl overflow-hidden";

export const DASHBOARD_LIST_ROW_CLASS =
  "px-4 py-3 bg-surface-card";

export const CHAIN_VIZ_CANVAS_CLASS =
  "rounded-2xl bg-chain-viz-canvas p-4 md:p-6";

export const CHAIN_PROGRESS_TRACK_CLASS =
  "w-full h-6 bg-chain-progress-track rounded-full overflow-hidden";

export const CHAIN_PROGRESS_FILL_CLASS =
  "h-full bg-chain-progress-fill rounded-full";

export const CHAIN_CONNECTOR_HEALTHY_CLASS =
  "w-24 h-1 rounded-full bg-chain-connector-healthy";

export const CHAIN_CONNECTOR_NEUTRAL_CLASS =
  "w-24 h-1 rounded-full bg-chain-connector-neutral";

export const MARKETING_SECTION_GLOW_CLASS =
  "absolute top-[-150px] right-[-100px] w-[400px] h-[400px] bg-marketing-section-glow rounded-full blur-3xl opacity-60";

export const MARKETING_STEP_CARD_CLASS =
  "relative overflow-hidden bg-marketing-step-bg rounded-3xl p-8 border border-marketing-step-border hover:shadow-2xl hover:shadow-marketing-feature-shadow transition-all duration-300";

export const MARKETING_STEP_ACCENT_BAR_CLASS =
  "absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-marketing-step-accent-from to-marketing-step-accent-to";

export const MARKETING_STEP_NUMBER_CLASS =
  "w-16 h-16 rounded-2xl bg-marketing-step-number-bg text-marketing-step-number-text flex items-center justify-center text-3xl font-bold";

export const MARKETING_FEATURE_CARD_CLASS =
  "bg-surface-card rounded-3xl border border-surface-card-border p-8 hover:-translate-y-2 hover:shadow-2xl hover:shadow-marketing-feature-shadow transition-all duration-300";

export const MARKETING_FEATURE_ICON_CLASS = "w-12 h-12 text-marketing-feature-icon";

export const MARKETING_METRIC_CARD_CLASS =
  "bg-marketing-metric-bg rounded-3xl p-8 border border-surface-card-border";

export const FOOTER_BG_CLASS = "bg-footer-bg border-t border-footer-border";

/** Primary CTA — Mimosa fill (brand accent). Teal is reserved for links, nav, and outlines. */
export const BTN_PRIMARY_CLASS =
  "bg-brand-accent text-brand-on-accent rounded-2xl font-semibold hover:bg-brand-accent-hover transition shadow-lg shadow-brand-accent/30 disabled:bg-slate-400 disabled:cursor-not-allowed disabled:shadow-none";

export const BTN_PRIMARY_SM_CLASS =
  "bg-brand-accent text-brand-on-accent rounded-xl font-semibold hover:bg-brand-accent-hover transition shadow-lg shadow-brand-accent/20 disabled:bg-slate-400 disabled:shadow-none";

export const BTN_ACCENT_CLASS =
  "bg-brand-accent text-brand-on-accent rounded-2xl font-semibold hover:bg-brand-accent-hover transition shadow-lg shadow-brand-accent/30";

export const BTN_ACCENT_SM_CLASS =
  "bg-brand-accent text-brand-on-accent rounded-xl font-semibold hover:bg-brand-accent-hover transition shadow-lg shadow-brand-accent/20";

export const BTN_SECONDARY_OUTLINE_CLASS =
  "border border-brand-primary bg-surface-card text-brand-primary rounded-2xl font-semibold hover:bg-surface-mist transition";

export const BTN_SECONDARY_OUTLINE_SM_CLASS =
  "border border-brand-primary bg-surface-card text-brand-primary rounded-xl font-semibold hover:bg-surface-mist transition";

export const BTN_DANGER_SM_CLASS =
  "border border-status-critical bg-surface-card text-status-critical rounded-xl font-semibold hover:bg-status-critical-soft transition";

export const BTN_SUCCESS_SM_CLASS =
  "border border-status-success bg-surface-card text-status-success rounded-xl font-semibold hover:bg-status-success-soft transition";

export const FONT_HEADING_CLASS =
  "font-[family-name:var(--font-heading)]";

export const WORKSPACE_CARD_CLASS =
  "rounded-2xl bg-surface-card shadow-sm ring-1 ring-surface-card-border";

export const WORKSPACE_SECTION_TITLE_CLASS = `text-xl font-semibold text-text-charcoal ${FONT_HEADING_CLASS}`;

export const WORKSPACE_HERO_PANEL_CLASS =
  "overflow-hidden rounded-2xl bg-surface-card shadow-md ring-1 ring-surface-card-border";

export const BTN_GHOST_DARK_CLASS =
  "border border-white/20 bg-white/10 backdrop-blur-xl text-white rounded-2xl font-semibold hover:bg-white/20 transition";

export const LINK_BRAND_CLASS =
  "text-brand-link hover:text-brand-link-hover font-semibold transition";

export const LINK_MUTED_CLASS =
  "text-slate-600 hover:text-brand-primary transition";

export const NAV_HEADER_DARK_CLASS =
  "sticky top-0 z-50 bg-brand-header-solid border-b border-brand-header-border";

export const NAV_HEADER_MOBILE_DRAWER_CLASS =
  "md:hidden border-t border-brand-header-border bg-brand-header-solid";

export const NAV_LINK_DARK_CLASS =
  "text-brand-header-link hover:text-brand-header-link-hover transition";

export const HERO_GRADIENT_CLASS =
  "bg-gradient-to-br from-brand-hero-from via-brand-hero-via to-brand-hero-to";

export const HERO_GLOW_PRIMARY_CLASS =
  "absolute top-[-200px] right-[-100px] w-[500px] h-[500px] bg-brand-glow-primary rounded-full blur-3xl";

export const HERO_GLOW_SECONDARY_CLASS =
  "absolute bottom-[-200px] left-[-100px] w-[400px] h-[400px] bg-brand-glow-secondary rounded-full blur-3xl";

export const HERO_BADGE_CLASS =
  "inline-flex items-center bg-brand-accent text-text-charcoal px-4 py-2 rounded-full text-sm font-semibold shadow-lg shadow-brand-accent/30";

/** Marketing hero headline — tighter on very small screens */
export const HERO_TITLE_CLASS =
  "text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-bold text-white leading-tight";

/** Hero illustration card — higher contrast on dark teal backgrounds */
export const HERO_ILLUSTRATION_CARD_CLASS =
  "rounded-3xl border border-white/20 bg-white/12 backdrop-blur-xl shadow-xl shadow-black/10";

export const GLASS_CARD_CLASS =
  "bg-white/10 backdrop-blur-xl rounded-3xl border border-white/10";

export const OPERATIONAL_NODE_RING_CLASS =
  "border-brand-operational ring-4 ring-brand-operational-soft";

export const LOGO_WORDMARK_DARK_CLASS = "text-brand-logo-dark";

export const LOGO_TAGLINE_DARK_CLASS = "text-brand-logo-tagline-dark";

export const LOGO_WORDMARK_LIGHT_CLASS = "text-brand-logo-light";

export const LOGO_TAGLINE_LIGHT_CLASS = "text-brand-logo-tagline-light";

export const LOGO_ACCENT_BAR_CLASS = "bg-brand-secondary";

export const TAB_ACTIVE_CLASS =
  "border-b-2 border-brand-primary text-brand-primary font-semibold";

export const INFO_CALLOUT_CLASS =
  "rounded-2xl border border-brand-info-border bg-brand-info-bg px-5 py-4 text-brand-info-text";

export const CHAIN_SCROLL_FADE_LEFT_CLASS =
  "pointer-events-none absolute left-0 top-0 bottom-4 z-10 w-10 bg-gradient-to-r from-surface-card to-transparent md:hidden";

export const CHAIN_SCROLL_FADE_RIGHT_CLASS =
  "pointer-events-none absolute right-0 top-0 bottom-4 z-10 w-14 bg-gradient-to-l from-surface-card to-transparent md:hidden";
