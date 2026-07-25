import { AUTH_TITLE_CLASS, CARD_PADDING_CLASS } from "@/components/mobileStandards";

/** Full-page auth shell — matches homeowner login reference. */
export const AUTH_PAGE_CLASS =
  "min-h-screen bg-slate-100 flex items-center justify-center px-6 py-12";

/** Estate agent auth section inside marketing shell. */
export const AUTH_EA_SECTION_CLASS =
  "max-w-xl mx-auto px-6 py-16";

/** White auth card — shared across all authentication surfaces. */
export const AUTH_CARD_CLASS = `w-full max-w-md bg-white rounded-3xl shadow-sm border border-surface-card-border ${CARD_PADDING_CLASS}`;

export { AUTH_TITLE_CLASS };

export const AUTH_SUBTITLE_CLASS = "mt-2 text-slate-600";

export const AUTH_LABEL_CLASS =
  "block text-sm font-medium text-slate-700";

export const AUTH_INPUT_CLASS =
  "mt-2 w-full border border-slate-300 text-base text-slate-900 rounded-2xl px-4 py-3 disabled:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-brand-primary/25 focus:border-brand-primary";

export const AUTH_FORM_CLASS = "mt-8 space-y-6";

export const AUTH_BUTTON_STACK_CLASS = "space-y-4";

export const AUTH_ERROR_CLASS =
  "rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800";

export const AUTH_SUCCESS_CLASS =
  "rounded-2xl border border-green-200 bg-green-50 px-4 py-3 text-sm font-medium text-green-800";

export const AUTH_PRIMARY_BUTTON_CLASS =
  "w-full bg-slate-900 text-white rounded-2xl py-4 font-semibold disabled:bg-slate-400";

export const AUTH_SECONDARY_BUTTON_CLASS =
  "w-full border border-slate-300 text-slate-900 rounded-2xl py-4 font-semibold disabled:bg-slate-100 disabled:text-slate-400";

export const AUTH_FOOTER_TEXT_CLASS = "mt-6 text-sm text-slate-600";

export const AUTH_FOOTER_LINK_CLASS =
  "font-semibold text-slate-900 underline";

export const AUTH_INLINE_LINK_CLASS =
  "text-sm font-medium text-slate-600 hover:text-brand-primary underline underline-offset-2";

/** @deprecated Use AUTH_INPUT_CLASS — kept for existing imports. */
export const AUTH_PASSWORD_INPUT_CLASS = AUTH_INPUT_CLASS;
