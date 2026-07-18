import type { PrivacyAuditEventRow } from "@/lib/privacyAdmin/types";
import { CARD_CLASS } from "@/lib/theme/themeTokens";

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export default function PrivacyAuditTimeline({
  events,
}: {
  events: PrivacyAuditEventRow[];
}) {
  return (
    <section className={CARD_CLASS}>
      <h2 className="text-lg font-semibold text-slate-900">Audit timeline</h2>
      <p className="mt-1 text-sm text-slate-600">
        Read-only operational history. Structured fields only.
      </p>
      {events.length === 0 ? (
        <p className="mt-4 text-sm text-slate-500">No audit events recorded yet.</p>
      ) : (
        <ol className="mt-4 space-y-3">
          {events.map((event) => (
            <li
              key={event.id}
              className="rounded-2xl border border-surface-divider bg-surface-inset px-4 py-3"
            >
              <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
                <p className="font-medium text-slate-900">{event.eventType}</p>
                <p className="text-sm text-slate-500">{formatDate(event.createdAt)}</p>
              </div>
              {Object.keys(event.detail).length > 0 ? (
                <pre className="mt-2 overflow-x-auto text-xs text-slate-700">
                  {JSON.stringify(event.detail, null, 2)}
                </pre>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
