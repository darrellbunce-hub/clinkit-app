# Authentication Security Audit

Pre-launch security review for Keynetic authentication and password controls.

**Date:** 2026-07-17  
**Scope:** Sign-up, login, password reset/change, invitation registration, email verification, session handling, abuse protection.

---

## Part 1 — Auth Entry Points

### Sign-up flows

| Flow | Route | File | Auth API | Password validation (app) |
|---|---|---|---|---|
| Homeowner inline sign-up | `/login` → Create Account | `app/login/page.tsx` | `supabase.auth.signUp` | `validatePasswordForSignUp()` + live checklist |
| Estate Agent sign-up | `/estate-agents/signup` | `app/estate-agents/signup/page.tsx` | `signUp` + `createEstateAgentProfile` | `validateNewPassword()` + live checklist |
| EA branch invitation sign-up | `/estate-agents/signup?token=` | Same as above | Same | Same; redirects to join after verify |
| EA branch join (existing account) | `/estate-agents/join?token=` | `app/estate-agents/join/page.tsx` | `acceptEaBranchInvitation` RPC | N/A (no password) |

There is no separate homeowner invitation sign-up page; homeowners receive property invitations and authenticate separately.

### Password creation / change flows

| Flow | Route | File | Validation |
|---|---|---|---|
| Forgot password | `/forgot-password` | `app/forgot-password/page.tsx` | Email only; generic success message |
| Reset confirm (OTP) | `/auth/confirm?type=recovery` | `app/auth/confirm/route.ts` | Server `verifyOtp`; maps errors safely |
| Choose new password | `/reset-password` | `components/account/ResetPasswordForm.tsx` | `validateNewPassword()` + checklist |
| Change password (signed in) | `/account#security` | `components/account/SecuritySection.tsx` | Re-auth + `validateNewPassword()` + checklist |

### Login / logout

| Flow | Route | File |
|---|---|---|
| Homeowner login | `/login` | `app/login/page.tsx` |
| Estate Agent login | `/estate-agents/login` | `app/estate-agents/login/page.tsx` |
| Logout | Navbar / account UI | `supabase.auth.signOut()` |

Login errors are mapped to a generic **"Invalid email or password."** via `mapAuthSignInError()`.

### Email verification

| Surface | Route | Behaviour |
|---|---|---|
| Post sign-up redirect | `/verify-email` | Shown when `signUp` returns user without session (email confirmation enabled in Supabase) |
| Resend | `/verify-email` | Wired to `supabase.auth.resend({ type: 'signup', email })` with generic messaging |
| Confirm handler | `/auth/confirm` | **Recovery only** (`type=recovery`). Sign-up confirmation links are handled by Supabase default redirect unless extended later. |

Helper: `lib/auth/emailVerification.ts` — `isEmailVerified(user)` checks `email_confirmed_at`.

### Session handling

- Browser client: `lib/supabase.ts` (`createBrowserClient`)
- Server client: `lib/supabase/server.ts` (`createServerClient` + Next.js cookies)
- Middleware: `middleware.ts` refreshes session via `getUser()` on account-gated routes
- Cookies are HTTP-only and managed by `@supabase/ssr` (appropriate for Next.js App Router)

No custom JWT handling. No passwords stored in application state beyond React form fields during submission.

### Custom auth API routes

| Route | Purpose |
|---|---|
| `GET /auth/confirm` | Password recovery OTP verification only |

All other auth operations use Supabase client SDK directly from the browser. No custom password endpoints bypass GoTrue.

### Shared modules

| Module | Responsibility |
|---|---|
| `lib/auth/passwordPolicy.ts` | Policy definition, validation, requirement states, error mapping |
| `lib/auth/authErrors.ts` | Re-exports sign-in/sign-up error mappers |
| `lib/auth/authConfirm.ts` | Recovery OTP error normalization, open-redirect protection |
| `lib/auth/passwordReset.ts` | Recovery redirect URL builder, generic forgot-password copy |
| `lib/auth/routeGuards.ts` | Account-type and onboarding route guards |
| `components/auth/PasswordRequirementsChecklist.tsx` | Live requirement UI |

---

## Audit Questions — Current State

### 1. Minimum password length enforced?

| Layer | Before audit | After implementation |
|---|---|---|
| App (all flows) | 8 chars (EA only); homeowner none | **10 characters** via `lib/auth/passwordPolicy.ts` |
| Supabase Auth | **Requires manual verification** | Recommend **10** in Dashboard (see checklist) |

### 2. Password complexity enforced?

| Layer | State |
|---|---|
| App | **Yes** — uppercase, lowercase, number, special character on all password create/change/reset flows |
| Supabase | **Requires manual verification** — complexity rules depend on Dashboard / plan settings |

### 3. Enforced by Supabase or UI only?

Both layers are required for production:

- **App layer:** Validates before every `signUp` and `updateUser({ password })` call.
- **Supabase layer:** Must mirror policy in Dashboard so direct API/SDK calls cannot bypass UI.

Without Dashboard alignment, a client could call Supabase Auth API with a weak password if project settings allow it.

### 4. Consistent behaviour across flows?

**After this work:** Yes — all password creation/change surfaces use `passwordPolicy.ts` and `PasswordRequirementsChecklist`.

Previously inconsistent (8-char EA only, homeowner none).

### 5. Is email verification required?

**Depends on Supabase project setting** (`Enable email confirmations`). Cannot be determined from repository code.

When enabled, sign-up without session redirects to `/verify-email`.

### 6. Can unverified email access operational functionality?

**Partially.** Unverified users can sign in and access account routes (`/dashboard`, `/account`, `/estate-agents/onboarding`). Live property transaction participation is blocked at middleware and participation RPCs until `email_confirmed_at` is set.

### Email verification transaction gate (implemented)

**Rule:** Account access before verification; no live transaction participation until verified.

| Layer | Enforcement |
|---|---|
| Middleware | `isTransactionParticipationRoute()` → redirect to `/verify-email?reason=transaction_participation` |
| RPCs | `_require_verified_email_for_transaction()` on participation grants |
| UI | `EmailVerificationBanner` on dashboard; friendly RPC error mapping |

**Allowed without verification:** `/dashboard`, `/account`, `/estate-agents/onboarding`, `/verify-email`

**Blocked without verification:** `/start-move`, `/join-chain`, `/claim`, `/my-chains`, `/chain/*`, `/property/*`, `/buyer-ready/*`, `/agent/*`

Migration: `20260714180000_email_verification_transaction_gate.sql`

### 7. Authentication rate limits?

| Surface | Limit |
|---|---|
| Supabase GoTrue (login, sign-up, reset) | Platform defaults — **requires manual verification** in Dashboard |
| Keynetic app auth endpoints | None (no Redis rate limiting on auth) |
| Invitation email sends | 3 per 15 minutes per scope (`lib/communications/invitationSendSecurity.ts`) |

Supabase defaults are generally sufficient for launch; add Redis-backed limits only if abuse is observed.

### 8. Custom endpoints bypassing Supabase Auth?

**No.** `/auth/confirm` delegates to `verifyOtp`. No custom credential verification or password storage.

### 9. CAPTCHA configured?

**Not in code.** Supabase Turnstile/hCaptcha integration is Dashboard-only. **Requires manual verification.**

**Recommendation:** Defer CAPTCHA until post-launch unless Supabase abuse metrics or penetration test findings require it. Forgot-password already uses enumeration-safe messaging.

### 10. User enumeration risks

| Flow | Risk | Mitigation |
|---|---|---|
| Login | Medium (was high) | Generic "Invalid email or password." |
| Sign-up | Medium | Softened duplicate-email message; does not confirm existence definitively |
| Forgot password | Low | Generic success regardless of account existence |
| Invitation preview | Low–Medium | Invalid token returns coded errors (expected for invite links) |

Supabase may still return distinguishable errors in edge cases; Dashboard rate limits reduce brute-force enumeration.

### 11. Supabase errors exposed to users?

| Flow | Before | After |
|---|---|---|
| Login | Raw Supabase message | Generic sign-in message |
| Sign-up | Raw message | Mapped via `mapAuthSignUpError()` |
| Password update | Partial mapping | Descriptive policy message via `mapPasswordUpdateError()` |
| Recovery | Internal codes only | Safe messages via `mapPasswordRecoveryError()` |

### 12. Sessions/cookies appropriate?

**Yes.** Standard `@supabase/ssr` pattern with middleware refresh. Server and browser share cookie session. No client-side password persistence.

---

## Part 4 — Password Reset Security

| Control | Status |
|---|---|
| Reset links expire | Yes — GoTrue OTP expiry (Dashboard: recommend 15 minutes) |
| Single-purpose tokens | Yes — recovery OTP consumed by `verifyOtp` |
| Replay after successful reset | Mitigated — OTP reuse returns error mapped to `reused` / `invalid_or_expired` |
| Invalid/expired links fail safely | Yes — `/auth/confirm` redirects to `/reset-password?error=...` with safe copy |
| Post-reset redirect | Yes — success state with profile-aware continue link |
| Email enumeration on reset | Mitigated — generic forgot-password success message |
| New password policy | Yes — same `validateNewPassword()` as sign-up/change |

Flow: `forgot-password` → email link → `/auth/confirm?type=recovery` → `/reset-password` → `updateUser({ password })`.

---

## Part 5 — Email Verification

### Policy (implemented)

You can create and access your Keynetic account before verification, but you cannot participate in a live property transaction until your email address has been verified.

### Enforcement

- **Middleware:** transaction participation routes redirect unverified users to `/verify-email`
- **Database RPCs:** participation grants return `email_verification_required`
- **Dashboard banner:** prompts verification without blocking account access

### Not gated (by design)

- Account settings, dashboard, EA onboarding, branch team join (`/estate-agents/join`)
- Sending property invitations (existing participants/agents only)

---

## Part 6 — Authentication Abuse Protection

### Assessment

- **Login / sign-up / reset:** Rely on Supabase GoTrue rate limits (verify in Dashboard).
- **Invitation acceptance:** Protected by token entropy + invitation lifecycle RPCs; no dedicated rate limit.
- **Redis rate limiting:** Available (`lib/cache/rateLimit.ts`) but not wired to auth — **not required for launch** unless abuse detected.

### CAPTCHA recommendation

**Enable selectively after launch** if:

- Sign-up spam increases
- Password reset abuse detected
- Supabase Auth logs show credential stuffing

If enabling pre-launch: configure Turnstile in Supabase Dashboard on sign-up and password recovery only.

---

## Part 7 — Leaked Password Protection

Supabase **HaveIBeenPwned leaked password protection** is available on **Pro plan and above** (not on Free tier).

**Action:** Verify project plan in Supabase Dashboard → Authentication → Settings → Password Security.

If on Pro+:

1. Enable **Leaked password protection**
2. Align minimum length and complexity with Keynetic policy

This cannot be enabled via repository code.

---

## Part 8 — Manual Dashboard Checklist

See **`docs/SUPABASE_AUTH_DASHBOARD_CHECKLIST.md`**.

---

## Part 9 — Regression Testing

### Automated

```bash
npx tsx scripts/verify-auth-password-policy.ts
npm run build
```

### Manual checklist (production/staging Supabase)

- [ ] Homeowner sign-up with weak password rejected (UI + Supabase if Dashboard aligned)
- [ ] Homeowner sign-up with strong password accepted
- [ ] EA sign-up policy enforced
- [ ] Invitation-based EA sign-up
- [ ] Login / logout
- [ ] Forgot password generic message
- [ ] Password reset happy path
- [ ] Expired reset link → safe error
- [ ] Invalid reset link → safe error
- [ ] Password change in `/account`
- [ ] Existing accounts with old passwords can still log in (grandfathered until change)
- [ ] No password values in browser console or server logs
- [ ] Verify-email resend

---

## Part 10 — SEC-104 audit (2026-07-25)

**Status:** AUDIT COMPLETE — **SEC-104 OPEN** (not closed). No code changes in audit pass.

Full report: **`docs/SEC-104_AUTHENTICATION_ABUSE_RATE_LIMITING_AUDIT.md`**

| Topic | Conclusion |
|-------|------------|
| Trust boundary | Auth is browser → Supabase direct; Keynetic Upstash cannot authoritatively limit those calls |
| Supabase limits | Email cooldowns, token/verify IP buckets — founder must verify Dashboard values |
| App-layer limits | None on auth; invitation **send** limits are separate (3/15min) |
| Brute force | Per-IP token bucket only; no per-account lockout without Auth Hook |
| Enumeration | Login/forgot/reset largely generic; login “no session” message may hint unverified account |
| CAPTCHA | Defer at launch |
| Recommended option | **Minimum Launch** — Dashboard verification + monitoring |
| Revised severity | SEC-104 **P2**; Production Dashboard verification **P1 gate** |

---

## Implemented Code Changes (this pass)

1. **`lib/auth/passwordPolicy.ts`** — 10-char policy with complexity, requirement states, error mappers
2. **`components/auth/PasswordRequirementsChecklist.tsx`** — shared live validation UI
3. **Updated forms:** login, EA signup, reset password, account security
4. **`lib/auth/authErrors.ts`** — generic sign-in/sign-up error mapping
5. **`lib/auth/emailVerification.ts`** — verification helper + gated-action documentation
6. **`app/verify-email/page.tsx`** — resend verification wired
7. **`scripts/verify-auth-password-policy.ts`** — policy unit regression
8. **Documentation:** this file + Dashboard checklist

---

## Remaining Launch Blockers

| Priority | Item | Owner |
|---|---|---|
| **P0** | Align Supabase Dashboard password policy with app (min 10 + complexity) | Ops / manual |
| **P0** | Confirm `Enable email confirmations` and OTP expiry (15 min recovery) | Ops / manual |
| **P0** | Verify redirect URLs include `/auth/confirm` in Supabase allow-list | Ops / manual |
| ~~**P0**~~ | ~~Decide and implement email verification gating for operational actions~~ | **Done** — see Part 5 |
| **P1** | Enable leaked password protection (if Pro+ plan) | Ops / manual |
| **P1** | Complete Supabase Auth rate-limit + SMTP Dashboard verification on Production (SEC-104) | Ops / manual |
| **P1** | Manual end-to-end auth regression on staging | QA |
| **P2** | CAPTCHA (only if abuse observed or pen-test requires) | Ops |

---

## Keynetic Password Policy (authoritative in code)

- Minimum **10** characters
- At least one **uppercase** letter
- At least one **lowercase** letter
- At least one **number**
- At least one **special character** (non-alphanumeric)

Defined in `lib/auth/passwordPolicy.ts`. Dashboard must match.
