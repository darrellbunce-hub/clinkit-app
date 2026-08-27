import type { Metadata } from "next";
import Image from "next/image";

import { KEYNETIC_LOGO_ASSETS } from "@/lib/theme/logoAssets";
import {
  HERO_GLOW_PRIMARY_CLASS,
  HERO_GLOW_SECONDARY_CLASS,
  HERO_GRADIENT_CLASS,
} from "@/lib/theme/themeTokens";

export const metadata: Metadata = {
  title: "Keynetic — Coming soon",
  description:
    "Keynetic is preparing to launch. A clearer way to follow your property chain.",
  robots: {
    index: false,
    follow: false,
  },
};

export default function ComingSoonPage() {
  const logo = KEYNETIC_LOGO_ASSETS.dark;

  return (
    <main
      className={`${HERO_GRADIENT_CLASS} relative flex min-h-screen items-center justify-center overflow-hidden px-6 py-16`}
    >
      <div
        className={`${HERO_GLOW_PRIMARY_CLASS} pointer-events-none absolute -left-24 top-16 h-72 w-72 rounded-full blur-3xl`}
        aria-hidden
      />
      <div
        className={`${HERO_GLOW_SECONDARY_CLASS} pointer-events-none absolute -right-16 bottom-10 h-80 w-80 rounded-full blur-3xl`}
        aria-hidden
      />

      <div className="relative z-10 w-full max-w-xl text-center">
        <div className="mb-10 flex justify-center">
          <div
            className="inline-flex items-center gap-3"
            aria-label="Keynetic"
          >
            <Image
              src={logo.icon.src}
              alt=""
              width={logo.icon.width}
              height={logo.icon.height}
              className="h-10 w-10"
              priority
              aria-hidden
            />
            <Image
              src={logo.wordmark.src}
              alt="Keynetic"
              width={logo.wordmark.width}
              height={logo.wordmark.height}
              className="h-8 w-auto"
              priority
            />
          </div>
        </div>

        <p className="text-sm font-medium uppercase tracking-[0.18em] text-brand-secondary">
          Coming soon
        </p>

        <h1 className="mt-4 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          Keynetic is nearly ready.
        </h1>

        <p className="mt-5 text-base leading-relaxed text-teal-50/90 sm:text-lg">
          We&apos;re putting the finishing touches in place before opening
          our doors.
        </p>

        <p className="mt-6 text-base leading-relaxed text-teal-100/80 sm:text-lg">
          Buying or selling a home is complicated enough. We&apos;re
          building a clearer way to keep everyone moving together.
        </p>

        <p className="mt-10 text-sm font-medium text-brand-secondary">
          We&apos;ll be ready soon.
        </p>
      </div>
    </main>
  );
}
