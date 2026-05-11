"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import Navbar from "@/components/Navbar";

export default function StartMovePage() {

  const [notSelling, setNotSelling] =
    useState(false);

  const [notBuying, setNotBuying] =
    useState(false);
    const [sellingAddress, setSellingAddress] =
    useState("");
  
  const [buyingAddress, setBuyingAddress] =
    useState("");
    async function handleStartMove() {

        const {
          data: { user },
        } = await supabase.auth.getUser();
      
        if (!user) {
          alert("Please login first");
          return;
        }
      
        const { data: chainData, error: chainError } =
          await supabase
            .from("chains")
            .insert({
              name:
                `CHAIN-${Date.now()}`,
            })
            .select()
            .single();
      
        if (chainError || !chainData) {
          console.error(chainError);
          return;
        }
      
        const createdProperties = [];
      
        if (!notSelling && sellingAddress) {
      
            const {
                data: sellingProperty,
                error: sellingError,
              } = await supabase
            .from("properties")
            .insert({
              chain_id: chainData.id,
              chain_position: 1,
              stage: "property_listed",
              status: "healthy",
              is_current_user: true,
              last_updated_days: 0,
            })
            .select()
            .single();
            alert(
                JSON.stringify(sellingError)
              );
          if (sellingProperty) {
      
            createdProperties.push(
              sellingProperty.id
            );
      
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
      
        if (!notBuying && buyingAddress) {
      
            const {
                data: buyingProperty,
                error: buyingError,
              } = await supabase
            .from("properties")
            .insert({
              chain_id: chainData.id,
              chain_position: 2,
              stage: "offer_accepted",
              status: "healthy",
              is_current_user: true,
              last_updated_days: 0,
            })
            .select()
            .single();
            alert(
            
                    JSON.stringify(buyingError)
                  );
          if (buyingProperty) {
      
            createdProperties.push(
              buyingProperty.id
            );
      
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
      
        window.location.href =
  `/chain/${chainData.id}?refresh=${Date.now()}`;
      }
  return (
    <main className="min-h-screen bg-slate-100">

      <Navbar />

      <div className="max-w-3xl mx-auto px-6 py-12">

        <h1 className="text-5xl font-bold text-slate-900">
          Start Your Move
        </h1>

        <p className="mt-3 text-lg text-slate-600">
          Tell Keynetic about your move
        </p>

        {/* Selling */}
        <div className="mt-12 bg-white rounded-3xl border border-slate-200 p-8">

          <div className="flex items-center justify-between">

            <div>

              <h2 className="text-3xl font-bold text-slate-900">
                Property You Are Selling
              </h2>

              <p className="mt-2 text-slate-600">
                Add the property you are selling
              </p>

            </div>

            <label className="flex items-center gap-3">

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
  placeholder="Selling property address"
                className="w-full border border-slate-300 rounded-2xl px-4 py-4"
              />

            </div>

          )}

        </div>

        {/* Buying */}
        <div className="mt-10 bg-white rounded-3xl border border-slate-200 p-8">

          <div className="flex items-center justify-between">

            <div>

              <h2 className="text-3xl font-bold text-slate-900">
                Property You Are Buying
              </h2>

              <p className="mt-2 text-slate-600">
                Add the property you are buying
              </p>

            </div>

            <label className="flex items-center gap-3">

              <input
                type="checkbox"
                checked={notBuying}
                onChange={() =>
                  setNotBuying(!notBuying)
                }
              />

              <span className="text-slate-700">
                I am not buying
              </span>

            </label>

          </div>

          {!notBuying && (

            <div className="mt-8">

<input
  type="text"
  value={buyingAddress}
  onChange={(event) =>
    setBuyingAddress(
      event.target.value
    )
  }
  placeholder="Buying property address"
                className="w-full border border-slate-300 rounded-2xl px-4 py-4"
              />

            </div>

          )}

        </div>

        <button
  onClick={handleStartMove}
  className="mt-10 w-full bg-slate-900 text-white rounded-2xl py-5 text-lg font-semibold"
        >
          Continue
        </button>

      </div>

    </main>
  );
}