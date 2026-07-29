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
      alert("Please log in first");
      return;
    }

    const {
      data: joinResult,
      error: joinError,
    } = await supabase.rpc("join_chain_property", {
      p_access_code: accessCode,
      p_address: address,
      p_postcode: postcode,
    });

    if (joinError) {
      console.error(
        "[join-chain] join_chain_property failed:",
        joinError.message
      );
      alert("Could not join this chain.");
      return;
    }

    if (!joinResult?.ok) {
      // Rate-limited joins intentionally reuse join_details_not_matched (no oracle).
      if (joinResult?.error === "join_details_not_matched") {
        alert(
          "We could not match those details to a property. Check the access code, address, and postcode, then try again."
        );
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
          "[join-chain] buyer ready create exception:",
          error instanceof Error ? error.message : "unknown_error"
        );
        throw error;
      }

      if (!buyerReadyResult.ok) {
        console.error(
          "[join-chain] buyer ready create failed:",
          buyerReadyResult.error
        );
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
            "Join completed, but we could not set up your next-home search step. Please try again from the chain page or contact support."
          );
          console.error(
            "[join-chain] searching intent failed:",
            intentResult.error
          );
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
          console.error(
            "[join-chain] onboarding cleanup failed:",
            cleanupError.message
          );
        }
      }

      joinCompleted = true;
      window.location.href =
        `/dashboard?refresh=${Date.now()}`;
    } catch (error) {
      console.error(
        "[join-chain] join completion failed:",
        error instanceof Error ? error.message : "unknown_error"
      );

      if (!joinCompleted) {
        alert(
          "An error occurred while finishing the join. Your membership may have been created, but setting up your next-home search step did not complete."
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
          Connect your property using the chain access code you received. You&apos;ll
          see shared progress for connected parts of the chain — visibility improves
          as more participants connect.
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

