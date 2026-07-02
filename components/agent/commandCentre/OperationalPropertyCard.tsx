import OperationalActionButton from "@/components/agent/commandCentre/OperationalActionButton";
import HomeownerStatusBadge from "@/components/agent/commandCentre/HomeownerStatusBadge";
import PropertyInvitationControls from "@/components/agent/commandCentre/PropertyInvitationControls";
import type { AgentBranchPropertySummary } from "@/lib/estateAgent/assignmentTypes";
import {
  formatDaysSinceLastUpdate,
  formatHealthLabel,
  formatManagedStageLabel,
  formatPropertyAddress,
  formatPropertyLocationLine,
  getHealthStatusClasses,
  getOperationalPriorityTier,
} from "@/lib/estateAgent/commandCentrePresentation";
import {
  getManagedPropertyOperationalState,
  getPrimaryActionRequiredReason,
  getSupportingActionRequiredReasons,
} from "@/lib/estateAgent/workspacePresentation";

type OperationalPropertyCardProps = {
  summary: AgentBranchPropertySummary;
  variant?: "action" | "managed";
  onInvitationChanged?: () => void | Promise<void>;
};

export default function OperationalPropertyCard({
  summary,
  variant = "managed",
  onInvitationChanged,
}: OperationalPropertyCardProps) {
  const tier = getOperationalPriorityTier(summary);
  const primaryReason =
    variant === "action"
      ? getPrimaryActionRequiredReason(summary)
      : null;
  const supportingReasons =
    variant === "action"
      ? getSupportingActionRequiredReasons(
          summary
        )
      : [];
  const operationalState =
    getManagedPropertyOperationalState(summary);

  return (
    <article
      className={`rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70 ${getCardAccentClasses(tier, variant)}`}
    >
      <div className="space-y-4">
        <header>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="truncate text-base font-semibold text-slate-900">
                {formatPropertyAddress(summary)}
              </h3>

              <p className="mt-0.5 text-sm text-slate-500">
                {formatPropertyLocationLine(
                  summary
                )}
              </p>
            </div>

            <span
              className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${getHealthStatusClasses(summary.health_status)}`}
            >
              {formatHealthLabel(
                summary.health_status
              )}
            </span>
          </div>

          {variant === "action" && primaryReason ? (
            <p className="mt-4 text-lg font-medium leading-snug text-slate-900">
              {primaryReason}
            </p>
          ) : null}
        </header>

        {variant === "managed" ? (
          <p className="text-base font-medium text-slate-800">
            {operationalState}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-slate-700">
          <span>
            {formatManagedStageLabel(
              summary.stage
            )}
          </span>

          <span className="text-slate-300">·</span>

          <span>
            {formatDaysSinceLastUpdate(
              summary.days_since_last_update
            )}
          </span>

          {typeof summary.confidence_score ===
          "number" ? (
            <>
              <span className="text-slate-300">
                ·
              </span>

              <span>
                {summary.confidence_score}%
                confidence
              </span>
            </>
          ) : null}
        </div>

        {summary.origin_type === "estate_agent" ? (
          <HomeownerStatusBadge summary={summary} />
        ) : null}

        {variant === "action" &&
        supportingReasons.length > 0 ? (
          <ul className="space-y-1 text-sm text-slate-600">
            {supportingReasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        ) : null}

        {summary.origin_type === "estate_agent" &&
        summary.claim_status !== "claimed" ? (
          <PropertyInvitationControls
            propertyId={summary.property_id}
            onChanged={onInvitationChanged}
          />
        ) : null}

        <div className="flex flex-col gap-2 border-t border-slate-100 pt-4 sm:flex-row">
          <OperationalActionButton
            href={`/property/${summary.property_id}`}
            label="Open Property"
          />

          {variant === "managed" ? (
            <OperationalActionButton
              href={`/chain/${summary.chain_id}`}
              label="Open Chain"
              variant="secondary"
            />
          ) : null}
        </div>
      </div>
    </article>
  );
}

function getCardAccentClasses(
  tier: "healthy" | "attention" | "critical",
  variant: "action" | "managed"
): string {
  if (variant !== "action") {
    return "";
  }

  switch (tier) {
    case "critical":
      return "border-l-4 border-l-red-400";
    case "attention":
      return "border-l-4 border-l-amber-400";
    default:
      return "border-l-4 border-l-slate-300";
  }
}
