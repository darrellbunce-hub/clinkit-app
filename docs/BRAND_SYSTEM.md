# Keynetic Brand System

Canonical visual identity for Keynetic product UI, emails, marketing, and administration surfaces.

## Primary colours

| Token | Hex | Usage |
|-------|-----|--------|
| Teal | `#0E7C7B` | Primary product colour — buttons, links, headers, operational emphasis |
| Mimosa | `#FFC62F` | Accent — logo node, attention highlights, sparing emphasis |
| White | `#FFFFFF` | Cards, primary surfaces |

## Secondary colours

| Token | Hex | Usage |
|-------|-----|--------|
| Mist | `#E6F3F2` | Soft teal-tinted backgrounds, info panels |
| Stone | `#F3F5F6` | Page background, subtle panels |
| Charcoal | `#1F2933` | Primary text |

## Status colours

| State | Usage |
|-------|--------|
| Success green | Healthy, progressing normally, positive empty states |
| Warning amber | Attention required, invitation active |
| Critical red | Immediate action, expired invitations, blocked properties |
| Unknown grey | Deferred / neutral states |

All status colours are exposed as CSS variables (`--status-*`) and Tailwind utilities (`text-status-success`, `bg-status-warning-soft`, etc.).

## Typography

- **Headings:** Poppins (Medium / Semibold / Bold) via `--font-heading`
- **Body:** Inter Regular via `--font-body`

Use `FONT_HEADING_CLASS` for section titles and operational headlines.

## Button hierarchy

| Variant | Style |
|---------|--------|
| Primary | Teal filled (`BTN_PRIMARY_SM_CLASS`) |
| Secondary | Teal outline (`BTN_SECONDARY_OUTLINE_SM_CLASS`) |
| Success | Green outline (`BTN_SUCCESS_SM_CLASS`) |
| Danger | Red outline (`BTN_DANGER_SM_CLASS`) |

Mimosa is not used for default buttons — reserve for accent moments only.

## Card hierarchy

1. **Hero panel** — operational health (`WORKSPACE_HERO_PANEL_CLASS`)
2. **Standard card** — property rows (`WORKSPACE_CARD_CLASS`)
3. **Nested KPI tiles** — secondary metrics inside hero footer

Cards use `rounded-2xl`, subtle ring border, white surface. Avoid heavy coloured fills.

## Badge hierarchy

- **Health / chain status** — semantic soft background + text (`getHealthStatusClasses`)
- **Homeowner connection** — workspace homeowner badges
- **Operational reason** — banner pills on Requires Action cards

## Spacing principles

- Section gap: `space-y-10` on command centre
- Card padding: `p-5` standard, `p-8` hero
- Consistent `rounded-xl` / `rounded-2xl` radius
- Reduce label noise — state before address on managed cards

## Logo usage

### Standard logo
- White background
- Teal mark + wordmark (`KeyneticLogoMark` variant `standard`)
- Mimosa node retained on mark

### Reversed logo
- Transparent background
- White mark + wordmark (`KeyneticLogoMark` variant `reversed`)
- Mimosa node retained
- Use on teal headers, footers, emails (`Logo` variant `reversed` or `dark`)

Implementation: `components/brand/KeyneticLogoMark.tsx`, `components/Logo.tsx`.

## Design tokens

CSS variables live in `app/globals.css` under `:root` / `[data-brand-theme="keynetic"]`.

TypeScript references: `lib/theme/brandSystem.ts`, `lib/theme/themeTokens.ts`.

Icons: `lib/theme/workspaceIcons.tsx` (Lucide, consistent sizing).
