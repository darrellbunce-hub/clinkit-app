"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import type {
  EmailEventRecord,
  EmailEventStatus,
} from "@/lib/communications/types";

type StatusFilter = EmailEventStatus | "all";

type EmailEventsDevWorkspaceProps = {
  initialStatus?: string;
};

const STATUS_FILTERS: Array<{
  value: StatusFilter;
  label: string;
}> = [
  { value: "all", label: "All" },
  { value: "queued", label: "Queued" },
  { value: "sent", label: "Sent" },
  { value: "failed", label: "Failed" },
];

function parseInitialStatus(value?: string): StatusFilter {
  if (
    value === "queued" ||
    value === "sent" ||
    value === "failed"
  ) {
    return value;
  }

  return "all";
}

function formatTimestamp(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function getStatusBadgeClass(status: EmailEventStatus): string {
  switch (status) {
    case "sent":
      return "bg-green-100 text-green-800";
    case "failed":
      return "bg-red-100 text-red-800";
    default:
      return "bg-amber-100 text-amber-800";
  }
}

export default function EmailEventsDevWorkspace({
  initialStatus,
}: EmailEventsDevWorkspaceProps) {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(
    parseInitialStatus(initialStatus)
  );
  const [events, setEvents] = useState<EmailEventRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const loadEvents = useCallback(async () => {
    setIsLoading(true);
    setLoadError("");

    const query =
      statusFilter === "all"
        ? ""
        : `?status=${statusFilter}`;

    try {
      const response = await fetch(`/api/dev/email-events${query}`);

      if (response.status === 401) {
        setLoadError("Sign in to view email events.");
        setEvents([]);
        return;
      }

      if (!response.ok) {
        throw new Error("Could not load email events.");
      }

      const payload = (await response.json()) as {
        events?: EmailEventRecord[];
      };

      setEvents(payload.events ?? []);
    } catch (error) {
      setEvents([]);
      setLoadError(
        error instanceof Error
          ? error.message
          : "Could not load email events."
      );
    } finally {
      setIsLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  return (
    <main className="min-h-screen bg-surface-stone px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-brand-primary">
              Developer workspace
            </p>
            <h1 className="mt-2 text-3xl font-bold text-text-charcoal">
              Email Events
            </h1>
            <p className="mt-2 max-w-3xl text-sm text-text-muted">
              Recent transactional email send attempts logged by the
              communication service. Preview-only — this page never sends email.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Link
              href="/dev/emails"
              className="rounded-lg border border-brand-primary px-3 py-2 text-sm font-medium text-brand-primary"
            >
              Email templates
            </Link>
            <button
              type="button"
              onClick={() => void loadEvents()}
              className="rounded-lg bg-brand-primary px-3 py-2 text-sm font-semibold text-white"
            >
              Refresh
            </button>
          </div>
        </div>

        <section className="mb-6 rounded-2xl bg-surface-card p-4 ring-1 ring-surface-card-border sm:p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-text-muted">
            Filter by status
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {STATUS_FILTERS.map((filter) => (
              <button
                key={filter.value}
                type="button"
                onClick={() => setStatusFilter(filter.value)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                  statusFilter === filter.value
                    ? "bg-brand-primary text-white"
                    : "bg-surface-mist text-text-charcoal"
                }`}
              >
                {filter.label}
              </button>
            ))}
          </div>
        </section>

        <section className="overflow-hidden rounded-2xl bg-surface-card ring-1 ring-surface-card-border">
          {isLoading ? (
            <p className="p-6 text-sm text-text-muted">
              Loading email events...
            </p>
          ) : null}

          {loadError ? (
            <p className="p-6 text-sm text-red-700">{loadError}</p>
          ) : null}

          {!isLoading && !loadError && events.length === 0 ? (
            <p className="p-6 text-sm text-text-muted">
              No email events found for this filter.
            </p>
          ) : null}

          {!isLoading && !loadError && events.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-surface-card-border text-left text-sm">
                <thead className="bg-surface-mist">
                  <tr>
                    <th className="px-4 py-3 font-semibold text-text-charcoal">
                      Timestamp
                    </th>
                    <th className="px-4 py-3 font-semibold text-text-charcoal">
                      Template
                    </th>
                    <th className="px-4 py-3 font-semibold text-text-charcoal">
                      Recipient
                    </th>
                    <th className="px-4 py-3 font-semibold text-text-charcoal">
                      Status
                    </th>
                    <th className="px-4 py-3 font-semibold text-text-charcoal">
                      Provider message ID
                    </th>
                    <th className="px-4 py-3 font-semibold text-text-charcoal">
                      Error
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-card-border">
                  {events.map((event) => (
                    <tr key={event.id} className="align-top">
                      <td className="px-4 py-3 text-text-muted">
                        {formatTimestamp(event.created_at)}
                      </td>
                      <td className="px-4 py-3 font-medium text-text-charcoal">
                        {event.template}
                      </td>
                      <td className="px-4 py-3 text-text-charcoal">
                        {event.recipient_email}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold uppercase tracking-wide ${getStatusBadgeClass(event.status)}`}
                        >
                          {event.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-text-muted">
                        {event.provider_message_id ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-text-muted">
                        {event.error_message ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}
