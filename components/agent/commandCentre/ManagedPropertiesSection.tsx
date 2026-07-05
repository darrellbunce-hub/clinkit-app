import OperationalPropertyCard from "@/components/agent/commandCentre/OperationalPropertyCard";
import CommandCentreSectionHeader from "@/components/agent/commandCentre/CommandCentreSectionHeader";
import WorkspaceEmptyState from "@/components/agent/commandCentre/WorkspaceEmptyState";
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
        description="Current operational state for each assigned property."
        icon="managedProperties"
      />

      {summaries.length === 0 ? (
        <WorkspaceEmptyState
          icon="managedProperties"
          title="No active properties assigned yet"
          description="When homeowners assign your branch, operational cards will appear here."
        />
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
