import CommandCentreSectionHeader from "@/components/agent/commandCentre/CommandCentreSectionHeader";
import HealthSummaryGrid from "@/components/agent/commandCentre/HealthSummaryGrid";
import type { BranchHealthOverview } from "@/lib/estateAgent/commandCentrePresentation";

export default function BranchHealthSection({
  overview,
  averageConfidence,
}: {
  overview: BranchHealthOverview;
  averageConfidence: number | null;
}) {
  return (
    <section className="space-y-5">
      <CommandCentreSectionHeader
        title="Branch health"
        description="Operational health across active managed properties."
      />

      <HealthSummaryGrid
        healthy={overview.healthy}
        attention={overview.attention}
        critical={overview.critical}
        averageConfidence={averageConfidence}
      />
    </section>
  );
}
