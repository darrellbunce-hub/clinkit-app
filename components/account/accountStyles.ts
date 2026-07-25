import { CARD_PADDING_CLASS } from "@/components/mobileStandards";
import {
  AUTH_ERROR_CLASS,
  AUTH_INPUT_CLASS,
  AUTH_PRIMARY_BUTTON_CLASS,
  AUTH_SECONDARY_BUTTON_CLASS,
  AUTH_SUCCESS_CLASS,
} from "@/components/auth/authStyles";
import { BTN_SECONDARY_OUTLINE_CLASS } from "@/lib/theme/themeTokens";

export const accountInputClassName = AUTH_INPUT_CLASS;

export const accountButtonPrimaryClassName =
  AUTH_PRIMARY_BUTTON_CLASS;

export const accountButtonSecondaryClassName = `w-full ${BTN_SECONDARY_OUTLINE_CLASS} py-4 disabled:bg-slate-100 disabled:text-slate-400`;

export const accountAlertErrorClassName = AUTH_ERROR_CLASS;

export const accountAlertSuccessClassName = AUTH_SUCCESS_CLASS;

export const accountSectionClassName = `bg-surface-card rounded-3xl shadow-sm border border-surface-card-border ${CARD_PADDING_CLASS}`;
