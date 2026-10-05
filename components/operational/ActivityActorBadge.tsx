import {
  formatActivityUpdaterLabel,
  getActivityUpdaterBadgeClass,
} from "@/lib/workflowPermissions";

export default function ActivityActorBadge({
  updatedBy,
}: {
  updatedBy: string | null | undefined;
}) {
  return (
    <span
      className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold ${getActivityUpdaterBadgeClass(updatedBy)}`}
    >
      <span className="sr-only">Updated by </span>
      {formatActivityUpdaterLabel(updatedBy)}
    </span>
  );
}
