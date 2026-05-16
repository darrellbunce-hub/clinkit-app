import { ReactNode } from "react";

export default function GlassCard({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div
      className="
        bg-white/10
        backdrop-blur-xl
        rounded-3xl
        border
        border-white/10
        p-8
        shadow-2xl
      "
    >
      {children}
    </div>
  );
}