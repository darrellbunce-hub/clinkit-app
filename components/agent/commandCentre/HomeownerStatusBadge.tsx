import {
  getHomeownerConnectionStatusClasses,
  getHomeownerConnectionStatusLabel,
  getHomeownerStatusForSummary,
} from "@/lib/estateAgent/workspacePresentation";
import type { AgentBranchPropertySummary } from "@/lib/estateAgent/assignmentTypes";

export default function HomeownerStatusBadge({
  summary,
}: {
  summary: Pick<
    AgentBranchPropertySummary,
    | "origin_type"
    | "claim_status"
    | "invitation_lifecycle_status"
  >;
}) {
  const status =
    getHomeownerStatusForSummary(summary);

  if (!status) {
    return null;
  }

  const label =
    getHomeownerConnectionStatusLabel(status);
  const classes =
    getHomeownerConnectionStatusClasses(status);

  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${classes}`}
    >
      {label}
    </span>
  );
}
