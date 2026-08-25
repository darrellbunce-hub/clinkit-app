import ChainCompletedBanner from "@/components/ChainCompletedBanner";
import CompletionScheduledBanner from "@/components/CompletionScheduledBanner";
import RecordCompletionDateForm from "@/components/RecordCompletionDateForm";
import { COMPLETION_DATE_REQUIRED_INTRO } from "@/lib/completionLifecycle";
import type { CompletionAmendmentReasonCode } from "@/lib/completionLifecycle";

type OperationalCompletionDatePanelProps = {
  chainScheduledDate: string | null | undefined;
  chainLifecycleStatus: string | null | undefined;
  completionConfirmedAt: string | null | undefined;
  showEntryForm: boolean;
  showChangeButton?: boolean;
  showConfirmButton?: boolean;
  onSubmit: (
    scheduledDate: string
  ) => Promise<{ ok: boolean; message?: string }>;
  onChangeDate?: (
    newDate: string,
    reasonCode: CompletionAmendmentReasonCode
  ) => Promise<{ ok: boolean; message?: string }>;
  onConfirmCompletion?: () => Promise<{
    ok: boolean;
    message?: string;
  }>;
};

export default function OperationalCompletionDatePanel({
  chainScheduledDate,
  chainLifecycleStatus,
  completionConfirmedAt,
  showEntryForm,
  showChangeButton = false,
  showConfirmButton = false,
  onSubmit,
  onChangeDate,
  onConfirmCompletion,
}: OperationalCompletionDatePanelProps) {
  if (
    chainLifecycleStatus === "completed" &&
    chainScheduledDate &&
    completionConfirmedAt
  ) {
    return (
      <ChainCompletedBanner
        scheduledDate={chainScheduledDate}
        confirmedAt={completionConfirmedAt}
        variant="operational"
      />
    );
  }

  if (chainScheduledDate) {
    return (
      <CompletionScheduledBanner
        scheduledDate={chainScheduledDate}
        variant="operational"
        showChangeButton={showChangeButton}
        showConfirmButton={showConfirmButton}
        onChangeDate={onChangeDate}
        onConfirmCompletion={onConfirmCompletion}
      />
    );
  }

  if (!showEntryForm) {
    return null;
  }

  return (
    <div className="mt-8 rounded-3xl border border-amber-200 bg-amber-50 p-8">
      <p className="text-2xl font-bold text-amber-950">
        🏁 Completion Date Required
      </p>

      <p className="mt-4 text-amber-900">
        {COMPLETION_DATE_REQUIRED_INTRO}
      </p>

      <RecordCompletionDateForm
        variant="embedded"
        onSubmit={onSubmit}
      />
    </div>
  );
}
