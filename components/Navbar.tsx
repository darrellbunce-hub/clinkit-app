"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { supabase } from "@/lib/supabase";
import Logo from "@/components/Logo";
import { MENU_BUTTON_CLASS } from "@/components/mobileStandards";
import { ROUTES } from "@/lib/auth/routes";
import { useChain } from "@/context/ChainContext";
import { isEstateAgent } from "@/lib/accountType";
import {
  BTN_ACCENT_SM_CLASS,
  NAV_HEADER_DARK_CLASS,
  NAV_HEADER_MOBILE_DRAWER_CLASS,
  NAV_LINK_DARK_CLASS,
} from "@/lib/theme/themeTokens";

export default function Navbar() {

  const [mobileMenuOpen, setMobileMenuOpen] =
    useState(false);
  const {
    isAuthenticated,
    authLoading,
    accountType,
  } = useChain();

  const homeHref = isEstateAgent({
    account_type: accountType ?? "homeowner",
  })
    ? ROUTES.agentHome
    : ROUTES.homeownerDashboard;

  const homeLabel = isEstateAgent({
    account_type: accountType ?? "homeowner",
  })
    ? "Agent Home"
    : "Dashboard";

  const showAuthenticatedNav =
    !authLoading && isAuthenticated;

  const pathname = usePathname();
  // FD-039: public homepage marketing brand — route context only, not auth state.
  const showMarketingBrandTagline = pathname === "/";

  return (

    <header className={`${NAV_HEADER_DARK_CLASS} w-full`}>

      <div
        className="
          max-w-6xl
          mx-auto
          px-6
          py-4
          sm:py-5
          flex
          items-center
          justify-between
          gap-4
          min-w-0
        "
      >
        <div className="min-w-0 flex-1">
          <Logo
            variant="dark"
            priority
            showTagline={showMarketingBrandTagline}
          />
        </div>
        
        {/* Desktop Nav */}
<nav className="hidden md:flex items-center gap-3">

{showAuthenticatedNav ? (

  <>

    <Link
      href={homeHref}
      className={`${NAV_LINK_DARK_CLASS} px-4 py-2`}
    >
      {homeLabel}
    </Link>

    <Link
      href={ROUTES.accountSettings}
      className={`${NAV_LINK_DARK_CLASS} px-4 py-2`}
    >
      Account Settings
    </Link>

    <button
      onClick={async () => {

        await supabase.auth.signOut();

        window.location.href = "/";

      }}
      className={`${NAV_LINK_DARK_CLASS} px-4 py-2`}
    >
      Logout
    </button>

  </>

) : (

  <>

    <Link
      href={ROUTES.about}
      className={`${NAV_LINK_DARK_CLASS} px-4 py-2`}
    >
      Why Keynetic?
    </Link>

    <Link
      href={ROUTES.estateAgentMarketing}
      className={`${NAV_LINK_DARK_CLASS} px-4 py-2`}
    >
      Estate Agents
    </Link>

    <Link
      href="/login"
      className={`${NAV_LINK_DARK_CLASS} px-4 py-2`}
    >
      Log in
    </Link>

    <Link
      href="/login"
      className={`${BTN_ACCENT_SM_CLASS} px-5 py-3`}
    >
      Create account
    </Link>

  </>

)}

</nav>

        {/* Mobile Button */}
        <button
          type="button"
          aria-expanded={mobileMenuOpen}
          aria-label={
            mobileMenuOpen
              ? "Close menu"
              : "Open menu"
          }
          onClick={() =>
            setMobileMenuOpen(
              !mobileMenuOpen
            )
          }
          className={MENU_BUTTON_CLASS}
        >
          {mobileMenuOpen ? "✕" : "☰"}
        </button>

      </div>

      {/* Mobile Menu */}
      {mobileMenuOpen && (

        <div className={NAV_HEADER_MOBILE_DRAWER_CLASS}>

<div className="px-6 py-6 flex flex-col gap-4">

{showAuthenticatedNav ? (

  <>

    <Link
      href={homeHref}
      className={`${NAV_LINK_DARK_CLASS} py-3`}
      onClick={() =>
        setMobileMenuOpen(false)
      }
    >
      {homeLabel}
    </Link>

    <Link
      href={ROUTES.accountSettings}
      className={`${NAV_LINK_DARK_CLASS} py-3`}
      onClick={() =>
        setMobileMenuOpen(false)
      }
    >
      Account Settings
    </Link>

    <button
      onClick={async () => {

        await supabase.auth.signOut();

        setMobileMenuOpen(false);

window.location.href = "/";

      }}
      className={`text-left ${NAV_LINK_DARK_CLASS} py-3`}
    >
      Logout
    </button>

  </>

) : (

  <>

    <Link
      href={ROUTES.about}
      className={`${NAV_LINK_DARK_CLASS} py-3 min-h-11 inline-flex items-center`}
      onClick={() =>
        setMobileMenuOpen(false)
      }
    >
      Why Keynetic?
    </Link>

    <Link
      href={ROUTES.estateAgentMarketing}
      className={`${NAV_LINK_DARK_CLASS} py-3 min-h-11 inline-flex items-center`}
      onClick={() =>
        setMobileMenuOpen(false)
      }
    >
      Estate Agents
    </Link>

    <Link
      href="/login"
      className={`${NAV_LINK_DARK_CLASS} py-3 min-h-11 inline-flex items-center`}
      onClick={() =>
        setMobileMenuOpen(false)
      }
    >
      Log in
    </Link>

    <Link
      href="/login"
      className={`${BTN_ACCENT_SM_CLASS} px-5 py-5 text-center`}
      onClick={() =>
        setMobileMenuOpen(false)
      }
    >
      Create account
    </Link>

  </>

)}

</div>

        </div>

      )}


    </header>

  );
}
