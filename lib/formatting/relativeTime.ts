const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

export function formatFullTimestamp(
  iso: string | null | undefined
): string {
  if (!iso) {
    return "";
  }

  const parsed = new Date(iso);

  if (Number.isNaN(parsed.getTime())) {
    return iso;
  }

  return parsed.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatRelativePast(
  iso: string | null | undefined,
  prefix: string,
  now = new Date()
): string | null {
  if (!iso) {
    return null;
  }

  const parsed = new Date(iso);

  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  const diffMs = now.getTime() - parsed.getTime();

  if (diffMs < MINUTE_MS) {
    return `${prefix} just now`;
  }

  const diffMinutes = Math.floor(diffMs / MINUTE_MS);

  if (diffMinutes < 60) {
    return `${prefix} ${diffMinutes} minute${
      diffMinutes === 1 ? "" : "s"
    } ago`;
  }

  const diffHours = Math.floor(diffMs / HOUR_MS);

  if (diffHours < 24) {
    return `${prefix} ${diffHours} hour${
      diffHours === 1 ? "" : "s"
    } ago`;
  }

  const diffDays = Math.floor(diffMs / DAY_MS);

  if (diffDays === 1) {
    return `${prefix} yesterday`;
  }

  if (diffDays < 7) {
    return `${prefix} ${diffDays} days ago`;
  }

  return `${prefix} on ${formatFullTimestamp(iso)}`;
}

export function formatExpiryLabel(
  iso: string | null | undefined
): string {
  if (!iso) {
    return "Expiry unavailable";
  }

  const parsed = new Date(iso);

  if (Number.isNaN(parsed.getTime())) {
    return "Expiry unavailable";
  }

  return parsed.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
