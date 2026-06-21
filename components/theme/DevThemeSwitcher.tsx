"use client";

import { BRAND_THEME_LIST } from "@/lib/theme/themes";
import { useBrandTheme } from "@/context/BrandThemeContext";

export function DevThemeSwitcher() {
  const { themeId, setThemeId, explorationEnabled } =
    useBrandTheme();

  if (!explorationEnabled) {
    return null;
  }

  return (
    <div
      className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white/95 p-3 shadow-xl backdrop-blur-sm max-w-[220px]"
      aria-label="Development theme switcher"
    >
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 px-1">
        Brand theme (dev)
      </p>

      <div className="flex flex-col gap-1">
        {BRAND_THEME_LIST.map((theme) => {
          const isActive = themeId === theme.id;

          return (
            <button
              key={theme.id}
              type="button"
              onClick={() => setThemeId(theme.id)}
              className={`
                flex items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-medium transition
                ${
                  isActive
                    ? "bg-slate-900 text-white"
                    : "text-slate-700 hover:bg-slate-100"
                }
              `}
            >
              <span
                className="inline-flex h-4 w-4 shrink-0 rounded-full border border-white/30"
                style={{
                  background: `linear-gradient(135deg, ${theme.primary} 50%, ${theme.secondary} 50%)`,
                }}
                aria-hidden
              />
              {theme.label}
            </button>
          );
        })}
      </div>

      <a
        href="/branding-review"
        className="text-xs font-semibold text-brand-link hover:text-brand-link-hover px-1 pt-1"
      >
        Open branding review →
      </a>
    </div>
  );
}
