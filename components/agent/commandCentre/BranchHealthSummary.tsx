import type { BranchHealthOverview } from "@/lib/estateAgent/commandCentrePresentation";
import { WORKSPACE_CARD_CLASS } from "@/lib/theme/themeTokens";

export default function BranchHealthSummary({
  overview,
  averageConfidence,
}: {
  overview: BranchHealthOverview;
  averageConfidence: number | null;
}) {
  return (
    <div className={`${WORKSPACE_CARD_CLASS} px-6 py-5`}>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
        <StatItem
          label="Healthy"
          value={String(overview.healthy)}
          tone="success"
        />

        <StatItem
          label="Attention"
          value={String(overview.attention)}
          tone="warning"
        />

        <StatItem
          label="Critical"
          value={String(overview.critical)}
          tone="critical"
        />

        <StatItem
          label="Average confidence"
          value={
            averageConfidence == null
              ? "—"
              : `${averageConfidence}%`
          }
          tone="neutral"
        />
      </dl>
    </div>
  );
}

function StatItem({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "success" | "warning" | "critical" | "neutral";
}) {
  const valueClass = {
    success: "text-status-success",
    warning: "text-status-warning",
    critical: "text-status-critical",
    neutral: "text-text-charcoal",
  }[tone];

  return (
    <div>
      <dt className="text-sm text-text-muted">
        {label}
      </dt>

      <dd
        className={`mt-1 text-2xl font-semibold tabular-nums ${valueClass}`}
      >
        {value}
      </dd>
    </div>
  );
}
