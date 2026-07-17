"use client";

import Link from "next/link";
import {
  CARD_PADDING_CLASS,
  PAGE_TITLE_CLASS,
  SECTION_TITLE_CLASS,
} from "@/components/mobileStandards";
import EmailVerificationBanner from "@/components/auth/EmailVerificationBanner";
import Navbar from "@/components/Navbar";
import PageHeaderBand from "@/components/theme/PageHeaderBand";
import { STAGES } from "@/data/stages";
import { useChain } from "@/context/ChainContext";
import {
  getDashboardChainTitle,
  getParticipantPropertyLabel,
  resolveDashboardOperationalPropertyId,
} from "@/lib/operationalPosition";
import { statusBadgeClasses } from "@/lib/theme/statusBadges";
import {
  BTN_PRIMARY_SM_CLASS,
  CARD_CLASS_NO_PADDING,
  DASHBOARD_LIST_CLASS,
  DASHBOARD_LIST_ROW_CLASS,
  PAGE_BG_CLASS,
  SURFACE_PANEL_HOVER_CLASS,
} from "@/lib/theme/themeTokens";

function formatConnectionStatus(
  status: string | null | undefined
): string {
  if (!status) {
    return "Unknown";
  }

  return status
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatChainState(
  state: string | null | undefined
): string {
  if (!state) {
    return "Unknown";
  }

  return state
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function getStageLabel(stage: string | null | undefined): string {
  if (!stage) {
    return "Unknown";
  }

  return (
    STAGES.find((entry) => entry.value === stage)?.label ??
    formatConnectionStatus(stage)
  );
}

export default function DashboardPage() {
  const { properties, chains } = useChain();

  return (
    <main className={PAGE_BG_CLASS}>
      <Navbar />
      <PageHeaderBand />

      <div className="max-w-6xl mx-auto px-6 py-12">
        <EmailVerificationBanner className="mb-8" />

        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
          <div>
            <h1 className={PAGE_TITLE_CLASS}>
              My Chains
            </h1>

            <p className="text-slate-600 mt-3 text-lg">
              Track and manage your active property chains.
            </p>
          </div>

          <Link
            href="/start-move"
            className={`${BTN_PRIMARY_SM_CLASS} px-6 py-4`}
          >
            + Create Chain
          </Link>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-8 mt-12">
          <div className="xl:col-span-2">
            <div className="grid gap-6 md:grid-cols-2">
              {chains.map((chain) => {
                const chainProperties = properties
                  .filter(
                    (property) =>
                      property.chainId === chain.id
                  )
                  .sort(
                    (a, b) =>
                      a.chainPosition - b.chainPosition
                  );

                const operationalPropertyId =
                  resolveDashboardOperationalPropertyId(
                    chainProperties
                  );

                return (
                  <div
                    key={chain.id}
                    className={`bg-surface-card rounded-3xl shadow-sm border border-surface-card-border ${CARD_PADDING_CLASS}`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <h2 className="text-2xl font-bold text-slate-900 truncate">
                          {getDashboardChainTitle(
                            chain.id,
                            properties,
                            operationalPropertyId
                          )}
                        </h2>

                        <p className="text-slate-500 mt-1 text-sm">
                          Access Code: {chain.accessCode}
                        </p>
                      </div>

                      <div
                        className={`
                          shrink-0 px-3 py-1.5 rounded-full text-xs font-medium
                          ${statusBadgeClasses(
                            chainProperties.some(
                              (property) =>
                                property.status ===
                                "broken_connection"
                            )
                              ? "broken_connection"
                              : chainProperties.some(
                                    (property) =>
                                      property.status ===
                                      "pending_connection"
                                  )
                                ? "pending_connection"
                                : chainProperties.some(
                                      (property) =>
                                        property.status ===
                                        "delayed"
                                    )
                                  ? "delayed"
                                  : "healthy"
                          )}
                        `}
                      >
                        {formatChainState(chain.state)}
                      </div>
                    </div>

                    <div className={`mt-4 ${DASHBOARD_LIST_CLASS}`}>
                      {chainProperties.map((property) => {
                        const stageLabel = getStageLabel(
                          property.stage
                        );
                        const statusLabel = formatConnectionStatus(
                          property.status
                        );

                        return (
                          <div
                            key={property.id}
                            className={DASHBOARD_LIST_ROW_CLASS}
                          >
                            <div className="min-w-0">
                              <h3 className="font-semibold text-slate-900 text-sm leading-snug">
                                {getParticipantPropertyLabel(
                                  {
                                    id: property.id,
                                    relationship_type:
                                      property.relationship_type,
                                    stage: property.stage,
                                    address: property.address,
                                    chainPosition:
                                      property.chainPosition,
                                    currentUserRole:
                                      property.currentUserRole,
                                  },
                                  operationalPropertyId
                                )}
                              </h3>

                              <p className="text-xs text-slate-500 mt-1">
                                Position #{property.chainPosition}
                                {" · "}
                                {stageLabel}
                                {" · "}
                                {statusLabel}
                              </p>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    <Link
                      href={`/chain/${chain.id}`}
                      className={`block mt-6 w-full border border-surface-card-border text-slate-900 py-3 rounded-xl ${SURFACE_PANEL_HOVER_CLASS} text-center text-sm font-medium`}
                    >
                      View Chain
                    </Link>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="space-y-6">
            <div className={`${CARD_CLASS_NO_PADDING} ${CARD_PADDING_CLASS}`}>
              <h2 className="text-xl font-bold text-slate-900">
                Recommended Next Steps
              </h2>

              <div className="mt-6 space-y-4">
                <div className={`border border-surface-card-border rounded-2xl p-4 hover:border-brand-primary/30 ${SURFACE_PANEL_HOVER_CLASS} cursor-pointer`}>
                  <p className="font-semibold text-slate-900">
                    Compare Home Insurance
                  </p>

                  <p className="text-sm text-slate-500 mt-1">
                    Recommended after searches and mortgage approval.
                  </p>
                </div>

                <div className={`border border-surface-card-border rounded-2xl p-4 hover:border-brand-primary/30 ${SURFACE_PANEL_HOVER_CLASS} cursor-pointer`}>
                  <p className="font-semibold text-slate-900">
                    Book a Removals Company
                  </p>

                  <p className="text-sm text-slate-500 mt-1">
                    Prepare early to secure your preferred moving date.
                  </p>
                </div>

                <div className={`border border-surface-card-border rounded-2xl p-4 hover:border-brand-primary/30 ${SURFACE_PANEL_HOVER_CLASS} cursor-pointer`}>
                  <p className="font-semibold text-slate-900">
                    Utilities & Broadband
                  </p>

                  <p className="text-sm text-slate-500 mt-1">
                    Set up your new services before completion day.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {chains.length === 0 && (
          <div className={`mt-12 ${CARD_CLASS_NO_PADDING} p-12 text-center`}>
            <h2 className={SECTION_TITLE_CLASS}>
              No Active Moves Yet
            </h2>

            <p className="mt-2 text-slate-500">
              Start a move to begin tracking your property chain progress.
            </p>

            <p className="mt-4 text-slate-600">
              Start your first property move or join an existing chain.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
