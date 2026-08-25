/**
 * Operational status colours — semantic (health/warning/error), not brand theme.
 * Kept consistent across all brand themes for clarity.
 */

export function statusBadgeClasses(
  status: string | null | undefined
): string {
  switch (status) {
    case "healthy":
      return "bg-green-100 text-green-700";
    case "pending_connection":
      return "bg-amber-100 text-amber-700";
    case "broken_connection":
      return "bg-red-100 text-red-700";
    case "delayed":
      return "bg-amber-100 text-amber-800";
    default:
      return "bg-slate-100 text-slate-700";
  }
}

export function actionButtonClasses(
  variant: "primary" | "secondary" | "disabled"
): string {
  switch (variant) {
    case "primary":
      return "bg-brand-primary text-brand-on-primary hover:bg-brand-primary-hover";
    case "secondary":
      return "bg-brand-secondary text-brand-on-secondary hover:opacity-90";
    case "disabled":
      return "bg-slate-200 text-slate-500 cursor-not-allowed";
  }
}
