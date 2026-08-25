import BriefKpiTile from "@/components/agent/commandCentre/BriefKpiTile";
import type { OperationalBriefModel } from "@/lib/estateAgent/workspacePresentation";
import {
  getBriefHealthHeroClasses,
} from "@/lib/estateAgent/workspacePresentation";
import {
  FONT_HEADING_CLASS,
  WORKSPACE_HERO_PANEL_CLASS,
} from "@/lib/theme/themeTokens";

export default function OperationalBriefSection({
  brief,
}: {
  brief: OperationalBriefModel;
}) {
  const hero = getBriefHealthHeroClasses(
    brief.healthLevel
  );

  return (
    <section
      aria-labelledby="operational-brief-heading"
      className={WORKSPACE_HERO_PANEL_CLASS}
    >
      <div
        className={`border-l-[10px] ${hero.accent} ${hero.panel} px-6 py-9 sm:px-10 sm:py-12`}
      >
        <div className="flex items-start gap-5 sm:gap-6">
          <div
            className={`mt-1.5 h-5 w-5 shrink-0 rounded-full ring-4 ring-white/80 sm:mt-2 sm:h-6 sm:w-6 ${hero.indicator}`}
            aria-hidden
          />

          <div className="min-w-0 flex-1 space-y-4">
            <div className="space-y-3">
              <p
                className={`text-sm font-bold uppercase tracking-[0.22em] sm:text-base ${FONT_HEADING_CLASS} ${hero.headline}`}
              >
                {brief.healthStatusLabel}
              </p>

              <h2
                id="operational-brief-heading"
                className={`text-3xl font-bold tracking-tight sm:text-[2.35rem] sm:leading-tight ${FONT_HEADING_CLASS} text-text-charcoal`}
              >
                {brief.summarySentence}
              </h2>

              {brief.reassuranceSentence ? (
                <p className="text-base text-text-muted sm:text-lg">
                  {brief.reassuranceSentence}
                </p>
              ) : null}
            </div>

            <div className="border-t border-surface-card-border/70 pt-5">
              <p className="text-sm font-medium text-text-muted">
                Active transactions
              </p>

              <p
                className={`mt-1 text-4xl font-bold tabular-nums tracking-tight text-text-charcoal sm:text-5xl ${FONT_HEADING_CLASS}`}
              >
                {brief.activeTransactions}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-3 bg-surface-stone/60 p-4 sm:grid-cols-2 sm:p-5 xl:grid-cols-4">
        {brief.kpis.map((kpi) => (
          <BriefKpiTile
            key={kpi.label}
            kpi={kpi}
          />
        ))}
      </div>
    </section>
  );
}
