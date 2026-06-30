import OperationalPropertyCard from "@/components/agent/commandCentre/OperationalPropertyCard";
import type { AgentBranchPropertySummary } from "@/lib/estateAgent/assignmentTypes";

export default function ManagedPropertiesSection({
  summaries,
}: {
  summaries: AgentBranchPropertySummary[];
}) {
  return (
    <section className="space-y-5">
      <div>
        <h2 className="text-2xl font-bold text-slate-900">
          Managed Properties
        </h2>

        <p className="mt-2 text-slate-600">
          All active assigned properties, ordered by
          operational priority.
        </p>
      </div>

      {summaries.length === 0 ? (
        <div className="rounded-3xl border border-slate-200 bg-white px-6 py-10 text-center">
          <h3 className="text-xl font-bold text-slate-900">
            No active properties assigned yet
          </h3>

          <p className="mt-3 text-slate-600">
            When homeowners assign your branch to a
            property, operational cards will appear
            here.
          </p>
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          {summaries.map((summary) => (
            <OperationalPropertyCard
              key={summary.assignment_id}
              summary={summary}
              variant="managed"
            />
          ))}
        </div>
      )}
    </section>
  );
}
