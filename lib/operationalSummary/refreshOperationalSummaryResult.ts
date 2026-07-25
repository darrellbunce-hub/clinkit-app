import type { OperationalRefreshDatasetLoadStep } from "@/lib/operationalSummary/loadOperationalRefreshDatasetResult";

export type RefreshOperationalSummaryStep =
  | OperationalRefreshDatasetLoadStep
  | "persist";

export type RefreshOperationalSummaryResult = {
  ok: boolean;
  error: string | null;
  errorCode?: string | null;
  step?: RefreshOperationalSummaryStep;
};
