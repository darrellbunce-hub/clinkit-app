import OperationalPropertyCard from "@/components/agent/commandCentre/OperationalPropertyCard";
import type { AgentBranchPropertySummary } from "@/lib/estateAgent/assignmentTypes";

export default function ActionRequiredSection({
  summaries,
}: {
  summaries: AgentBranchPropertySummary[];
}) {
  return (
    <section className="space-y-5">
      <div>
        <h2 className="text-2xl font-bold text-slate-900">
          Action Required
        </h2>

        <p className="mt-2 text-slate-600">
          Properties that need operational attention
          today, prioritised by severity and staleness.
        </p>
      </div>

      {summaries.length === 0 ? (
        <div className="rounded-3xl border border-green-200 bg-green-50/50 px-6 py-8">
          <p className="text-lg font-semibold text-green-900">
            No urgent operational actions
          </p>

          <p className="mt-2 text-sm text-green-800">
            All managed properties are currently
            within normal operational thresholds.
          </p>
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          {summaries.map((summary) => (
            <OperationalPropertyCard
              key={summary.assignment_id}
              summary={summary}
              variant="action"
            />
          ))}
        </div>
      )}
    </section>
  );
}
