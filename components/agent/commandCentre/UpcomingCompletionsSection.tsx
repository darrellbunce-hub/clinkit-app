import CommandCentreSectionHeader from "@/components/agent/commandCentre/CommandCentreSectionHeader";
import type { AgentBranchPropertySummary } from "@/lib/estateAgent/assignmentTypes";
import {
  formatPropertyAddress,
  formatPropertyLocationLine,
} from "@/lib/estateAgent/commandCentrePresentation";
import {
  formatScheduledCompletionDate,
  getCompletionConfirmationLabel,
} from "@/lib/estateAgent/workspacePresentation";

function CompletionRow({
  summary,
}: {
  summary: AgentBranchPropertySummary;
}) {
  const confirmationLabel =
    getCompletionConfirmationLabel(summary);

  return (
    <li className="flex items-start justify-between gap-4 rounded-xl bg-white px-4 py-3 shadow-sm ring-1 ring-slate-200/60">
      <div className="min-w-0">
        <p className="truncate font-medium text-slate-900">
          {formatPropertyAddress(summary)}
        </p>

        <p className="mt-0.5 text-sm text-slate-500">
          {formatPropertyLocationLine(summary)}
        </p>
      </div>

      <div className="shrink-0 text-right text-sm">
        {summary.completion_scheduled_date ? (
          <p className="font-medium text-slate-900">
            {formatScheduledCompletionDate(
              summary.completion_scheduled_date
            )}
          </p>
        ) : null}

        <p className="mt-0.5 text-slate-600">
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
      />

      {!hasItems ? (
        <div className="rounded-2xl bg-white px-6 py-8 shadow-sm ring-1 ring-slate-200/70">
          <p className="text-sm text-slate-600">
            No upcoming completions recorded for
            active managed properties.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {scheduled.length > 0 ? (
            <div>
              <h3 className="text-sm font-medium text-slate-500">
                Scheduled
              </h3>

              <ul className="mt-3 space-y-2">
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
              <h3 className="text-sm font-medium text-slate-500">
                Awaiting confirmation
              </h3>

              <ul className="mt-3 space-y-2">
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
