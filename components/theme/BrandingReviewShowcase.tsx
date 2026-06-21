import ChainNode from "@/components/ChainNode";

import Logo from "@/components/Logo";

import PageHeaderBand from "@/components/theme/PageHeaderBand";

import {

  accountAlertErrorClassName,

  accountAlertSuccessClassName,

} from "@/components/account/accountStyles";

import { CARD_PADDING_CLASS } from "@/components/mobileStandards";

import { chainConnectorClasses } from "@/lib/theme/chainViz";

import { statusBadgeClasses } from "@/lib/theme/statusBadges";

import {

  BTN_ACCENT_SM_CLASS,

  BTN_PRIMARY_CLASS,

  BTN_SECONDARY_OUTLINE_CLASS,

  CARD_CLASS_NO_PADDING,

  CHAIN_PROGRESS_FILL_CLASS,

  CHAIN_PROGRESS_TRACK_CLASS,

  CHAIN_VIZ_CANVAS_CLASS,

  DASHBOARD_LIST_CLASS,

  DASHBOARD_LIST_ROW_CLASS,

  HERO_BADGE_CLASS,

  HERO_GRADIENT_CLASS,

  INFO_CALLOUT_CLASS,

  LINK_BRAND_CLASS,

  MARKETING_STEP_CARD_CLASS,

  NAV_HEADER_DARK_CLASS,

  NAV_LINK_DARK_CLASS,

  PAGE_BG_CLASS,

  PAGE_HEADER_BAND_CLASS,

  SECTION_BG_CLASS,

  SURFACE_INSET_CLASS,

  SURFACE_MUTED_CLASS,

} from "@/lib/theme/themeTokens";



function PreviewSection({

  title,

  children,

}: {

  title: string;

  children: React.ReactNode;

}) {

  return (

    <section className="space-y-3">

      <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">

        {title}

      </h3>

      {children}

    </section>

  );

}



export function BrandingReviewShowcase() {

  return (

    <div className={`${PAGE_BG_CLASS} rounded-2xl border border-surface-card-border overflow-hidden`}>

      <header className={`${NAV_HEADER_DARK_CLASS} relative`}>

        <div className="px-4 py-3 flex items-center justify-between gap-2">

          <Logo variant="dark" href="#" />

          <nav className="hidden sm:flex items-center gap-2 text-sm">

            <span className={`${NAV_LINK_DARK_CLASS} px-2 py-1`}>

              Dashboard

            </span>

            <span className={`${BTN_ACCENT_SM_CLASS} px-3 py-1.5 text-xs`}>

              Create Account

            </span>

          </nav>

        </div>

        <div className={PAGE_HEADER_BAND_CLASS} />

      </header>



      <div className={`space-y-6 ${CARD_PADDING_CLASS}`}>

        <PreviewSection title="Page surfaces">

          <div className="grid grid-cols-2 gap-2 text-xs">

            <div className={`${SURFACE_MUTED_CLASS} p-3 border border-surface-card-border`}>

              Muted panel

            </div>

            <div className={`${SURFACE_INSET_CLASS} p-3 border border-surface-card-border`}>

              Inset panel

            </div>

            <div className={`${SECTION_BG_CLASS} p-3 col-span-2`}>

              Section background

            </div>

          </div>

        </PreviewSection>



        <PreviewSection title="Hero strip">

          <div className={`h-16 rounded-xl ${HERO_GRADIENT_CLASS}`} />

        </PreviewSection>



        <PreviewSection title="Logo">

          <div className="flex flex-wrap gap-6 items-start">

            <div className={`rounded-xl ${HERO_GRADIENT_CLASS} p-4`}>

              <Logo variant="dark" href="#" />

            </div>

            <div className="rounded-xl bg-surface-card border border-surface-card-border p-4">

              <Logo variant="light" href="#" />

            </div>

          </div>

        </PreviewSection>



        <PreviewSection title="Buttons">

          <div className="flex flex-wrap gap-3">

            <button type="button" className={`${BTN_PRIMARY_CLASS} px-5 py-3`}>

              Primary

            </button>

            <button type="button" className={`${BTN_ACCENT_SM_CLASS} px-5 py-3`}>

              Accent

            </button>

            <button

              type="button"

              className={`${BTN_SECONDARY_OUTLINE_CLASS} px-5 py-3`}

            >

              Outline

            </button>

          </div>

        </PreviewSection>



        <PreviewSection title="Links">

          <a href="#" className={LINK_BRAND_CLASS}>

            Brand link example

          </a>

        </PreviewSection>



        <PreviewSection title="Cards (white)">

          <div className={`${CARD_CLASS_NO_PADDING} ${CARD_PADDING_CLASS}`}>

            <p className="font-bold text-slate-900">Chain card preview</p>

            <p className="mt-2 text-sm text-slate-600">

              42 Maple Drive — Stage: Searches ordered

            </p>

            <div className={`mt-4 ${DASHBOARD_LIST_CLASS}`}>

              <div className={DASHBOARD_LIST_ROW_CLASS}>

                Property 1 · Searches ordered

              </div>

              <div className={DASHBOARD_LIST_ROW_CLASS}>

                Property 2 · Mortgage approved

              </div>

            </div>

            <div className="mt-4 flex flex-wrap gap-2">

              {(["healthy", "pending_connection", "broken_connection"] as const).map(

                (status) => (

                  <span

                    key={status}

                    className={`rounded-full px-3 py-1 text-xs font-semibold ${statusBadgeClasses(status)}`}

                  >

                    {status.replaceAll("_", " ")}

                  </span>

                )

              )}

            </div>

          </div>

        </PreviewSection>



        <PreviewSection title="Alerts">

          <div className="space-y-3">

            <div className={accountAlertSuccessClassName}>

              Profile updated successfully.

            </div>

            <div className={accountAlertErrorClassName}>

              Unable to save changes. Please try again.

            </div>

            <div className={INFO_CALLOUT_CLASS}>

              Operational info callout for chain updates.

            </div>

          </div>

        </PreviewSection>



        <PreviewSection title="Status pills">

          <div className="flex flex-wrap gap-2">

            {(

              [

                "healthy",

                "pending_connection",

                "delayed",

                "broken_connection",

                "unknown",

              ] as const

            ).map((status) => (

              <span

                key={status}

                className={`rounded-full px-3 py-1.5 text-xs font-semibold ${statusBadgeClasses(status)}`}

              >

                {status.replaceAll("_", " ")}

              </span>

            ))}

          </div>

        </PreviewSection>



        <PreviewSection title="Marketing step card">

          <div className={MARKETING_STEP_CARD_CLASS}>

            <p className="font-bold text-slate-900">Create your chain</p>

            <p className="mt-2 text-sm text-slate-600">

              Themed section surface behind white content cards.

            </p>

          </div>

        </PreviewSection>



        <PreviewSection title="Chain visualisation">

          <div className={CHAIN_VIZ_CANVAS_CLASS}>

            <div className="flex items-center justify-center gap-4">

              <ChainNode

                propertyNumber={1}

                displayTitle="Sale property"

                stageLabel="Under offer"

                progress={40}

                updatedDaysAgo={2}

                currentUserRole="seller"

                status="healthy"

                buyer_connected

                seller_connected

              />

              <div className={chainConnectorClasses("connected")} />

              <ChainNode

                propertyNumber={2}

                displayTitle="12 Oak Lane"

                stageLabel="Searches ordered"

                progress={65}

                updatedDaysAgo={3}

                currentUserRole="buyer"

                status="healthy"

                buyer_connected

                seller_connected

                isOperationalPosition

                positionKind="sale"

              />

            </div>

            <div className={`mt-6 ${CHAIN_PROGRESS_TRACK_CLASS}`}>

              <div

                className={CHAIN_PROGRESS_FILL_CLASS}

                style={{ width: "65%" }}

              />

            </div>

          </div>

        </PreviewSection>



        <PreviewSection title="Estate agent preview">

          <div className="rounded-2xl border border-surface-card-border bg-surface-card overflow-hidden">

            <div className="border-b border-surface-card-border px-4 py-3 flex items-center justify-between bg-surface-section">

              <Logo variant="light" href="#" />

              <span className={`${BTN_PRIMARY_CLASS} px-3 py-1.5 text-xs`}>

                Sign Up

              </span>

            </div>

            <div className="p-4 space-y-3 bg-surface-card">

              <span className={HERO_BADGE_CLASS}>For estate agents</span>

              <p className="font-bold text-slate-900">

                Operational visibility across transactions

              </p>

              <p className="text-sm text-slate-600">

                Privacy-safe chain progress on assigned properties.

              </p>

            </div>

          </div>

        </PreviewSection>

      </div>

    </div>

  );

}

