/**
 * Operational delay lifecycle — structured reasons only, no free text.
 */

export const OPERATIONAL_DELAY_REASONS = [
  "Awaiting Searches",
  "Awaiting Mortgage Offer",
  "Awaiting Signed Documents",
  "Awaiting Survey Results",
  "Awaiting Management Pack",
] as const;

export type OperationalDelayReason =
  (typeof OPERATIONAL_DELAY_REASONS)[number];

export type OperationalDelayStatus = "active" | "resolved";

export type OperationalDelay = {
  id: number;
  chainId: number;
  propertyId: number | null;
  chainNodeId: number | null;
  reason: OperationalDelayReason;
  status: OperationalDelayStatus;
  createdAt: string;
  resolvedAt: string | null;
  createdByUserId?: string | null;
  resolvedByUserId?: string | null;
  createdByRole?: string | null;
  resolvedByRole?: string | null;
};

export const DELAY_REPORTED_ACTIVITY_PREFIX =
  "Delay reported — ";

export const DELAY_RESOLVED_ACTIVITY_PREFIX =
  "Delay resolved — ";

/** Legacy activity prefix (pre-lifecycle). */
export const LEGACY_DELAY_REPORTED_PREFIX =
  "Delay Reported";

export function isOperationalDelayReason(
  value: string
): value is OperationalDelayReason {
  return (
    OPERATIONAL_DELAY_REASONS as readonly string[]
  ).includes(value);
}

export function formatDelayReportedActivity(
  reason: OperationalDelayReason
): string {
  return `${DELAY_REPORTED_ACTIVITY_PREFIX}${reason}`;
}

export function formatDelayResolvedActivity(
  reason: OperationalDelayReason
): string {
  return `${DELAY_RESOLVED_ACTIVITY_PREFIX}${reason}`;
}

export function parseDelayReasonFromActivityUpdate(
  update: string
): OperationalDelayReason | null {
  const prefixes = [
    DELAY_REPORTED_ACTIVITY_PREFIX,
    DELAY_RESOLVED_ACTIVITY_PREFIX,
    `${LEGACY_DELAY_REPORTED_PREFIX}: `,
    `${LEGACY_DELAY_REPORTED_PREFIX}:`,
  ];

  for (const prefix of prefixes) {
    if (update.startsWith(prefix)) {
      const remainder = update.slice(prefix.length).trim();
      if (isOperationalDelayReason(remainder)) {
        return remainder;
      }
    }
  }

  return null;
}

export function delayReasonDisplayLabel(
  reason: OperationalDelayReason
): string {
  return reason;
}

export function mapOperationalDelayRow(row: {
  id: number;
  chain_id: number;
  property_id: number | null;
  chain_node_id: number | null;
  reason: string;
  status: string;
  created_at: string;
  resolved_at: string | null;
  created_by_user_id?: string | null;
  resolved_by_user_id?: string | null;
  created_by_role?: string | null;
  resolved_by_role?: string | null;
}): OperationalDelay | null {
  if (
    !isOperationalDelayReason(row.reason) ||
    (row.status !== "active" && row.status !== "resolved")
  ) {
    return null;
  }

  return {
    id: row.id,
    chainId: row.chain_id,
    propertyId: row.property_id,
    chainNodeId: row.chain_node_id,
    reason: row.reason,
    status: row.status,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
    createdByUserId: row.created_by_user_id ?? null,
    resolvedByUserId: row.resolved_by_user_id ?? null,
    createdByRole: row.created_by_role ?? null,
    resolvedByRole: row.resolved_by_role ?? null,
  };
}

export function findActiveDelayForProperty(
  delays: OperationalDelay[] | null | undefined,
  propertyId: number
): OperationalDelay | null {
  return (
    delays?.find(
      (delay) =>
        delay.status === "active" &&
        delay.propertyId === propertyId
    ) ?? null
  );
}

export function findActiveDelayForChainNode(
  delays: OperationalDelay[] | null | undefined,
  chainNodeId: number
): OperationalDelay | null {
  return (
    delays?.find(
      (delay) =>
        delay.status === "active" &&
        delay.chainNodeId === chainNodeId
    ) ?? null
  );
}

export function findActiveDelaysForChain(
  delays: OperationalDelay[] | null | undefined,
  chainId: number
): OperationalDelay[] {
  return (delays ?? []).filter(
    (delay) =>
      delay.status === "active" &&
      delay.chainId === chainId
  );
}

export type ReportOperationalDelayResult =
  | {
      ok: true;
      delayId: number;
      status: OperationalDelayStatus;
      reason: OperationalDelayReason;
      createdAt: string;
      activityMessage: string;
    }
  | {
      ok: false;
      error: string;
    };

export type ResolveOperationalDelayResult =
  | {
      ok: true;
      delayId: number;
      status: "resolved";
      reason: OperationalDelayReason;
      resolvedAt: string | null;
      activityMessage?: string;
      alreadyResolved: boolean;
    }
  | {
      ok: false;
      error: string;
    };

export function parseReportOperationalDelayResult(
  raw: unknown
): ReportOperationalDelayResult {
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "invalid_response" };
  }

  const data = raw as Record<string, unknown>;

  if (data.ok !== true) {
    return {
      ok: false,
      error:
        typeof data.error === "string"
          ? data.error
          : "unknown_error",
    };
  }

  if (
    typeof data.delay_id !== "number" ||
    typeof data.reason !== "string" ||
    !isOperationalDelayReason(data.reason) ||
    typeof data.created_at !== "string"
  ) {
    return { ok: false, error: "invalid_response" };
  }

  return {
    ok: true,
    delayId: data.delay_id,
    status: "active",
    reason: data.reason,
    createdAt: data.created_at,
    activityMessage:
      typeof data.activity_message === "string"
        ? data.activity_message
        : formatDelayReportedActivity(data.reason),
  };
}

export function parseResolveOperationalDelayResult(
  raw: unknown
): ResolveOperationalDelayResult {
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "invalid_response" };
  }

  const data = raw as Record<string, unknown>;

  if (data.ok !== true) {
    return {
      ok: false,
      error:
        typeof data.error === "string"
          ? data.error
          : "unknown_error",
    };
  }

  if (
    typeof data.delay_id !== "number" ||
    typeof data.reason !== "string" ||
    !isOperationalDelayReason(data.reason)
  ) {
    return { ok: false, error: "invalid_response" };
  }

  return {
    ok: true,
    delayId: data.delay_id,
    status: "resolved",
    reason: data.reason,
    resolvedAt:
      typeof data.resolved_at === "string"
        ? data.resolved_at
        : null,
    activityMessage:
      typeof data.activity_message === "string"
        ? data.activity_message
        : undefined,
    alreadyResolved: data.already_resolved === true,
  };
}
