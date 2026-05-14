"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";

export default function LoginPage() {

  const [email, setEmail] =
    useState("");

  const [password, setPassword] =
    useState("");

  async function handleLogin() {

    const { error } =
      await supabase.auth.signInWithPassword({
        email,
        password,
      });

    if (error) {
      alert(error.message);
      return;
    }

    window.location.href =
      "/chain/clk-102";
  }

  async function handleSignup() {

    const {
      data,
      error,
    } =
      await supabase.auth.signUp({
        email,
        password,
      });

    if (error) {
      alert(error.message);
      return;
    }
    if (data.user) {

      await supabase
        .from("profiles")
        .insert({
    
          id: data.user.id,
    
          role: "homeowner",
    
        });
    }
    alert(
      "Account created successfully"
    );
  }

  return (
    <main className="min-h-screen bg-slate-100 flex items-center justify-center px-6">

      <div className="w-full max-w-md bg-white rounded-3xl shadow-sm border border-slate-200 p-8">

        <h1 className="text-4xl font-bold text-slate-900">
          Login
        </h1>

        <p className="mt-2 text-slate-600">
          Access your property chain
        </p>

        <div className="mt-8">

          <label className="block text-sm font-medium text-slate-700">
            Email
          </label>

          <input
            type="email"
            value={email}
            onChange={(event) =>
              setEmail(event.target.value)
            }
            className="mt-2 w-full border border-slate-300 rounded-2xl px-4 py-3"
          />

        </div>

        <div className="mt-6">

          <label className="block text-sm font-medium text-slate-700">
            Password
          </label>

          <input
            type="password"
            value={password}
            onChange={(event) =>
              setPassword(event.target.value)
            }
            className="mt-2 w-full border border-slate-300 rounded-2xl px-4 py-3"
          />

        </div>

        <button
          onClick={handleLogin}
          className="mt-8 w-full bg-slate-900 text-white rounded-2xl py-4 font-semibold"
        >
          Login
        </button>

        <button
          onClick={handleSignup}
          className="mt-4 w-full border border-slate-300 rounded-2xl py-4 font-semibold"
        >
          Create Account
        </button>

      </div>

    </main>
  );
}