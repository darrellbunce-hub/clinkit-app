import OperationalPropertyCard from "@/components/agent/commandCentre/OperationalPropertyCard";
import CommandCentreSectionHeader from "@/components/agent/commandCentre/CommandCentreSectionHeader";
import WorkspaceEmptyState from "@/components/agent/commandCentre/WorkspaceEmptyState";
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
        description="Operational reasons appear first so you know what to do next."
        icon="attention"
      />

      {summaries.length === 0 ? (
        <WorkspaceEmptyState
          icon="success"
          title="Nothing requires action right now"
          description="Everything is up to date across your managed properties."
        />
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
