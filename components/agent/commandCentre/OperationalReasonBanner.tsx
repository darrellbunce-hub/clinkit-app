import type { OperationalPriorityTier } from "@/lib/estateAgent/commandCentrePresentation";
import { getActionReasonBannerClasses } from "@/lib/estateAgent/workspacePresentation";
import { WorkspaceIcon } from "@/lib/theme/workspaceIcons";

export default function OperationalReasonBanner({
  reason,
  tier,
}: {
  reason: string;
  tier: OperationalPriorityTier;
}) {
  const classes =
    getActionReasonBannerClasses(tier);

  return (
    <div
      className={`flex items-start gap-3 rounded-xl px-4 py-3 ${classes.container}`}
    >
      <WorkspaceIcon
        name={
          tier === "critical"
            ? "attention"
            : tier === "attention"
              ? "attention"
              : "operationalHealth"
        }
        className={`mt-0.5 h-5 w-5 ${classes.icon}`}
      />

      <p
        className={`text-base font-semibold leading-snug ${classes.text}`}
      >
        {reason}
      </p>
    </div>
  );
}
