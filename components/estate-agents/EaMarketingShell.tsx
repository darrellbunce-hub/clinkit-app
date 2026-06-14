import Link from "next/link";
import Logo from "@/components/Logo";
import { ROUTES } from "@/lib/auth/routes";

export default function EaMarketingShell({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="min-h-screen bg-slate-100">
      <header className="border-b border-slate-200 bg-white">
        <div className="max-w-6xl mx-auto px-6 py-5 flex items-center justify-between gap-4">
          <Logo href={ROUTES.home} />

          <nav className="flex items-center gap-3 text-sm font-semibold">
            <Link
              href={ROUTES.estateAgentMarketing}
              className="text-slate-600 hover:text-slate-900 px-3 py-2"
            >
              Estate Agents
            </Link>

            <Link
              href={ROUTES.estateAgentLogin}
              className="text-slate-600 hover:text-slate-900 px-3 py-2"
            >
              Login
            </Link>

            <Link
              href={ROUTES.estateAgentSignup}
              className="bg-slate-900 text-white px-4 py-2 rounded-xl hover:bg-slate-800"
            >
              Sign Up
            </Link>
          </nav>
        </div>
      </header>

      {children}
    </main>
  );
}
