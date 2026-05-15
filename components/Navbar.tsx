"use client";

import Link from "next/link";

export default function Navbar() {

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
              "
            >
              MOVING MADE CLEAR
            </p>

          </div>

        </Link>

        {/* Navigation */}
        <nav className="flex items-center gap-3">

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

      </div>

    </header>

  );
}