"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import Navbar from "@/components/Navbar";
import {
  CARD_PADDING_CLASS,
  PAGE_TITLE_CLASS,
} from "@/components/mobileStandards";
import { createChainForOnboarding } from "@/lib/createChainForOnboarding";
import { createStartMoveProperty } from "@/lib/ownership/grants";
import { generateAccessCode } from "@/lib/accessCode";
import { attachSearchingPlaceholderToSale } from "@/lib/searchingPlaceholder";
import CollectionPointNotice from "@/components/legal/CollectionPointNotice";
import DuplicatePropertyDialog, {
  type DuplicatePropertyDialogVariant,
} from "@/components/onboarding/DuplicatePropertyDialog";
import StartMoveRecoveryPanel from "@/components/onboarding/StartMoveRecoveryPanel";
import type {
  StartMoveRecovery,
  StartMoveRecoveryReason,
} from "@/lib/onboarding/startMoveRecovery";
import PropertyAddressLookup from "@/components/address/PropertyAddressLookup";
import { formatUkPostcodeForStorage } from "@/lib/address/normalize";
import { checkStartMoveAddress } from "@/lib/onboarding/addressReservation";
import {
  buildJoinExistingChainHref,
  resolveBuyingAwaitingConnectionAction,
} from "@/lib/onboarding/joinChainIntent";

type PendingDuplicateAction =
  /** The caller's own chain already holds the address. */
  | { kind: "open_chain"; chainId: number | null }
  /** Join without a source chain (nothing created yet). */
  | { kind: "join"; notSelling: boolean }
  /** Create the caller's sale first, then join carrying it across. */
  | { kind: "join_after_sale" }
  /** A source chain was already created; Join Chain migrates and removes it. */
  | {
      kind: "join_source_chain";
      chainId: number;
      /** A property already exists; cancelling must keep the chain. */
      preserveSourceChain: boolean;
    }
  | { kind: "none" };

const START_MOVE_FAILED_MESSAGE =
  "We could not create your chain. Please try again.";

const START_MOVE_ADDRESS_RESERVED_MESSAGE =
  "One of these addresses has just been added to MoveLoop by someone else. Please try again and we will show you how to join it.";

/** The address was taken between routing and creation. */
function isAddressReservedFailure(error: string) {
  return error === "address_reserved" || error === "address_unavailable";
}

export default function StartMovePage() {
 
  const [notSelling, setNotSelling] =
    useState(false);

  const [notBuying, setNotBuying] =
    useState(false);
    const [
      searchingForProperty,
      setSearchingForProperty,
    ] = useState(false);
  const [duplicateDialogOpen, setDuplicateDialogOpen] =
    useState(false);
  const [duplicateDialogVariant, setDuplicateDialogVariant] =
    useState<DuplicatePropertyDialogVariant>("existing");
  const [pendingDuplicateAction, setPendingDuplicateAction] =
    useState<PendingDuplicateAction>({ kind: "none" });
  const [isSubmitting, setIsSubmitting] =
    useState(false);
  const [errorMessage, setErrorMessage] =
    useState("");
  const [recovery, setRecovery] =
    useState<StartMoveRecovery | null>(null);
  const [sellingAddress, setSellingAddress] =
    useState("");

  const [sellingPostcode, setSellingPostcode] =
    useState("");

  const [buyingAddress, setBuyingAddress] =
    useState("");

  const [buyingPostcode, setBuyingPostcode] =
    useState("");

    function redirectToJoinExistingChain(
      chainId: number | null,
      options: { notSelling?: boolean } = {}
    ) {
      window.location.href = buildJoinExistingChainHref({
        sourceChainId: chainId,
        searching: searchingForProperty,
        notSelling: options.notSelling === true,
      });
    }

    function openDuplicateDialog(
      variant: DuplicatePropertyDialogVariant,
      action: PendingDuplicateAction
    ) {
      setDuplicateDialogVariant(variant);
      setPendingDuplicateAction(action);
      setDuplicateDialogOpen(true);
    }

    function promptJoinExistingChain(
      chainId: number,
      preserveSourceChain: boolean
    ) {
      openDuplicateDialog("existing", {
        kind: "join_source_chain",
        chainId,
        preserveSourceChain,
      });
    }

    async function cleanupOnboardingChain(chainId: number) {
      const { error } = await supabase.rpc(
        "cleanup_abandoned_onboarding_chain",
        { p_chain_id: chainId, p_require_empty: true }
      );

      if (error) {
        console.error(
          "[start-move] onboarding cleanup failed:",
          error.message
        );
      }
    }

    function hasSellingAddress() {
      return !notSelling && Boolean(sellingAddress);
    }

    function hasBuyingAddress() {
      return !notBuying && Boolean(buyingAddress);
    }

    /** Returns true when routing took over and nothing should be created. */
    async function routeExistingAddresses(): Promise<boolean> {
      if (hasSellingAddress()) {
        const selling = await checkStartMoveAddress(supabase, {
          address: sellingAddress,
          postcode: formatUkPostcodeForStorage(sellingPostcode),
          side: "selling",
        });

        if (!selling.ok) {
          setErrorMessage(selling.message);
          return true;
        }

        if (selling.state === "yours") {
          openDuplicateDialog("yours", {
            kind: "open_chain",
            chainId: selling.chainId,
          });
          return true;
        }

        if (selling.state === "awaiting_connection") {
          openDuplicateDialog("awaiting_seller", {
            kind: "join",
            notSelling: false,
          });
          return true;
        }

        if (selling.state === "already_represented") {
          openDuplicateDialog("represented", { kind: "none" });
          return true;
        }
      }

      if (hasBuyingAddress()) {
        const buying = await checkStartMoveAddress(supabase, {
          address: buyingAddress,
          postcode: formatUkPostcodeForStorage(buyingPostcode),
          side: "buying",
        });

        if (!buying.ok) {
          setErrorMessage(buying.message);
          return true;
        }

        if (buying.state === "yours") {
          openDuplicateDialog("yours", {
            kind: "open_chain",
            chainId: buying.chainId,
          });
          return true;
        }

        if (buying.state === "awaiting_connection") {
          openDuplicateDialog(
            "awaiting_buyer",
            resolveBuyingAwaitingConnectionAction({
              hasSellingAddress: hasSellingAddress(),
            })
          );
          return true;
        }

        if (buying.state === "already_represented") {
          openDuplicateDialog("represented", { kind: "none" });
          return true;
        }
      }

      return false;
    }

    async function handleStartMove(
      options: { joinBuyingAfterSale?: boolean } = {}
    ) {
      if (isSubmitting) {
        return;
      }

      setIsSubmitting(true);
      setErrorMessage("");

      let chainId: number | null = null;
      let redirected = false;
      /** Set once a property exists with the caller's homeowner access. */
      let propertyEstablished = false;
      /** Set while a create call may have committed without a response. */
      let createOutcomeUnknown = false;

      async function fail(
        logMessage: string,
        detail?: unknown,
        userMessage: string = START_MOVE_FAILED_MESSAGE,
        recoveryReason: StartMoveRecoveryReason = "step_incomplete"
      ) {
        console.error(logMessage, detail ?? "");

        // The chain may only be cleaned up while it is known to be empty.
        if (chainId != null && (propertyEstablished || createOutcomeUnknown)) {
          setRecovery({
            chainId,
            reason: createOutcomeUnknown ? "outcome_unknown" : recoveryReason,
          });
          return;
        }

        if (chainId != null) {
          await cleanupOnboardingChain(chainId);
        }

        setErrorMessage(userMessage);
      }

      try {
    
        if (
          document.activeElement instanceof HTMLElement
        ) {
          document.activeElement.blur();
        }
    
        const {
          data: { user },
        } = await supabase.auth.getUser();
    
        if (!user) {
    
          return;
    
        }

        if (
          !options.joinBuyingAfterSale &&
          (await routeExistingAddresses())
        ) {
          return;
        }
    
        let accessCode =
          generateAccessCode();

        for (let attempt = 0; attempt < 5; attempt++) {
          const chainResult =
            await createChainForOnboarding(
              supabase,
              {
                name: `CHAIN-${Date.now()}`,
                accessCode,
              }
            );

          if (
            chainResult.error ===
              "duplicate_access_code" &&
            attempt < 4
          ) {
            accessCode =
              generateAccessCode();
            continue;
          }

          if (chainResult.error) {
            await fail(
              "[start-move] chain create failed:",
              chainResult.error
            );
            return;
          }

          chainId = chainResult.chainId;
          accessCode = chainResult.accessCode ?? accessCode;
          break;
        }

        if (chainId == null) {
          await fail(
            "[start-move] chain create failed after retries"
          );
          return;
        }
    
        let sellingPropertyId =
          null;

        // SELLING PROPERTY
        if (!notSelling && sellingAddress) {
          const sellingPostcodeStored =
            formatUkPostcodeForStorage(sellingPostcode);
          const { data: sellingCheck } = await supabase.rpc(
            "validate_onboarding_property_address",
            {
              p_address: sellingAddress,
              p_postcode: sellingPostcodeStored,
              p_chain_id: chainId,
            }
          );

          if (
            sellingCheck?.ok === false &&
            sellingCheck.error === "address_unavailable"
          ) {
            promptJoinExistingChain(chainId, false);
            return;
          }
    
          createOutcomeUnknown = true;
          const sellingResult = await createStartMoveProperty(supabase, {
            chainId,
            relationshipType: "sale",
            address: sellingAddress,
            postcode: sellingPostcodeStored,
            awaitingBuyer: notBuying,
          });
          createOutcomeUnknown =
            !sellingResult.ok && sellingResult.outcomeUnknown;

          if (!sellingResult.ok) {
            await fail(
              "[start-move] sale property creation failed:",
              sellingResult.error,
              isAddressReservedFailure(sellingResult.error)
                ? START_MOVE_ADDRESS_RESERVED_MESSAGE
                : START_MOVE_FAILED_MESSAGE
            );
            return;
          }

          sellingPropertyId = sellingResult.propertyId;
          propertyEstablished = true;
    
        }
        let buyerReadyPropertyId = null;
        // BUYING PROPERTY
        if (!notBuying && buyingAddress) {
          if (options.joinBuyingAfterSale) {
            redirected = true;
            redirectToJoinExistingChain(chainId);
            return;
          }

          const buyingPostcodeStored =
            formatUkPostcodeForStorage(buyingPostcode);
          const { data: buyingCheck } = await supabase.rpc(
            "validate_onboarding_property_address",
            {
              p_address: buyingAddress,
              p_postcode: buyingPostcodeStored,
              p_chain_id: chainId,
            }
          );

          if (
            buyingCheck?.ok === false &&
            buyingCheck.error === "address_unavailable"
          ) {
            promptJoinExistingChain(chainId, propertyEstablished);
            return;
          }
    
          createOutcomeUnknown = true;
          const buyingResult = await createStartMoveProperty(supabase, {
            chainId,
            relationshipType: "purchase",
            address: buyingAddress,
            postcode: buyingPostcodeStored,
            awaitingBuyer: false,
          });
          createOutcomeUnknown =
            !buyingResult.ok && buyingResult.outcomeUnknown;

          if (!buyingResult.ok) {
            const reserved = isAddressReservedFailure(buyingResult.error);
            await fail(
              "[start-move] purchase property creation failed:",
              buyingResult.error,
              reserved
                ? START_MOVE_ADDRESS_RESERVED_MESSAGE
                : START_MOVE_FAILED_MESSAGE,
              reserved ? "purchase_address_reserved" : "purchase_not_added"
            );
            return;
          }

          buyerReadyPropertyId = buyingResult.propertyId;
          propertyEstablished = true;
    
        }

        // SEARCHING PLACEHOLDER (stage-authoritative; no buying address)
        if (
          searchingForProperty &&
          !buyingAddress &&
          sellingPropertyId
        ) {
          const attachResult =
            await attachSearchingPlaceholderToSale(
              supabase,
              {
                chainId,
                salePropertyId: sellingPropertyId,
                userId: user.id,
              }
            );

          if (!attachResult.ok) {
            await fail(
              "[start-move] searching placeholder attach failed:",
              attachResult.error,
              START_MOVE_FAILED_MESSAGE,
              "searching_not_added"
            );
            return;
          }
        }

        if (notSelling) {

          const { error: buyerReadyError } = await supabase
  .from("chain_nodes")
  .insert({

    chain_id: chainId,

    linked_property_id:
  buyerReadyPropertyId,

    node_type: "buyer_ready",

    user_id: user.id,

    position: 0,

    stage: "mortgage_in_principle",

    status: "healthy",

    progress: 10,

    stage_entered_at: new Date().toISOString(),

  });

          if (buyerReadyError) {
            await fail(
              "[start-move] buyer ready create failed:",
              buyerReadyError.message,
              START_MOVE_FAILED_MESSAGE,
              "buyer_ready_not_added"
            );
            return;
          }
        
        }
        redirected = true;
        window.location.href =
          `/chain/${chainId}?refresh=${Date.now()}`;
    
      } catch (error) {
        await fail(
          "[start-move] unexpected error:",
          error instanceof Error ? error.message : "unknown_error"
        );
      } finally {
        if (!redirected) {
          setIsSubmitting(false);
        }
      }
    
    }

  return (
    <main className="min-h-screen bg-slate-100">

      <Navbar />

      {recovery != null ? (
        <div className="max-w-3xl mx-auto px-6 py-12">
          <div className={`bg-white rounded-3xl border border-slate-200 ${CARD_PADDING_CLASS}`}>
            <StartMoveRecoveryPanel recovery={recovery} />
          </div>
        </div>
      ) : (
      <form
  noValidate
  onSubmit={(event) => {
    event.preventDefault();
    handleStartMove();
  }}
  className="max-w-3xl mx-auto px-6 py-12"
>

        <h1 className={PAGE_TITLE_CLASS}>
          Start Your Move
        </h1>

        <p className="mt-3 text-lg text-slate-600">
          Tell MoveLoop about your move — free for homeowners. You&apos;ll get a
          shared view of progress across connected parts of your chain as
          participants share updates.
        </p>

        <CollectionPointNotice
          className="mt-4"
          context="property-address"
        />
      
 
        {/* Selling */}
<div className={`mt-12 bg-white rounded-3xl border border-slate-200 ${CARD_PADDING_CLASS}`}>

<div className="flex flex-col md:flex-row md:items-start md:justify-between gap-6">

  <div>

    <h2 className="text-3xl font-bold text-slate-900">
      Property You Are Selling
    </h2>

    <p className="mt-2 text-slate-600">
      Only add a selling property once you have accepted an offer
    </p>

  </div>

  <label className="flex items-center gap-3 shrink-0 mt-1">

    <input
      type="checkbox"
      checked={notSelling}
      onChange={() =>
        setNotSelling(!notSelling)
      }
    />

    <span className="text-slate-700">
      I am not selling
    </span>

  </label>

</div>

{!notSelling && (

  <div className="mt-8">
    <PropertyAddressLookup
      idPrefix="start-move-selling"
      label="Property address"
      address={sellingAddress}
      postcode={sellingPostcode}
      onAddressChange={setSellingAddress}
      onPostcodeChange={setSellingPostcode}
    />
  </div>

)}

</div>

{/* Buying */}
<div className={`mt-10 bg-white rounded-3xl border border-slate-200 ${CARD_PADDING_CLASS}`}>

<div className="flex flex-col md:flex-row md:items-start md:justify-between gap-6">

  <div>

    <h2 className="text-3xl font-bold text-slate-900">
      Property You Are Buying
    </h2>

    <p className="mt-2 text-slate-600">
      Only add a buying property once your offer has been accepted
    </p>

  </div>

  <div className="flex flex-col gap-4 shrink-0 mt-1">

    <label className="flex items-center gap-3">

      <input
        type="checkbox"
        checked={searchingForProperty}
        onChange={() => {

          setSearchingForProperty(
            !searchingForProperty
          );

          if (!searchingForProperty) {
            setNotBuying(false);
          }
        }}
      />

      <span className="text-slate-700">
        I am searching for my next property
      </span>

    </label>

    <label className="flex items-center gap-3">

      <input
        type="checkbox"
        checked={notBuying}
        onChange={() => {

          setNotBuying(!notBuying);

          if (!notBuying) {
            setSearchingForProperty(false);
          }
        }}
      />

      <span className="text-slate-700">
        I am not buying another property
      </span>

    </label>

  </div>

</div>

{!notBuying && !searchingForProperty && (

  <div className="mt-8">
    <PropertyAddressLookup
      idPrefix="start-move-buying"
      label="Property address"
      address={buyingAddress}
      postcode={buyingPostcode}
      onAddressChange={setBuyingAddress}
      onPostcodeChange={setBuyingPostcode}
    />
  </div>

)}

</div>
<div className="mt-10">
{errorMessage ? (
  <p
    role="alert"
    className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
  >
    {errorMessage}
  </p>
) : null}
<button
  type="submit"
  disabled={isSubmitting}
  className="mt-10 w-full bg-slate-900 text-white rounded-2xl py-5 text-lg font-semibold disabled:cursor-not-allowed disabled:opacity-60"
>
  {isSubmitting ? "Creating..." : "Create Chain"}
</button>
</div>

</form>
      )}

      <DuplicatePropertyDialog
        isOpen={duplicateDialogOpen}
        isPending={isSubmitting}
        variant={duplicateDialogVariant}
        onJoinExisting={() => {
          const action = pendingDuplicateAction;

          if (action.kind === "open_chain") {
            window.location.href =
              action.chainId != null
                ? `/chain/${action.chainId}`
                : "/my-chains";
          } else if (action.kind === "join") {
            redirectToJoinExistingChain(null, {
              notSelling: action.notSelling,
            });
          } else if (action.kind === "join_source_chain") {
            redirectToJoinExistingChain(action.chainId);
          } else if (action.kind === "join_after_sale") {
            setDuplicateDialogOpen(false);
            setPendingDuplicateAction({ kind: "none" });
            void handleStartMove({ joinBuyingAfterSale: true });
          }
        }}
        onCancel={() => {
          const action = pendingDuplicateAction;

          setDuplicateDialogOpen(false);
          setPendingDuplicateAction({ kind: "none" });

          if (action.kind === "join_source_chain") {
            if (action.preserveSourceChain) {
              setRecovery({
                chainId: action.chainId,
                reason: "purchase_already_on_moveloop",
              });
            } else {
              void cleanupOnboardingChain(action.chainId);
            }
          }
        }}
      />

    </main>
  );
}