"use client";

import { useCallback, useEffect, useState } from "react";

import ConfirmStillActiveModal from "@/components/lifecycle/ConfirmStillActiveModal";
import DormancyWarningPanel from "@/components/lifecycle/DormancyWarningPanel";
import { confirmTransactionStillActive } from "@/lib/lifecycle/confirmStillActive";
import {
  loadPropertyLifecycleStatus,
  NO_LIFECYCLE_WARNING,
  type PropertyLifecycleStatus,
} from "@/lib/lifecycle/loadPropertyLifecycleState";
import { STILL_ACTIVE_SUCCESS_MESSAGE } from "@/lib/lifecycle/stillActiveConfirmationEligibility";
import { supabase } from "@/lib/supabase";

type ChainLifecycleDormancySectionProps = {
  /**
   * The property the viewer's own Buyer Ready node is linked to. Null when the
   * viewer does not own the node or it is not linked; nothing is loaded then.
   */
  linkedPropertyId: number | null;
  onConfirmed?: () => void | Promise<void>;
  onSuccessMessage?: (message: string) => void;
};

/**
 * Still-active confirmation on the Buyer Ready page: the node owner is on the
 * dependent side of the placeholder their node is linked to, and confirms that
 * row only.
 */
export default function ChainLifecycleDormancySection({
  linkedPropertyId,
  onConfirmed,
  onSuccessMessage,
}: ChainLifecycleDormancySectionProps) {
  const [status, setStatus] =
    useState<PropertyLifecycleStatus>(NO_LIFECYCLE_WARNING);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);

  const fetchStatus = useCallback(async () => {
    if (linkedPropertyId === null) {
      return NO_LIFECYCLE_WARNING;
    }

    try {
      return await loadPropertyLifecycleStatus({
        supabase,
        propertyId: linkedPropertyId,
      });
    } catch {
      return NO_LIFECYCLE_WARNING;
    }
  }, [linkedPropertyId]);

  useEffect(() => {
    if (linkedPropertyId === null) {
      return;
    }

    let cancelled = false;

    void fetchStatus().then((next) => {
      if (!cancelled) {
        setStatus(next);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [fetchStatus, linkedPropertyId]);

  async function handleConfirmStillActive() {
    if (isConfirming || linkedPropertyId === null || !status.canConfirm) {
      return { ok: false, message: "Confirmation is not available." };
    }

    setIsConfirming(true);

    const result = await confirmTransactionStillActive({
      supabase,
      propertyId: linkedPropertyId,
    });

    if (!result.ok) {
      setIsConfirming(false);
      return { ok: false, message: result.error };
    }

    setStatus(await fetchStatus());
    await onConfirmed?.();

    if (!result.idempotent) {
      onSuccessMessage?.(STILL_ACTIVE_SUCCESS_MESSAGE);
    }

    setIsConfirming(false);

    return { ok: true };
  }

  if (linkedPropertyId === null || !status.inWarning || !status.canConfirm) {
    return null;
  }

  return (
    <>
      <DormancyWarningPanel
        confirmationDeadlineAt={status.confirmationDeadlineAt}
        onConfirmClick={() => setIsModalOpen(true)}
        isConfirmDisabled={isConfirming}
      />

      <ConfirmStillActiveModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onConfirm={handleConfirmStillActive}
      />
    </>
  );
}
