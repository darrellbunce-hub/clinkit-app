"use client";

import Link from "next/link";
import {
  useState,
  type ReactNode,
} from "react";

import Logo from "@/components/Logo";
import { MENU_BUTTON_LIGHT_CLASS } from "@/components/mobileStandards";
import {
  BTN_PRIMARY_SM_CLASS,
  LINK_MUTED_CLASS,
} from "@/lib/theme/themeTokens";

export type LightShellNavLink = {
  href: string;
  label: string;
  primary?: boolean;
};

type LightShellHeaderProps = {
  logoHref: string;
  links: LightShellNavLink[];
  trailing?: ReactNode;
  onLogout?: () => void | Promise<void>;
};

/**
 * Shared light-header navigation for estate agent marketing and agent product shells.
 * Desktop: inline links. Mobile: hamburger drawer.
 */
export default function LightShellHeader({
  logoHref,
  links,
  trailing,
  onLogout,
}: LightShellHeaderProps) {
  const [mobileMenuOpen, setMobileMenuOpen] =
    useState(false);

  function closeMenu() {
    setMobileMenuOpen(false);
  }

  return (
    <header className="border-b border-slate-200 bg-white sticky top-0 z-50">
      <div className="max-w-6xl mx-auto px-6 py-4 sm:py-5 flex items-center justify-between gap-4">
        <Logo href={logoHref} variant="light" />

        <nav className="hidden md:flex items-center gap-1 sm:gap-3 text-sm font-semibold">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={
                link.primary
                  ? `${BTN_PRIMARY_SM_CLASS} px-4 py-2 min-h-11 inline-flex items-center`
                  : `${LINK_MUTED_CLASS} px-3 py-2 min-h-11 inline-flex items-center`
              }
            >
              {link.label}
            </Link>
          ))}

          {trailing}

          {onLogout ? (
            <button
              type="button"
              onClick={() => void onLogout()}
              className="text-slate-600 hover:text-brand-primary px-3 py-2 min-h-11 inline-flex items-center"
            >
              Logout
            </button>
          ) : null}
        </nav>

        <button
          type="button"
          aria-expanded={mobileMenuOpen}
          aria-label={
            mobileMenuOpen
              ? "Close menu"
              : "Open menu"
          }
          onClick={() =>
            setMobileMenuOpen((open) => !open)
          }
          className={MENU_BUTTON_LIGHT_CLASS}
        >
          {mobileMenuOpen ? "✕" : "☰"}
        </button>
      </div>

      {mobileMenuOpen ? (
        <div className="md:hidden border-t border-slate-200 bg-white">
          <div className="max-w-6xl mx-auto px-6 py-4 flex flex-col gap-1">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={closeMenu}
                className={
                  link.primary
                    ? `${BTN_PRIMARY_SM_CLASS} px-5 py-3 min-h-11 inline-flex items-center text-center justify-center`
                    : "text-slate-700 hover:text-brand-primary py-3 min-h-11 inline-flex items-center font-medium"
                }
              >
                {link.label}
              </Link>
            ))}

            {trailing ? (
              <div
                className="pt-2 border-t border-slate-100 mt-2"
                onClick={closeMenu}
              >
                {trailing}
              </div>
            ) : null}

            {onLogout ? (
              <button
                type="button"
                onClick={async () => {
                  closeMenu();
                  await onLogout();
                }}
                className="text-left text-slate-700 hover:text-brand-primary py-3 min-h-11 inline-flex items-center font-medium"
              >
                Logout
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </header>
  );
}
