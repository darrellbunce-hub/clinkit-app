import type {
  BriefKpiTone,
  OperationalBriefKpi,
} from "@/lib/estateAgent/workspacePresentation";
import {
  getBriefKpiIndicatorClasses,
  getBriefKpiToneClasses,
} from "@/lib/estateAgent/workspacePresentation";

export default function BriefKpiTile({
  kpi,
}: {
  kpi: OperationalBriefKpi;
}) {
  return (
    <div className="rounded-xl bg-surface-card px-4 py-4 ring-1 ring-surface-card-border">
      <div className="flex items-center gap-2">
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${getBriefKpiIndicatorClasses(kpi.tone)}`}
          aria-hidden="true"
        />

        <p className="text-sm text-text-muted">
          {kpi.label}
        </p>
      </div>

      <p
        className={`mt-2 text-2xl font-semibold tabular-nums ${getBriefKpiToneClasses(kpi.tone)}`}
      >
        {kpi.value}
      </p>
    </div>
  );
}
