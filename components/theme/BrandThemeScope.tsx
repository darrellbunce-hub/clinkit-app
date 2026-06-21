import type { ReactNode } from "react";

import type { BrandThemeId } from "@/lib/theme/types";

type BrandThemeScopeProps = {
  themeId: BrandThemeId;
  children: ReactNode;
  className?: string;
};

/**
 * Scopes CSS variable overrides to a subtree — used for side-by-side
 * theme comparison on /branding-review without affecting the document root.
 */
export function BrandThemeScope({
  themeId,
  children,
  className = "",
}: BrandThemeScopeProps) {
  return (
    <div
      data-brand-theme={themeId}
      className={className}
    >
      {children}
    </div>
  );
}
