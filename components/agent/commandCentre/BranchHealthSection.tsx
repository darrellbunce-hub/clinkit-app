import OperationalKpiCard from "@/components/agent/commandCentre/OperationalKpiCard";
import type { BranchHealthOverview } from "@/lib/estateAgent/commandCentrePresentation";

export default function BranchHealthSection({
  overview,
}: {
  overview: BranchHealthOverview;
}) {
  return (
    <section className="space-y-5">
      <div>
        <h2 className="text-2xl font-bold text-slate-900">
          Branch Health
        </h2>

        <p className="mt-2 text-slate-600">
          Simple operational health distribution
          across active managed properties.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <OperationalKpiCard
          label="Healthy"
          value={String(overview.healthy)}
        />

        <OperationalKpiCard
          label="Attention"
          value={String(overview.attention)}
        />

        <OperationalKpiCard
          label="Critical"
          value={String(overview.critical)}
        />
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Confidence Distribution
        </h3>

        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <DistributionItem
            label="Healthy"
            value={overview.confidenceHealthy}
            tone="healthy"
          />

          <DistributionItem
            label="Progress Slowing"
            value={overview.confidenceSlowing}
            tone="attention"
          />

          <DistributionItem
            label="Needs Attention"
            value={overview.confidenceLow}
            tone="critical"
          />
        </div>
      </div>
    </section>
  );
}

function DistributionItem({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "healthy" | "attention" | "critical";
}) {
  const toneClasses = {
    healthy: "bg-green-50 text-green-800 border-green-200",
    attention:
      "bg-amber-50 text-amber-800 border-amber-200",
    critical: "bg-red-50 text-red-800 border-red-200",
  }[tone];

  return (
    <div
      className={`rounded-2xl border px-4 py-4 ${toneClasses}`}
    >
      <p className="text-sm font-medium">{label}</p>

      <p className="mt-2 text-2xl font-bold">
        {value}
      </p>
    </div>
  );
}
