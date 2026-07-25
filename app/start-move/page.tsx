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
import { attachSearchingPlaceholderToSale } from "@/lib/searchingPlaceholder";
import CollectionPointNotice from "@/components/legal/CollectionPointNotice";
import DuplicatePropertyDialog from "@/components/onboarding/DuplicatePropertyDialog";

type PendingDuplicateJoin = {
  chainId: number;
};

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
  const [pendingDuplicateJoin, setPendingDuplicateJoin] =
    useState<PendingDuplicateJoin | null>(null);
  const [sellingAddress, setSellingAddress] =
    useState("");

  const [sellingPostcode, setSellingPostcode] =
    useState("");

  const [buyingAddress, setBuyingAddress] =
    useState("");

  const [buyingPostcode, setBuyingPostcode] =
    useState("");
    function generateAccessCode() {
      
      const characters =
        "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    
      let result = "KN-";
    
      for (let i = 0; i < 7; i++) {
    
        if (i === 3) {
          result += "-";
        }
    
        result += characters.charAt(
          Math.floor(
            Math.random() *
            characters.length
          )
        );
      }
    
      return result;
    }

    function redirectToJoinExistingChain(
      chainId: number
    ) {
      const joinParams = new URLSearchParams({
        sourceChain: String(chainId),
      });

      if (searchingForProperty) {
        joinParams.set("searching", "1");
      }

      window.location.href =
        `/join-chain?${joinParams.toString()}`;
    }

    function promptJoinExistingChain(chainId: number) {
      setPendingDuplicateJoin({ chainId });
      setDuplicateDialogOpen(true);
    }

    async function handleStartMove() {

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
    
        let accessCode =
          generateAccessCode();
    
        let chainId: number | null = null;

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
            console.error(
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
          console.error(
            "[start-move] chain create failed after retries"
          );
          return;
        }
    
        let sellingPropertyId =
          null;

        // SELLING PROPERTY
        if (!notSelling && sellingAddress) {
          const {
            data: sellingExists,
          } = await supabase.rpc(
            "property_exists_for_onboarding",
            {
              p_address: sellingAddress,
              p_postcode: sellingPostcode,
            }
          );
    
          if (sellingExists) {
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
    
              postcode: sellingPostcode,
    
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
    
            console.error(
              "[start-move] selling property insert failed:",
              sellingError.message
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
              console.error(
                "[start-move] operational homeowner grant failed:",
                sellerMemberError?.message ??
                  (!sellerGrant.ok ? sellerGrant.error : "unknown_error")
              );
              return;
            }
          }
    
        }
        let buyerReadyPropertyId = null;
        // BUYING PROPERTY
        if (!notBuying && buyingAddress) {
          const {
            data: buyingExists,
          } = await supabase.rpc(
            "property_exists_for_onboarding",
            {
              p_address: buyingAddress,
              p_postcode: buyingPostcode,
            }
          );
    
          if (buyingExists) {
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
    
              postcode: buyingPostcode,
    
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
    
            console.error(
              "[start-move] buying property insert failed:",
              buyingError.message
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
              console.error(
                "[start-move] operational homeowner grant failed:",
                buyerMemberError?.message ??
                  (!buyerGrant.ok ? buyerGrant.error : "unknown_error")
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
            console.error(
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
        window.location.href =
          `/chain/${chainId}?refresh=${Date.now()}`;
    
      } catch (error) {
    
        console.error(
          "[start-move] unexpected error:",
          error instanceof Error ? error.message : "unknown_error"
        );
    
    
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
          Tell Keynetic about your move — free for homeowners. You&apos;ll get a
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

    <input
      type="text"
      value={sellingAddress}
      onChange={(event) =>
        setSellingAddress(
          event.target.value
        )
        
      }
      onBlur={() => window.scrollTo(0, 0)}
  autoComplete="off"
      placeholder="Selling property address"
      className="w-full border border-slate-300 text-base text-slate-900 rounded-2xl px-4 py-4"
    />

    <input
      type="text"
      value={sellingPostcode}
      onChange={(event) =>
        setSellingPostcode(
          event.target.value
        )
      }
      onBlur={() => window.scrollTo(0, 0)}
  autoComplete="off"
      placeholder="Selling postcode"
      className="mt-4 w-full border border-slate-300 text-base text-slate-900 rounded-2xl px-4 py-4"
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

    <input
      type="text"
      value={buyingAddress}
      onChange={(event) =>
        setBuyingAddress(
          event.target.value
        )
      }
      onBlur={() => window.scrollTo(0, 0)}
  autoComplete="off"
      placeholder="Buying property address"
      className="w-full border border-slate-300 text-base text-slate-900 rounded-2xl px-4 py-4"
    />

    <input
      type="text"
      value={buyingPostcode}
      onChange={(event) =>
        setBuyingPostcode(
          event.target.value
        )
      }
      onBlur={() => window.scrollTo(0, 0)}
  autoComplete="off"
      placeholder="Buying postcode"
      className="mt-4 w-full border border-slate-300 text-base text-slate-900 rounded-2xl px-4 py-4"
    />

  </div>

)}

</div>
<div className="mt-10">
<button
  type="submit"
  className="mt-10 w-full bg-slate-900 text-white rounded-2xl py-5 text-lg font-semibold"
>
  Create Chain
</button>
</div>

</form>

      <DuplicatePropertyDialog
        isOpen={duplicateDialogOpen}
        onJoinExisting={() => {
          if (pendingDuplicateJoin) {
            redirectToJoinExistingChain(
              pendingDuplicateJoin.chainId
            );
          }
        }}
        onCancel={() => {
          setDuplicateDialogOpen(false);
          setPendingDuplicateJoin(null);
        }}
      />

    </main>
  );
}