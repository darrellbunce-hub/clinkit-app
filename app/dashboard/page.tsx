"use client";

import Link from "next/link";
import {
  CARD_PADDING_CLASS,
  PAGE_TITLE_CLASS,
  SECTION_TITLE_CLASS,
} from "@/components/mobileStandards";
import { MobilePanelHeader } from "@/components/mobile/MobileLayout";
import EmailVerificationBanner from "@/components/auth/EmailVerificationBanner";
import Navbar from "@/components/Navbar";
import ParticipantDataLoadingState from "@/components/loading/ParticipantDataLoadingState";
import PageHeaderBand from "@/components/theme/PageHeaderBand";
import { STAGES } from "@/data/stages";
import { useChain } from "@/context/ChainContext";
import {
  getDashboardChainTitle,
  getParticipantPropertyLabel,
  resolveDashboardOperationalPropertyId,
} from "@/lib/operationalPosition";
import { formatConnectionStatusLabel } from "@/lib/legal/connectionStatusLabels";
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
  return formatConnectionStatusLabel(status);
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
  const { properties, chains, authLoading, participantDataReady } =
    useChain();

  if (authLoading || !participantDataReady) {
    return (
      <ParticipantDataLoadingState message="Loading your chains…" />
    );
  }

  const hasChains = chains.length > 0;

  return (
    <main className={`${PAGE_BG_CLASS} overflow-x-clip`}>
      <Navbar />
      <PageHeaderBand />

      <div className="max-w-6xl mx-auto min-w-0 px-6 py-12">
        <EmailVerificationBanner className="mb-8" />

        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
          <div>
            <h1 className={PAGE_TITLE_CLASS}>
              My Chains
            </h1>

            <p className="text-slate-600 mt-3 text-lg">
              Your active property chains — with a shared view of progress across
              connected parts of each move.
            </p>
          </div>

          {hasChains ? (
            <Link
              href="/start-move"
              className={`${BTN_PRIMARY_SM_CLASS} px-6 py-4`}
            >
              + Create Chain
            </Link>
          ) : null}
        </div>

        {!hasChains ? (
          <div className={`mt-12 ${CARD_CLASS_NO_PADDING} p-10 sm:p-12 text-center`}>
            <h2 className={SECTION_TITLE_CLASS}>
              No Active Moves Yet
            </h2>

            <p className="mt-3 text-slate-600 max-w-xl mx-auto">
              Start your first property move, or join a chain you have already
              been invited to with an access code.
            </p>

            <div className="mt-8 flex flex-col sm:flex-row gap-4 justify-center">
              <Link
                href="/start-move"
                className={`${BTN_PRIMARY_SM_CLASS} px-6 py-4`}
              >
                Start a move
              </Link>
              <Link
                href="/join-chain"
                className="rounded-2xl border border-slate-300 bg-white px-6 py-4 font-semibold text-slate-800 hover:bg-slate-50"
              >
                Join a chain
              </Link>
            </div>
          </div>
        ) : (
          <div className="mt-12 grid min-w-0 grid-cols-1 xl:grid-cols-3 gap-8">
            <div className="min-w-0 xl:col-span-2">
              <div className="grid min-w-0 gap-6 md:grid-cols-2">
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
                      className={`min-w-0 bg-surface-card rounded-3xl shadow-sm border border-surface-card-border ${CARD_PADDING_CLASS}`}
                    >
                      <MobilePanelHeader
                        aside={
                          <div
                            className={`
                            px-3 py-1.5 rounded-full text-xs font-medium
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
                        }
                      >
                        <h2 className={`${SECTION_TITLE_CLASS} break-words`}>
                          {getDashboardChainTitle(
                            chain.id,
                            properties,
                            operationalPropertyId
                          )}
                        </h2>

                        <p className="text-slate-500 mt-1 text-sm break-words">
                          Access Code: {chain.accessCode}
                        </p>
                      </MobilePanelHeader>

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
                                <h3 className="font-semibold text-slate-900 text-sm leading-snug break-words">
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

                                <p className="text-xs text-slate-500 mt-1 break-words">
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

            <div className="min-w-0 space-y-6">
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
        )}
      </div>
    </main>
  );
}
