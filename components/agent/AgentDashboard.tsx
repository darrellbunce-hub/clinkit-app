"use client";

import Link from "next/link";
import {
  useEffect,
  useMemo,
  useState,
} from "react";

import type { AgentHomeContext } from "@/lib/estateAgent/loadAgentHomeContext";
import type {
  AgentBranchPropertySummary,
  AgentDashboardTab,
} from "@/lib/estateAgent/assignmentTypes";
import { loadAgentBranchPropertySummaries } from "@/lib/estateAgent/assignments";
import {
  computeAgentDashboardStats,
  filterSummariesByTab,
} from "@/lib/estateAgent/classifyAgentDashboard";
import { getAgentAssignmentAccessLabel } from "@/lib/estateAgent/delegatedUpdates";
import { PAGE_TITLE_CLASS } from "@/components/mobileStandards";
import { TAB_ACTIVE_CLASS } from "@/lib/theme/themeTokens";
import { supabase } from "@/lib/supabase";

const tabs: {
  id: AgentDashboardTab;
  label: string;
}[] = [
  { id: "active", label: "Active Chains" },
  { id: "archived", label: "Archived Chains" },
];

export default function AgentDashboard({
  context,
}: {
  context: AgentHomeContext;
}) {
  const [activeTab, setActiveTab] =
    useState<AgentDashboardTab>("active");
  const [summaries, setSummaries] =
    useState<AgentBranchPropertySummary[]>(
      []
    );
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

    loadSummaries();
  }, []);

  const stats = useMemo(
    () =>
      computeAgentDashboardStats(summaries),
    [summaries]
  );

  const visibleSummaries =
    filterSummariesByTab(
      summaries,
      activeTab
    );

  return (
    <div className="space-y-8">
      <div>
        <h1 className={PAGE_TITLE_CLASS}>
          Welcome
          {context.contactName
            ? `, ${context.contactName}`
            : ""}
        </h1>

        <p className="mt-3 text-slate-600">
          {context.company.name} ·{" "}
          {context.branch.name} ·{" "}
          {context.branch.town_or_city}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Active properties"
          value={String(stats.activeCount)}
        />
        <StatCard
          label="Archived properties"
          value={String(stats.archivedCount)}
        />
        <StatCard
          label="Scheduled completions"
          value={String(
            stats.scheduledCompletions
          )}
        />
        <StatCard
          label="Awaiting confirmation"
          value={String(
            stats.awaitingConfirmation
          )}
        />
      </div>

      <div className="border-b border-slate-200">
        <nav className="flex gap-2">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() =>
                setActiveTab(tab.id)
              }
              className={`
                px-4 py-3 text-sm font-semibold border-b-2 transition
                ${
                  activeTab === tab.id
                    ? TAB_ACTIVE_CLASS
                    : "border-transparent text-slate-500 hover:text-slate-700"
                }
              `}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="p-10 text-center text-slate-600">
            Loading property summaries...
          </div>
        ) : visibleSummaries.length === 0 ? (
          <div className="p-10 text-center">
            <h2 className="text-2xl font-bold text-slate-900">
              {activeTab === "active"
                ? "No active properties assigned yet"
                : "No archived properties yet"}
            </h2>

            <p className="mt-4 text-slate-600 max-w-xl mx-auto">
              {activeTab === "active"
                ? "When homeowners assign your branch to a property, summaries will appear here."
                : "Completed or withdrawn assignments will appear here."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-6 py-4 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Property
                  </th>
                  <th className="px-6 py-4 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Stage
                  </th>
                  <th className="px-6 py-4 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Completion
                  </th>
                  <th className="px-6 py-4 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Access
                  </th>
                </tr>
              </thead>

              <tbody>
                {visibleSummaries.map(
                  (summary) => (
                    <SummaryRow
                      key={
                        summary.assignment_id
                      }
                      summary={summary}
                    />
                  )
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white px-6 py-5 shadow-sm">
      <p className="text-sm font-medium text-slate-500">
        {label}
      </p>

      <p className="mt-2 text-3xl font-bold text-slate-900">
        {value}
      </p>
    </div>
  );
}

function SummaryRow({
  summary,
}: {
  summary: AgentBranchPropertySummary;
}) {
  const accessLabel =
    getAgentAssignmentAccessLabel({
      status: summary.assignment_status,
      homeowner_only_updates:
        summary.homeowner_only_updates,
    });

  const accessText =
    accessLabel === "delegated_updates"
      ? "Delegated updates"
      : accessLabel === "view_only"
        ? "View only"
        : "No access";

  return (
    <tr className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50/80">
      <td className="px-6 py-4">
        <Link
          href={`/property/${summary.property_id}`}
          className="block group"
        >
          <p className="font-semibold text-slate-900 group-hover:text-blue-700">
            {summary.address ?? "Property"}
          </p>

          <p className="text-sm text-slate-500">
            {summary.postcode ?? "—"} · Chain{" "}
            {summary.chain_id}
          </p>
        </Link>
      </td>

      <td className="px-6 py-4 text-slate-700">
        {summary.stage}
      </td>

      <td className="px-6 py-4 text-slate-700">
        {summary.completion_scheduled_date ??
          summary.completion_lifecycle_status ??
          "—"}
      </td>

      <td className="px-6 py-4 text-slate-700">
        {accessText}
      </td>
    </tr>
  );
}
