"use client";

import LightShellHeader from "@/components/mobile/LightShellHeader";
import { supabase } from "@/lib/supabase";
import { ROUTES } from "@/lib/auth/routes";

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
    <main className="min-h-screen bg-slate-100">
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

      {children}
    </main>
  );
}
