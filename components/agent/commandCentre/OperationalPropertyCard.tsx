import OperationalActionButton from "@/components/agent/commandCentre/OperationalActionButton";
import ConfidenceBar from "@/components/agent/commandCentre/ConfidenceBar";
import HomeownerInvitationPanel from "@/components/agent/commandCentre/HomeownerInvitationPanel";
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
  FONT_HEADING_CLASS,
  WORKSPACE_CARD_CLASS,
} from "@/lib/theme/themeTokens";
import {
  getActionReasonBannerClasses,
  getManagedPropertyOperationalState,
  getPrimaryActionRequiredReason,
  getSupportingActionRequiredReasons,
} from "@/lib/estateAgent/workspacePresentation";
import { WorkspaceIcon } from "@/lib/theme/workspaceIcons";

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
  const reasonClasses =
    getActionReasonBannerClasses(tier);
  const supportingReasons =
    variant === "action"
      ? getSupportingActionRequiredReasons(
          summary
        )
      : [];
  const operationalState =
    getManagedPropertyOperationalState(summary);

  return (
    <article className={`${WORKSPACE_CARD_CLASS} p-5`}>
      <div className="space-y-4">
        {variant === "action" && primaryReason ? (
          <div className="space-y-2">
            <div className="flex items-start gap-3">
              <WorkspaceIcon
                name={
                  tier === "critical" || tier === "attention"
                    ? "attention"
                    : "operationalHealth"
                }
                className={`mt-1.5 h-6 w-6 shrink-0 ${reasonClasses.icon}`}
              />

              <h2
                className={`text-2xl font-bold leading-tight tracking-tight sm:text-[1.65rem] ${FONT_HEADING_CLASS} ${reasonClasses.text}`}
              >
                {primaryReason}
              </h2>
            </div>

            <div className="pl-9">
              <p className="text-lg font-semibold text-text-charcoal">
                {formatPropertyAddress(summary)}
              </p>

              <p className="mt-0.5 text-sm text-text-muted">
                {formatPropertyLocationLine(summary)}
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-1">
            <p
              className={`text-xl font-semibold text-text-charcoal ${FONT_HEADING_CLASS}`}
            >
              {operationalState}
            </p>

            <h3 className="truncate text-sm font-medium text-text-muted">
              {formatPropertyAddress(summary)}
            </h3>

            <p className="text-xs text-text-muted">
              {formatPropertyLocationLine(summary)}
            </p>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${getHealthStatusClasses(summary.health_status)}`}
          >
            {formatHealthLabel(
              summary.health_status
            )}
          </span>

          <span className="text-sm text-text-muted">
            {formatManagedStageLabel(
              summary.stage
            )}
          </span>

          <span className="text-text-muted">·</span>

          <span className="text-sm text-text-muted">
            {formatDaysSinceLastUpdate(
              summary.days_since_last_update
            )}
          </span>
        </div>

        {typeof summary.confidence_score ===
        "number" ? (
          <ConfidenceBar
            score={summary.confidence_score}
          />
        ) : null}

        {summary.origin_type === "estate_agent" ? (
          <HomeownerInvitationPanel
            propertyId={summary.property_id}
            onChanged={onInvitationChanged}
          />
        ) : null}

        {variant === "action" &&
        supportingReasons.length > 0 ? (
          <ul className="space-y-1 border-t border-surface-card-border pt-3 text-sm text-text-muted">
            {supportingReasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        ) : null}

        <div className="flex flex-col gap-2 border-t border-surface-card-border pt-4 sm:flex-row">
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
