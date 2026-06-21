"use client";

import { DevThemeSwitcher } from "@/components/theme/DevThemeSwitcher";
import { BrandThemeProvider } from "@/context/BrandThemeContext";
import type { ReactNode } from "react";

export function AppThemeShell({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <BrandThemeProvider>
      {children}
      <DevThemeSwitcher />
    </BrandThemeProvider>
  );
}
