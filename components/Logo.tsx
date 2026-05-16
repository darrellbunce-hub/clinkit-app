import Image from "next/image";
import Link from "next/link";

export default function Logo() {

  return (

    <Link
      href="/"
      className="flex items-center gap-4"
    >

<div className="relative w-20 h-20">

        <Image
          src="/logo.png"
          alt="Keynetic"
          fill
          className="object-contain"
          priority
        />

      </div>

      <div className="leading-tight">

        <h1
          className="
            text-5xl
            font-black
            tracking-tight
            text-white
          "
        >
          Keynetic
        </h1>

        <p
          className="
            text-base
            uppercase
            tracking-[0.28em]
            text-slate-400
            font-medium
          "
        >
          MOVING MADE CLEAR
        </p>

      </div>

    </Link>

  );
}