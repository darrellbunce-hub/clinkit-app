"use client";

import Link from "next/link";
import { useState } from "react";

export default function Navbar() {

  const [mobileMenuOpen, setMobileMenuOpen] =
    useState(false);

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
          py-4
          flex
          items-center
          justify-between
        "
      >

        {/* Logo */}
        <Link
          href="/"
          className="flex items-center gap-4 group"
        >

          {/* Icons */}
          <div className="flex items-center gap-3">

            {/* Chain Icon */}
            <div
              className="
                w-12
                h-12
                rounded-2xl
                bg-gradient-to-br
                from-cyan-400
                to-blue-600
                flex
                items-center
                justify-center
                shadow-lg
                shadow-blue-500/30
              "
            >
              <span className="text-white text-2xl">
                🔗
              </span>
            </div>

            {/* K Icon */}
            <div
              className="
                w-11
                h-11
                rounded-2xl
                bg-slate-950
                border-2
                border-cyan-400
                flex
                items-center
                justify-center
                shadow-lg
              "
            >
              <span className="text-white font-black text-lg">
                K
              </span>
            </div>

          </div>

          {/* Text */}
          <div className="leading-tight">

            <h1
              className="
                text-3xl
                font-black
                tracking-tight
                text-white
              "
            >
              Keynetic
            </h1>

            <p
              className="
                text-sm
                font-medium
                text-slate-400
                tracking-[0.18em]
                hidden sm:block
              "
            >
              MOVING MADE CLEAR
            </p>

          </div>

        </Link>

        {/* Desktop Nav */}
        <nav className="hidden md:flex items-center gap-3">

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

          <Link
            href="/join-chain"
            className="
              text-slate-300
              hover:text-white
              transition
              px-4
              py-2
            "
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
              py-3
              rounded-xl
              font-semibold
              transition
              shadow-lg
              shadow-blue-500/20
            "
          >
            Start Move
          </Link>

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
                py-4
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