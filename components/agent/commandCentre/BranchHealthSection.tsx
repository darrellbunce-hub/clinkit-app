import BranchHealthSummary from "@/components/agent/commandCentre/BranchHealthSummary";
import CommandCentreSectionHeader from "@/components/agent/commandCentre/CommandCentreSectionHeader";
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
        description="Concise operational health across active managed properties."
        icon="operationalHealth"
      />

      <BranchHealthSummary
        overview={overview}
        averageConfidence={averageConfidence}
      />
    </section>
  );
}
