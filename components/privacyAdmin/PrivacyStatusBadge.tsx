import type { ErasureRequestStatus } from "@/lib/gdpr/types";

const STATUS_LABELS: Record<ErasureRequestStatus, string> = {
  requested: "Requested",
  identity_verified: "Identity verified",
  scope_assessed: "Scope assessed",
  awaiting_approval: "Awaiting approval",
  approved: "Approved",
  processing: "Processing",
  database_processed: "Database processed",
  awaiting_external_processors: "Awaiting external processors",
  awaiting_auth_deletion: "Awaiting Auth deletion",
  partially_completed: "Partially completed",
  completed: "Completed",
  rejected: "Rejected",
  manual_review_required: "Manual review required",
  failed: "Failed",
};

const STATUS_CLASSES: Record<string, string> = {
  completed: "bg-green-100 text-green-800",
  rejected: "bg-slate-200 text-slate-700",
  failed: "bg-red-100 text-red-800",
  approved: "bg-blue-100 text-blue-800",
  processing: "bg-amber-100 text-amber-900",
  awaiting_auth_deletion: "bg-purple-100 text-purple-900",
  partially_completed: "bg-orange-100 text-orange-900",
  manual_review_required: "bg-rose-100 text-rose-900",
};

export default function PrivacyStatusBadge({
  status,
}: {
  status: ErasureRequestStatus | string;
}) {
  const label =
    STATUS_LABELS[status as ErasureRequestStatus] ??
    String(status).replaceAll("_", " ");

  const className =
    STATUS_CLASSES[status] ?? "bg-slate-100 text-slate-800";

  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium capitalize ${className}`}
    >
      {label}
    </span>
  );
}
