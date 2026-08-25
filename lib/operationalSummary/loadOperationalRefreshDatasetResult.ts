import type { OperationalRefreshDataset } from "@/lib/operationalSummary/types";

export type OperationalRefreshDatasetLoadStep =
  | "chains"
  | "participant_properties"
  | "chain_nodes";

export type OperationalRefreshDatasetLoadFailure = {
  ok: false;
  step: OperationalRefreshDatasetLoadStep;
  code: string | null;
  message: string;
};

export type OperationalRefreshDatasetLoadResult =
  | { ok: true; dataset: OperationalRefreshDataset }
  | OperationalRefreshDatasetLoadFailure;

export function operationalRefreshDatasetLoadFailure(
  step: OperationalRefreshDatasetLoadStep,
  error: { code?: string | null; message?: string } | null,
  fallbackMessage: string
): OperationalRefreshDatasetLoadFailure {
  return {
    ok: false,
    step,
    code: error?.code ?? null,
    message: error?.message ?? fallbackMessage,
  };
}
