"use client";
import { useEffect, useState } from "react";
import Navbar from "@/components/Navbar";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";
import { getDashboardPropertyLabel } from "@/lib/operationalPosition";
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

        {/* Dashboard Layout */}
<div className="grid grid-cols-1 xl:grid-cols-3 gap-8 mt-12">

<div className="xl:col-span-2">

  {/* Chains */}
  <div className="grid gap-6 md:grid-cols-2">

          {chains.map((chain) => (

            <div
              key={chain.id}
              className="bg-white rounded-3xl shadow-sm p-8 border border-slate-200"
            >

              <div className="flex items-start justify-between">

                <div>

                <h2 className="text-2xl font-bold text-slate-900">

  {properties.find(
    (property: any) =>
      property.chain_id === chain.id
  )?.address || `Chain #${chain.id}`}

</h2>

<p className="text-slate-500 mt-2">
  Access Code: {chain.access_code}
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

<div className="flex flex-col gap-4">

        <div>

        <h3 className="font-semibold text-slate-900">

{getDashboardPropertyLabel({
  relationship_type: property.relationship_type,
  stage: property.stage,
  address: property.address,
  chain_position: property.chain_position,
})}

</h3>

          <p className="text-sm text-slate-500 mt-1">
            Position #{property.chain_position}
          </p>

        </div>

        <div
  className="
    self-start
    bg-blue-100
    text-blue-700
    px-2.5
    py-0.5
    rounded-full
    text-sm
    font-medium
    mt-3
  "
>

  {property.status || "Active"}

</div>

<div className="mt-6 space-y-2">

<div className="flex items-center gap-3">

  <div className="w-3 h-3 rounded-full bg-green-500"></div>

  <p className="text-sm text-slate-700">
    Memorandum Issued
  </p>

</div>

<div className="flex items-center gap-3">

  <div className="w-3 h-3 rounded-full bg-green-500"></div>

  <p className="text-sm text-slate-700">
    Searches Ordered
  </p>

</div>

<div className="flex items-center gap-3">

  <div className="w-3 h-3 rounded-full bg-blue-500"></div>

  <p className="text-sm font-medium text-slate-900">
    Awaiting Enquiries
  </p>

</div>

<div className="flex items-center gap-3 opacity-50">

  <div className="w-3 h-3 rounded-full bg-slate-300"></div>

  <p className="text-sm text-slate-700">
    Mortgage Offer
  </p>

</div>

<div className="flex items-center gap-3 opacity-50">

  <div className="w-3 h-3 rounded-full bg-slate-300"></div>

  <p className="text-sm text-slate-700">
    Exchange Contracts
  </p>

</div>

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
                className="block mt-8 w-full border border-slate-300 text-slate-900 py-4 rounded-xl hover:bg-slate-50 transition text-center"
              >
                View Chain
              </Link>

            </div>

          ))}

</div>

</div>

{/* Right Sidebar */}
<div className="space-y-6">

  <div className="bg-white rounded-3xl shadow-sm p-6 border border-slate-200">

    <h2 className="text-xl font-bold text-slate-900">
      Recommended Next Steps
    </h2>

    <div className="mt-6 space-y-4">

    <div
  className="
    border
    border-slate-200
    rounded-2xl
    p-4
    hover:border-slate-300
    hover:bg-slate-50
    transition
    cursor-pointer
  "
>

        <p className="font-semibold text-slate-900">
          Compare Home Insurance
        </p>

        <p className="text-sm text-slate-500 mt-1">
          Recommended after searches and mortgage approval.
        </p>

      </div>

      <div
  className="
    border
    border-slate-200
    rounded-2xl
    p-4
    hover:border-slate-300
    hover:bg-slate-50
    transition
    cursor-pointer
  "
>

        <p className="font-semibold text-slate-900">
          Book a Removals Company
        </p>

        <p className="text-sm text-slate-500 mt-1">
          Prepare early to secure your preferred moving date.
        </p>

      </div>

      <div
  className="
    border
    border-slate-200
    rounded-2xl
    p-4
    hover:border-slate-300
    hover:bg-slate-50
    transition
    cursor-pointer
  "
>

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

{/* Empty State */}
        {chains.length === 0 && (

          <div className="mt-12 bg-white rounded-3xl border border-slate-200 p-12 text-center">

<h2 className="text-3xl font-bold text-slate-900">
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