import BriefKpiTile from "@/components/agent/commandCentre/BriefKpiTile";
import type { OperationalBriefModel } from "@/lib/estateAgent/workspacePresentation";
import { getBriefHealthIndicatorClasses } from "@/lib/estateAgent/workspacePresentation";

export default function OperationalBriefSection({
  brief,
}: {
  brief: OperationalBriefModel;
}) {
  return (
    <section
      aria-labelledby="operational-brief-heading"
      className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200/70 sm:p-8"
    >
      <div className="flex items-start gap-3">
        <span
          className={`mt-2 h-2.5 w-2.5 shrink-0 rounded-full ${getBriefHealthIndicatorClasses(brief.healthLevel)}`}
          aria-hidden="true"
        />

        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium uppercase tracking-wide text-slate-500">
            Operational health
          </p>

          <h2
            id="operational-brief-heading"
            className="mt-1 text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl"
          >
            {brief.healthHeadline}
          </h2>

          <p className="mt-2 text-sm text-slate-600">
            {brief.summarySentence}
          </p>
        </div>
      </div>

      <div className="mt-8 border-t border-slate-100 pt-6">
        <p className="text-sm text-slate-500">
          Active transactions
        </p>

        <p className="mt-1 text-4xl font-semibold tabular-nums tracking-tight text-slate-900">
          {brief.activeTransactions}
        </p>
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {brief.kpis.map((kpi) => (
          <BriefKpiTile
            key={kpi.label}
            kpi={kpi}
          />
        ))}
      </div>
    </section>
  );
}
