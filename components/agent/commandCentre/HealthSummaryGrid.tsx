export default function HealthSummaryGrid({
  healthy,
  attention,
  critical,
  averageConfidence,
}: {
  healthy: number;
  attention: number;
  critical: number;
  averageConfidence: number | null;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <HealthSummaryItem
        label="Healthy"
        value={String(healthy)}
        tone="healthy"
      />

      <HealthSummaryItem
        label="Attention"
        value={String(attention)}
        tone="attention"
      />

      <HealthSummaryItem
        label="Critical"
        value={String(critical)}
        tone="critical"
      />

      <HealthSummaryItem
        label="Average confidence"
        value={
          averageConfidence == null
            ? "—"
            : `${averageConfidence}%`
        }
        tone="neutral"
      />
    </div>
  );
}

function HealthSummaryItem({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "healthy" | "attention" | "critical" | "neutral";
}) {
  const valueClasses = {
    healthy: "text-green-700",
    attention: "text-amber-700",
    critical: "text-red-700",
    neutral: "text-slate-900",
  }[tone];

  return (
    <div className="rounded-2xl bg-white px-5 py-4 shadow-sm ring-1 ring-slate-200/70">
      <p className="text-sm text-slate-500">
        {label}
      </p>

      <p
        className={`mt-1 text-2xl font-semibold tabular-nums ${valueClasses}`}
      >
        {value}
      </p>
    </div>
  );
}
