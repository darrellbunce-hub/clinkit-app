"use client";

import {
  DORMANCY_WARNING_PANEL_BODY,
  DORMANCY_WARNING_PANEL_CONSEQUENCE,
  DORMANCY_WARNING_PANEL_TITLE,
  DORMANCY_WARNING_PRIMARY_ACTION,
} from "@/lib/lifecycle/dormancyConfirmationPresentation";
import { formatDormancyConfirmationDeadline } from "@/lib/lifecycle/stillActiveConfirmationEligibility";
import { MobilePanelHeader } from "@/components/mobile/MobileLayout";
import {
  CARD_PADDING_CLASS,
  SECTION_TITLE_CLASS,
  TOUCH_TARGET_CLASS,
} from "@/components/mobileStandards";
import { BTN_PRIMARY_CLASS } from "@/lib/theme/themeTokens";

type DormancyWarningPanelProps = {
  confirmationDeadlineAt: string | null;
  onConfirmClick: () => void;
  isConfirmDisabled?: boolean;
};

export default function DormancyWarningPanel({
  confirmationDeadlineAt,
  onConfirmClick,
  isConfirmDisabled = false,
}: DormancyWarningPanelProps) {
  const deadlineLabel = formatDormancyConfirmationDeadline(
    confirmationDeadlineAt
  );

  return (
    <div
      className={`mt-8 min-w-0 overflow-x-hidden bg-surface-card rounded-3xl shadow-sm border border-amber-200 ${CARD_PADDING_CLASS}`}
    >
      <MobilePanelHeader
        aside={
          <div className="max-w-full rounded-2xl bg-amber-100 px-4 py-3 text-center text-sm font-semibold text-amber-800 break-words sm:text-left">
            Confirmation needed
          </div>
        }
      >
        <p className="text-sm font-medium text-amber-700 break-words">
          Transaction activity
        </p>

        <h2 className={`mt-3 break-words ${SECTION_TITLE_CLASS}`}>
          {DORMANCY_WARNING_PANEL_TITLE}
        </h2>

        <p className="mt-4 max-w-2xl text-slate-700 break-words">
          {DORMANCY_WARNING_PANEL_BODY}
        </p>

        <p className="mt-4 max-w-2xl text-slate-700 break-words">
          {DORMANCY_WARNING_PANEL_CONSEQUENCE}
        </p>

        {deadlineLabel ? (
          <p className="mt-4 text-sm font-medium text-slate-600 break-words">
            Please confirm by {deadlineLabel}.
          </p>
        ) : null}
      </MobilePanelHeader>

      <div className="mt-6 w-full sm:w-auto">
        <button
          type="button"
          onClick={onConfirmClick}
          disabled={isConfirmDisabled}
          className={`${BTN_PRIMARY_CLASS} ${TOUCH_TARGET_CLASS} w-full px-5 py-3 text-center whitespace-normal disabled:opacity-60 sm:w-auto`}
        >
          {DORMANCY_WARNING_PRIMARY_ACTION}
        </button>
      </div>
    </div>
  );
}
