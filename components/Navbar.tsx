import Link from "next/link";
import Image from "next/image";

export default function Navbar() {
  return (
    <header className="bg-white shadow-sm">

      <div className="max-w-6xl mx-auto px-6 py-5 flex items-center justify-between">

        <Link
          href="/"
          className="flex items-center gap-3"
        >

          <Image
            src="/logo.png"
            alt="ClinkIt Logo"
            width={50}
            height={50}
          />

          <span className="text-3xl font-bold text-slate-900">
            ClinkIt
          </span>

        </Link>

        <nav className="flex items-center gap-4">

          <Link
            href="/dashboard"
            className="text-slate-700 hover:text-slate-900"
          >
            Dashboard
          </Link>

          <Link
            href="/login"
            className="bg-slate-900 text-white px-4 py-2 rounded-lg"
          >
            Login
          </Link>

        </nav>

      </div>

    </header>
  );
}