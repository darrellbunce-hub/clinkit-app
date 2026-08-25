"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

import ActionRequiredSection from "@/components/agent/commandCentre/ActionRequiredSection";
import BranchHealthSection from "@/components/agent/commandCentre/BranchHealthSection";
import ManagedPropertiesSection from "@/components/agent/commandCentre/ManagedPropertiesSection";
import OperationalBriefSection from "@/components/agent/commandCentre/OperationalBriefSection";
import UpcomingCompletionsSection from "@/components/agent/commandCentre/UpcomingCompletionsSection";
import { PAGE_TITLE_CLASS } from "@/components/mobileStandards";
import { FONT_HEADING_CLASS } from "@/lib/theme/themeTokens";
import { ROUTES } from "@/lib/auth/routes";
import type { AgentHomeContext } from "@/lib/estateAgent/loadAgentHomeContext";
import type { AgentBranchPropertySummary } from "@/lib/estateAgent/assignmentTypes";
import { loadAgentBranchPropertySummaries } from "@/lib/estateAgent/assignments";
import {
  computeBranchHealthOverview,
  computeTodaysOperationsKpis,
  filterActionRequiredSummaries,
  filterActiveSummaries,
  filterUpcomingCompletionSummaries,
  sortActionRequiredSummaries,
  sortManagedPropertySummaries,
} from "@/lib/estateAgent/commandCentrePresentation";
import { buildOperationalBriefModel } from "@/lib/estateAgent/workspacePresentation";
import { BTN_PRIMARY_SM_CLASS } from "@/lib/theme/themeTokens";
import { supabase } from "@/lib/supabase";

export default function AgentCommandCentre({
  context,
}: {
  context: AgentHomeContext;
}) {
  const [summaries, setSummaries] =
    useState<AgentBranchPropertySummary[]>([]);
  const [isLoading, setIsLoading] =
    useState(true);

  async function reloadSummaries() {
    const rows =
      await loadAgentBranchPropertySummaries(
        supabase
      );

    setSummaries(rows);
    setIsLoading(false);
  }

  useEffect(() => {
    void reloadSummaries();
  }, []);

  const activeSummaries = useMemo(
    () => filterActiveSummaries(summaries),
    [summaries]
  );

  const operationalBrief = useMemo(
    () => buildOperationalBriefModel(summaries),
    [summaries]
  );

  const todaysOperationsKpis = useMemo(
    () =>
      computeTodaysOperationsKpis(summaries),
    [summaries]
  );

  const actionRequiredSummaries = useMemo(
    () =>
      sortActionRequiredSummaries(
        filterActionRequiredSummaries(summaries)
      ),
    [summaries]
  );

  const managedPropertySummaries = useMemo(
    () =>
      sortManagedPropertySummaries(
        activeSummaries
      ),
    [activeSummaries]
  );

  const upcomingCompletions = useMemo(
    () =>
      filterUpcomingCompletionSummaries(
        summaries
      ),
    [summaries]
  );

  const branchHealthOverview = useMemo(
    () =>
      computeBranchHealthOverview(summaries),
    [summaries]
  );

  if (isLoading) {
    return (
      <div className="rounded-2xl bg-surface-card p-10 text-center text-text-muted shadow-sm ring-1 ring-surface-card-border">
        Loading operational command centre...
      </div>
    );
  }

  return (
    <div className="space-y-10">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className={`${PAGE_TITLE_CLASS} ${FONT_HEADING_CLASS} text-text-charcoal`}>
            Operational Command Centre
          </h1>

          <p className="mt-2 text-text-muted">
            {context.company.name} ·{" "}
            {context.branch.name} ·{" "}
            {context.branch.town_or_city}
          </p>
        </div>

        <Link
          href={ROUTES.agentOriginate}
          className={`inline-flex items-center justify-center rounded-xl px-5 py-3 text-sm font-semibold ${BTN_PRIMARY_SM_CLASS}`}
        >
          Add Managed Property
        </Link>
      </header>

      <OperationalBriefSection
        brief={operationalBrief}
      />

      <ActionRequiredSection
        summaries={actionRequiredSummaries}
        onInvitationChanged={reloadSummaries}
      />

      <ManagedPropertiesSection
        summaries={managedPropertySummaries}
        onInvitationChanged={reloadSummaries}
      />

      <UpcomingCompletionsSection
        scheduled={
          upcomingCompletions.scheduled
        }
        awaitingConfirmation={
          upcomingCompletions.awaitingConfirmation
        }
      />

      <BranchHealthSection
        overview={branchHealthOverview}
        averageConfidence={
          todaysOperationsKpis.averageConfidence
        }
      />
    </div>
  );
}

