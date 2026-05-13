"use client";

import Link from "next/link";
import Navbar from "@/components/Navbar";
import { useChain } from "@/context/ChainContext";

export default function MyChainsPage() {

  const {
    properties,
    chains,
  } = useChain();

  const uniqueChainIds =
    [...new Set(
      properties.map(
        (property) =>
          property.chainId
      )
    )];

  const userChains =
    chains.filter(
      (chain) =>
        uniqueChainIds.includes(
          chain.id
        )
    );

  return (
    <main className="min-h-screen bg-slate-100">

      <Navbar />

      <div className="max-w-5xl mx-auto px-6 py-12">

        <h1 className="text-5xl font-bold text-slate-900">
          My Chains
        </h1>

        <p className="mt-3 text-lg text-slate-600">
          Your active property chains
        </p>

        <div className="mt-10 grid gap-6">

          {userChains.map((chain) => {

            const chainProperties =
              properties.filter(
                (property) =>
                  property.chainId ===
                  chain.id
              );

            const connectedCount =
              chainProperties.filter(
                (property) =>
                  property.status ===
                  "healthy"
              ).length;

            const pendingCount =
              chainProperties.filter(
                (property) =>
                  property.status ===
                  "pending_connection"
              ).length;

            return (

              <div
                key={chain.id}
                className="bg-white rounded-3xl border border-slate-200 p-8"
              >

                <div className="flex items-center justify-between">

                  <div>

                    <h2 className="text-3xl font-bold text-slate-900">
                      Chain #{chain.id}
                    </h2>

                    <p className="mt-2 text-slate-600">
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

                  </div>

                  <Link
                    href={`/chain/${chain.id}`}
                    className="bg-slate-900 text-white px-6 py-4 rounded-2xl font-semibold"
                  >
                    Open Chain
                  </Link>

                </div>

                <div className="mt-8 flex gap-6">

                  <div className="bg-green-100 px-5 py-4 rounded-2xl">

                    <p className="text-sm text-green-700">
                      Connected
                    </p>

                    <p className="text-3xl font-bold text-green-700">
                      {connectedCount}
                    </p>

                  </div>

                  <div className="bg-slate-100 px-5 py-4 rounded-2xl">

                    <p className="text-sm text-slate-700">
                      Pending
                    </p>

                    <p className="text-3xl font-bold text-slate-700">
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