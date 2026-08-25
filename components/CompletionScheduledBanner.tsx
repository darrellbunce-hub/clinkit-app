"use client";

import { useState } from "react";

import ChangeCompletionDateModal from "@/components/ChangeCompletionDateModal";
import ConfirmCompletionModal from "@/components/ConfirmCompletionModal";
import {
  COMPLETION_SCHEDULED_BANNER_FOOTER,
  COMPLETION_SCHEDULED_OPERATIONAL_FOOTER,
  COMPLETION_SCHEDULED_OPERATIONAL_INTRO,
  COMPLETION_SCHEDULED_STATUS_LABEL,
  computeCompletionCountdown,
  formatCompletionScheduledDate,
  getCompletionBannerPhase,
  getCompletionBannerPrompt,
  getCompletionBannerTitle,
} from "@/lib/completionLifecycle";
import type { CompletionAmendmentReasonCode } from "@/lib/completionLifecycle";

type CompletionScheduledBannerProps = {
  scheduledDate: string;
  variant?: "chain" | "operational";
  layout?: "banner" | "primary";
  showChangeButton?: boolean;
  showConfirmButton?: boolean;
  onChangeDate?: (
    newDate: string,
    reasonCode: CompletionAmendmentReasonCode
  ) => Promise<{ ok: boolean; message?: string }>;
  onConfirmCompletion?: () => Promise<{
    ok: boolean;
    message?: string;
  }>;
};

export default function CompletionScheduledBanner({
  scheduledDate,
  variant = "chain",
  layout = "banner",
  showChangeButton = false,
  showConfirmButton = false,
  onChangeDate,
  onConfirmCompletion,
}: CompletionScheduledBannerProps) {
  const [isChangeModalOpen, setIsChangeModalOpen] =
    useState(false);
  const [isConfirmModalOpen, setIsConfirmModalOpen] =
    useState(false);

  const phase =
    getCompletionBannerPhase(scheduledDate);
  const bannerTitle =
    getCompletionBannerTitle(phase);
  const bannerPrompt =
    getCompletionBannerPrompt(phase);
  const countdown =
    computeCompletionCountdown(scheduledDate);

  const formattedDate =
    formatCompletionScheduledDate(scheduledDate);

  const footerText =
    variant === "operational"
      ? COMPLETION_SCHEDULED_OPERATIONAL_FOOTER
      : COMPLETION_SCHEDULED_BANNER_FOOTER;

  const isPrimaryLayout = layout === "primary";
  const showChangeControl =
    showChangeButton &&
    onChangeDate &&
    phase !== "passed";
  const showConfirmControl =
    showConfirmButton &&
    onConfirmCompletion &&
    phase === "passed";

  return (
    <>
      <div
        className={
          isPrimaryLayout
            ? `mt-8 rounded-3xl border-2 p-10 shadow-sm ${
                phase === "passed"
                  ? "border-amber-300 bg-amber-50"
                  : "border-green-300 bg-green-50"
              }`
            : `mt-8 rounded-3xl border p-8 ${
                phase === "passed"
                  ? "border-amber-200 bg-amber-50"
                  : "border-green-200 bg-green-50"
              }`
        }
      >
        <p
          className={
            isPrimaryLayout
              ? `text-3xl font-bold ${
                  phase === "passed"
                    ? "text-amber-950"
                    : "text-green-900"
                }`
              : `text-2xl font-bold ${
                  phase === "passed"
                    ? "text-amber-950"
                    : "text-green-900"
                }`
          }
        >
          {bannerTitle}
        </p>

        {isPrimaryLayout ? (
          <div className="mt-8 grid gap-6 md:grid-cols-3">
            <div>
              <p
                className={`text-sm font-medium ${
                  phase === "passed"
                    ? "text-amber-800"
                    : "text-green-800"
                }`}
              >
                Completion Date
              </p>
              <p
                className={`mt-2 text-2xl font-bold ${
                  phase === "passed"
                    ? "text-amber-950"
                    : "text-green-900"
                }`}
              >
                {formattedDate}
              </p>
            </div>

            <div>
              <p
                className={`text-sm font-medium ${
                  phase === "passed"
                    ? "text-amber-800"
                    : "text-green-800"
                }`}
              >
                {phase === "today"
                  ? "Expected"
                  : "Days Remaining"}
              </p>
              <p
                className={`mt-2 text-2xl font-bold ${
                  phase === "passed"
                    ? "text-amber-950"
                    : "text-green-900"
                }`}
              >
                {phase === "today"
                  ? "Today"
                  : countdown.daysRemaining < 0
                    ? "Passed"
                    : countdown.daysRemaining === 1
                      ? "1 day"
                      : `${countdown.daysRemaining} days`}
              </p>
              <p
                className={`mt-1 text-sm ${
                  phase === "passed"
                    ? "text-amber-800"
                    : "text-green-800"
                }`}
              >
                {bannerPrompt ?? countdown.countdownLabel}
              </p>
            </div>

            <div>
              <p
                className={`text-sm font-medium ${
                  phase === "passed"
                    ? "text-amber-800"
                    : "text-green-800"
                }`}
              >
                Status
              </p>
              <p
                className={`mt-2 text-lg font-semibold ${
                  phase === "passed"
                    ? "text-amber-950"
                    : "text-green-900"
                }`}
              >
                {phase === "passed"
                  ? bannerPrompt
                  : phase === "today"
                    ? bannerPrompt
                    : COMPLETION_SCHEDULED_STATUS_LABEL}
              </p>
            </div>
          </div>
        ) : (
          <>
            {variant === "operational" ? (
              <>
                <p
                  className={`mt-4 ${
                    phase === "passed"
                      ? "text-amber-900"
                      : "text-green-900"
                  }`}
                >
                  {COMPLETION_SCHEDULED_OPERATIONAL_INTRO}
                </p>
                <p
                  className={`mt-1 text-3xl font-bold ${
                    phase === "passed"
                      ? "text-amber-950"
                      : "text-green-900"
                  }`}
                >
                  {formattedDate}
                </p>
              </>
            ) : (
              <>
                <p
                  className={`mt-4 text-sm font-medium ${
                    phase === "passed"
                      ? "text-amber-800"
                      : "text-green-800"
                  }`}
                >
                  Completion Date:
                </p>
                <p
                  className={`mt-1 text-3xl font-bold ${
                    phase === "passed"
                      ? "text-amber-950"
                      : "text-green-900"
                  }`}
                >
                  {formattedDate}
                </p>
              </>
            )}

            {phase !== "passed" && (
              <>
                <p className="mt-4 text-sm font-medium text-green-800">
                  Countdown:
                </p>
                <p className="mt-1 text-xl font-semibold text-green-900">
                  {phase === "today"
                    ? "Completion today"
                    : countdown.daysRemainingLabel}
                </p>
                <p className="mt-1 text-sm text-green-800">
                  {bannerPrompt ?? countdown.countdownLabel}
                </p>
              </>
            )}

            {phase === "passed" && bannerPrompt && (
              <p className="mt-4 text-sm text-amber-900">
                {bannerPrompt}
              </p>
            )}
          </>
        )}

        {showChangeControl && (
          <button
            type="button"
            onClick={() => setIsChangeModalOpen(true)}
            className="mt-6 rounded-2xl border border-green-700 bg-white px-5 py-3 text-sm font-semibold text-green-900 hover:bg-green-100"
          >
            Change Completion Date
          </button>
        )}

        {showConfirmControl && (
          <button
            type="button"
            onClick={() => setIsConfirmModalOpen(true)}
            className="mt-6 rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-800"
          >
            Confirm Completion
          </button>
        )}

        {!isPrimaryLayout &&
          phase !== "passed" && (
            <p className="mt-4 text-sm text-green-800">
              {footerText}
            </p>
          )}
      </div>

      {showChangeControl && (
        <ChangeCompletionDateModal
          isOpen={isChangeModalOpen}
          currentDate={scheduledDate}
          onClose={() => setIsChangeModalOpen(false)}
          onConfirm={onChangeDate}
        />
      )}

      {showConfirmControl && onConfirmCompletion && (
        <ConfirmCompletionModal
          isOpen={isConfirmModalOpen}
          scheduledDate={scheduledDate}
          onClose={() => setIsConfirmModalOpen(false)}
          onConfirm={onConfirmCompletion}
        />
      )}
    </>
  );
}
