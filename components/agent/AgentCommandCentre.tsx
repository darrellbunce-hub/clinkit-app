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
import { listReconnectableProperties } from "@/lib/estateAgent/reconnectReturningBranch";
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
  const [reconnectableCount, setReconnectableCount] =
    useState(0);

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

    void listReconnectableProperties(supabase).then(
      (result) => {
        setReconnectableCount(
          result.ok ? result.properties.length : 0
        );
      }
    );
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

      {reconnectableCount > 0 ? (
        <div className="flex flex-col gap-3 rounded-2xl bg-surface-card px-5 py-4 shadow-sm ring-1 ring-surface-card-border sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-text-charcoal">
            {reconnectableCount === 1
              ? "A property your branch represented is no longer represented after the homeowner left MoveLoop."
              : `${reconnectableCount} properties your branch represented are no longer represented after the homeowner left MoveLoop.`}
          </p>

          <Link
            href={ROUTES.agentReconnect}
            className="shrink-0 text-sm font-semibold text-brand-primary underline"
          >
            Review and reconnect
          </Link>
        </div>
      ) : null}

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

