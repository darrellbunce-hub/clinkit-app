"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import Logo from "@/components/Logo";
export default function Navbar() {

  const [mobileMenuOpen, setMobileMenuOpen] =
    useState(false);
    const [user, setUser] =
    useState<any>(null);
    useEffect(() => {

      async function getUser() {
    
        const {
          data,
        } =
          await supabase.auth.getUser();
    
        setUser(data.user);
    
      }
    
      getUser();
    
    }, []);
  return (

    <header
      className="
        sticky
        top-0
        z-50
        backdrop-blur-xl
        bg-slate-950/80
        border-b
        border-white/10
      "
    >

      <div
        className="
          max-w-6xl
          mx-auto
          px-6
          py-5
          flex
          items-center
          justify-between
        "
      >
<Logo />
        
        {/* Desktop Nav */}
<nav className="hidden md:flex items-center gap-3">

{user ? (

  <>

    <Link
      href="/dashboard"
      className="
        text-slate-300
        hover:text-white
        transition
        px-4
        py-2
      "
    >
      Dashboard
    </Link>

    <button
      onClick={async () => {

        await supabase.auth.signOut();

        window.location.href = "/";

      }}
      className="
        text-slate-300
        hover:text-white
        transition
        px-4
        py-2
      "
    >
      Logout
    </button>

  </>

) : (

  <>

    <Link
      href="/login"
      className="
        text-slate-300
        hover:text-white
        transition
        px-4
        py-2
      "
    >
      Login
    </Link>

    <Link
      href="/login"
      className="
        bg-blue-600
        hover:bg-blue-500
        text-white
        px-5
        py-3
        rounded-xl
        font-semibold
        transition
        shadow-lg
        shadow-blue-500/20
      "
    >
      Create Account
    </Link>

  </>

)}

</nav>

        {/* Mobile Button */}
        <button
          onClick={() =>
            setMobileMenuOpen(
              !mobileMenuOpen
            )
          }
          className="
            md:hidden
            text-white
            text-3xl
          "
        >
          {mobileMenuOpen ? "✕" : "☰"}
        </button>

      </div>

      {/* Mobile Menu */}
      {mobileMenuOpen && (

        <div
          className="
            md:hidden
            border-t
            border-white/10
            bg-slate-950/95
            backdrop-blur-xl
          "
        >

          <div className="px-6 py-6 flex flex-col gap-4">

            <Link
              href="/dashboard"
              className="
                text-slate-300
                hover:text-white
                transition
                py-3
              "
              onClick={() =>
                setMobileMenuOpen(false)
              }
            >
              Dashboard
            </Link>

            <Link
              href="/join-chain"
              className="
                text-slate-300
                hover:text-white
                transition
                py-3
              "
              onClick={() =>
                setMobileMenuOpen(false)
              }
            >
              Join Chain
            </Link>

            <Link
              href="/start-move"
              className="
                bg-blue-600
                hover:bg-blue-500
                text-white
                px-5
                py-5
                rounded-xl
                font-semibold
                text-center
                transition
              "
              onClick={() =>
                setMobileMenuOpen(false)
              }
            >
              Start Move
            </Link>

          </div>

        </div>

      )}

    </header>

  );
}