# Launch Polish Sprint 2 — Authentication Experience Consistency

**Date:** 25 July 2026  
**Scope:** UX consistency only  
**Status:** Complete

---

## Summary

All Keynetic authentication surfaces now share a single design system built from the homeowner login reference. Estate Agent login includes the same informational password requirements checklist as other auth pages. Copy, spacing, inputs, alerts, and buttons are standardised via shared components.

**No authentication logic, password policy, security, Supabase, middleware, redirects, API routes, database, or migration changes were made.**

---

## Tasks completed

| Task | Status |
|------|--------|
| 1 — EA login password checklist | Done |
| 2 — Shared auth component audit | Done |
| 3 — Copy consistency | Done |
| 4 — Password checklist wording | Done (via `passwordPolicy.ts`) |
| 5 — Styling consistency | Done |

---

## Shared components introduced / reused

| Component | Purpose |
|-----------|---------|
| `components/auth/authStyles.ts` | Single source for page shell, card, inputs, buttons, alerts, links |
| `components/auth/AuthPageShell.tsx` | Homeowner-style centred auth layout |
| `components/auth/AuthEmailField.tsx` | Email / Work email field |
| `components/auth/AuthTextField.tsx` | Text and confirm-password fields |
| `components/auth/AuthPasswordFieldWithRequirements.tsx` | Password + live checklist |
| `components/auth/PasswordRequirementsChecklist.tsx` | Requirement labels from `passwordPolicy.ts` |
| `components/auth/AuthErrorAlert.tsx` | Error banner styling |
| `components/auth/AuthSuccessAlert.tsx` | Success banner styling |

`components/account/accountStyles.ts` now re-exports auth styles for account settings compatibility.

---

## Files changed

### Created

- `components/auth/authStyles.ts`
- `components/auth/AuthPageShell.tsx`
- `components/auth/AuthEmailField.tsx`
- `components/auth/AuthTextField.tsx`
- `components/auth/AuthErrorAlert.tsx`
- `components/auth/AuthSuccessAlert.tsx`

### Modified

- `components/auth/AuthPasswordFieldWithRequirements.tsx`
- `components/account/accountStyles.ts`
- `components/account/ResetPasswordForm.tsx`
- `components/account/SecuritySection.tsx`
- `app/login/page.tsx`
- `app/forgot-password/page.tsx`
- `app/reset-password/page.tsx`
- `app/estate-agents/login/page.tsx`
- `app/estate-agents/signup/page.tsx`
- `components/Navbar.tsx` (Create account CTA copy)
- `scripts/verify-auth-password-checklist-surfaces.ts`

---

## Pages updated

| Page | Changes |
|------|---------|
| `/login` | Shared shell, fields, alerts, buttons; “Create account” copy |
| `/estate-agents/login` | **Password checklist added**; shared card/fields/alerts; “Create account” footer link |
| `/estate-agents/signup` | Title “Create account”; shared components; “Work email” |
| `/forgot-password` | Shared shell and field components |
| `/reset-password` | Shared shell (homeowner + EA via same route) |
| `/account` → Security | Shared password field, checklist, alerts, buttons |

---

## Copy standardisation

| Before | After | Where |
|--------|-------|-------|
| Create Account | Create account | Homeowner login, Navbar |
| Sign up | Create account | EA login footer |
| Estate Agent Sign Up | Create account | EA signup title |
| Back to login | Back to Log in | Forgot / reset password links |

Labels:

- Homeowner: **Email**
- Estate Agent: **Work email**
- All primary auth actions: **Log in** / **Create account**

---

## Password checklist (identical everywhere)

Sourced from `lib/auth/passwordPolicy.ts` via `PasswordRequirementsChecklist`:

- Minimum 10 characters
- Uppercase letter
- Lowercase letter
- Number
- Symbol

Shown on: homeowner login (informational), EA login (informational), EA signup, reset password, change password.

---

## Styling standard

All auth cards use:

- White card (`AUTH_CARD_CLASS`)
- Light grey border (`border-surface-card-border`)
- Charcoal heading (`AUTH_TITLE_CLASS` / `text-text-charcoal`)
- Teal focus rings on inputs (`focus:ring-brand-primary/25`)
- Consistent input height (`rounded-2xl px-4 py-3`)
- Consistent button height (`py-4 rounded-2xl`)
- Shared error/success alert classes

Estate Agent auth pages retain `EaMarketingShell` outer navigation but use the same inner card and form components as the homeowner reference.

---

## Validation results

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` | Pass |
| `npm run build` | Pass |
| `npx tsx scripts/verify-auth-password-policy.ts` | 21/21 pass |
| `npx tsx scripts/verify-auth-password-checklist-surfaces.ts` | Pass |
| `npx tsx scripts/verify-login-redirect.ts` | 3/3 pass |

---

## Confirmations

- No authentication behaviour changed
- No password policy changed
- No security changes
- No Supabase changes
- No migrations
- UX consistency only

---

## Remaining visual differences (intentional)

| Area | Notes |
|------|-------|
| EA auth outer shell | Uses `EaMarketingShell` + marketing nav (appropriate for EA entry) |
| EA signup extra fields | Contact name field — EA-specific, same styling tokens |
| Marketing pages | EA landing CTAs still use marketing copy (“Register your branch”) — outside auth page scope |
| Onboarding | Post-signup branch setup — not an authentication surface |

No functional differences remain between auth password checklists.
