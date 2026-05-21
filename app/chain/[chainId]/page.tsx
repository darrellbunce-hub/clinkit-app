"use client";
import ChainNode from "@/components/ChainNode";
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
    console.log("CHAIN ID", chainId);

    console.log(
      "PROPERTY CHAIN IDS",
      properties.map(
        (property) => property.chainId
      )
    );
    
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
      
      const recentActivities =

  chainProperties
    .flatMap((property) =>

      property.activities.map(
        (activity) => ({

          ...activity,


        })
      )
    )
    .sort(
      (a, b) =>

        new Date(
          b.timestamp || 0
        ).getTime()

        -

        new Date(
          a.timestamp || 0
        ).getTime()
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
  
      const rootProperties =
  chainProperties.filter(
    (property) =>
      !property.linked_property_id
  );
      
      const transactionNodes = [];
      
      for (const root of rootProperties) {
      
        transactionNodes.push(root);
      
        let currentId = root.id;
      
        while (true) {
      
          const nextProperty =
            chainProperties.find(
              (candidate) =>
                candidate.linked_property_id ===
                currentId
            );
      
          if (!nextProperty) {
            break;
          }
      
          transactionNodes.push(nextProperty);
      
          currentId = nextProperty.id;
        }
      }

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
    85;

  confidenceScore -= blockedCount * 25;
  confidenceScore -= delayedCount * 10;
  confidenceScore -= staleProperties.length * 5;

  if (confidenceScore < 0) {
    confidenceScore = 0;
  }

  let confidenceLabel =
  "Needs Attention";

let confidenceColour =
  "text-amber-700";

let confidenceBg =
  "bg-amber-100";

if (confidenceScore >= 70) {

  confidenceLabel = "Healthy";
  confidenceColour = "text-green-700";
  confidenceBg = "bg-green-100";

}
else if (confidenceScore >= 40) {

  confidenceLabel = "Progress Slowing";
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
    null;
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
          created_by_user_id:
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
          {chainProperties[0]?.status ===
  "awaiting_buyer" && (

  <div className="flex items-center">

    <div className="flex flex-col items-center text-center">

      <div
        className="
          w-24
          h-24
          rounded-2xl
          border-2
          border-blue-300
          bg-blue-50
          flex
          items-center
          justify-center
          text-5xl
        "
      >

        🧍

      </div>

      <p className="mt-4 font-semibold text-slate-700">
        Awaiting Buyer
      </p>

      <p className="text-sm mt-1 text-slate-500">
        Waiting for buyer connection
      </p>

    </div>

    <div
      className="
        w-24
        border-t-4
        border-dashed
        border-blue-300
        mx-4
      "
    ></div>

  </div>

)}
<p className="text-red-500">
  
</p>
{transactionNodes.map((property, index) => {
              const stage = STAGES.find(
                (stage) =>
                  stage.value === property.stage
              );
              const isCurrentUserProperty =
  (property as any).is_current_user;

const isSearchingNode =
  property.is_searching;

const isPurchase =
  property.relationship_type === "purchase";

const isSale =
  property.relationship_type === "sale";
  let displayStage = "In progress";

  if (isSearchingNode) {
  
    displayStage =
      "Searching for forever home";
  
  } else if (property.awaiting_buyer) {
  
    displayStage =
      "Awaiting buyer";
  
  } else if (stage?.label) {
  
    displayStage =
      stage.label;
  
  }
  let displayTitle = "Property";

if (isCurrentUserProperty) {

  if (isSale) {

    displayTitle = "{displayTitle}";

  } else if (isPurchase) {

    displayTitle = "Your Purchase";

  }

} else {

  if (isSale) {

    displayTitle = "Property Sale";

  } else if (isPurchase) {

    displayTitle = "Property Purchase";

  }

}
              if (
                !stage &&
                property.relationship_type !== "searching"
              ) {
                return null;
          
              }

              return (

                <div
                key={property.id}
                  className="flex items-center"
                >

<Link
  href={`/property/${property.id}`}
  className="hover:scale-105 transition"
>

  <ChainNode
    propertyNumber={property.chainPosition}
    stageLabel={
      property.status === "pending_connection"
        ? "Awaiting seller connection"
        : property.status === "broken_connection"
        ? "Reconnect required"
        : displayStage
    }
    progress={stage?.progress || 0}
    updatedDaysAgo={property.lastUpdatedDays}
    currentUserRole={property.currentUserRole}
    status={property.status}
    buyer_connected={
      property.buyer_connected
    }
    
    seller_connected={
      property.seller_connected
    }
    />

</Link>
{property.is_searching && (

<div className="flex items-center mx-5">

  <div className="flex flex-col items-center">

    <div
      className="
        w-20 h-20 rounded-3xl
        border-[3px]
        border-amber-400
        flex items-center justify-center
        text-5xl bg-white
      "
    >

      🔎

    </div>

    <h3 className="mt-4 text-lg font-bold text-slate-900">
      Searching
    </h3>

    <p className="text-sm text-slate-500">
      Looking for next property
    </p>

  </div>

</div>

)}
                  {index < chainProperties.length - 1 && (

<div className="flex items-center mx-5">

<div
  className={`
    w-24 h-1 rounded-full

    ${
      property.status === "healthy"
        ? "bg-green-400"

        : property.status === "pending_connection"
        ? "bg-slate-300"

        : property.status === "broken_connection"
        ? "bg-red-400"

        : property.status === "delayed"
        ? "bg-amber-400"

        : "bg-slate-300"
    }
  `}
/>

</div>

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
{/* Recent Activity Feed */}

<div className="mt-10 bg-white border border-slate-200 rounded-3xl p-8">

  <h2 className="text-2xl font-bold text-slate-900">
    Recent Chain Activity
  </h2>

  <div className="mt-6 space-y-4">

    {recentActivities.length === 0 && (

      <p className="text-slate-500">
        Updates from chain participants will appear here as progress is made.
      </p>

    )}

    {recentActivities.map((activity, index) => (

      <div
        key={`${activity.id}-${index}`}
        className="border border-slate-200 rounded-2xl p-5"
      >

        <div className="flex items-start justify-between gap-4">

          <div>

            <p className="font-semibold text-slate-900">
              {activity.update}
            </p>

      

            <p className="text-xs text-slate-400 mt-2">
            Updated by {activity.updated_by || "homeowner"}
            </p>

          </div>

          <div className="text-xs text-slate-400 whitespace-nowrap">

            {new Date(
              activity.timestamp
            ).toLocaleDateString()}

          </div>

        </div>

      </div>

    ))}

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