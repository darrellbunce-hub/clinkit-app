export type RefreshOperationalSummaryStep = "load" | "derive" | "persist";

export type RefreshOperationalSummaryResult = {
  ok: boolean;
  error: string | null;
  errorCode?: string | null;
  step?: RefreshOperationalSummaryStep;
};
