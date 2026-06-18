import Image from "next/image";
import Link from "next/link";

export type LogoVariant = "dark" | "light";

/**
 * Logo wordmark variant:
 * - `dark` — for dark headers/backgrounds (white wordmark)
 * - `light` — for light headers/backgrounds (slate wordmark)
 */
export default function Logo({
  href = "/",
  variant = "dark",
}: {
  href?: string;
  variant?: LogoVariant;
}) {
  const isDarkBackground = variant === "dark";

  return (
    <Link
      href={href}
      className="flex items-center gap-2 sm:gap-3 lg:gap-4 shrink-0 min-w-0"
      aria-label="Keynetic home"
    >
      <div
        className="
          relative
          w-12 h-12
          sm:w-16 sm:h-16
          lg:w-20 lg:h-20
          shrink-0
        "
      >
        <Image
          src="/logo.png"
          alt=""
          fill
          className="object-contain"
          priority
          aria-hidden
        />
      </div>

      <div className="leading-tight min-w-0">
        <span
          className={`
            block
            text-2xl
            sm:text-3xl
            lg:text-5xl
            font-black
            tracking-tight
            truncate
            ${isDarkBackground ? "text-white" : "text-slate-900"}
          `}
        >
          Keynetic
        </span>

        <p
          className={`
            text-[10px]
            sm:text-xs
            lg:text-base
            uppercase
            tracking-[0.18em]
            sm:tracking-[0.24em]
            lg:tracking-[0.28em]
            font-medium
            ${isDarkBackground ? "text-slate-400" : "text-slate-500"}
          `}
        >
          MOVING MADE CLEAR
        </p>
      </div>
    </Link>
  );
}
