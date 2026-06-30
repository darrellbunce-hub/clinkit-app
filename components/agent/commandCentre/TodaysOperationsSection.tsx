import OperationalKpiCard from "@/components/agent/commandCentre/OperationalKpiCard";
import type { TodaysOperationsKpis } from "@/lib/estateAgent/commandCentrePresentation";

export default function TodaysOperationsSection({
  kpis,
}: {
  kpis: TodaysOperationsKpis;
}) {
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold text-slate-900">
          Today&apos;s Operations
        </h2>

        <p className="mt-2 text-slate-600">
          Operational overview from cached branch
          summaries.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <OperationalKpiCard
          label="Active Chains"
          value={String(kpis.activeChains)}
        />

        <OperationalKpiCard
          label="Needs Attention"
          value={String(kpis.needsAttention)}
        />

        <OperationalKpiCard
          label="Critical"
          value={String(kpis.critical)}
        />

        <OperationalKpiCard
          label="Average Confidence"
          value={
            kpis.averageConfidence == null
              ? "—"
              : `${kpis.averageConfidence}%`
          }
        />

        <OperationalKpiCard
          label="Completing This Week"
          value={String(kpis.completingThisWeek)}
        />
      </div>
    </section>
  );
}
