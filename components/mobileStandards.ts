/**
 * Shared mobile design tokens for Keynetic.
 * Reuse across Phase 2+ mobile optimisation work.
 */

/** Primary page title — mobile 3xl → tablet 4xl → desktop 5xl */
export const PAGE_TITLE_CLASS =
  "text-3xl md:text-4xl lg:text-5xl font-bold text-slate-900";

/** Page title on dark backgrounds */
export const PAGE_TITLE_INVERTED_CLASS =
  "text-3xl md:text-4xl lg:text-5xl font-bold text-white";

/** Section headings inside pages (h2) */
export const SECTION_TITLE_CLASS =
  "text-2xl md:text-3xl lg:text-4xl font-bold text-slate-900";

/** Auth card titles (login, signup, forgot password) */
export const AUTH_TITLE_CLASS =
  "text-3xl md:text-4xl lg:text-5xl font-bold text-slate-900";

/** Large stat / metric values */
export const STAT_VALUE_CLASS =
  "text-2xl md:text-3xl lg:text-4xl font-bold text-slate-900";

/** Marketing section headings on light backgrounds */
export const MARKETING_SECTION_TITLE_CLASS =
  "text-3xl md:text-4xl lg:text-5xl font-bold text-slate-900";

/** Card padding — tighter on mobile */
export const CARD_PADDING_CLASS = "p-6 md:p-8";

/** Minimum 44×44px touch target (WCAG 2.5.5) */
export const TOUCH_TARGET_CLASS =
  "inline-flex items-center justify-center min-h-11 min-w-11";

/** Icon-only menu button — dark headers */
export const MENU_BUTTON_CLASS =
  "md:hidden inline-flex items-center justify-center min-h-11 min-w-11 rounded-xl text-white text-2xl hover:bg-white/10 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white";

/** Icon-only menu button — light headers */
export const MENU_BUTTON_LIGHT_CLASS =
  "md:hidden inline-flex items-center justify-center min-h-11 min-w-11 rounded-xl text-slate-900 text-2xl hover:bg-slate-100 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-400";

/** Mobile nav link in drawer menus */
export const MOBILE_NAV_LINK_CLASS =
  "text-slate-600 hover:text-slate-900 transition py-3 min-h-11 inline-flex items-center w-full";

/** Mobile nav link — dark drawer (homeowner) */
export const MOBILE_NAV_LINK_DARK_CLASS =
  "text-slate-300 hover:text-white transition py-3 min-h-11 inline-flex items-center w-full";

/** Stacked panel: content + aside badge/action */
export const MOBILE_PANEL_HEADER_CLASS =
  "flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6";

/** Card header: title block + primary action */
export const MOBILE_ACTION_HEADER_CLASS =
  "flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between";

/** Page-level back links row */
export const MOBILE_PAGE_NAV_ROW_CLASS =
  "flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-4 mb-6";

/** Flash message stack above page nav */
export const MOBILE_ALERT_STACK_CLASS = "flex flex-col gap-3 mb-6";

/** Modal overlay — scrollable on short viewports */
export const MODAL_OVERLAY_CLASS =
  "fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/50 p-4 overflow-y-auto";

/** Modal panel — max height with internal scroll */
export const MODAL_PANEL_CLASS =
  "w-full max-w-xl max-h-[min(90dvh,calc(100vh-2rem))] overflow-y-auto rounded-3xl border border-slate-200 bg-white shadow-xl p-6 md:p-8";

/** Modal action button row */
export const MODAL_ACTIONS_CLASS =
  "mt-6 flex flex-col-reverse sm:flex-row sm:flex-wrap gap-3 [&_button]:min-h-11 [&_button]:w-full sm:[&_button]:w-auto";

/** Mobile chain scroll hint — hidden from md breakpoint up */
export const CHAIN_SCROLL_HINT_CLASS =
  "mb-3 text-center text-sm font-medium text-slate-500 md:hidden";

/** Chain horizontal scroll container — extends into card padding on mobile for peek */
export const CHAIN_SCROLL_REGION_CLASS =
  "overflow-x-auto overscroll-x-contain pb-4 -mx-6 px-6 md:mx-0 md:px-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-400 rounded-xl";

/** Edge fade overlays — mobile only */
export const CHAIN_SCROLL_FADE_LEFT_CLASS =
  "pointer-events-none absolute left-0 top-0 bottom-4 z-10 w-10 bg-gradient-to-r from-white to-transparent md:hidden";

export const CHAIN_SCROLL_FADE_RIGHT_CLASS =
  "pointer-events-none absolute right-0 top-0 bottom-4 z-10 w-14 bg-gradient-to-l from-white to-transparent md:hidden";
