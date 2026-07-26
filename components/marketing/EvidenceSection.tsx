import Link from "next/link";

import {
  HOME_BUYING_EVIDENCE_ATTRIBUTION,
  HOME_BUYING_EVIDENCE_STATS,
  HOME_BUYING_KEY_INSIGHT,
  HOME_BUYING_REFORM_ROADMAP_TITLE,
  HOME_BUYING_REFORM_ROADMAP_URL,
} from "@/lib/marketing/homeBuyingEvidence";
import { MARKETING_SECTION_TITLE_CLASS } from "@/components/mobileStandards";
import {
  MARKETING_FEATURE_CARD_CLASS,
  SECTION_BG_CLASS,
  SECTION_CONTENT_CLASS,
} from "@/lib/theme/themeTokens";

type EvidenceSectionProps = {
  showKeyInsight?: boolean;
  className?: string;
};

export default function EvidenceSection({
  showKeyInsight = true,
  className = "",
}: EvidenceSectionProps) {
  return (
    <section
      className={`${SECTION_BG_CLASS} border-t-0 ${className}`.trim()}
      aria-labelledby="home-buying-evidence-heading"
    >
      <div className={SECTION_CONTENT_CLASS}>
        <div className="max-w-3xl mx-auto text-center">
          <h2
            id="home-buying-evidence-heading"
            className={MARKETING_SECTION_TITLE_CLASS}
          >
            Moving home involves real uncertainty
          </h2>

          <p className="mt-6 text-lg md:text-xl text-slate-600 leading-relaxed">
            Once an offer is accepted, limited visibility across the property
            chain can make an already significant move feel harder to follow.
            The scale of the challenge is well documented.
          </p>
        </div>

        <div className="mt-12 grid gap-6 md:grid-cols-3">
          {HOME_BUYING_EVIDENCE_STATS.map((stat) => (
            <article
              key={stat.id}
              className={`${MARKETING_FEATURE_CARD_CLASS} text-center`}
            >
              <p className="text-4xl md:text-5xl font-bold text-brand-primary">
                {stat.value}
              </p>

              <p className="mt-4 text-slate-600 leading-relaxed text-sm md:text-base">
                {stat.description}
              </p>
            </article>
          ))}
        </div>

        <p className="mt-8 text-center text-sm text-slate-500 leading-relaxed max-w-3xl mx-auto">
          {HOME_BUYING_EVIDENCE_ATTRIBUTION}{" "}
          <Link
            href={HOME_BUYING_REFORM_ROADMAP_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-brand-primary underline underline-offset-2 hover:text-brand-primary-hover"
          >
            {HOME_BUYING_REFORM_ROADMAP_TITLE}
          </Link>
          .
        </p>

        {showKeyInsight ? (
          <blockquote className="mt-12 max-w-3xl mx-auto rounded-3xl border border-surface-card-border bg-white px-6 py-8 md:px-10 text-center shadow-sm">
            <p className="text-xl md:text-2xl font-semibold text-slate-900 leading-snug">
              &ldquo;{HOME_BUYING_KEY_INSIGHT}&rdquo;
            </p>
          </blockquote>
        ) : null}
      </div>
    </section>
  );
}
