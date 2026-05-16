"use client";

import Link from "next/link";
import Navbar from "@/components/Navbar";

export default function VerifyEmailPage() {

  return (

    <main className="min-h-screen bg-slate-950 overflow-hidden">

      <Navbar />

      {/* Background Glow */}
      <div className="absolute inset-0 bg-gradient-to-br from-slate-950 via-slate-900 to-blue-950"></div>

      <div className="absolute top-[-200px] right-[-100px] w-[500px] h-[500px] bg-blue-500/20 rounded-full blur-3xl"></div>

      <div className="absolute bottom-[-200px] left-[-100px] w-[400px] h-[400px] bg-cyan-400/10 rounded-full blur-3xl"></div>

      <section className="relative z-10 flex items-center justify-center px-6 py-24">

        <div
          className="
            w-full
            max-w-2xl
            bg-white/10
            backdrop-blur-xl
            border
            border-white/10
            rounded-3xl
            p-10
            text-center
          "
        >

          <div
            className="
              w-24
              h-24
              rounded-3xl
              bg-blue-500/20
              border
              border-blue-400/30
              flex
              items-center
              justify-center
              mx-auto
            "
          >

            <span className="text-5xl">
              ✉️
            </span>

          </div>

          <h1 className="mt-10 text-5xl font-bold text-white leading-tight">

            Verify Your Email

          </h1>

          <p className="mt-6 text-xl text-slate-300 leading-relaxed">

            We’ve sent a verification email to your inbox.

            Please verify your account before accessing your property chain dashboard.

          </p>

          <div
            className="
              mt-10
              bg-blue-500/10
              border
              border-blue-400/20
              rounded-2xl
              p-6
            "
          >

            <p className="text-blue-100 text-lg">

              Once verified, you’ll be able to:
              <br />
              • Create property chains
              <br />
              • Join existing transactions
              <br />
              • Track progression in real time

            </p>

          </div>

          <div className="mt-10 flex flex-col sm:flex-row gap-4 justify-center">

            <Link
              href="/login"
              className="
                bg-blue-600
                hover:bg-blue-500
                text-white
                px-8
                py-4
                rounded-2xl
                font-semibold
                transition
              "
            >
              Return To Login
            </Link>

            <button
              className="
                border
                border-white/20
                bg-white/10
                text-white
                px-8
                py-4
                rounded-2xl
                font-semibold
                hover:bg-white/20
                transition
              "
            >
              Resend Verification
            </button>

          </div>

        </div>

      </section>

    </main>

  );
}