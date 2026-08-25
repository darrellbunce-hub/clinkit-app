import type { OperationalAlertCode } from "@/lib/operationalAlerts/types";

export const OPERATIONAL_ALERT_LABELS: Record<
  OperationalAlertCode,
  string
> = {
  stale_update: "Stale update",
  delay_reported: "Delay reported",
  buyer_ready_stale: "Buyer Ready stale",
  buyer_ready_delayed: "Buyer Ready delayed",
  completion_awaiting_confirmation:
    "Completion awaiting confirmation",
  chain_confidence_low: "Chain confidence reduced",
  broken_connection: "Broken connection",
  property_blocked: "Property blocked",
};

export function getOperationalAlertLabel(
  code: string
): string {
  return (
    OPERATIONAL_ALERT_LABELS[
      code as OperationalAlertCode
    ] ?? code.replaceAll("_", " ")
  );
}

export const OPERATIONAL_ALERT_SEVERITY_CLASSES: Record<
  string,
  string
> = {
  critical: "bg-red-100 text-red-800",
  warning: "bg-amber-100 text-amber-800",
  info: "bg-slate-100 text-slate-700",
};

export function getOperationalAlertSeverityClasses(
  severity: string
): string {
  return (
    OPERATIONAL_ALERT_SEVERITY_CLASSES[
      severity
    ] ?? OPERATIONAL_ALERT_SEVERITY_CLASSES.info
  );
}

export function getRecommendedActionLabel(params: {
  code: string;
  severity: string;
}): string {
  return getOperationalAlertLabel(params.code);
}
