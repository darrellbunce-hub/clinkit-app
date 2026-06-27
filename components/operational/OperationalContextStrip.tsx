import type { OperationalWorkspaceLabels } from "@/hooks/useOperationalWorkspaceLabels";

type OperationalContextStripProps = {
  labels: OperationalWorkspaceLabels;
  editingMode: "Owner" | "Delegated" | "View only";
  showManager: boolean;
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
}: OperationalContextStripProps) {
  return (
    <div
      className={`mt-4 grid gap-4 border-t border-slate-100 pt-4 ${
        showManager
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

      <ContextItem
        label="Editing mode"
        value={editingMode}
      />
    </div>
  );
}
