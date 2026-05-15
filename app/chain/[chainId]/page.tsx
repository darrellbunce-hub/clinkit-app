"use client";

import { useState, useEffect } from "react";
import Navbar from "@/components/Navbar";
import {
  useParams,
  useRouter,
} from "next/navigation";
import Link from "next/link";
import { useChain } from "@/context/ChainContext";
import { supabase } from "@/lib/supabase";
import { STAGES } from "@/data/stages";

export default function ChainPage() {

  const params = useParams();
  const router = useRouter();
  const chainId =
    parseInt(
      params.chainId as string
    );

    const {
      properties,
      chains,
      currentUserId,
    } = useChain();

    useEffect(() => {

      async function checkAuth() {
    
        const {
          data: { user },
        } = await supabase.auth.getUser();
    
        if (!user) {
    
          router.push("/login");
        }
      }
    
      checkAuth();
    
    }, []);

  const chainProperties =
  
    properties
      .filter(
        (property) =>
          property.chainId === chainId
      )
      .sort(
        (a, b) =>
          a.chainPosition -
          b.chainPosition
      );
      const staleProperties =
      chainProperties.filter(
        (property) =>
          property.lastUpdatedDays > 21
      );
    
    const delayedProperties =
      chainProperties.filter(
        (property) =>
          property.activities.some(
            (activity) =>
              activity.update.includes(
                "Delay Reported"
              )
          )
      );
    
    let chainHealth =
      "Stable";
    
    let chainHealthMessage =
      "Most properties updated recently with no major delays reported.";
    
    if (
      staleProperties.length >= 1 ||
      delayedProperties.length >= 1
    ) {
    
      chainHealth =
        "Active";
    
      chainHealthMessage =
        "Some delays or stale updates detected within the chain.";
    }
    
    if (
      staleProperties.length >= 2 ||
      delayedProperties.length >= 2
    ) {
    
      chainHealth =
        "At Risk";
    
      chainHealthMessage =
        "Multiple delays or stale properties may impact chain progression.";
    }
  const currentChain =
    chains.find(
      (chain) =>
        Number(chain.id) ===
        Number(chainId)
    );

  const [newAddress, setNewAddress] =
    useState("");

  const [newPostcode, setNewPostcode] =
    useState("");

  const totalProgress =
    chainProperties.reduce(
      (total, property) => {

        const stage = STAGES.find(
          (stage) =>
            stage.value === property.stage
        );

        if (!stage) {
          return total;
        }

        return total + (stage.progress || 0);

      },
      0
    );

  const averageProgress =
    chainProperties.length > 0
      ? Math.round(
          totalProgress /
          chainProperties.length
        )
      : 0;

  

  const blockedCount =
    chainProperties.filter(
      (property) =>
        property.status === "blocked"
    ).length;

  const delayedCount =
    chainProperties.filter(
      (property) =>
        property.status === "delayed"
    ).length;

  let confidenceScore =
    averageProgress;

  confidenceScore -= blockedCount * 25;
  confidenceScore -= delayedCount * 10;
  confidenceScore -= staleProperties.length * 5;

  if (confidenceScore < 0) {
    confidenceScore = 0;
  }

  let confidenceLabel =
    "High Risk";

  let confidenceColour =
    "text-red-700";

  let confidenceBg =
    "bg-red-100";

  if (confidenceScore >= 70) {

    confidenceLabel = "Healthy";
    confidenceColour = "text-green-700";
    confidenceBg = "bg-green-100";

  }
  else if (confidenceScore >= 40) {

    confidenceLabel = "Moderate";
    confidenceColour = "text-amber-700";
    confidenceBg = "bg-amber-100";

  }
  let estimatedChainCompletion =
  "16–20 weeks";

if (averageProgress >= 20) {
  estimatedChainCompletion =
    "12–16 weeks";
}

if (averageProgress >= 40) {
  estimatedChainCompletion =
    "8–12 weeks";
}

if (averageProgress >= 60) {
  estimatedChainCompletion =
    "4–8 weeks";
}

if (averageProgress >= 80) {
  estimatedChainCompletion =
    "1–3 weeks";
}

if (blockedCount > 0) {

  estimatedChainCompletion =
    `${estimatedChainCompletion} (blocked property detected)`;
}

else if (delayedCount > 0) {

  estimatedChainCompletion =
    `${estimatedChainCompletion} (delays reported)`;
}

else if (staleProperties.length > 0) {

  estimatedChainCompletion =
    `${estimatedChainCompletion} (awaiting updates)`;
}
let bottleneckProperty =
  null;

const blockedProperty =
  chainProperties.find(
    (property) =>
      property.status === "blocked"
  );

const delayedProperty =
  chainProperties.find(
    (property) =>
      property.activities.some(
        (activity) =>
          activity.update.includes(
            "Delay Reported"
          )
      )
  );

const staleProperty =
  chainProperties.find(
    (property) =>
      property.lastUpdatedDays > 14
  );

if (blockedProperty) {

  bottleneckProperty =
    blockedProperty;
}

else if (delayedProperty) {

  bottleneckProperty =
    delayedProperty;
}

else if (staleProperty) {

  bottleneckProperty =
    staleProperty;
}

else {

  bottleneckProperty =
    [...chainProperties].sort(
      (a, b) => {

        const stageA =
          STAGES.find(
            (stage) =>
              stage.value === a.stage
          );

        const stageB =
          STAGES.find(
            (stage) =>
              stage.value === b.stage
          );

        return (
          (stageA?.progress || 0) -
          (stageB?.progress || 0)
        );
      }
    )[0];
}
  async function handleAddProperty() {

    if (!newAddress || !newPostcode) {

      alert("Please complete fields");

      return;
    }

    const nextPosition =
      chainProperties.length + 1;

      const {
        data: propertyData,
        error,
      } =
      await supabase
        .from("properties")
        .insert({

          chain_id: chainId,

          chain_position:
            nextPosition,

          address: newAddress,

          postcode: newPostcode,

          stage: "property_listed",

          status:
            "pending_connection",

          is_current_user: true,
          owner_user_id:
          currentUserId,
          last_updated_days: 0,

        })
        .select()
        .single();

    if (error) {

      alert(error.message);

      return;
    }
    await supabase
    .from("activities")
    .insert({
  
      property_id:
        propertyData.id,
  
      update:
        "Onward purchase added",
  
    });
    window.location.reload();
  }

  return (
    <main className="min-h-screen bg-slate-100">

      <Navbar />

      <div className="max-w-6xl mx-auto px-6 py-12">

        <div>

          <h1 className="text-5xl font-bold text-slate-900">
            Chain #{chainId}
          </h1>
          <div className="mt-8 bg-white rounded-3xl border border-slate-200 p-8">

<div className="flex items-center gap-4">

  <div
    className={`
      px-4 py-2 rounded-full text-sm font-semibold

      ${
        chainHealth === "Stable"
          ? "bg-green-100 text-green-700"

        : chainHealth === "Active"
          ? "bg-amber-100 text-amber-700"

        : "bg-red-100 text-red-700"
      }
    `}
  >

    Chain Health: {chainHealth}

  </div>

</div>

<p className="mt-4 text-slate-600">
  {chainHealthMessage}
</p>

</div>
          <p className="text-slate-600 mt-3 text-lg">
            Live property chain progress tracking
          </p>

          <p className="mt-2 text-sm text-slate-500">
            Access Code:{" "}
            {currentChain?.accessCode || "Loading..."}
          </p>

          <p className="mt-2 text-slate-600">

            Status:{" "}

            {currentChain?.state
              ?.replaceAll("_", " ")
              .replace(/\b\w/g, (letter) =>
                letter.toUpperCase()
              )}

          </p>

        </div>

        {/* Progress */}
        <div className="mt-10 bg-white rounded-3xl shadow-sm border border-slate-200 p-8">

          <div className="flex items-center justify-between">

            <div>

              <h2 className="text-3xl font-bold text-slate-900">
                Chain Progress
              </h2>

              <p className="text-slate-600 mt-2">
                Overall chain completion estimate
              </p>

            </div>

            <div className="text-4xl font-bold text-slate-900">
              {averageProgress}%
            </div>

          </div>

          <div className="mt-8 w-full h-6 bg-slate-200 rounded-full overflow-hidden">

            <div
              className="h-full bg-green-500 rounded-full"
              style={{
                width: `${averageProgress}%`,
              }}
            ></div>

          </div>

        </div>

        {/* Confidence */}
        <div className="mt-10 bg-white rounded-3xl shadow-sm border border-slate-200 p-8">

          <div className="flex items-center justify-between">

            <div>

              <h2 className="text-3xl font-bold text-slate-900">
                Chain Confidence
              </h2>

            </div>

            <div
              className={`
                ${confidenceBg}
                px-6 py-4 rounded-2xl
              `}
            >

              <p className={`text-3xl font-bold ${confidenceColour}`}>
                {confidenceScore}%
              </p>

              <p className={`text-sm mt-1 ${confidenceColour}`}>
                {confidenceLabel}
              </p>
              <p className="text-xs text-slate-500 mt-4 max-w-xs">
  Confidence is calculated using
  chain progress, recent activity,
  delayed updates and blocked
  transactions.
</p>
            </div>

          </div>

        </div>
{/* Estimated Chain Completion */}
<div className="mt-10 bg-white rounded-3xl shadow-sm border border-slate-200 p-8">

  <div className="flex items-start justify-between gap-6">

    <div>

      <p className="text-sm font-medium text-slate-500">
        Estimated Chain Completion
      </p>

      <h2 className="mt-3 text-4xl font-bold text-slate-900">
        {estimatedChainCompletion}
      </h2>

      <p className="mt-4 text-slate-600 max-w-2xl">
        Estimated completion is based on overall chain progression, delays, stale activity and blocked transactions.
      </p>

    </div>

    <div className="bg-blue-100 text-blue-700 px-5 py-3 rounded-2xl text-sm font-semibold">

      Forecast Engine

    </div>

  </div>

</div>
{/* Chain Bottleneck */}
{bottleneckProperty && (

<div className="mt-10 bg-white rounded-3xl shadow-sm border border-slate-200 p-8">

  <div className="flex items-start justify-between gap-6">

    <div>

      <p className="text-sm font-medium text-slate-500">
        Chain Bottleneck
      </p>

      <h2 className="mt-3 text-3xl font-bold text-slate-900">
        Property {bottleneckProperty.chainPosition}
      </h2>

      <p className="mt-4 text-slate-600">
        This property currently appears to be slowing overall chain progression.
      </p>

      <div className="mt-6 space-y-2">

        <p className="text-slate-900 font-medium">
          {bottleneckProperty.address}
        </p>

        <p className="text-slate-500">
          Last updated {bottleneckProperty.lastUpdatedDays} days ago
        </p>

      </div>

    </div>

    <div className="bg-amber-100 text-amber-700 px-5 py-3 rounded-2xl text-sm font-semibold">

      Bottleneck Detected

    </div>

  </div>

</div>

)}
        {/* Warning */}
        {staleProperties.length > 0 && (

          <div className="mt-10 bg-amber-100 border border-amber-300 rounded-3xl p-6">

            <p className="text-amber-700 font-semibold">
              Property {staleProperties[0].id} has not updated for{" "}
              {staleProperties[0].lastUpdatedDays} days.
            </p>

          </div>

        )}

        {/* Chain */}
        <div className="mt-12 bg-white rounded-3xl shadow-sm border border-slate-200 p-8 overflow-x-auto">

          <div className="flex items-center min-w-max">

            {chainProperties.map((property, index) => {

              const stage = STAGES.find(
                (stage) =>
                  stage.value === property.stage
              );

              if (!stage) {
                return null;
              }

              return (

                <div
                  key={property.id}
                  className="flex items-center"
                >

                  <Link
                    href={`/property/${property.id}`}
                    className="flex flex-col items-center text-center hover:scale-105 transition"
                  >

                    <div
                      className={`
                        relative
                        flex
                        items-center
                        justify-center

                        ${
                          property.isCurrentUser
                            ? "w-28 h-28 rounded-3xl border-4 text-6xl"
                            : "w-24 h-24 rounded-2xl border-2 text-5xl"
                        }

                        ${
                          property.status === "healthy"
                            ? "bg-green-100 border-green-500"

                            : property.status === "pending_connection"
                            ? "bg-slate-100 border-slate-400"

                            : property.status === "delayed"
                            ? "bg-amber-100 border-amber-500"

                            : "bg-red-100 border-red-500"
                        }
                      `}
                    >

{
  property.status ===
  "pending_connection"

    ? "🔗"

  : property.status ===
    "broken_connection"

    ? "⛓️"

    : "🏠"
}

                    </div>

                    <p className="mt-4 font-semibold text-slate-900">
                      Property {property.chainPosition}
                    </p>

                    <p className="text-sm mt-1 text-slate-600">

  {
    property.status ===
    "pending_connection"

      ? "Awaiting seller connection"

    : property.status ===
      "broken_connection"

      ? "Reconnect required"

      : stage.label
  }
    </p>                      
                  
<div className="mt-3 w-32 h-2 bg-slate-200 rounded-full overflow-hidden">

<div
  className="h-full bg-green-500 rounded-full"
  style={{
    width: `${stage.progress}%`,
  }}
></div>

</div>

<p className="text-xs mt-1 text-slate-500">
{stage.progress}% complete
</p>
                    

                    <p className="text-xs mt-1 text-slate-500">
                      {property.address}
                    </p>

                    <p className="text-xs text-slate-400">
                      {property.postcode}
                    </p>
                    <p
  className={`
    text-xs mt-2 font-medium

    ${
      property.lastUpdatedDays > 14
        ? "text-red-500"
        : property.lastUpdatedDays > 7
        ? "text-amber-500"
        : "text-slate-400"
    }
  `}
>
  Updated {property.lastUpdatedDays} day
  {property.lastUpdatedDays !== 1 && "s"} ago
</p>
                  </Link>

                  {index < chainProperties.length - 1 && (

                    <div
                      className={`
                        w-24
                        border-t-4
                        border-dashed
                        mx-4

                        ${
                          property.status === "healthy"
                            ? "border-green-400"
                        
                            : property.status === "pending_connection"
                            ? "border-slate-400"
                        
                            : property.status === "broken_connection"
                            ? "border-red-500"
                        
                            : property.status === "delayed"
                            ? "border-amber-400"
                        
                            : "border-red-400"
                        }
                      `}
                    ></div>

                  )}

                </div>

              );
            })}
{chainProperties.length === 1 && (

<div className="flex items-center">

  <div
    className="
      w-24
      border-t-4
      border-dashed
      border-slate-300
      mx-4
    "
  ></div>

  <div className="flex flex-col items-center text-center">

    <div
      className="
        w-24
        h-24
        rounded-2xl
        border-2
        border-slate-300
        bg-slate-100
        flex
        items-center
        justify-center
        text-5xl
      "
    >

      🔍

    </div>

    <p className="mt-4 font-semibold text-slate-700">
      Searching
    </p>

    <p className="text-sm mt-1 text-slate-500">
      Searching for forever home
    </p>

  </div>

</div>

)}
          </div>

          

        </div>

        {/* Add Property */}
        <div className="mt-10 bg-white rounded-3xl border border-slate-200 p-8">

          <h2 className="text-2xl font-bold text-slate-900">
            Add Onward Purchase
          </h2>

          <p className="mt-2 text-slate-600">
            Continue building your property chain
          </p>

          <input
            type="text"
            value={newAddress}
            onChange={(event) =>
              setNewAddress(
                event.target.value
              )
            }
            placeholder="Property address"
            className="mt-6 w-full border border-slate-300 rounded-2xl px-4 py-4"
          />

          <input
            type="text"
            value={newPostcode}
            onChange={(event) =>
              setNewPostcode(
                event.target.value
              )
            }
            placeholder="Postcode"
            className="mt-4 w-full border border-slate-300 rounded-2xl px-4 py-4"
          />

          <button
            onClick={handleAddProperty}
            className="mt-6 bg-slate-900 text-white px-6 py-4 rounded-2xl font-semibold"
          >
            Add Property
          </button>

        </div>

      </div>

    </main>
  );
}