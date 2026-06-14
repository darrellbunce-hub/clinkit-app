"use client";

import { useEffect, useState } from "react";

import AgentDashboard from "@/components/agent/AgentDashboard";
import AgentShell from "@/components/agent/AgentShell";
import type { AgentHomeContext } from "@/lib/estateAgent/loadAgentHomeContext";
import { loadAgentHomeContext } from "@/lib/estateAgent/loadAgentHomeContext";
import { supabase } from "@/lib/supabase";

export default function AgentHomePage() {
  const [context, setContext] =
    useState<AgentHomeContext | null>(null);
  const [isLoading, setIsLoading] =
    useState(true);
  const [loadError, setLoadError] =
    useState("");

  useEffect(() => {
    async function loadPageContext() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setIsLoading(false);

        return;
      }

      const agentContext =
        await loadAgentHomeContext(
          supabase,
          user.id
        );

      if (!agentContext) {
        setLoadError(
          "We could not load your agency details. Try signing in again."
        );
        setIsLoading(false);

        return;
      }

      setContext(agentContext);
      setIsLoading(false);
    }

    loadPageContext();
  }, []);

  return (
    <AgentShell>
      <section className="max-w-6xl mx-auto px-6 py-12">
        {isLoading ? (
          <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-10 text-center text-slate-600">
            Loading dashboard...
          </div>
        ) : loadError ? (
          <div className="bg-white rounded-3xl border border-red-200 shadow-sm p-10 text-center text-red-800">
            {loadError}
          </div>
        ) : context ? (
          <AgentDashboard context={context} />
        ) : null}
      </section>
    </AgentShell>
  );
}
