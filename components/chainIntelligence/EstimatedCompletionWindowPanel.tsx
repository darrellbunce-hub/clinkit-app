import { STAT_VALUE_CLASS } from "@/components/mobileStandards";
import { parseEstimatedCompletionPresentation } from "@/lib/chainIntelligence/presentation";

type EstimatedCompletionWindowPanelProps = {
  rawWindow: string | null | undefined;
  title?: string;
  titleClassName?: string;
  className?: string;
};

export function EstimatedCompletionWindowPanel({
  rawWindow,
  title = "Estimated completion window",
  titleClassName = "text-slate-500",
  className,
}: EstimatedCompletionWindowPanelProps) {
  const parsed = parseEstimatedCompletionPresentation(rawWindow);

  return (
    <div className={className}>
      <p className={`text-sm font-medium ${titleClassName}`}>{title}</p>

      <p className={`mt-3 ${STAT_VALUE_CLASS}`}>{parsed.primaryValue}</p>

      {parsed.limitedCoverageQualifier ? (
        <p className="mt-2 text-sm font-medium text-slate-600 leading-relaxed">
          {parsed.limitedCoverageQualifier}
        </p>
      ) : null}

      {parsed.delayNote ? (
        <p className="mt-2 text-sm text-amber-700 leading-relaxed">
          {parsed.delayNote}
        </p>
      ) : null}

      <p className="mt-4 text-sm text-slate-500 max-w-2xl leading-relaxed">
        {parsed.disclaimer}
      </p>
    </div>
  );
}
