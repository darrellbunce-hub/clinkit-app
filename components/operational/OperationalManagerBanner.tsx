import { BriefcaseBusiness } from "lucide-react";

export default function OperationalManagerBanner() {
  return (
    <div className="mt-6 flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
      <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-200 text-slate-600">
        <BriefcaseBusiness
          className="h-3.5 w-3.5"
          aria-hidden="true"
        />
      </span>

      <div className="min-w-0">
        <p className="text-sm font-medium text-slate-800">
          Managing this transaction
        </p>

        <p className="mt-1 text-xs leading-relaxed text-slate-600">
          You are managing this property on behalf of the
          operational owner. All updates are recorded in the
          activity history and visible to chain participants.
        </p>
      </div>
    </div>
  );
}
