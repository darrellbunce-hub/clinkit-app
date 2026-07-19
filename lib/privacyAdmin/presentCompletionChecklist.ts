import {
  isProcessorStatusBlocking,
  isProcessorStatusSatisfied,
  type CompletionSemantic,
} from "@/lib/gdpr/suppressionLedgerCore";
import type { PrivacyProcessorActionRow } from "@/lib/privacyAdmin/types";

export type CompletionChecklistItem = {
  key: CompletionSemantic | string;
  label: string;
  state: "complete" | "pending" | "review" | "not_applicable" | "failed";
  detail: string;
};

export type CompletionChecklistView = {
  items: CompletionChecklistItem[];
  overallLabel: string;
  exposesFingerprint: false;
};

const PROCESSOR_LABELS: Record<string, string> = {
  resend: "Resend",
  vercel: "Vercel logs",
  upstash: "Upstash cache",
  supabase_auth: "Supabase Auth",
};

function processorDetail(processor: PrivacyProcessorActionRow): string {
  if (processor.status === "retention_expiry") {
    return "Covered by provider retention expiry";
  }
  if (processor.status === "not_applicable") {
    return "Not applicable for this request";
  }
  if (processor.status === "manual_review") {
    return "Manual processor review pending";
  }
  if (processor.status === "pending") {
    return "Processor action pending";
  }
  if (processor.status === "processing") {
    return "Processor action in progress";
  }
  if (processor.status === "failed") {
    return "Processor action requires review";
  }
  if (processor.status === "completed") {
    return "Processor action completed";
  }
  return processor.status;
}

export function buildCompletionChecklist(params: {
  databaseProcessingCompletedAt: string | null;
  suppressionRecorded: boolean;
  authDeletionCompletedAt: string | null;
  requestStatus: string;
  processors: PrivacyProcessorActionRow[];
}): CompletionChecklistView {
  const items: CompletionChecklistItem[] = [
    {
      key: "DATABASE_ERASURE_COMPLETE",
      label: "Keynetic database",
      state: params.databaseProcessingCompletedAt ? "complete" : "pending",
      detail: params.databaseProcessingCompletedAt
        ? "Personal data erased or redacted in live database"
        : "Database erasure not completed",
    },
    {
      key: "SUPPRESSION_PROTECTION_RECORDED",
      label: "Backup re-erasure protection",
      state: params.suppressionRecorded ? "complete" : "pending",
      detail: params.suppressionRecorded
        ? "Re-erasure fingerprint recorded"
        : "Recorded before Auth deletion",
    },
    {
      key: "AUTH_DELETION_COMPLETE",
      label: "Supabase Auth",
      state: params.authDeletionCompletedAt ? "complete" : "pending",
      detail: params.authDeletionCompletedAt
        ? "Login identity deleted"
        : "Auth deletion remains last step",
    },
  ];

  const externalProcessors = params.processors.filter(
    (processor) => processor.processor !== "supabase_auth"
  );

  const upstash = externalProcessors.find((processor) => processor.processor === "upstash");
  if (!upstash) {
    items.push({
      key: "upstash_not_applicable",
      label: PROCESSOR_LABELS.upstash,
      state: "not_applicable",
      detail: "Not applicable",
    });
  }

  for (const processor of externalProcessors) {
    let state: CompletionChecklistItem["state"] = "pending";
    if (processor.status === "failed") {
      state = "failed";
    } else if (processor.status === "manual_review") {
      state = "review";
    } else if (processor.status === "not_applicable" || !processor.required) {
      state = "not_applicable";
    } else if (isProcessorStatusSatisfied(processor.status)) {
      state = "complete";
    } else if (isProcessorStatusBlocking(processor.status)) {
      state = processor.status === "manual_review" ? "review" : "pending";
    }

    items.push({
      key: `PROCESSOR_${processor.processor.toUpperCase()}`,
      label: PROCESSOR_LABELS[processor.processor] ?? processor.processor,
      state,
      detail: processorDetail(processor),
    });
  }

  const blocking = externalProcessors.some(
    (processor) => processor.required && isProcessorStatusBlocking(processor.status)
  );

  let overallLabel = "In progress";
  if (params.requestStatus === "completed") {
    overallLabel = "Completed";
  } else if (params.requestStatus === "partially_completed") {
    overallLabel = "Partially completed — external processor actions may remain";
  } else if (blocking) {
    overallLabel = "Database and Auth steps may be done; processor actions remain";
  }

  return {
    items,
    overallLabel,
    exposesFingerprint: false,
  };
}
