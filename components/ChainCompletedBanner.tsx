import {
  CHAIN_COMPLETED_BANNER_FOOTER,
  formatCompletionConfirmedAt,
  formatCompletionScheduledDate,
} from "@/lib/completionLifecycle";

type ChainCompletedBannerProps = {
  scheduledDate: string;
  confirmedAt: string;
  variant?: "chain" | "operational";
  layout?: "banner" | "primary";
};

export default function ChainCompletedBanner({
  scheduledDate,
  confirmedAt,
  variant = "chain",
  layout = "banner",
}: ChainCompletedBannerProps) {
  const formattedCompletedDate =
    formatCompletionScheduledDate(scheduledDate);

  const formattedConfirmedAt =
    formatCompletionConfirmedAt(confirmedAt);

  const isPrimaryLayout = layout === "primary";

  if (variant === "operational") {
    return (
      <div className="mt-8 rounded-3xl border border-slate-300 bg-slate-50 p-8">
        <p className="text-2xl font-bold text-slate-900">
          ✅ Transaction Completed
        </p>

        <p className="mt-4 text-slate-700">
          This transaction completed on:
        </p>

        <p className="mt-1 text-3xl font-bold text-slate-900">
          {formattedCompletedDate}
        </p>

        <p className="mt-4 text-sm text-slate-600">
          No further updates are required.
        </p>
      </div>
    );
  }

  return (
    <div
      className={
        isPrimaryLayout
          ? "mt-8 rounded-3xl border-2 border-slate-300 bg-slate-50 p-10 shadow-sm"
          : "mt-8 rounded-3xl border border-slate-300 bg-slate-50 p-8"
      }
    >
      <p
        className={
          isPrimaryLayout
            ? "text-3xl font-bold text-slate-900"
            : "text-2xl font-bold text-slate-900"
        }
      >
        ✅ Chain Completed
      </p>

      {isPrimaryLayout ? (
        <div className="mt-8 grid gap-6 md:grid-cols-2">
          <div>
            <p className="text-sm font-medium text-slate-600">
              Completed:
            </p>
            <p className="mt-2 text-2xl font-bold text-slate-900">
              {formattedCompletedDate}
            </p>
          </div>

          <div>
            <p className="text-sm font-medium text-slate-600">
              Confirmed:
            </p>
            <p className="mt-2 text-2xl font-bold text-slate-900">
              {formattedConfirmedAt}
            </p>
          </div>
        </div>
      ) : (
        <>
          <p className="mt-4 text-sm font-medium text-slate-600">
            Completed:
          </p>
          <p className="mt-1 text-3xl font-bold text-slate-900">
            {formattedCompletedDate}
          </p>

          <p className="mt-4 text-sm font-medium text-slate-600">
            Confirmed:
          </p>
          <p className="mt-1 text-lg font-semibold text-slate-900">
            {formattedConfirmedAt}
          </p>
        </>
      )}

      <p className="mt-4 text-sm text-slate-600">
        {CHAIN_COMPLETED_BANNER_FOOTER}
      </p>
    </div>
  );
}
