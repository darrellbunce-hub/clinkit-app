import OperationalPropertyCard from "@/components/agent/commandCentre/OperationalPropertyCard";
import CommandCentreSectionHeader from "@/components/agent/commandCentre/CommandCentreSectionHeader";
import type { AgentBranchPropertySummary } from "@/lib/estateAgent/assignmentTypes";

export default function ActionRequiredSection({
  summaries,
  onInvitationChanged,
}: {
  summaries: AgentBranchPropertySummary[];
  onInvitationChanged?: () => void | Promise<void>;
}) {
  return (
    <section className="space-y-5">
      <CommandCentreSectionHeader
        title="Requires action"
        description="Transactions that need attention, with the reason each one appears here."
      />

      {summaries.length === 0 ? (
        <div className="rounded-2xl bg-green-50/60 px-6 py-8 ring-1 ring-green-200/60">
          <p className="font-medium text-green-900">
            Nothing requires action right now
          </p>

          <p className="mt-1.5 text-sm text-green-800">
            All managed properties are within normal
            operational thresholds.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {summaries.map((summary) => (
            <OperationalPropertyCard
              key={summary.assignment_id}
              summary={summary}
              variant="action"
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
