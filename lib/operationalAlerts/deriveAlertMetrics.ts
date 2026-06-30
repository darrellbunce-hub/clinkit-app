import type {
  OperationalAlert,
  OperationalAlertSeverity,
} from "@/lib/operationalAlerts/types";
import type {
  OperationalRecommendedAction,
  StoredOperationalAlert,
} from "@/lib/operationalSummary/types";

const SEVERITY_RANK: Record<
  OperationalAlertSeverity,
  number
> = {
  critical: 3,
  warning: 2,
  info: 1,
};

export function toStoredAlerts(
  alerts: OperationalAlert[]
): StoredOperationalAlert[] {
  return alerts.map((alert) => ({
    code: alert.code,
    severity: alert.severity,
  }));
}

export function deriveNeedsAttention(
  alerts: OperationalAlert[]
): boolean {
  return alerts.some(
    (alert) => alert.severity !== "info"
  );
}

export function deriveWarningCount(
  alerts: OperationalAlert[]
): number {
  return alerts.filter(
    (alert) => alert.severity === "warning"
  ).length;
}

export function deriveCriticalCount(
  alerts: OperationalAlert[]
): number {
  return alerts.filter(
    (alert) => alert.severity === "critical"
  ).length;
}

export function deriveNextRecommendedAction(
  alerts: OperationalAlert[]
): OperationalRecommendedAction {
  if (alerts.length === 0) {
    return null;
  }

  const sortedAlerts = [...alerts].sort(
    (left, right) =>
      SEVERITY_RANK[right.severity] -
      SEVERITY_RANK[left.severity]
  );

  const topAlert = sortedAlerts[0];

  return {
    code: topAlert.code,
    severity: topAlert.severity,
  };
}
