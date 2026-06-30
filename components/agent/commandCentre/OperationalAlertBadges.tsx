import {
  getOperationalAlertLabel,
  getOperationalAlertSeverityClasses,
} from "@/lib/operationalAlerts/templates";
import type { StoredOperationalAlert } from "@/lib/estateAgent/commandCentrePresentation";

export default function OperationalAlertBadges({
  alerts,
  limit,
}: {
  alerts: StoredOperationalAlert[];
  limit?: number;
}) {
  if (alerts.length === 0) {
    return null;
  }

  const visibleAlerts =
    typeof limit === "number"
      ? alerts.slice(0, limit)
      : alerts;

  return (
    <div className="flex flex-wrap gap-2">
      {visibleAlerts.map((alert) => (
        <span
          key={`${alert.code}-${alert.severity}`}
          className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${getOperationalAlertSeverityClasses(alert.severity)}`}
        >
          {getOperationalAlertLabel(alert.code)}
        </span>
      ))}
    </div>
  );
}
