"use client";

import { useState } from "react";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Navbar from "@/components/Navbar";
import { supabase } from "@/lib/supabase";

function JoinChainContent() {
  const searchParams =
  useSearchParams();

const sourceChainId =
  searchParams.get("sourceChain");

const propertyId =
  searchParams.get("property");
  const [accessCode, setAccessCode] =
    useState("");

  const [address, setAddress] =
    useState("");

  const [postcode, setPostcode] =
    useState("");

  async function handleJoinChain() {

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      alert("Please login first");
      return;
    }

    const {
      data: chain,
    } = await supabase
      .from("chains")
      .select("*")
      .eq("access_code", accessCode)
      .single();

    if (!chain) {

      alert("Invalid access code");

      return;
    }

    const {
      data: property,
    } = await supabase
      .from("properties")
      .select("*")
      .eq("chain_id", chain.id)
      .eq("address", address)

      .eq("postcode", postcode)
      .single();

    if (!property) {

      alert(
        "Property not found in this chain"
      );

      return;
    }
    await supabase
    .from("properties")
    .update({
      status: "healthy",
    })
    .eq("id", property.id);
    await supabase
  .from("property_members")
  .insert({
    property_id: property.id,
    user_id: user.id,
    role: "participant",
  });

const {
  data: members,
} = await supabase
  .from("property_members")
  .select("*")
  .eq("property_id", property.id);

if (members && members.length >= 2) {

  await supabase
    .from("properties")
    .update({
      status: "healthy",
    })
    .eq("id", property.id);
}
if (sourceChainId) {

  await supabase
    .from("properties")
    .delete()
    .eq("chain_id", sourceChainId);

}
      await supabase
      .from("properties")
      .update({
        status: "healthy",
      })
      .eq("id", property.id);
      window.location.href =
      `/dashboard?refresh=${Date.now()}`;
  }

  return (
    <main className="min-h-screen bg-slate-100">

      <Navbar />

      <div className="max-w-2xl mx-auto px-6 py-12">

        <h1 className="text-5xl font-bold text-slate-900">
          Join Existing Chain
        </h1>

        <p className="mt-3 text-lg text-slate-600">
          Enter your chain access details
        </p>

        <div className="mt-10 bg-white rounded-3xl border border-slate-200 p-8">

          <input
            type="text"
            value={accessCode}
            onChange={(event) =>
              setAccessCode(
                event.target.value
              )
            }
            placeholder="Chain access code"
            className="w-full border border-slate-300 rounded-2xl px-4 py-4"
          />

          <input
            type="text"
            value={address}
            onChange={(event) =>
              setAddress(
                event.target.value
              )
            }
            placeholder="Property address"
            className="mt-4 w-full border border-slate-300 rounded-2xl px-4 py-4"
          />

          <input
            type="text"
            value={postcode}
            onChange={(event) =>
              setPostcode(
                event.target.value
              )
            }
            placeholder="Property postcode"
            className="mt-4 w-full border border-slate-300 rounded-2xl px-4 py-4"
          />

          <button
            onClick={handleJoinChain}
            className="mt-6 w-full bg-slate-900 text-white rounded-2xl py-5 text-lg font-semibold"
          >
            Join Chain
          </button>

        </div>

      </div>

    </main>
  );
}

export default function JoinChainPage() {

  return (
    <Suspense fallback={<div>Loading...</div>}>
      <JoinChainContent />
    </Suspense>
  );
}