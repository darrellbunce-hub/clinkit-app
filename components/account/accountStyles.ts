import { CARD_PADDING_CLASS } from "@/components/mobileStandards";
import { BTN_PRIMARY_CLASS, BTN_SECONDARY_OUTLINE_CLASS } from "@/lib/theme/themeTokens";

export const accountInputClassName =
  "mt-2 w-full border border-slate-300 text-base text-slate-900 rounded-2xl px-4 py-3 disabled:bg-slate-100";

export const accountButtonPrimaryClassName = `w-full ${BTN_PRIMARY_CLASS} py-4`;

export const accountButtonSecondaryClassName = `w-full ${BTN_SECONDARY_OUTLINE_CLASS} py-4 disabled:bg-slate-100 disabled:text-slate-400`;

export const accountAlertErrorClassName =
  "rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800";

export const accountAlertSuccessClassName =
  "rounded-2xl border border-green-200 bg-green-50 px-4 py-3 text-sm font-medium text-green-800";

export const accountSectionClassName =
  `bg-surface-card rounded-3xl shadow-sm border border-surface-card-border ${CARD_PADDING_CLASS}`;
