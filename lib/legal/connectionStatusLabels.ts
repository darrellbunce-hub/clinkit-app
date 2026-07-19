/**
 * Customer-facing labels for property connection status values.
 * Internal enum values (e.g. healthy) are unchanged — copy only.
 */
const CONNECTION_STATUS_LABELS: Record<string, string> = {
  healthy: "Connected",
  pending_connection: "Pending Connection",
  broken_connection: "Disconnected",
  delayed: "Delayed",
};

export function formatConnectionStatusLabel(
  status: string | null | undefined
): string {
  if (!status) {
    return "Unknown";
  }

  const mapped = CONNECTION_STATUS_LABELS[status];

  if (mapped) {
    return mapped;
  }

  return status
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
