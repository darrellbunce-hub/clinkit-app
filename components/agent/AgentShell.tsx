"use client";

import { usePathname } from "next/navigation";

import LightShellHeader from "@/components/mobile/LightShellHeader";
import type { LightShellNavLink } from "@/components/mobile/LightShellHeader";
import PageHeaderBand from "@/components/theme/PageHeaderBand";
import { supabase } from "@/lib/supabase";
import { ROUTES } from "@/lib/auth/routes";
import { LINK_MUTED_CLASS, PAGE_BG_CLASS } from "@/lib/theme/themeTokens";

export default function AgentShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const onAccountSettings = pathname === ROUTES.accountSettings;

  const agentNavLinks: LightShellNavLink[] = onAccountSettings
    ? []
    : [
        {
          href: ROUTES.accountSettings,
          label: "Account Settings",
        },
      ];

  async function handleLogout() {
    await supabase.auth.signOut();
    window.location.href = ROUTES.estateAgentLogin;
  }

  return (
    <main className={PAGE_BG_CLASS}>
      <LightShellHeader
        logoHref={ROUTES.agentHome}
        links={agentNavLinks}
        trailing={
          onAccountSettings ? (
            <span
              className={`${LINK_MUTED_CLASS} hidden lg:inline px-3 py-2 min-h-11 items-center text-slate-900 font-semibold`}
              aria-current="page"
            >
              Account Settings
            </span>
          ) : undefined
        }
        onLogout={handleLogout}
      />

      <PageHeaderBand />

      {children}
    </main>
  );
}
