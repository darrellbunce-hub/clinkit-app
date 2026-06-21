"use client";

import { useState } from "react";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Navbar from "@/components/Navbar";
import {
  CARD_PADDING_CLASS,
  PAGE_TITLE_CLASS,
} from "@/components/mobileStandards";
import { supabase } from "@/lib/supabase";
import {
  formatTopologyConflictMessage,
  migrateSourceChainOnwardProperties,
  relinkJoinedPropertyToSearching,
  resolveSearchingFromJoinIntent,
} from "@/lib/joinChainSearching";
import {
  establishConnectedHopAfterSellerJoinsPurchase,
} from "@/lib/chainConnection";
import { ensureBuyerReadyOnJoin } from "@/lib/ensureBuyerReadyOnJoin";

function JoinChainContent() {
  const searchParams =
    useSearchParams();

  const sourceChainId =
    searchParams.get("sourceChain");

  const searchingIntent =
    searchParams.get("searching") === "1";

  const [accessCode, setAccessCode] =
    useState("");

  const [address, setAddress] =
    useState("");

  const [postcode, setPostcode] =
    useState("");

  const [nothingToSell, setNothingToSell] =
    useState(false);

  async function handleJoinChain() {

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      alert("Please login first");
      return;
    }

    console.log("BUYER_READY_DEBUG", {
      nothingToSell,
      phase: "pre_join_chain_property",
    });

    const {
      data: joinResult,
      error: joinError,
    } = await supabase.rpc("join_chain_property", {
      p_access_code: accessCode,
      p_address: address,
      p_postcode: postcode,
    });

    if (joinError) {
      console.log("BUYER_READY_DEBUG", {
        nothingToSell,
        joinResult: null,
        joinError: joinError.message,
        joiningRole: null,
        shouldCreateBuyerReady: false,
      });
      console.error(joinError);
      alert("Could not join this chain.");
      return;
    }

    if (!joinResult?.ok) {
      console.log("BUYER_READY_DEBUG", {
        nothingToSell,
        joinResult,
        joiningRole: joinResult?.joining_role ?? null,
        shouldCreateBuyerReady: false,
      });

      if (joinResult?.error === "invalid_access_code") {
        alert("Invalid access code");
        return;
      }

      if (joinResult?.error === "property_not_found") {
        alert("Property not found in this chain");
        return;
      }

      alert("Could not join this property.");
      return;
    }

    const property = {
      id: joinResult.property_id as number,
      chain_id: joinResult.chain_id as number,
      linked_property_id:
        joinResult.linked_property_id as number | null,
      relationship_type:
        joinResult.relationship_type as string,
    };

    const joiningRole =
      joinResult.joining_role as string;
    const shouldCreateBuyerReady =
      joiningRole === "buyer" && nothingToSell;

    console.log("BUYER_READY_DEBUG", {
      nothingToSell,
      joinResult,
      joiningRole,
      shouldCreateBuyerReady,
    });

    if (joinResult.joining_role === "seller") {
      await establishConnectedHopAfterSellerJoinsPurchase(
        supabase,
        property.id
      );
    }

    if (
      joinResult.joining_role === "buyer" &&
      nothingToSell
    ) {
      console.log("BUYER_READY_CREATE_START", {
        chainId: property.chain_id,
        propertyId: property.id,
        userId: user.id,
      });

      let buyerReadyResult;

      try {
        buyerReadyResult =
          await ensureBuyerReadyOnJoin(
            supabase,
            {
              chainId: property.chain_id,
              purchasePropertyId: property.id,
              userId: user.id,
            }
          );
      } catch (error) {
        console.error(
          "BUYER_READY_CREATE_EXCEPTION",
          error
        );
        throw error;
      }

      console.log("BUYER_READY_CREATE_RESULT", {
        ok: buyerReadyResult.ok,
        created:
          buyerReadyResult.ok
            ? buyerReadyResult.created
            : undefined,
        nodeId:
          buyerReadyResult.ok &&
          buyerReadyResult.created
            ? buyerReadyResult.nodeId
            : undefined,
        linkedPropertyId: property.id,
        error:
          buyerReadyResult.ok
            ? undefined
            : buyerReadyResult.error,
      });

      if (!buyerReadyResult.ok) {
        console.error(buyerReadyResult.error);
        alert(
          "Join completed, but Buyer Ready could not be recorded. Please contact support."
        );
      }
    }

    let joinCompleted = false;

    try {
      let migratedSearchingId:
        | number
        | null = null;

      if (sourceChainId) {
        const migrationResult =
          await migrateSourceChainOnwardProperties(
            supabase,
            {
              sourceChainId,
              userId: user.id,
              joinedProperty: {
                id: property.id,
                chain_id: property.chain_id,
                linked_property_id:
                  property.linked_property_id,
              },
              excludePropertyId: property.id,
            }
          );

        migratedSearchingId =
          migrationResult.onwardSearchingId;

        if (migratedSearchingId) {
          const migrationRelinkResult =
            await relinkJoinedPropertyToSearching(
              supabase,
              {
                id: property.id,
                chain_id: property.chain_id,
                linked_property_id:
                  property.linked_property_id,
              },
              migratedSearchingId
            );

          if (!migrationRelinkResult.ok) {
            alert(
              formatTopologyConflictMessage(
                migrationRelinkResult.existingLinkedPropertyId
              )
            );
            return;
          }
        }
      }

      const joinedPropertyState = {
        id: property.id,
        chain_id: property.chain_id,
        linked_property_id: property.linked_property_id,
      };

      const intentResult =
        await resolveSearchingFromJoinIntent(
          supabase,
          {
            userId: user.id,
            joinedProperty:
              joinedPropertyState,
            searchingIntent,
            migratedSearchingId,
          }
        );

      if (
        intentResult &&
        !intentResult.ok
      ) {
        if (
          intentResult.reason ===
          "downstream_link_exists"
        ) {
          alert(
            formatTopologyConflictMessage(
              intentResult.existingLinkedPropertyId!
            )
          );
        } else {
          alert(
            "Join completed, but the Searching placeholder could not be created. Please try again from the chain page or contact support."
          );
          console.error(intentResult.error);
        }

        return;
      }

      if (sourceChainId) {
        const { error: cleanupError } =
          await supabase.rpc(
            "cleanup_abandoned_onboarding_chain",
            {
              p_chain_id: Number(sourceChainId),
            }
          );

        if (cleanupError) {
          console.error(cleanupError);
        }
      }

      joinCompleted = true;
      window.location.href =
        `/dashboard?refresh=${Date.now()}`;
    } catch (error) {
      console.error(
        "BUYER_READY_JOIN_EXCEPTION",
        error
      );
      console.error(error);

      if (!joinCompleted) {
        alert(
          "An error occurred while finishing the join. Your membership may have been created, but onward Searching setup did not complete."
        );
      }
    }
  }

  return (
    <main className="min-h-screen bg-slate-100">

      <Navbar />

      <div className="max-w-2xl mx-auto px-6 py-12">

        <h1 className={PAGE_TITLE_CLASS}>
          Join Existing Chain
        </h1>

        <p className="mt-3 text-lg text-slate-600">
          Enter your chain access details
        </p>

        <div className={`mt-10 bg-white rounded-3xl border border-slate-200 ${CARD_PADDING_CLASS}`}>

          <input
            type="text"
            value={accessCode}
            onChange={(event) =>
              setAccessCode(
                event.target.value
              )
            }
            placeholder="Chain access code"
            className="w-full border border-slate-300 text-base text-slate-900 rounded-2xl px-4 py-4"
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
            className="mt-4 w-full border border-slate-300 text-base text-slate-900 text-slate-900 rounded-2xl px-4 py-4"
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
            className="mt-4 w-full border border-slate-300 text-base text-slate-900 rounded-2xl px-4 py-4"
          />

          <label className="mt-6 flex items-center gap-3">

            <input
              type="checkbox"
              checked={nothingToSell}
              onChange={() =>
                setNothingToSell(
                  !nothingToSell
                )
              }
            />

            <span className="text-slate-700">
              I have nothing to sell
            </span>

          </label>

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

