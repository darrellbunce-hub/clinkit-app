"use client";

import { usePathname } from "next/navigation";

import type { LightShellNavLink } from "@/components/mobile/LightShellHeader";
import { ROUTES } from "@/lib/auth/routes";

/**
 * EA marketing header links. Uses hash-only hrefs on the landing page so
 * in-page section links scroll instead of no-op client navigations.
 */
export function useEaMarketingNavLinks(): LightShellNavLink[] {
  const pathname = usePathname();
  const onLanding = pathname === ROUTES.estateAgentMarketing;
  const sectionPrefix = onLanding ? "" : ROUTES.estateAgentMarketing;

  return [
    {
      href: `${sectionPrefix}#how-it-works`,
      label: "How it works",
    },
    {
      href: `${sectionPrefix}#pricing`,
      label: "Pricing",
    },
    {
      href: `${sectionPrefix}#faq`,
      label: "FAQ",
    },
    {
      href: ROUTES.estateAgentLogin,
      label: "Log in",
    },
    {
      href: ROUTES.estateAgentSignup,
      label: "Sign Up",
      primary: true,
    },
  ];
}
