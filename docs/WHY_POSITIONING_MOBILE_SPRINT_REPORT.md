# Keynetic — WHY Positioning + Mobile Responsiveness Sprint Report

**Date:** July 2026

## Summary

Public website messaging restructured around WHY → WHAT, new `/about` page added, hero illustration contrast improved, and authenticated dashboard mobile overflow fixed.

---

## 1. Root cause of mobile horizontal overflow

**Primary cause:** `/dashboard` chain card headers used a rigid `flex items-start justify-between` row with a `shrink-0` status pill beside long chain titles and access codes. On narrow viewports the pill could not compress, and CSS grid items defaulted to `min-width: auto`, letting cards exceed the viewport width.

**Contributing factors:** Property list rows without `break-words`, access codes without wrapping on dashboard, and logo lockup `shrink-0` in the navbar reducing available header space.

`/my-chains` had already received Phase 2 mobile work; minor hardening applied (`min-w-0`, `overflow-x-clip`).

---

## 2. Components/files responsible

| File | Issue |
|------|-------|
| `app/dashboard/page.tsx` | Non-stacking card header, missing `min-w-0` on grid/card |
| `app/my-chains/page.tsx` | Minor — card grid shrink |
| `components/Navbar.tsx` | Logo could not shrink in narrow header |

---

## 3. Responsive fix

- Replaced dashboard card header with `MobilePanelHeader` (stacks badge below title on mobile)
- Added `min-w-0` to dashboard/my-chains containers, grids, and cards
- Added `break-words` to chain titles, access codes, and property meta
- Added `overflow-x-clip` on authenticated `main` shells
- Navbar logo wrapped in `min-w-0 flex-1`; header `w-full`

---

## 4. Mobile widths tested

Static verification + layout review at: **320px, 375px, 390px, 430px, 768px**, desktop.

---

## 5. Homepage section order

| Previous | New |
|----------|-----|
| Hero (feature-led) | **1. WHY Hero** |
| How Keynetic Works | **2. Evidence + key insight** |
| Homeowner value | **3. WHAT — Your Property Chain. One Shared View.** |
| Partial chain | **4. HOW Keynetic Works** |
| Estate agents | Partial chain (retained) |
| Features | Features (retained, after problem established) |
| Benefit strip | **6. Homeowner value** |
| FAQ | **7. Estate agent value** |
| Final CTA | **8. Trust / positioning** |
| Footer | Benefit strip · FAQ · Final CTA · Footer |

---

## 6. Final hero copy

**Eyebrow:** Clarity through every move

**Headline:** Moving home will always have uncertainty. Being kept in the dark shouldn't be part of it.

**Body:** Buying or selling… surprisingly difficult. Keynetic gives… clearer view… without claiming to remove every delay or replace property professionals.

**CTAs:** Start Your Move · Join Existing Chain · **Free for homeowners.**

---

## 7. Evidence/stat copy + sources

| Stat | Copy |
|------|------|
| **120 days** | Average time from offer accepted to completion, per UK Government June 2026 roadmap |
| **1 in 3** | Approximately one in three transactions falls through (same source) |
| **£400m** | Government estimate of annual wasted costs associated with failed transactions |

**Source:** [Home buying and selling reform roadmap](https://www.gov.uk/government/consultations/home-buying-and-selling-reform/outcome/home-buying-and-selling-reform-roadmap) (MHCLG, June 2026). Attribution states Keynetic is not government endorsed.

**Key insight:** *"The problem isn't that people expect their house move to be instant. They expect to know what's happening."*

---

## 8. Homeowner proposition

**Your home. Your money. Your move.** — You deserve to understand what's happening.

Keynetic does not eliminate delays; it provides visibility into where the move stands, what's changed, and chain progress.

**More visibility. Less uncertainty.** · **Free for homeowners.**

---

## 9. Estate agent proposition

**Your clients want answers. You want to give them answers.**

Operational problem → shared branch view → **Less chasing. More knowing.**

---

## 10. £129/month / £4.30/day presentation

- **Value frame:** "A clearer view of every chain. Around £4.30 a day."
- **Transparent monthly:** **£129/month per branch**
- Founding branch pricing (£79/month on EA landing) referenced, not removed

---

## 11. `/about` structure

1. Hero — Why Keynetic?
2. Why we exist
3. Evidence (shared component)
4. The problem (roadmap context, no endorsement)
5. What we believe (five principles + clarity principle)
6. What Keynetic isn't
7. CTAs — Start Your Move · Estate agent overview · Join Existing Chain

---

## 12. Navigation changes

- Public desktop + mobile nav: **Why Keynetic?** → `/about`
- Footer link added
- Authenticated nav unchanged (no clutter)
- `ROUTES.about` + `PUBLIC_EXACT_PATHS` updated

---

## 13. Hero illustration contrast changes

New `HeroChainIllustration` component:
- White/mimosa progress bars (not teal-on-teal)
- Solid mimosa 95% badge with charcoal text
- White icon surfaces with teal icons
- Pending row uses white/35 track and white/15 nodes
- Explanatory text `text-white/80`

---

## 14. Accessibility changes

- Logical H1 → H2 hierarchy preserved
- Evidence source is a real link with `rel="noopener noreferrer"`
- `aria-labelledby` on evidence/trust sections
- Decorative SVG/illustration elements `aria-hidden`
- Navbar menu `aria-expanded` retained
- Focus-visible classes unchanged on menu button

---

## 15. Files changed

- `app/page.tsx`
- `app/about/page.tsx` (new)
- `app/dashboard/page.tsx`
- `app/my-chains/page.tsx`
- `components/Navbar.tsx`
- `components/marketing/EvidenceSection.tsx` (new)
- `components/marketing/TrustPositioningSection.tsx` (new)
- `components/marketing/HeroChainIllustration.tsx` (new)
- `lib/marketing/homeBuyingEvidence.ts` (new)
- `lib/marketing/eaPricing.ts` (new)
- `lib/auth/routes.ts`
- `lib/theme/themeTokens.ts`
- `scripts/verify-marketing-why-positioning.ts` (new)

---

## 16–18. Validation

Run:

```bash
npx tsc --noEmit
npm run build
npx tsx scripts/verify-marketing-why-positioning.ts
npx tsx scripts/verify-launch-stage3-legal.ts
npx tsx scripts/verify-legal-acceptance-signup.ts
```

---

## 19–20. Boundaries confirmed

- No chain business logic, auth, database, RLS, RPC, or Supabase config changes
- No Production modifications
- EA founding £79 pricing on `EaLandingPage.tsx` preserved

---

## 21. Remaining launch concerns

- £129/month on homepage vs FD-007 £99 standard direction — sprint brief applied; founder may wish to align docs before launch comms
- Evidence stats should receive final legal/comms sign-off against gov.uk wording
- Manual device QA on real iOS/Android browsers recommended for overflow and hero contrast
