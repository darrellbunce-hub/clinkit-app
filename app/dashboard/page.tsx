"use client";
import { useEffect, useState } from "react";
import Navbar from "@/components/Navbar";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";
type Chain = {
  id: number;
  access_code: string;
};

export default function DashboardPage() {

  const [properties, setProperties] =
  useState<any[]>([]);
  
  const [chains, setChains] =
    useState<Chain[]>([]);
    const router = useRouter();
    useEffect(() => {

      async function loadProperties() {
    
        const {
          data,
          error,
        } = await supabase
          .from("properties")
          .select("*")
          .order("chain_position");
    
        if (error) {
          console.error(error);
          return;
        }
    
        setProperties(data || []);
    
      }
    
      loadProperties();
    
    }, []);
  useEffect(() => {

    async function loadChains() {

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        return;
      }

      const {
        data: memberships,
      } = await supabase
        .from("property_members")
        .select(`
          property_id,
          properties (
            chain_id
          )
        `)
        .eq("user_id", user.id);

      if (!memberships) {
        return;
      }

      const chainIds =
  memberships
    .filter(
      (membership: any) =>
        membership.properties
    )
    .map(
      (membership: any) =>
        membership.properties.chain_id
    );

      const uniqueChainIds =
        [...new Set(chainIds)];

      const {
        data: chainsData,
      } = await supabase
        .from("chains")
        .select("*")
        .in("id", uniqueChainIds);

      if (chainsData) {
        setChains(chainsData);
      }
    }

    loadChains();

  }, []);

  return (
    <main className="min-h-screen bg-slate-100">

<Navbar />

      <div className="max-w-6xl mx-auto px-6 py-12">

        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">

          <div>

            <h1 className="text-5xl font-bold text-slate-900">
              My Chains
            </h1>

            <p className="text-slate-600 mt-3 text-lg">
              Track and manage your active property chains.
            </p>

          </div>

          <Link
            href="/start-move"
            className="bg-slate-900 text-white px-6 py-4 rounded-xl hover:bg-slate-700 transition"
          >
            + Create Chain
          </Link>

        </div>

        {/* Chains */}
        <div className="grid gap-6 md:grid-cols-2 mt-12">

          {chains.map((chain) => (

            <div
              key={chain.id}
              className="bg-white rounded-3xl shadow-sm p-8 border border-slate-200"
            >

              <div className="flex items-start justify-between">

                <div>

                  <h2 className="text-2xl font-bold text-slate-900">
                    Chain #{chain.id}
                  </h2>

                  <p className="text-slate-500 mt-2">
                    Access Code:
                    {" "}
                    {chain.access_code}
                  </p>
                  <div className="mt-6 space-y-4">

{properties
  .filter(
    (property: any) =>
      property.chain_id === chain.id
  )
  .map((property: any) => (

    <div
      key={property.id}
      className="
        border
        border-slate-200
        rounded-2xl
        p-4
        bg-slate-50
      "
    >

      <div className="flex items-center justify-between">

        <div>

          <h3 className="font-semibold text-slate-900">
            {property.address}
          </h3>

          <p className="text-sm text-slate-500 mt-1">
            Position #{property.chain_position}
          </p>

        </div>

        <div
          className="
            bg-blue-100
            text-blue-700
            px-3
            py-1
            rounded-full
            text-sm
            font-medium
          "
        >

          {property.status || "Active"}

        </div>

      </div>

    </div>

  ))}

</div>
                </div>

                <div className="bg-green-100 text-green-700 px-4 py-2 rounded-full text-sm font-medium">

                  Active

                </div>

              </div>

              <Link
                href={`/chain/${chain.id}`}
                className="block mt-8 w-full border border-slate-300 py-4 rounded-xl hover:bg-slate-50 transition text-center"
              >
                View Chain
              </Link>

            </div>

          ))}

        </div>

        {/* Empty State */}
        {chains.length === 0 && (

          <div className="mt-12 bg-white rounded-3xl border border-slate-200 p-12 text-center">

            <h2 className="text-3xl font-bold text-slate-900">
            No Active Moves Yet
            <p className="mt-2 text-slate-500">
  Start a move to begin tracking your property chain progress.
</p>
            </h2>

            <p className="mt-4 text-slate-600">
              Start your first property move or join an existing chain.
            </p>

          </div>

        )}

      </div>

    </main>
  );
}