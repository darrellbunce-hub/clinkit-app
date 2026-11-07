"use client";

import { useEffect, useRef, useState } from "react";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Navbar from "@/components/Navbar";
import HelpLink from "@/components/help/HelpLink";
import { HELP_SECTION_IDS } from "@/lib/help/helpContent";
import {
  CARD_PADDING_CLASS,
  PAGE_TITLE_CLASS,
} from "@/components/mobileStandards";
import { supabase } from "@/lib/supabase";
import {
  formatJoinedPropertyRelinkFailure,
  formatTopologyConflictMessage,
  JOINED_PROPERTY_RELINK_NOT_APPLIED_MESSAGE,
  migrateSourceChainOnwardProperties,
  relinkJoinedPropertyToSearching,
  resolveSearchingFromJoinIntent,
  SOURCE_CHAIN_MIGRATION_FAILED_MESSAGE,
  SourceChainMigrationError,
} from "@/lib/joinChainSearching";
import {
  establishConnectedHopAfterSellerJoinsPurchase,
} from "@/lib/chainConnection";
import { ensureBuyerReadyOnJoin } from "@/lib/ensureBuyerReadyOnJoin";
import {
  readJoinChainIntent,
  shouldCreateBuyerReadyOnJoin,
} from "@/lib/onboarding/joinChainIntent";
import {
  clearJoinAddressHandoff,
  isJoinAddressHandoffUsable,
  peekJoinAddressHandoff,
} from "@/lib/onboarding/joinAddressHandoff";
import {
  classifyOnwardPurchaseConversion,
  onwardPurchaseOutcomeMessage,
  planCarriedOnwardPurchase,
  shouldAddCarriedOnwardPurchase,
  type OnwardPurchaseConversionResult,
} from "@/lib/onboarding/joinOnwardPurchase";
import { convertSearchingPlaceholder } from "@/lib/searchingPlaceholder";
import PropertyAddressLookup from "@/components/address/PropertyAddressLookup";
import { formatUkPostcodeForStorage } from "@/lib/address/normalize";

function JoinChainContent() {
  const searchParams =
    useSearchParams();

  const {
    sourceChainId,
    searchingIntent,
    notSellingIntent,
  } = readJoinChainIntent(searchParams);

  const [accessCode, setAccessCode] =
    useState("");

  // Read once on mount; page state keeps it through a failed join attempt.
  const [carriedAddress, setCarriedAddress] =
    useState(() => peekJoinAddressHandoff());

  const [address, setAddress] =
    useState(carriedAddress?.address ?? "");

  const [postcode, setPostcode] =
    useState(carriedAddress?.postcode ?? "");

  const [nothingToSell, setNothingToSell] =
    useState(notSellingIntent);

  const [onwardPurchaseRemoved, setOnwardPurchaseRemoved] =
    useState(false);

  // The ref blocks a second click before the disabled state renders.
  const joinInProgress = useRef(false);
  const leavingAfterJoin = useRef(false);
  const [isJoining, setIsJoining] = useState(false);

  useEffect(() => {
    return () => {
      clearJoinAddressHandoff();
    };
  }, []);

  useEffect(() => {
    if (!carriedAddress) {
      return;
    }

    let cancelled = false;

    void supabase.auth.getUser().then(({ data: { user } }) => {
      if (
        !cancelled &&
        !isJoinAddressHandoffUsable(carriedAddress, user?.id)
      ) {
        discardCarriedAddress();
      }
    });

    return () => {
      cancelled = true;
    };
  }, [carriedAddress]);

  function discardCarriedAddress() {
    clearJoinAddressHandoff();
    setCarriedAddress(null);
    setAddress("");
    setPostcode("");
  }

  function handleChangeAddress() {
    if (carriedAddress?.onwardPurchase) {
      setOnwardPurchaseRemoved(true);
    }

    discardCarriedAddress();
  }

  async function handleJoinChain() {
    if (joinInProgress.current) {
      return;
    }

    joinInProgress.current = true;
    setIsJoining(true);

    try {
      await submitJoin();
    } finally {
      if (!leavingAfterJoin.current) {
        joinInProgress.current = false;
        setIsJoining(false);
      }
    }
  }

  async function submitJoin() {

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      alert("Please log in first");
      return;
    }

    if (
      carriedAddress &&
      !isJoinAddressHandoffUsable(carriedAddress, user.id)
    ) {
      discardCarriedAddress();
      alert("Please select the property address again.");
      return;
    }

    const {
      data: joinResult,
      error: joinError,
    } = await supabase.rpc("join_chain_property", {
      p_access_code: accessCode,
      p_address: address,
      p_postcode: formatUkPostcodeForStorage(postcode),
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

    clearJoinAddressHandoff();

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

    if (joiningRole === "seller") {
      await establishConnectedHopAfterSellerJoinsPurchase(
        supabase,
        property.id
      );
    }

    if (
      shouldCreateBuyerReadyOnJoin({
        joiningRole,
        nothingToSell,
      })
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
          "Join completed, but Buyer Ready could not be recorded. Check your chain on your dashboard. For what to do next, see Help & FAQs."
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
              formatJoinedPropertyRelinkFailure(
                migrationRelinkResult
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

      const carriedOnwardPurchase =
        carriedAddress?.onwardPurchase ?? null;

      const onwardPurchasePlan = planCarriedOnwardPurchase({
        joiningRole,
        hasCarriedOnwardPurchase: carriedOnwardPurchase != null,
        joinedPropertyLinkedId: property.linked_property_id,
      });

      const intentResult =
        await resolveSearchingFromJoinIntent(
          supabase,
          {
            userId: user.id,
            joinedProperty:
              joinedPropertyState,
            searchingIntent:
              searchingIntent &&
              onwardPurchasePlan !== "convert_existing_link",
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
        } else if (
          intentResult.reason ===
          "relink_not_applied"
        ) {
          alert(
            JOINED_PROPERTY_RELINK_NOT_APPLIED_MESSAGE
          );
        } else {
          alert(
            "Join completed, but we could not set up your next-home search step. Please try again from the chain page. For what to do next, see Help & FAQs."
          );
          console.error(
            "[join-chain] searching intent failed:",
            intentResult.error
          );
        }

        return;
      }

      if (
        carriedOnwardPurchase &&
        shouldAddCarriedOnwardPurchase({
          plan: onwardPurchasePlan,
          searchingPlaceholderLinked:
            intentResult?.ok === true ||
            migratedSearchingId != null,
        })
      ) {
        let convertResult: OnwardPurchaseConversionResult | null =
          null;

        try {
          convertResult =
            await convertSearchingPlaceholder(supabase, {
              chainId: property.chain_id,
              salePropertyId: property.id,
              address: carriedOnwardPurchase.address,
              postcode: carriedOnwardPurchase.postcode,
              updatedBy: "homeowner",
            });
        } catch {
          convertResult = null;
        }

        const onwardPurchaseOutcome =
          classifyOnwardPurchaseConversion(convertResult);
        const onwardPurchaseMessage =
          onwardPurchaseOutcomeMessage(onwardPurchaseOutcome);

        if (onwardPurchaseMessage) {
          console.error(
            "[join-chain] onward purchase not added:",
            onwardPurchaseOutcome
          );
          alert(onwardPurchaseMessage);
        }
      }

      if (sourceChainId) {
        const { error: cleanupError } =
          await supabase.rpc(
            "cleanup_abandoned_onboarding_chain",
            {
              p_chain_id: Number(sourceChainId),
              p_require_empty: true,
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
      leavingAfterJoin.current = true;
      window.location.href =
        `/dashboard?refresh=${Date.now()}`;
    } catch (error) {
      console.error(
        "[join-chain] join completion failed:",
        error instanceof Error ? error.message : "unknown_error"
      );

      if (!joinCompleted) {
        alert(
          error instanceof SourceChainMigrationError
            ? SOURCE_CHAIN_MIGRATION_FAILED_MESSAGE
            : "An error occurred while finishing the join. Your membership may have been created, but setting up your next-home search step did not complete."
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

          <div className="mt-4">
            {carriedAddress ? (
              <div>
                <p className="block text-sm font-medium text-slate-900">
                  Property address
                </p>
                <div className="mt-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                  <p className="font-medium text-slate-900">{address}</p>
                  <p className="mt-1">{postcode}</p>
                </div>
                <button
                  type="button"
                  onClick={handleChangeAddress}
                  className="mt-3 text-sm font-medium text-slate-700 underline underline-offset-2 hover:text-slate-900"
                >
                  Change address
                </button>

                {carriedAddress.onwardPurchase ? (
                  <div className="mt-6">
                    <p className="block text-sm font-medium text-slate-900">
                      Property you are buying
                    </p>
                    <div className="mt-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                      <p className="font-medium text-slate-900">
                        {carriedAddress.onwardPurchase.address}
                      </p>
                      <p className="mt-1">
                        {carriedAddress.onwardPurchase.postcode}
                      </p>
                    </div>
                    <p className="mt-2 text-sm text-slate-600">
                      Once you have joined, we will add this to your
                      chain as your onward purchase. If you change the
                      address above, your next home will show as
                      Searching and you can add it from your chain.
                    </p>
                  </div>
                ) : null}
              </div>
            ) : (
              <>
                <PropertyAddressLookup
                  idPrefix="join-chain"
                  address={address}
                  postcode={postcode}
                  onAddressChange={setAddress}
                  onPostcodeChange={setPostcode}
                />
                {onwardPurchaseRemoved ? (
                  <p className="mt-3 text-sm text-slate-600">
                    After you join, your next home will show as
                    Searching. You can then add the property you are
                    buying from your chain.
                  </p>
                ) : null}
              </>
            )}
          </div>

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
            disabled={isJoining}
            className="mt-6 w-full bg-slate-900 text-white rounded-2xl py-5 text-lg font-semibold disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isJoining ? "Joining..." : "Join Chain"}
          </button>

        </div>

        <p className="mt-6 text-sm text-slate-600">
          Having trouble joining?{" "}
          <HelpLink section={HELP_SECTION_IDS.accessCodes} newTab />
        </p>

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

