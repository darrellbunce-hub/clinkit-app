"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  DEFAULT_BRAND_THEME_ID,
  isBrandThemeId,
} from "@/lib/theme/themes";
import type { BrandThemeId } from "@/lib/theme/types";

const STORAGE_KEY = "keynetic-brand-theme";

export function isBrandThemeExplorationEnabled(): boolean {
  if (process.env.NODE_ENV === "development") {
    return true;
  }

  return process.env.NEXT_PUBLIC_VERCEL_ENV === "preview";
}

type BrandThemeContextValue = {
  themeId: BrandThemeId;
  setThemeId: (themeId: BrandThemeId) => void;
  explorationEnabled: boolean;
};

const BrandThemeContext =
  createContext<BrandThemeContextValue | null>(null);

function readStoredTheme(): BrandThemeId {
  if (typeof window === "undefined") {
    return DEFAULT_BRAND_THEME_ID;
  }

  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);

    if (isBrandThemeId(stored)) {
      return stored;
    }
  } catch {
    // Ignore storage errors in private browsing.
  }

  return DEFAULT_BRAND_THEME_ID;
}

function applyThemeToDocument(themeId: BrandThemeId) {
  document.documentElement.setAttribute(
    "data-brand-theme",
    themeId
  );
}

export function BrandThemeProvider({
  children,
}: {
  children: ReactNode;
}) {
  const explorationEnabled = isBrandThemeExplorationEnabled();
  const [themeId, setThemeIdState] = useState<BrandThemeId>(
    DEFAULT_BRAND_THEME_ID
  );

  useEffect(() => {
    const resolvedTheme = explorationEnabled
      ? readStoredTheme()
      : DEFAULT_BRAND_THEME_ID;

    setThemeIdState(resolvedTheme);
    applyThemeToDocument(resolvedTheme);
  }, [explorationEnabled]);

  const setThemeId = useCallback(
    (nextThemeId: BrandThemeId) => {
      const resolvedTheme = explorationEnabled
        ? nextThemeId
        : DEFAULT_BRAND_THEME_ID;

      setThemeIdState(resolvedTheme);
      applyThemeToDocument(resolvedTheme);

      if (explorationEnabled) {
        try {
          window.localStorage.setItem(
            STORAGE_KEY,
            resolvedTheme
          );
        } catch {
          // Ignore storage errors.
        }
      }
    },
    [explorationEnabled]
  );

  const value = useMemo(
    () => ({
      themeId,
      setThemeId,
      explorationEnabled,
    }),
    [themeId, setThemeId, explorationEnabled]
  );

  return (
    <BrandThemeContext.Provider value={value}>
      {children}
    </BrandThemeContext.Provider>
  );
}

export function useBrandTheme(): BrandThemeContextValue {
  const context = useContext(BrandThemeContext);

  if (!context) {
    throw new Error(
      "useBrandTheme must be used within BrandThemeProvider"
    );
  }

  return context;
}
