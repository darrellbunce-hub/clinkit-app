"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import ParticipationDelinkConfirmModal from "@/components/participation/ParticipationDelinkConfirmModal";
import { ROUTES } from "@/lib/auth/routes";
import { isEstateAgent, type AccountType } from "@/lib/accountType";
import {
  executeParticipationDelink,
  getParticipationDelinkOptions,
  PARTICIPATION_DELINK_OPERATION,
  type ParticipationDelinkOption,
} from "@/lib/ownership/participationDelink";
import {
  getParticipationDelinkConfirmationCopy,
  getParticipationDelinkSuccessMessage,
  PARTICIPATION_DELINK_PANEL_DESCRIPTION,
  PARTICIPATION_DELINK_PANEL_TITLE,
} from "@/lib/ownership/participationDelinkPresentation";
import type { ParticipationDelinkOperation } from "@/lib/ownership/participationDelinkTypes";
import type { ParticipationDelinkReasonCode } from "@/lib/ownership/participationDelinkReasonCodes";
import { supabase } from "@/lib/supabase";

type ParticipationDelinkPanelProps = {
  propertyId: number;
  accountType: string | null;
  onCompleted?: () => void | Promise<void>;
};

export default function ParticipationDelinkPanel({
  propertyId,
  accountType,
  onCompleted,
}: ParticipationDelinkPanelProps) {
  const router = useRouter();
  const [options, setOptions] = useState<ParticipationDelinkOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [pendingOperation, setPendingOperation] =
    useState<ParticipationDelinkOperation | null>(null);

  const reloadOptions = useCallback(async () => {
    setIsLoading(true);
    setLoadError("");

    const { data, error } = await getParticipationDelinkOptions(
      supabase,
      propertyId
    );

    if (error) {
      setLoadError(error.message);
      setOptions([]);
      setIsLoading(false);
      return;
    }

    if (!data.ok) {
      setLoadError(data.error);
      setOptions([]);
      setIsLoading(false);
      return;
    }

    setOptions(data.options);
    setIsLoading(false);
  }, [propertyId]);

  useEffect(() => {
    void reloadOptions();
  }, [reloadOptions]);

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

    setSuccessMessage(
      getParticipationDelinkSuccessMessage(pendingOperation)
    );

    await onCompleted?.();

    if (pendingOperation === PARTICIPATION_DELINK_OPERATION.homeownerSelf) {
      router.push(
        isEstateAgent({
          account_type: (accountType ?? "homeowner") as AccountType,
        })
          ? ROUTES.agentHome
          : ROUTES.homeownerDashboard
      );
      return { ok: true };
    }

    await reloadOptions();
    return { ok: true };
  }

  if (isLoading) {
    return (
      <div className="rounded-3xl border border-slate-200 bg-white p-8 text-slate-600">
        Loading participation options…
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="rounded-3xl border border-red-200 bg-red-50 p-8 text-red-800">
        {loadError}
      </div>
    );
  }

  if (options.length === 0) {
    return null;
  }

  const pendingCopy = pendingOperation
    ? getParticipationDelinkConfirmationCopy(pendingOperation)
    : null;

  return (
    <>
      <div className="rounded-3xl border border-red-200 bg-white p-8">
        <h2 className="text-2xl font-bold text-slate-900">
          {PARTICIPATION_DELINK_PANEL_TITLE}
        </h2>

        <p className="mt-2 text-slate-600">
          {PARTICIPATION_DELINK_PANEL_DESCRIPTION}
        </p>

        {successMessage ? (
          <p className="mt-4 rounded-2xl border border-green-200 bg-green-50 px-4 py-3 text-sm font-medium text-green-800">
            {successMessage}
          </p>
        ) : null}

        <ul className="mt-6 space-y-3">
          {options.map((option) => (
            <li key={option.operation}>
              <button
                type="button"
                onClick={() => setPendingOperation(option.operation)}
                className="w-full rounded-2xl border border-red-200 px-4 py-4 text-left transition hover:bg-red-50"
              >
                <p className="font-semibold text-slate-900">
                  {option.label}
                </p>

                {option.invitationPending ? (
                  <p className="mt-1 text-sm text-slate-600">
                    Invitation is still pending.
                  </p>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
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
