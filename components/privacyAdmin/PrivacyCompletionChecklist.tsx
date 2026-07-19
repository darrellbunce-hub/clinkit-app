import type { CompletionChecklistView } from "@/lib/privacyAdmin/presentCompletionChecklist";
import { CARD_CLASS } from "@/lib/theme/themeTokens";

function stateSymbol(state: CompletionChecklistView["items"][number]["state"]): string {
  switch (state) {
    case "complete":
      return "✓";
    case "pending":
      return "○";
    case "review":
      return "!";
    case "failed":
      return "×";
    case "not_applicable":
      return "—";
  }
}

function stateClass(state: CompletionChecklistView["items"][number]["state"]): string {
  switch (state) {
    case "complete":
      return "text-emerald-700";
    case "pending":
      return "text-slate-600";
    case "review":
      return "text-amber-700";
    case "failed":
      return "text-red-700";
    case "not_applicable":
      return "text-slate-500";
  }
}

export default function PrivacyCompletionChecklist({
  checklist,
}: {
  checklist: CompletionChecklistView;
}) {
  return (
    <section className={CARD_CLASS}>
      <h2 className="text-lg font-semibold text-slate-900">Completion checklist</h2>
      <p className="mt-2 text-sm text-slate-600">{checklist.overallLabel}</p>
      <ul className="mt-4 space-y-3">
        {checklist.items.map((item) => (
          <li
            key={item.key}
            className="rounded-2xl bg-surface-inset px-4 py-3 text-sm"
          >
            <div className="flex items-start gap-3">
              <span
                className={`mt-0.5 inline-flex min-h-6 min-w-6 items-center justify-center rounded-full bg-white text-base font-semibold ${stateClass(item.state)}`}
                aria-hidden="true"
              >
                {stateSymbol(item.state)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-medium text-slate-900">{item.label}</p>
                <p className="mt-1 text-slate-600">{item.detail}</p>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
