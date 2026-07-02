import OperationalPropertyCard from "@/components/agent/commandCentre/OperationalPropertyCard";
import CommandCentreSectionHeader from "@/components/agent/commandCentre/CommandCentreSectionHeader";
import type { AgentBranchPropertySummary } from "@/lib/estateAgent/assignmentTypes";

export default function ManagedPropertiesSection({
  summaries,
  onInvitationChanged,
}: {
  summaries: AgentBranchPropertySummary[];
  onInvitationChanged?: () => void | Promise<void>;
}) {
  return (
    <section className="space-y-5">
      <CommandCentreSectionHeader
        title="Managed properties"
        description="Active assigned properties, ordered by operational priority."
      />

      {summaries.length === 0 ? (
        <div className="rounded-2xl bg-white px-6 py-10 text-center shadow-sm ring-1 ring-slate-200/70">
          <h3 className="text-lg font-semibold text-slate-900">
            No active properties assigned yet
          </h3>

          <p className="mt-2 text-sm text-slate-600">
            When homeowners assign your branch to a
            property, operational cards will appear
            here.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {summaries.map((summary) => (
            <OperationalPropertyCard
              key={summary.assignment_id}
              summary={summary}
              variant="managed"
              onInvitationChanged={
                onInvitationChanged
              }
            />
          ))}
        </div>
      )}
    </section>
  );
}
