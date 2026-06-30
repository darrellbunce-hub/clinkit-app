import OperationalActionButton from "@/components/agent/commandCentre/OperationalActionButton";
import OperationalAlertBadges from "@/components/agent/commandCentre/OperationalAlertBadges";
import ClaimStatusBadge from "@/components/agent/commandCentre/ClaimStatusBadge";
import {
  getRecommendedActionLabel,
} from "@/lib/operationalAlerts/templates";
import type { AgentBranchPropertySummary } from "@/lib/estateAgent/assignmentTypes";
import {
  formatCompletionStatus,
  formatDaysSinceLastUpdate,
  formatHealthLabel,
  formatManagedStageLabel,
  formatPropertyAddress,
  formatPropertyLocationLine,
  getHighestPriorityAlert,
  getOperationalPriorityTier,
  getPriorityTierCardClasses,
  getSummaryAlerts,
  getHealthStatusClasses,
} from "@/lib/estateAgent/commandCentrePresentation";

type OperationalPropertyCardProps = {
  summary: AgentBranchPropertySummary;
  variant?: "action" | "managed";
};

export default function OperationalPropertyCard({
  summary,
  variant = "managed",
}: OperationalPropertyCardProps) {
  const tier = getOperationalPriorityTier(summary);
  const alerts = getSummaryAlerts(summary);
  const topAlert = getHighestPriorityAlert(summary);
  const alertCount = alerts.length;

  return (
    <article
      className={`rounded-3xl border p-5 shadow-sm ${getPriorityTierCardClasses(tier)}`}
    >
      <div className="space-y-4">
        <div>
          <p className="text-lg font-bold text-slate-900">
            {formatPropertyAddress(summary)}
          </p>

          <p className="mt-1 text-sm text-slate-500">
            {formatPropertyLocationLine(summary)}
          </p>

          {summary.origin_type === "estate_agent" &&
          summary.claim_status !== "claimed" ? (
            <div className="mt-3">
              <ClaimStatusBadge
                claimStatus={summary.claim_status}
              />
            </div>
          ) : summary.claim_status === "claimed" &&
            summary.origin_type === "estate_agent" ? (
            <div className="mt-3">
              <ClaimStatusBadge claimStatus="claimed" />
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-2">
          <span
            className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${getHealthStatusClasses(summary.health_status)}`}
          >
            {formatHealthLabel(
              summary.health_status
            )}
          </span>

          {typeof summary.confidence_score ===
          "number" ? (
            <span className="inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
              {summary.confidence_score}% confidence
            </span>
          ) : null}
        </div>

        <div
          className={`grid gap-3 ${variant === "managed" ? "sm:grid-cols-2 xl:grid-cols-3" : "sm:grid-cols-2"}`}
        >
          <MetricItem
            label="Current stage"
            value={formatManagedStageLabel(
              summary.stage
            )}
          />

          <MetricItem
            label="Last updated"
            value={formatDaysSinceLastUpdate(
              summary.days_since_last_update
            )}
          />

          {variant === "managed" ? (
            <MetricItem
              label="Completion status"
              value={formatCompletionStatus(summary)}
            />
          ) : null}
        </div>

        {variant === "action" && topAlert ? (
          <div className="rounded-2xl border border-slate-200/80 bg-white/70 px-4 py-3">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Highest priority alert
            </p>

            <p className="mt-1 text-sm font-semibold text-slate-900">
              {getRecommendedActionLabel(topAlert)}
            </p>
          </div>
        ) : null}

        {alerts.length > 0 ? (
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
              Operational alerts
            </p>

            <OperationalAlertBadges
              alerts={alerts}
              limit={
                variant === "action" ? 4 : 3
              }
            />

            {variant === "managed" &&
            alertCount > 0 ? (
              <p className="mt-2 text-xs text-slate-500">
                {alertCount} alert
                {alertCount === 1 ? "" : "s"}
              </p>
            ) : null}
          </div>
        ) : null}

        {summary.next_recommended_action ? (
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Recommended action
            </p>

            <p className="mt-1 text-sm font-medium text-slate-800">
              {getRecommendedActionLabel(
                summary.next_recommended_action
              )}
            </p>
          </div>
        ) : null}

        <div className="flex flex-col gap-3 sm:flex-row">
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

function MetricItem({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl bg-white/70 px-4 py-3">
      <p className="text-xs font-medium text-slate-500">
        {label}
      </p>

      <p className="mt-1 text-sm font-semibold text-slate-900">
        {value}
      </p>
    </div>
  );
}
