import type { ReactNode } from "react";

/** Pass-through shell — production Keynetic branding is fixed in globals.css. */
export function AppThemeShell({
  children,
}: {
  children: ReactNode;
}) {
  return children;
}
