# Launch Polish Sprint 1 — Implementation Report

**Date:** 25 July 2026  
**Scope:** UI / UX polish only  
**Status:** Complete

---

## Summary

This sprint applied the approved production Keynetic visual system, removed development branding tooling, standardised auth copy (“Log in”, “Work email”), improved operational feedback placement and wording, replaced the duplicate-property browser dialog with a Keynetic modal, and eliminated transient “Property not found” / empty-dashboard flashes using `participantDataReady` from `ChainContext`.

**No business logic, database, migration, RLS, RPC, authentication, permission, or security architecture changes were made.**

---

## Tasks completed

| # | Task | Status |
|---|------|--------|
| 1 | Remove dev branding / theme tooling | Done |
| 2 | Remove dead “Keynetic Agent” nav item | Done |
| 3 | Global production visual system (Option A) | Done |
| 4 | Estate Agent password requirement wording | Done |
| 5 | Section-scoped success/error banners | Done |
| 6 | Friendlier “already recorded” wording | Done |
| 7 | Duplicate property Keynetic modal | Done |
| 8 | “Log in” / “Work email” standardisation | Done |
| 9 | `participantDataReady` loading state | Done |
| 10 | Access code review (analysis only) | Done — see below |
| 11 | Flash / flicker audit | Done |

---

## Files changed

### Created

| File | Purpose |
|------|---------|
| `components/loading/ParticipantDataLoadingState.tsx` | Reusable full-page loading shell |
| `components/onboarding/DuplicatePropertyDialog.tsx` | Keynetic modal for duplicate property |

### Deleted

| File | Purpose |
|------|---------|
| `app/branding-review/page.tsx` | Dev branding review route |
| `components/theme/DevThemeSwitcher.tsx` | Runtime theme switcher |
| `components/theme/BrandThemeScope.tsx` | Scoped theme wrapper |
| `components/theme/BrandingReviewShowcase.tsx` | Branding showcase |
| `context/BrandThemeContext.tsx` | Runtime theme context |

### Modified

| Area | Files |
|------|-------|
| Theme / tokens | `app/globals.css`, `lib/theme/types.ts`, `lib/theme/themes.ts`, `lib/theme/themeTokens.ts`, `components/theme/AppThemeShell.tsx` |
| Auth copy | `app/login/page.tsx`, `app/estate-agents/login/page.tsx`, `app/estate-agents/signup/page.tsx`, `app/estate-agents/onboarding/page.tsx`, `app/estate-agents/join/page.tsx`, `app/join-chain/page.tsx`, `components/Navbar.tsx`, `components/estate-agents/EaLandingPage.tsx`, `components/estate-agents/useEaMarketingNavLinks.ts` |
| Password UX | `lib/auth/passwordPolicy.ts` |
| Participant loading | `context/ChainContext.tsx` |
| Operational feedback | `lib/operationalPresentation.ts`, `app/property/[propertyId]/page.tsx`, `app/buyer-ready/[chainId]/page.tsx` |
| Duplicate property | `app/start-move/page.tsx` |
| Loading / flicker | `app/dashboard/page.tsx`, `app/my-chains/page.tsx`, `app/chain/[chainId]/page.tsx` |
| Agent shell / command centre | `components/agent/AgentShell.tsx`, `components/agent/commandCentre/*.tsx` |

---

## Components changed

- `ParticipantDataLoadingState` — new reusable loading shell
- `DuplicatePropertyDialog` — new accessible modal
- `AppThemeShell` — pass-through only (production branding fixed in CSS)
- `MobileAlertStack` / `MobileAlert` — used inline above triggering sections (property & buyer-ready pages)
- Command centre panels — white card surfaces instead of mist-tinted panels

---

## Screens affected

| Screen | Changes |
|--------|---------|
| Global nav | “Log in” link (desktop + mobile) |
| `/login` | Title and button → “Log in” |
| `/estate-agents/login` | “Log in”, “Work email” |
| `/estate-agents/signup`, `/onboarding` | “Work email” |
| `/estate-agents/join` | “Log in” CTA |
| EA marketing / nav | “Log in” CTAs |
| `/dashboard`, `/my-chains`, `/chain/[id]` | Loading gate before empty states |
| `/property/[id]`, `/buyer-ready/[id]` | Loading gate; section-scoped alerts; friendlier duplicate messages |
| `/start-move` | Duplicate property modal |
| Agent command centre | White card panels |
| All themed pages | White page/card surfaces via CSS tokens |

---

## Regression risk

| Risk | Level | Notes |
|------|-------|-------|
| Visual regression | Low | Token-level CSS changes; manual spot-check recommended on dashboard, property, buyer-ready, EA login |
| Alert placement | Low | Same messages/timing; only DOM position changed |
| Loading gate | Low | Uses existing `participantDataReady` flag; no new data fetches |
| Duplicate property flow | Low | Same redirect/cancel behaviour; modal replaces `window.confirm` |
| Removed dev routes | None | `/branding-review` was dev-only; not linked in production nav |

---

## Confirmations

- No business logic changes
- No security control weakening
- No database changes
- No migration changes
- No authentication flow changes
- No Production deployment changes

---

## Task 10 — Access code review (analysis only)

### Generators

| Origin | Location | Format | Example |
|--------|----------|--------|---------|
| Homeowner (Start Move) | `app/start-move/page.tsx` → `generateAccessCode()` | `KN-XXX-XXX` (prefix + hyphen grouping) | `KN-A2B-C3D` |
| Estate Agent (Originate) | `lib/estateAgent/originateOperationalProperty.ts` → `generateOperationalAccessCode()` | 7 characters, no prefix | `A2BC3DE` |

### Shared vs separate

They are **separate functions** with **duplicated charset logic** but **different output formatting**. They do **not** share a single module.

### Character set

Both use:

```
ABCDEFGHJKLMNPQRSTUVWXYZ23456789
```

(32 characters — excludes `I`, `O`, `0`, `1` for readability.)

### Entropy

| Generator | Random symbols | Entropy (log₂) |
|-----------|----------------|----------------|
| Homeowner | 6 | ~30 bits (32⁶ ≈ 1.1×10⁹) |
| Estate Agent | 7 | ~35 bits (32⁷ ≈ 3.4×10¹⁰) |

Both use `Math.random()` (not `crypto.getRandomValues`). Collision handling retries on `duplicate_access_code` from the database unique constraint.

### Collision probability

Practically negligible at current scale given DB uniqueness enforcement and retry loops. Global birthday-bound collision risk remains low until chain volume reaches very large numbers; neither format is structurally weak for launch scale.

### Case sensitivity

Generated codes are **uppercase only**. Database lookup uses exact match (`trim` only, no normalisation to uppercase in RPCs). User-entered lowercase codes **will not match** unless the UI normalises input (join-chain and originate forms currently pass input as typed).

### Brute-force resistance

Join/create flows require an **authenticated session** before RPCs accept an access code. There is **no dedicated app-layer rate limit** on access-code attempts; reliance is on Supabase Auth session requirements and provider limits. Codes are not short enough to be trivially guessed at scale, but unified monitoring of failed join attempts is advisable post-launch.

### Readability over the phone

| Format | Phone-friendly? |
|--------|-----------------|
| `KN-XXX-XXX` | **Yes** — grouped, branded prefix aids dictation |
| 7-char ungrouped | **Moderate** — no separators; harder to read aloud |

### Recommendation

**Recommend unifying formats before launch** by extracting a shared generator and adopting the homeowner `KN-XXX-XXX` pattern for estate-agent origination as well. Rationale:

1. Consistent participant experience when sharing codes
2. Better phone readability
3. Single charset/entropy policy to maintain
4. EA codes still have adequate entropy at 6 grouped symbols; if higher margin is desired, extend to `KN-XXXX-XXXX` (8 symbols) for both paths

**No code changes were made** for this recommendation.

---

## Task 11 — Flash / flicker audit

| Issue | Fix |
|-------|-----|
| “Property not found” flash before data load | Gated on `authLoading` + `participantDataReady` (`/property/[id]`, `/buyer-ready/[id]`) |
| Empty dashboard / my-chains flash | Same gate on `/dashboard`, `/my-chains` |
| Empty chain view flash | Same gate on `/chain/[id]` |
| Chain access code showing “Loading…” after load | Resolved by participant gate (chain data present before render) |

---

## Validation

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` | Pass |
| `npm run build` | Pass |
| `npx tsx scripts/verify-auth-password-policy.ts` | 21/21 pass |
| `npx tsx scripts/verify-login-redirect.ts` | 3/3 pass |
| `npx tsx scripts/verify-participant-data-gating.ts` | Pass |

---

## Manual test checklist (recommended)

- [ ] `/login` — title and button read “Log in”
- [ ] `/estate-agents/login` — “Log in”, “Work email”
- [ ] `/dashboard` — no empty-state flash on hard refresh while signed in
- [ ] `/property/[id]` — loading shell, then content; “not found” only when genuinely missing
- [ ] Property status/update — alerts appear above the relevant section
- [ ] `/start-move` duplicate address — modal appears; Join/Cancel behave as before
- [ ] Agent command centre — white cards, teal primary actions
