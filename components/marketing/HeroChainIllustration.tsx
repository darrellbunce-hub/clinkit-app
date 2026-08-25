import { Clock3, Home, Search } from "lucide-react";

import { HERO_ILLUSTRATION_CARD_CLASS } from "@/lib/theme/themeTokens";

/**
 * Hero chain confidence illustration — tuned for contrast on dark teal backgrounds,
 * especially on narrow mobile viewports.
 */
export default function HeroChainIllustration() {
  return (
    <div className={`${HERO_ILLUSTRATION_CARD_CLASS} p-6 md:p-10`}>
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-white/90">
            Chain Confidence
          </p>

          <p className="mt-2 text-2xl md:text-3xl font-bold text-white">
            Strong
          </p>
        </div>

        <div className="rounded-full border border-brand-accent bg-brand-accent px-4 py-2 text-sm font-bold text-text-charcoal shadow-md shadow-black/10">
          95%
        </div>
      </div>

      <div className="mt-8 space-y-5" aria-hidden="true">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border-2 border-white/80 bg-white text-brand-primary">
            <Home className="h-6 w-6" />
          </div>

          <div className="h-2 min-w-0 flex-1 rounded-full bg-white/85" />

          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border-2 border-white/80 bg-white text-brand-primary">
            <Home className="h-6 w-6" />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border-2 border-brand-accent bg-brand-accent text-text-charcoal">
            <Home className="h-6 w-6" />
          </div>

          <div className="h-2 min-w-0 flex-1 rounded-full bg-brand-accent" />

          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border-2 border-white bg-white text-brand-primary">
            <Clock3 className="h-6 w-6" />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border-2 border-white/50 bg-white/15 text-white">
            <Clock3 className="h-6 w-6" />
          </div>

          <div className="h-2 min-w-0 flex-1 rounded-full bg-white/35" />

          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border-2 border-white/50 bg-white/15 text-white">
            <Search className="h-6 w-6" />
          </div>
        </div>
      </div>

      <p className="mt-8 text-xs md:text-sm text-white/80 leading-relaxed">
        Illustrative view of connected chain progress. Visibility grows as more
        of the chain connects.
      </p>
    </div>
  );
}
