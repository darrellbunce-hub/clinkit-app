import type { EstateAgentManagementModePresentation } from "@/lib/estateAgent/managementModePresentation";
import { getManagementModeBadgeClasses } from "@/lib/estateAgent/managementModePresentation";

type EstateAgentManagementModeBadgeProps = {
  presentation: EstateAgentManagementModePresentation;
  showDescription?: boolean;
};

export default function EstateAgentManagementModeBadge({
  presentation,
  showDescription = false,
}: EstateAgentManagementModeBadgeProps) {
  return (
    <div className="space-y-1">
      <span
        className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold tracking-wide ${getManagementModeBadgeClasses(presentation.colour)}`}
      >
        {presentation.badge}
      </span>

      {showDescription ? (
        <p className="text-xs leading-relaxed text-text-muted">
          {presentation.description}
        </p>
      ) : null}
    </div>
  );
}
