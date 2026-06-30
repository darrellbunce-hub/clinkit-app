import type { AgentBranchPropertySummary } from "@/lib/estateAgent/assignmentTypes";
import {
  formatPropertyAddress,
  formatPropertyLocationLine,
} from "@/lib/estateAgent/commandCentrePresentation";

function CompletionListItem({
  summary,
  label,
}: {
  summary: AgentBranchPropertySummary;
  label: string;
}) {
  return (
    <li className="rounded-2xl border border-slate-200 bg-white px-4 py-4">
      <p className="font-semibold text-slate-900">
        {formatPropertyAddress(summary)}
      </p>

      <p className="mt-1 text-sm text-slate-500">
        {formatPropertyLocationLine(summary)}
      </p>

      <p className="mt-3 text-sm font-medium text-slate-800">
        {label}
      </p>
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
      <div>
        <h2 className="text-2xl font-bold text-slate-900">
          Upcoming Completions
        </h2>

        <p className="mt-2 text-slate-600">
          Scheduled and pending confirmation from
          cached completion metadata.
        </p>
      </div>

      {!hasItems ? (
        <div className="rounded-3xl border border-slate-200 bg-white px-6 py-8">
          <p className="text-sm text-slate-600">
            No upcoming completions recorded for
            active managed properties.
          </p>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-3xl border border-slate-200 bg-slate-50/60 p-5">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              Completion Scheduled
            </h3>

            {scheduled.length === 0 ? (
              <p className="mt-4 text-sm text-slate-600">
                None scheduled
              </p>
            ) : (
              <ul className="mt-4 space-y-3">
                {scheduled.map((summary) => (
                  <CompletionListItem
                    key={summary.assignment_id}
                    summary={summary}
                    label={
                      summary.completion_scheduled_date ??
                      "Scheduled"
                    }
                  />
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-3xl border border-amber-200 bg-amber-50/40 p-5">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-amber-800">
              Awaiting Confirmation
            </h3>

            {awaitingConfirmation.length === 0 ? (
              <p className="mt-4 text-sm text-slate-600">
                None awaiting confirmation
              </p>
            ) : (
              <ul className="mt-4 space-y-3">
                {awaitingConfirmation.map(
                  (summary) => (
                    <CompletionListItem
                      key={
                        summary.assignment_id
                      }
                      summary={summary}
                      label="Awaiting confirmation"
                    />
                  )
                )}
              </ul>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
