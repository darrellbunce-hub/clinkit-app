"use client";

import { useEffect, useState } from "react";

import type { AccountType } from "@/lib/accountType";
import { loadAssignmentWithBranchDirectory } from "@/lib/estateAgent/assignments";
import {
  formatOperationalManagerLabel,
  OPERATIONAL_MANAGER_FALLBACK_LABEL,
} from "@/lib/operationalPresentation";
import { getOperationalOwnerDisplayFallback } from "@/lib/customerFacingLabels";
import { supabase } from "@/lib/supabase";
import { fetchProfileAccountFields } from "@/lib/currentUserContext";

type UseOperationalWorkspaceLabelsParams = {
  assignedPropertyId: number | null;
  subjectUserId: string | null;
  accountType: AccountType | null | undefined;
  currentUserId: string | null | undefined;
};

export type OperationalWorkspaceLabels = {
  operationalOwner: string;
  operationalManager: string | null;
  isLoading: boolean;
};

export function useOperationalWorkspaceLabels(
  params: UseOperationalWorkspaceLabelsParams
): OperationalWorkspaceLabels {
  const {
    assignedPropertyId,
    subjectUserId,
    accountType,
    currentUserId,
  } = params;

  const [labels, setLabels] =
    useState<OperationalWorkspaceLabels>({
      operationalOwner: getOperationalOwnerDisplayFallback(
        accountType === "estate_agent"
          ? "estate_agent"
          : "owner"
      ),
      operationalManager: null,
      isLoading: false,
    });

  useEffect(() => {
    let cancelled = false;

    async function loadLabels() {
      if (!currentUserId) {
        return;
      }

      setLabels((previous) => ({
        ...previous,
        isLoading: true,
      }));

      const isEstateAgentViewer =
        accountType === "estate_agent";

      let operationalOwner = getOperationalOwnerDisplayFallback(
        isEstateAgentViewer ? "estate_agent" : "owner"
      );
      let operationalManager: string | null =
        null;

      if (isEstateAgentViewer) {
        if (subjectUserId) {
          const ownerProfile =
            await fetchProfileAccountFields(
              supabase,
              subjectUserId
            );

          if (ownerProfile?.contact_name?.trim()) {
            operationalOwner =
              ownerProfile.contact_name.trim();
          }
        }

        if (assignedPropertyId != null) {
          const { branch } =
            await loadAssignmentWithBranchDirectory(
              supabase,
              assignedPropertyId
            );

          operationalManager =
            formatOperationalManagerLabel(
              branch?.company_name,
              branch?.branch_name
            );
        } else {
          operationalManager =
            OPERATIONAL_MANAGER_FALLBACK_LABEL;
        }
      } else {
        const viewerProfile =
          await fetchProfileAccountFields(
            supabase,
            currentUserId
          );

        operationalOwner =
          viewerProfile?.contact_name?.trim() ||
          getOperationalOwnerDisplayFallback("owner");
      }

      if (!cancelled) {
        setLabels({
          operationalOwner,
          operationalManager,
          isLoading: false,
        });
      }
    }

    void loadLabels();

    return () => {
      cancelled = true;
    };
  }, [
    accountType,
    assignedPropertyId,
    currentUserId,
    subjectUserId,
  ]);

  return labels;
}
