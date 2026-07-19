"use client";

import Link from "next/link";

import {
  CARD_PADDING_CLASS,
  PAGE_TITLE_CLASS,
  SECTION_TITLE_CLASS,
  STAT_VALUE_CLASS,
} from "@/components/mobileStandards";
import { MobileActionHeader } from "@/components/mobile/MobileLayout";
import Navbar from "@/components/Navbar";
import { useChain } from "@/context/ChainContext";
import { getDashboardChainTitle } from "@/lib/operationalPosition";

export default function MyChainsPage() {
  const { properties, chains } = useChain();

  const uniqueChainIds = [
    ...new Set(
      properties.map((property) => property.chainId)
    ),
  ];

  const userChains = chains.filter((chain) =>
    uniqueChainIds.includes(chain.id)
  );

  return (
    <main className="min-h-screen bg-slate-100">
      <Navbar />

      <div className="max-w-5xl mx-auto px-6 py-12">
        <h1 className={PAGE_TITLE_CLASS}>My Chains</h1>

        <p className="mt-3 text-lg text-slate-600">
          Your active property chains
        </p>

        <div className="mt-10 grid gap-6">
          {userChains.map((chain) => {
            const chainProperties = properties.filter(
              (property) =>
                property.chainId === chain.id
            );

            const connectedCount = chainProperties.filter(
              (property) =>
                property.status === "healthy"
            ).length;

            const pendingCount = chainProperties.filter(
              (property) =>
                property.status === "pending_connection"
            ).length;

            return (
              <div
                key={chain.id}
                className={`bg-white rounded-3xl border border-slate-200 ${CARD_PADDING_CLASS}`}
              >
                <MobileActionHeader
                  title={
                    <h2 className={SECTION_TITLE_CLASS}>
                      {getDashboardChainTitle(
                        chain.id,
                        chainProperties
                      )}
                    </h2>
                  }
                  meta={
                    <>
                      <p className="mt-2 text-slate-600 break-words">
                        Access Code: {chain.accessCode}
                      </p>

                      <p className="mt-2 text-slate-500">
                        Status:{" "}
                        {chain.state
                          .replaceAll("_", " ")
                          .replace(/\b\w/g, (letter) =>
                            letter.toUpperCase()
                          )}
                      </p>
                    </>
                  }
                  action={
                    <Link
                      href={`/chain/${chain.id}`}
                      className="inline-flex items-center justify-center bg-slate-900 text-white px-6 py-4 min-h-11 rounded-2xl font-semibold hover:bg-slate-800 transition"
                    >
                      Open Chain
                    </Link>
                  }
                />

                <div className="mt-8 grid grid-cols-2 gap-4 sm:flex sm:gap-6">
                  <div className="bg-green-100 px-5 py-4 rounded-2xl min-w-0">
                    <p className="text-sm text-green-700">
                      Connected
                    </p>

                    <p
                      className={`${STAT_VALUE_CLASS} text-green-700`}
                    >
                      {connectedCount}
                    </p>
                  </div>

                  <div className="bg-slate-100 px-5 py-4 rounded-2xl min-w-0">
                    <p className="text-sm text-slate-700">
                      Pending
                    </p>

                    <p
                      className={`${STAT_VALUE_CLASS} text-slate-700`}
                    >
                      {pendingCount}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </main>
  );
}
