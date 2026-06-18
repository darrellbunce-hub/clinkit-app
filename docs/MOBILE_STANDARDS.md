# Keynetic Mobile Design Standards

Shared tokens for mobile optimisation (Phase 1+).  
Implementation: `components/mobileStandards.ts`

## Typography

| Token | Classes | Use |
|---|---|---|
| `PAGE_TITLE_CLASS` | `text-3xl md:text-4xl lg:text-5xl` | Primary page H1 (dashboard, chain, property, etc.) |
| `PAGE_TITLE_INVERTED_CLASS` | same + `text-white` | H1 on dark backgrounds (landing hero, verify email) |
| `AUTH_TITLE_CLASS` | `text-3xl md:text-4xl lg:text-5xl` | Login, signup, forgot/reset password cards |
| `SECTION_TITLE_CLASS` | `text-2xl md:text-3xl lg:text-4xl` | In-page H2 sections, status panels |
| `MARKETING_SECTION_TITLE_CLASS` | `text-3xl md:text-4xl lg:text-5xl` | Marketing / landing section headings |
| `STAT_VALUE_CLASS` | `text-2xl md:text-3xl lg:text-4xl` | Large numeric stats (chain progress, etc.) |

**Rule:** Do not use bare `text-5xl` or `text-6xl` on page titles without responsive breakpoints.

## Logo

Component: `components/Logo.tsx`

| Prop | Values | When |
|---|---|---|
| `variant` | `"dark"` (default) | Dark headers — white wordmark (`Navbar`, landing footer) |
| `variant` | `"light"` | Light headers — slate wordmark (`EaMarketingShell`, `AgentShell`) |

**Responsive sizing:**

| Breakpoint | Icon | Wordmark | Tagline |
|---|---|---|---|
| Mobile (default) | 48×48 (`w-12`) | `text-2xl` | `text-[10px]` |
| `sm` | 64×64 | `text-3xl` | `text-xs` |
| `lg` | 80×80 | `text-5xl` | `text-base` |

## Card padding

| Token | Classes |
|---|---|
| `CARD_PADDING_CLASS` | `p-6 md:p-8` |

Apply on all major homeowner card surfaces (Phase 3 complete).

## Modals

| Token | Use |
|---|---|
| `MODAL_OVERLAY_CLASS` | Scrollable full-screen overlay |
| `MODAL_PANEL_CLASS` | Panel with `max-h-[90dvh]` + internal scroll |
| `MODAL_ACTIONS_CLASS` | Stacked full-width buttons on mobile |
| `MobileModal` | Wrapper in `components/mobile/MobileLayout.tsx` |

## Phase 3 scope (completed)

- [x] Buyer Ready — `MobilePageNavRow`, `MobileAlertStack`, `MobilePanelHeader`
- [x] Chain page stat panels — `MobilePanelHeader` stack
- [x] `CARD_PADDING_CLASS` on dashboard, chain, buyer-ready, join-chain, start-move, account, auth pages, property
- [x] Completion lifecycle modals — `MobileModal` + scrollable viewport
- [x] Modal tokens in `mobileStandards.ts`

## Phase 4 backlog (not started)

- Agent dashboard table → cards
- Buyer Ready / Property activity timeline row stacking (minor)

## Phase 4A scope (completed)

- [x] Mobile swipe hint above chain visualisation (`MobileChainScrollRegion`)
- [x] Edge fade scroll indicators when content overflows
- [x] Partial next-node visibility via negative margin scroll region
- [x] Keyboard-focusable scroll region with `aria-label`

## Chain scroll (Phase 4A)

| Token | Use |
|---|---|
| `CHAIN_SCROLL_HINT_CLASS` | Mobile-only swipe hint text |
| `CHAIN_SCROLL_REGION_CLASS` | Horizontal scroll container with edge peek |
| `CHAIN_SCROLL_FADE_LEFT_CLASS` / `CHAIN_SCROLL_FADE_RIGHT_CLASS` | Overflow edge fades (mobile) |

## Touch targets

Minimum **44×44px** (WCAG 2.5.5 / Apple HIG).

| Token | Classes | Use |
|---|---|---|
| `TOUCH_TARGET_CLASS` | `min-h-11 min-w-11 inline-flex items-center justify-center` | Generic interactive controls |
| `MENU_BUTTON_CLASS` | 44px menu button + focus ring | Mobile hamburger (`Navbar`) |

**Rules:**

- Primary nav links on mobile: `py-3 min-h-11`
- EA / Agent shell links: `min-h-11 inline-flex items-center px-3`
- Avoid text-only links without padding for primary actions

## Navigation

| Surface | Mobile pattern |
|---|---|
| Homeowner | `Navbar` — hamburger + drawer (`md:hidden` / `hidden md:flex`) |
| Estate agent marketing | Inline links with touch targets (Phase 2: hamburger) |
| Agent product | Inline Account + Logout with touch targets |

## Import example

```tsx
import {
  PAGE_TITLE_CLASS,
  AUTH_TITLE_CLASS,
  MENU_BUTTON_CLASS,
} from "@/components/mobileStandards";
import Logo from "@/components/Logo";

// Light header
<Logo href="/agent" variant="light" />

// Page title
<h1 className={PAGE_TITLE_CLASS}>My Chains</h1>
```

## Phase 1 scope (completed)

- [x] Logo variant system (C1)
- [x] Responsive logo sizing (H4)
- [x] Global responsive page titles (H5)
- [x] Navbar hamburger 44px target (H3)
- [x] EA/Agent nav touch target pass (H3 partial)

## Phase 2 scope (completed)

- [x] C2 My Chains mobile layout (`MobileActionHeader`, stat grid)
- [x] C3 Property page alerts, nav, panel headers (`MobileLayout` components)
- [x] H1 EA marketing hamburger (`LightShellHeader`)
- [x] H2 Agent shell hamburger (`LightShellHeader`)
- [x] Shared mobile layout components (`components/mobile/`)

## Shared layout components

| Component | File | Use |
|---|---|---|
| `MobileActionHeader` | `components/mobile/MobileLayout.tsx` | Title + CTA stacks on mobile |
| `MobilePanelHeader` | same | Content + badge/stat stacks on mobile |
| `MobileAlert` / `MobileAlertStack` | same | Flash messages |
| `MobilePageNavRow` | same | Back / dashboard links |
| `MobileModal` | same | Scrollable dialog shell |
| `MobileChainScrollRegion` | `components/mobile/MobileChainScrollRegion.tsx` | Chain viz horizontal scroll hint + fades |
| `LightShellHeader` | `components/mobile/LightShellHeader.tsx` | EA marketing + agent nav |

## Phase 4 backlog (not started)

- Agent dashboard table → cards
