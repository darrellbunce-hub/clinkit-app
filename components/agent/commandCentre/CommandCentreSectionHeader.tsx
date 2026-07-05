import { WORKSPACE_SECTION_TITLE_CLASS } from "@/lib/theme/themeTokens";
import { WorkspaceIcon } from "@/lib/theme/workspaceIcons";
import type { WorkspaceIconName } from "@/lib/theme/workspaceIcons";

export default function CommandCentreSectionHeader({
  title,
  description,
  icon,
}: {
  title: string;
  description?: string;
  icon?: WorkspaceIconName;
}) {
  return (
    <div className="flex items-start gap-3">
      {icon ? (
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-mist text-brand-primary">
          <WorkspaceIcon
            name={icon}
            className="h-5 w-5"
          />
        </div>
      ) : null}

      <div>
        <h2 className={WORKSPACE_SECTION_TITLE_CLASS}>
          {title}
        </h2>

        {description ? (
          <p className="mt-1.5 text-sm text-text-muted">
            {description}
          </p>
        ) : null}
      </div>
    </div>
  );
}
