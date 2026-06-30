"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

import ActionRequiredSection from "@/components/agent/commandCentre/ActionRequiredSection";
import BranchHealthSection from "@/components/agent/commandCentre/BranchHealthSection";
import ManagedPropertiesSection from "@/components/agent/commandCentre/ManagedPropertiesSection";
import TodaysOperationsSection from "@/components/agent/commandCentre/TodaysOperationsSection";
import UpcomingCompletionsSection from "@/components/agent/commandCentre/UpcomingCompletionsSection";
import { PAGE_TITLE_CLASS } from "@/components/mobileStandards";
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

  useEffect(() => {
    async function loadSummaries() {
      const rows =
        await loadAgentBranchPropertySummaries(
          supabase
        );

      setSummaries(rows);
      setIsLoading(false);
    }

    void loadSummaries();
  }, []);

  const activeSummaries = useMemo(
    () => filterActiveSummaries(summaries),
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
      <div className="rounded-3xl border border-slate-200 bg-white p-10 text-center text-slate-600 shadow-sm">
        Loading operational command centre...
      </div>
    );
  }

  return (
    <div className="space-y-12">
      <header className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className={PAGE_TITLE_CLASS}>
            Operational Command Centre
          </h1>

          <p className="mt-3 text-lg text-slate-600">
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

      <TodaysOperationsSection
        kpis={todaysOperationsKpis}
      />

      <ActionRequiredSection
        summaries={actionRequiredSummaries}
      />

      <ManagedPropertiesSection
        summaries={managedPropertySummaries}
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
      />
    </div>
  );
}
