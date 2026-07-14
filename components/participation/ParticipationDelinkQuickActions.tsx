"use client";

import { useCallback, useEffect, useState } from "react";

import ParticipationDelinkConfirmModal from "@/components/participation/ParticipationDelinkConfirmModal";
import {
  executeParticipationDelink,
  getParticipationDelinkOptions,
  PARTICIPATION_DELINK_OPERATION,
  type ParticipationDelinkOption,
} from "@/lib/ownership/participationDelink";
import {
  getParticipationDelinkConfirmationCopy,
  getParticipationDelinkSuccessMessage,
} from "@/lib/ownership/participationDelinkPresentation";
import type { ParticipationDelinkOperation } from "@/lib/ownership/participationDelinkTypes";
import type { ParticipationDelinkReasonCode } from "@/lib/ownership/participationDelinkReasonCodes";
import { BTN_SECONDARY_OUTLINE_SM_CLASS } from "@/lib/theme/themeTokens";
import { supabase } from "@/lib/supabase";

const EA_OPERATIONS: ParticipationDelinkOperation[] = [
  PARTICIPATION_DELINK_OPERATION.estateAgentRemoveBranch,
  PARTICIPATION_DELINK_OPERATION.estateAgentRemoveHomeowner,
];

type ParticipationDelinkQuickActionsProps = {
  propertyId: number;
  onCompleted?: () => void | Promise<void>;
};

export default function ParticipationDelinkQuickActions({
  propertyId,
  onCompleted,
}: ParticipationDelinkQuickActionsProps) {
  const [options, setOptions] = useState<ParticipationDelinkOption[]>([]);
  const [pendingOperation, setPendingOperation] =
    useState<ParticipationDelinkOperation | null>(null);

  const reload = useCallback(async () => {
    const { data } = await getParticipationDelinkOptions(
      supabase,
      propertyId
    );

    if (!data.ok) {
      setOptions([]);
      return;
    }

    setOptions(
      data.options.filter((option) =>
        EA_OPERATIONS.includes(option.operation)
      )
    );
  }, [propertyId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (options.length === 0) {
    return null;
  }

  async function handleConfirm(reasonCode: ParticipationDelinkReasonCode) {
    if (!pendingOperation) {
      return { ok: false, message: "No operation selected." };
    }

    const selected = options.find(
      (option) => option.operation === pendingOperation
    );

    const { data, error } = await executeParticipationDelink(supabase, {
      propertyId,
      operation: pendingOperation,
      reasonCode,
      branchId: selected?.branchId,
    });

    if (error) {
      return { ok: false, message: error.message };
    }

    if (!data.ok) {
      return { ok: false, message: data.error };
    }

    await onCompleted?.();
    await reload();

    return {
      ok: true,
      message: getParticipationDelinkSuccessMessage(pendingOperation),
    };
  }

  const pendingCopy = pendingOperation
    ? getParticipationDelinkConfirmationCopy(pendingOperation)
    : null;

  return (
    <>
      <div className="flex flex-wrap gap-2 border-t border-surface-card-border pt-4">
        {options.map((option) => (
          <button
            key={option.operation}
            type="button"
            onClick={() => setPendingOperation(option.operation)}
            className={`inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-medium ${BTN_SECONDARY_OUTLINE_SM_CLASS}`}
          >
            {option.label}
          </button>
        ))}
      </div>

      {pendingCopy && pendingOperation ? (
        <ParticipationDelinkConfirmModal
          isOpen
          operation={pendingOperation}
          copy={pendingCopy}
          onClose={() => setPendingOperation(null)}
          onConfirm={handleConfirm}
        />
      ) : null}
    </>
  );
}
