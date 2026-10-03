"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import ConfirmStillActiveModal from "@/components/lifecycle/ConfirmStillActiveModal";
import DormancyWarningPanel from "@/components/lifecycle/DormancyWarningPanel";
import { MobileAlert } from "@/components/mobile/MobileLayout";
import { confirmTransactionStillActive } from "@/lib/lifecycle/confirmStillActive";
import {
  loadPropertyLifecycleStatus,
  NO_LIFECYCLE_WARNING,
  type PropertyLifecycleStatus,
} from "@/lib/lifecycle/loadPropertyLifecycleState";
import {
  isLifecycleDormancyWarningHint,
  resolveStillActiveConfirmationView,
  STILL_ACTIVE_SUCCESS_MESSAGE,
} from "@/lib/lifecycle/stillActiveConfirmationEligibility";
import { supabase } from "@/lib/supabase";

type PropertyLifecycleDormancySectionProps = {
  propertyId: number;
  currentUserId: string | null;
  onConfirmed?: () => void | Promise<void>;
  onSuccessMessage?: (message: string) => void;
};

export default function PropertyLifecycleDormancySection({
  propertyId,
  currentUserId,
  onConfirmed,
  onSuccessMessage,
}: PropertyLifecycleDormancySectionProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const lifecycleHint = isLifecycleDormancyWarningHint(
    searchParams.get("lifecycle")
  );

  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [status, setStatus] =
    useState<PropertyLifecycleStatus>(NO_LIFECYCLE_WARNING);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [infoMessage, setInfoMessage] = useState("");

  const clearLifecycleHintFromUrl = useCallback(() => {
    if (!lifecycleHint) {
      return;
    }

    router.replace(`/property/${propertyId}`, { scroll: false });
  }, [lifecycleHint, propertyId, router]);

  const reloadLifecycleStatus = useCallback(async () => {
    if (!currentUserId) {
      setIsLoading(false);
      setStatus(NO_LIFECYCLE_WARNING);
      return;
    }

    setIsLoading(true);
    setLoadError("");

    try {
      setStatus(
        await loadPropertyLifecycleStatus({ supabase, propertyId })
      );
    } catch (error) {
      setLoadError(
        error instanceof Error
          ? error.message
          : "Could not load lifecycle state."
      );
    } finally {
      setIsLoading(false);
    }
  }, [currentUserId, propertyId]);

  useEffect(() => {
    void reloadLifecycleStatus();
  }, [reloadLifecycleStatus]);

  const view = resolveStillActiveConfirmationView({
    lifecycleHint,
    inWarning: status.inWarning,
    canConfirmStillActive: status.canConfirm,
  });

  useEffect(() => {
    if (isLoading || !view.showAlreadyActiveInfo) {
      return;
    }

    setInfoMessage(view.alreadyActiveInfoMessage);
    clearLifecycleHintFromUrl();
  }, [
    clearLifecycleHintFromUrl,
    isLoading,
    view.alreadyActiveInfoMessage,
    view.showAlreadyActiveInfo,
  ]);

  async function handleConfirmStillActive() {
    if (isConfirming || !view.canConfirm) {
      return { ok: false, message: "Confirmation is not available." };
    }

    setIsConfirming(true);

    const result = await confirmTransactionStillActive({
      supabase,
      propertyId,
    });

    if (!result.ok) {
      setIsConfirming(false);
      return { ok: false, message: result.error };
    }

    await reloadLifecycleStatus();
    await onConfirmed?.();

    if (!result.idempotent) {
      onSuccessMessage?.(STILL_ACTIVE_SUCCESS_MESSAGE);
    }

    clearLifecycleHintFromUrl();
    setIsConfirming(false);

    return { ok: true };
  }

  if (isLoading || loadError) {
    return null;
  }

  return (
    <>
      {infoMessage ? (
        <div className="mt-6">
          <MobileAlert variant="success">{infoMessage}</MobileAlert>
        </div>
      ) : null}

      {view.showDormancyPanel ? (
        <DormancyWarningPanel
          confirmationDeadlineAt={status.confirmationDeadlineAt}
          onConfirmClick={() => setIsModalOpen(true)}
          isConfirmDisabled={isConfirming}
        />
      ) : null}

      <ConfirmStillActiveModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onConfirm={handleConfirmStillActive}
      />
    </>
  );
}
