"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import Navbar from "@/components/Navbar";

export default function StartMovePage() {
 
  const [notSelling, setNotSelling] =
    useState(false);

  const [notBuying, setNotBuying] =
    useState(false);
    const [
      searchingForProperty,
      setSearchingForProperty,
    ] = useState(false);
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
    async function handleStartMove() {

      try {
    
        console.log("START MOVE CLICKED");
    
        console.log({
          sellingAddress,
          sellingPostcode,
          buyingAddress,
          buyingPostcode,
          notSelling,
          notBuying,
          searchingForProperty,
        });
    
        if (
          document.activeElement instanceof HTMLElement
        ) {
          document.activeElement.blur();
        }
    
        console.log("ABOUT TO GET USER");
    
        const {
          data: { user },
        } = await supabase.auth.getUser();
    
        console.log("USER RESULT", user);
    
        if (!user) {
    
          alert("Please login first");
    
          return;
    
        }
    
        const accessCode =
          generateAccessCode();
    
        console.log("ABOUT TO CREATE CHAIN");
    
        const {
          data: chainData,
          error: chainError,
        } = await supabase
          .from("chains")
          .insert({
            name: `CHAIN-${Date.now()}`,
            access_code: accessCode,
          })
          .select()
          .single();
    
        console.log(
          "CHAIN RESULT",
          chainData,
          chainError
        );
    
        if (chainError || !chainData) {
    
          console.error(chainError);
    
          alert("CHAIN CREATION FAILED");
    
          return;
    
        }
    
        // SELLING PROPERTY
        if (!notSelling && sellingAddress) {
    
          console.log(
            "CHECKING EXISTING SELLING PROPERTY"
          );
    
          const {
            data: existingSellingProperty,
          } = await supabase
            .from("properties")
            .select("*")
            .eq("address", sellingAddress)
            .eq("postcode", sellingPostcode)
            .single();
    
          if (existingSellingProperty) {
    
            const shouldJoinExisting =
              window.confirm(
                "This property already exists within an active chain.\n\nWould you like to connect to the existing transaction?"
              );
    
            if (shouldJoinExisting) {
    
              window.location.href =
                `/join-chain?property=${existingSellingProperty.id}&sourceChain=${chainData.id}`;
    
              return;
    
            }
    
            return;
    
          }
    
          console.log(
            "ABOUT TO INSERT SELLING PROPERTY"
          );
    
          const {
            data: sellingProperty,
            error: sellingError,
          } = await supabase
            .from("properties")
            .insert({
              chain_id: chainData.id,
    
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
    
          console.log(
            "SELLING RESULT",
            sellingProperty,
            sellingError
          );
    
          if (sellingError) {
    
            console.error(sellingError);
    
            alert(
              JSON.stringify(sellingError)
            );
    
            return;
    
          }
    
          if (sellingProperty) {
    
            await supabase
              .from("property_members")
              .insert({
                property_id:
                  sellingProperty.id,
    
                user_id: user.id,
    
                role: "seller",
              });
    
          }
    
        }
    
        // BUYING PROPERTY
        if (!notBuying && buyingAddress) {
    
          console.log(
            "CHECKING EXISTING BUYING PROPERTY"
          );
    
          const {
            data: existingBuyingProperty,
          } = await supabase
            .from("properties")
            .select("*")
            .eq("address", buyingAddress)
            .eq("postcode", buyingPostcode)
            .single();
    
          if (existingBuyingProperty) {
    
            const shouldJoinExisting =
              window.confirm(
                "This property already exists within an active chain.\n\nWould you like to connect to the existing transaction?"
              );
    
            if (shouldJoinExisting) {
    
              window.location.href =
                `/join-chain?property=${existingBuyingProperty.id}&sourceChain=${chainData.id}`;
    
              return;
    
            }
    
            return;
    
          }
    
          console.log(
            "ABOUT TO INSERT BUYING PROPERTY"
          );
    
          const {
            data: buyingProperty,
            error: buyingError,
          } = await supabase
            .from("properties")
            .insert({
              chain_id: chainData.id,
    
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
    
              is_searching: searchingForProperty,
    
              is_current_user: true,
    
              last_updated_days: 0,
            })
            .select()
            .single();
    
          console.log(
            "BUYING RESULT",
            buyingProperty,
            buyingError
          );
    
          if (buyingError) {
    
            console.error(buyingError);
    
            alert(
              JSON.stringify(buyingError)
            );
    
            return;
    
          }
    
          if (buyingProperty) {
    
            await supabase
              .from("property_members")
              .insert({
                property_id:
                  buyingProperty.id,
    
                user_id: user.id,
    
                role: "buyer",
              });
    
          }
    
        }
    
        console.log(
          "REDIRECTING TO CHAIN"
        );
    
        window.location.href =
          `/chain/${chainData.id}?refresh=${Date.now()}`;
    
      } catch (error) {
    
        console.error(error);
    
        alert("HANDLE START MOVE FAILED");
    
      }
    
    }

  return (
    <main className="min-h-screen bg-slate-100">

      <Navbar />

      <form
  onSubmit={(event) => {
    event.preventDefault();
    handleStartMove();
  }}
  className="max-w-3xl mx-auto px-6 py-12"
>

        <h1 className="text-5xl font-bold text-slate-900">
          Start Your Move
        </h1>

        <p className="mt-3 text-lg text-slate-600">
          Tell Keynetic about your move
        </p>
      
 
        {/* Selling */}
<div className="mt-12 bg-white rounded-3xl border border-slate-200 p-8">

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
<div className="mt-10 bg-white rounded-3xl border border-slate-200 p-8">

<div className="flex flex-col md:flex-row items-start justify-between gap-6">

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

    </main>
  );
}