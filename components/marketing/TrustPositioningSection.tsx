import { ShieldCheck } from "lucide-react";

import { MARKETING_SECTION_TITLE_CLASS } from "@/components/mobileStandards";
import {
  MARKETING_FEATURE_CARD_CLASS,
} from "@/lib/theme/themeTokens";

const expectations = [
  "Keynetic does not guarantee completion.",
  "Keynetic does not guarantee completion dates.",
  "Keynetic cannot prevent every delay.",
  "Keynetic cannot prevent every chain break.",
  "Keynetic complements estate agents and conveyancers — it does not replace them.",
];

export default function TrustPositioningSection() {
  return (
    <section
      className="max-w-6xl mx-auto px-6 py-20 md:py-24"
      aria-labelledby="trust-positioning-heading"
    >
      <div className="grid lg:grid-cols-2 gap-12 items-start">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-brand-primary">
            What Keynetic is — and is not
          </p>

          <h2
            id="trust-positioning-heading"
            className={`mt-4 ${MARKETING_SECTION_TITLE_CLASS} leading-tight`}
          >
            Keynetic doesn&apos;t replace the professionals progressing your move.
          </h2>

          <p className="mt-6 text-lg md:text-xl text-slate-600 leading-relaxed">
            It makes the journey easier to see.
          </p>
        </div>

        <ul className="space-y-4">
          {expectations.map((item) => (
            <li
              key={item}
              className={`${MARKETING_FEATURE_CARD_CLASS} flex items-start gap-4 py-5`}
            >
              <ShieldCheck
                className="mt-0.5 h-6 w-6 shrink-0 text-brand-primary"
                aria-hidden="true"
              />
              <span className="text-slate-700 leading-relaxed">{item}</span>
            </li>
          ))}
        </ul>
      </div>

      <p className="mt-12 rounded-3xl border border-brand-accent/40 bg-brand-accent/10 px-6 py-8 md:px-10 text-center text-xl md:text-2xl font-semibold text-slate-900 leading-snug">
        Even when certainty isn&apos;t possible, clarity should be.
      </p>
    </section>
  );
}
