"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import Navbar from "@/components/Navbar";
import {
  CARD_PADDING_CLASS,
  PAGE_TITLE_CLASS,
} from "@/components/mobileStandards";
import { createChainForOnboarding } from "@/lib/createChainForOnboarding";
import {
  establishOperationalHomeowner,
  OPERATIONAL_IDENTITY_GRANT_VIA,
} from "@/lib/ownership/grants";
import { generateAccessCode } from "@/lib/accessCode";
import { attachSearchingPlaceholderToSale } from "@/lib/searchingPlaceholder";
import CollectionPointNotice from "@/components/legal/CollectionPointNotice";
import DuplicatePropertyDialog, {
  type DuplicatePropertyDialogVariant,
} from "@/components/onboarding/DuplicatePropertyDialog";
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
  | { kind: "join_source_chain"; chainId: number }
  | { kind: "none" };

const START_MOVE_FAILED_MESSAGE =
  "We could not create your chain. Please try again.";

const START_MOVE_ADDRESS_RESERVED_MESSAGE =
  "One of these addresses has just been added to MoveLoop by someone else. Please try again and we will show you how to join it.";

function isAddressReservedFailure(
  insertError: { code?: string; message?: string } | null,
  grantError: string | null | undefined
) {
  return (
    (insertError?.code === "23505" &&
      insertError.message === "property_address_reserved") ||
    grantError === "address_reserved"
  );
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

    function promptJoinExistingChain(chainId: number) {
      openDuplicateDialog("existing", {
        kind: "join_source_chain",
        chainId,
      });
    }

    async function cleanupOnboardingChain(chainId: number) {
      const { error } = await supabase.rpc(
        "cleanup_abandoned_onboarding_chain",
        { p_chain_id: chainId }
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

      async function fail(
        logMessage: string,
        detail?: unknown,
        userMessage: string = START_MOVE_FAILED_MESSAGE
      ) {
        console.error(logMessage, detail ?? "");

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
            promptJoinExistingChain(chainId);
            return;
          }
    
          const {
            data: sellingProperty,
            error: sellingError,
          } = await supabase
            .from("properties")
            .insert({
              chain_id: chainId,
    
              chain_position: 1,
    
              address: sellingAddress,
    
              postcode: sellingPostcodeStored,
    
              stage: "property_listed",
    
              status: "pending_connection",
    
              relationship_type: "sale",
    
              created_by_user_id: user.id,
    
              awaiting_buyer: notBuying,
    
              buyer_connected: false,
    
              seller_connected: true,
    
              is_searching: false,
    
              is_current_user: true,
    
              last_updated_days: 0,
            })
            .select()
            .single();
    
          if (sellingError) {
            await fail(
              "[start-move] selling property insert failed:",
              sellingError.message,
              isAddressReservedFailure(sellingError, null)
                ? START_MOVE_ADDRESS_RESERVED_MESSAGE
                : START_MOVE_FAILED_MESSAGE
            );
            return;
          }
    
          if (sellingProperty) {

            sellingPropertyId =
              sellingProperty.id;
    
            const { data: sellerGrant, error: sellerMemberError } =
              await establishOperationalHomeowner(supabase, {
                propertyId: sellingProperty.id,
                grantedVia: OPERATIONAL_IDENTITY_GRANT_VIA.startMove,
              });

            if (sellerMemberError || !sellerGrant.ok) {
              const grantError = !sellerGrant.ok
                ? sellerGrant.error
                : null;
              await fail(
                "[start-move] operational homeowner grant failed:",
                sellerMemberError?.message ??
                  grantError ??
                  "unknown_error",
                isAddressReservedFailure(null, grantError)
                  ? START_MOVE_ADDRESS_RESERVED_MESSAGE
                  : START_MOVE_FAILED_MESSAGE
              );
              return;
            }
          }
    
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
            promptJoinExistingChain(chainId);
            return;
          }
    
          const {
            data: buyingProperty,
            error: buyingError,
          } = await supabase
            .from("properties")
            .insert({
              chain_id: chainId,
    
              chain_position: 2,
    
              address: buyingAddress,
    
              postcode: buyingPostcodeStored,
    
              stage: "offer_accepted",
    
              status: "pending_connection",
    
              relationship_type: "purchase",
    
              created_by_user_id: user.id,
    
              awaiting_buyer: false,
    
              buyer_connected: true,
    
              seller_connected: false,
    
              is_searching: false,
    
              is_current_user: true,
    
              last_updated_days: 0,
            })
            .select()
            .single();
    
          if (buyingError) {
            await fail(
              "[start-move] buying property insert failed:",
              buyingError.message,
              isAddressReservedFailure(buyingError, null)
                ? START_MOVE_ADDRESS_RESERVED_MESSAGE
                : START_MOVE_FAILED_MESSAGE
            );
            return;
          }
    
          if (buyingProperty) {
            buyerReadyPropertyId =
            buyingProperty.id;
            const { data: buyerGrant, error: buyerMemberError } =
              await establishOperationalHomeowner(supabase, {
                propertyId: buyingProperty.id,
                grantedVia: OPERATIONAL_IDENTITY_GRANT_VIA.startMove,
              });

            if (buyerMemberError || !buyerGrant.ok) {
              const grantError = !buyerGrant.ok
                ? buyerGrant.error
                : null;
              await fail(
                "[start-move] operational homeowner grant failed:",
                buyerMemberError?.message ??
                  grantError ??
                  "unknown_error",
                isAddressReservedFailure(null, grantError)
                  ? START_MOVE_ADDRESS_RESERVED_MESSAGE
                  : START_MOVE_FAILED_MESSAGE
              );
              return;
            }
          }
    
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
              attachResult.error
            );
            return;
          }
        }

        if (notSelling) {

          await supabase
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
            void cleanupOnboardingChain(action.chainId);
          }
        }}
      />

    </main>
  );
}