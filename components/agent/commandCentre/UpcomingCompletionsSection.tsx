import CommandCentreSectionHeader from "@/components/agent/commandCentre/CommandCentreSectionHeader";
import WorkspaceEmptyState from "@/components/agent/commandCentre/WorkspaceEmptyState";
import type { AgentBranchPropertySummary } from "@/lib/estateAgent/assignmentTypes";
import {
  formatPropertyAddress,
  formatPropertyLocationLine,
} from "@/lib/estateAgent/commandCentrePresentation";
import {
  formatScheduledCompletionDate,
  getCompletionConfirmationLabel,
} from "@/lib/estateAgent/workspacePresentation";
import { WORKSPACE_CARD_CLASS } from "@/lib/theme/themeTokens";
import { WorkspaceIcon } from "@/lib/theme/workspaceIcons";

function CompletionRow({
  summary,
}: {
  summary: AgentBranchPropertySummary;
}) {
  const confirmationLabel =
    getCompletionConfirmationLabel(summary);

  return (
    <li
      className={`${WORKSPACE_CARD_CLASS} flex items-start justify-between gap-4 px-4 py-3`}
    >
      <div className="min-w-0">
        <p className="truncate font-medium text-text-charcoal">
          {formatPropertyAddress(summary)}
        </p>

        <p className="mt-0.5 text-sm text-text-muted">
          {formatPropertyLocationLine(summary)}
        </p>
      </div>

      <div className="shrink-0 text-right text-sm">
        {summary.completion_scheduled_date ? (
          <p className="font-medium text-text-charcoal">
            {formatScheduledCompletionDate(
              summary.completion_scheduled_date
            )}
          </p>
        ) : null}

        <p className="mt-0.5 text-text-muted">
          {confirmationLabel}
        </p>
      </div>
    </li>
  );
}

export default function UpcomingCompletionsSection({
  scheduled,
  awaitingConfirmation,
}: {
  scheduled: AgentBranchPropertySummary[];
  awaitingConfirmation: AgentBranchPropertySummary[];
}) {
  const hasItems =
    scheduled.length > 0 ||
    awaitingConfirmation.length > 0;

  return (
    <section className="space-y-5">
      <CommandCentreSectionHeader
        title="Upcoming completions"
        description="Scheduled completions and those awaiting confirmation."
        icon="completion"
      />

      {!hasItems ? (
        <WorkspaceEmptyState
          icon="success"
          title="No completions are currently scheduled"
          description="Everything is up to date."
        />
      ) : (
        <div className="space-y-6">
          {scheduled.length > 0 ? (
            <div>
              <div className="mb-3 flex items-center gap-2 text-sm font-medium text-text-muted">
                <WorkspaceIcon
                  name="completion"
                  className="h-4 w-4 text-brand-primary"
                />
                Scheduled
              </div>

              <ul className="space-y-2">
                {scheduled.map((summary) => (
                  <CompletionRow
                    key={summary.assignment_id}
                    summary={summary}
                  />
                ))}
              </ul>
            </div>
          ) : null}

          {awaitingConfirmation.length > 0 ? (
            <div>
              <div className="mb-3 flex items-center gap-2 text-sm font-medium text-status-warning-text">
                <WorkspaceIcon
                  name="attention"
                  className="h-4 w-4"
                />
                Awaiting confirmation
              </div>

              <ul className="space-y-2">
                {awaitingConfirmation.map(
                  (summary) => (
                    <CompletionRow
                      key={
                        summary.assignment_id
                      }
                      summary={summary}
                    />
                  )
                )}
              </ul>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
