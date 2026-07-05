import { WorkspaceIcon } from "@/lib/theme/workspaceIcons";
import type { WorkspaceIconName } from "@/lib/theme/workspaceIcons";
import { WORKSPACE_CARD_CLASS } from "@/lib/theme/themeTokens";

export default function WorkspaceEmptyState({
  icon = "success",
  title,
  description,
}: {
  icon?: WorkspaceIconName;
  title: string;
  description: string;
}) {
  return (
    <div
      className={`${WORKSPACE_CARD_CLASS} flex flex-col items-center px-6 py-10 text-center`}
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-status-success-soft text-status-success">
        <WorkspaceIcon
          name={icon}
          className="h-6 w-6"
        />
      </div>

      <p className="mt-4 font-semibold text-text-charcoal">
        {title}
      </p>

      <p className="mt-1.5 max-w-sm text-sm text-text-muted">
        {description}
      </p>
    </div>
  );
}
