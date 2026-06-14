"use client";

import Logo from "@/components/Logo";
import { supabase } from "@/lib/supabase";
import { ROUTES } from "@/lib/auth/routes";

export default function AgentShell({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="min-h-screen bg-slate-100">
      <header className="border-b border-slate-200 bg-white">
        <div className="max-w-6xl mx-auto px-6 py-5 flex items-center justify-between gap-4">
          <Logo href={ROUTES.agentHome} />

          <div className="flex items-center gap-3 text-sm font-semibold">
            <span className="text-slate-500 hidden sm:inline">
              Keynetic Agent
            </span>

            <button
              type="button"
              onClick={async () => {
                await supabase.auth.signOut();
                window.location.href =
                  ROUTES.estateAgentLogin;
              }}
              className="text-slate-600 hover:text-slate-900 px-3 py-2"
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      {children}
    </main>
  );
}
