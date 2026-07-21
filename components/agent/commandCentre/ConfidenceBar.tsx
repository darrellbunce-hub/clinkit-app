import {
  getConfidenceBarFillClass,
  getConfidenceLabel,
} from "@/lib/estateAgent/workspacePresentation";

export default function ConfidenceBar({
  score,
}: {
  score: number;
}) {
  const clamped = Math.max(
    0,
    Math.min(100, score)
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="text-text-muted">
          Chain confidence
        </span>

        <span className="font-semibold tabular-nums text-text-charcoal">
          {clamped}%
        </span>
      </div>

      <div
        className="h-2.5 w-full overflow-hidden rounded-full bg-surface-stone"
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Chain confidence ${clamped} percent`}
      >
        <div
          className={`h-full rounded-full transition-all ${getConfidenceBarFillClass(clamped)}`}
          style={{ width: `${clamped}%` }}
        />
      </div>

      <p className="text-xs font-medium text-text-muted">
        {getConfidenceLabel(clamped)}
      </p>
    </div>
  );
}
