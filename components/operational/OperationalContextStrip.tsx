import EstateAgentManagementModeBadge from "@/components/estate-agents/EstateAgentManagementModeBadge";
import type { OperationalWorkspaceLabels } from "@/hooks/useOperationalWorkspaceLabels";
import type { EstateAgentManagementModePresentation } from "@/lib/estateAgent/managementModePresentation";

type OperationalContextStripProps = {
  labels: OperationalWorkspaceLabels;
  editingMode: "Owner" | "Delegated" | "View only";
  showManager: boolean;
  managementMode?: EstateAgentManagementModePresentation | null;
};

function ContextItem({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
        {label}
      </p>

      <p className="mt-0.5 truncate text-sm text-slate-800">
        {value}
      </p>
    </div>
  );
}

export default function OperationalContextStrip({
  labels,
  editingMode,
  showManager,
  managementMode = null,
}: OperationalContextStripProps) {
  const columnCount =
    2 +
    (showManager ? 1 : 0) +
    (managementMode ? 1 : 0);

  return (
    <div
      className={`mt-4 grid gap-4 border-t border-slate-100 pt-4 ${
        columnCount >= 4
          ? "sm:grid-cols-2 lg:grid-cols-4"
          : columnCount === 3
            ? "sm:grid-cols-3"
            : "sm:grid-cols-2"
      }`}
    >
      <ContextItem
        label="Operational owner"
        value={
          labels.isLoading
            ? "Loading…"
            : labels.operationalOwner
        }
      />

      {showManager && labels.operationalManager ? (
        <ContextItem
          label="Operational manager"
          value={
            labels.isLoading
              ? "Loading…"
              : labels.operationalManager
          }
        />
      ) : null}

      {managementMode ? (
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
            Management mode
          </p>

          <div className="mt-1">
            <EstateAgentManagementModeBadge
              presentation={managementMode}
              showDescription
            />
          </div>
        </div>
      ) : null}

      <ContextItem
        label="Editing mode"
        value={editingMode}
      />
    </div>
  );
}
