"use client";

import LightShellHeader from "@/components/mobile/LightShellHeader";
import PageHeaderBand from "@/components/theme/PageHeaderBand";
import { useEaMarketingNavLinks } from "@/components/estate-agents/useEaMarketingNavLinks";
import { ROUTES } from "@/lib/auth/routes";
import { PAGE_BG_CLASS } from "@/lib/theme/themeTokens";

export default function EaMarketingShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const marketingNavLinks = useEaMarketingNavLinks();

  return (
    <main className={PAGE_BG_CLASS}>
      <LightShellHeader
        logoHref={ROUTES.home}
        links={marketingNavLinks}
        showBrandTagline
      />

      <PageHeaderBand />

      {children}
    </main>
  );
}
