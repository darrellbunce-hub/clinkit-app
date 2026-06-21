"use client";

import LightShellHeader from "@/components/mobile/LightShellHeader";
import PageHeaderBand from "@/components/theme/PageHeaderBand";
import { supabase } from "@/lib/supabase";
import { ROUTES } from "@/lib/auth/routes";
import { PAGE_BG_CLASS } from "@/lib/theme/themeTokens";

const agentNavLinks = [
  {
    href: ROUTES.accountSettings,
    label: "Account Settings",
  },
];

export default function AgentShell({
  children,
}: {
  children: React.ReactNode;
}) {
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
          <span className="text-slate-500 hidden lg:inline px-2">
            Keynetic Agent
          </span>
        }
        onLogout={handleLogout}
      />

      <PageHeaderBand />

      {children}
    </main>
  );
}
