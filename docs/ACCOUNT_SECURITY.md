# Keynetic Account & Security

Production-readiness documentation for authentication, account settings, and password recovery.

---

## Part 1 — Auth Architecture Audit

### Login flow

| Audience | Route | Implementation |
|---|---|---|
| Homeowner | `/login` | `app/login/page.tsx` — `signInWithPassword`, hard redirect to `/dashboard` |
| Estate agent | `/estate-agents/login` | `app/estate-agents/login/page.tsx` — profile-aware redirect via `resolvePostLoginRedirect()` |

Session is established by Supabase Auth and persisted in HTTP-only cookies via `@supabase/ssr`.

### Registration flow

| Audience | Route | Notes |
|---|---|---|
| Homeowner | `/login` (inline Create Account) | `signUp` + `profiles.insert({ role: "homeowner" })`; skips email verification redirect |
| Estate agent | `/estate-agents/signup` | Business email validation, min 8-char password, `createEstateAgentProfile()`, redirects to `/verify-email` when no session |
| Verify email | `/verify-email` | Informational only; resend button not wired |

`/start-move` is chain onboarding for **authenticated** homeowners, not registration.

### Supabase auth usage

| Client | File | Usage |
|---|---|---|
| Browser | `lib/supabase.ts` | `createBrowserClient` — all client pages |
| Server | `lib/supabase/server.ts` | `createServerSupabaseClient` — RSC layouts, auth confirm route |
| Middleware | `middleware.ts` | `createServerClient` with cookie read/write for session refresh |

No dedicated `/auth/callback` code-exchange route. Password recovery uses **`/auth/confirm`** with `verifyOtp` (PKCE / SSR pattern per Supabase docs).

### Session handling

- Cookies shared between browser, middleware, and server client.
- `ChainContext` loads participant data after `getUser()` on mount.
- `Navbar` checks auth once on mount; no `onAuthStateChange` subscription.
- Middleware calls `getUser()` on account-gated routes and loads `profiles` for account-type routing.

### Middleware protection

Matcher (`middleware.ts`):

```
/account/*, /dashboard/*, /start-move/*, /join-chain/*, /my-chains/*,
/chain/*, /property/*, /buyer-ready/*, /agent/*, /estate-agents/onboarding/*
```

| Route class | Guard |
|---|---|
| `/account` | Authenticated only (any account type) |
| Homeowner prefixes | `requireHomeowner()` |
| EA onboarding | `requireEstateAgentOnboarding()` |
| EA product | `requireCompletedEstateAgentOnboarding()` |

Server layouts additionally enforce chain/property participant access (404 on failure).

### Password handling (before this work)

- No password reset or change UI.
- EA signup: min 8 characters + confirm match.
- Homeowner signup: no strength rules.

### Existing account pages (before this work)

None. Post-auth navigation was Dashboard / Agent Home + Logout only.

### Profile data model

**`public.profiles`** (extended in `20260610150000_phase1_ea_foundation_schema.sql`):

| Column | Purpose |
|---|---|
| `id` | PK = `auth.users.id` |
| `role` | Legacy string (`homeowner` on inline signup) |
| `account_type` | `homeowner` \| `estate_agent` \| `solicitor` — routing authority |
| `contact_name` | Display name (EA signup) |
| `onboarding_completed_at` | EA onboarding gate |
| `email_domain` | Parsed from business email |

RLS: own-row SELECT/INSERT/UPDATE only (`20260610160000`).

Email lives on `auth.users`; not duplicated in `profiles`.

---

## Part 2–6 — Implementation Summary

### Routes added

| Route | Access | Purpose |
|---|---|---|
| `/account` | Authenticated (middleware) | Account Settings — Profile, Security, Legal & Privacy |
| `/forgot-password` | Public | Request password reset email |
| `/reset-password` | Public (requires recovery session) | Set new password after email link |
| `/auth/confirm` | Public (route handler) | OTP/token exchange for recovery links |

### Navigation

**Homeowner (`Navbar`):** Dashboard → Account Settings → Logout

**Estate agent (`AgentShell`):** Account Settings → Logout

### Code path — password change (signed in)

```
/account → SecuritySection
  → signInWithPassword (verify current password)
  → updateUser({ password })
```

### Code path — password recovery

```
/login or /estate-agents/login → Forgot password?
  → /forgot-password
  → resetPasswordForEmail(email, { redirectTo: /auth/confirm?next=/reset-password })
  → Email link → /auth/confirm?token_hash=…&type=recovery&next=/reset-password
  → verifyOtp → session cookie
  → /reset-password → updateUser({ password })
  → Continue → dashboard or agent home
```

---

## Part 5 — Password Reset Security Review

### 1. How long are reset links currently valid?

**Default: 3600 seconds (1 hour)** unless changed in the Supabase project.

This is controlled by GoTrue **`otp_expiry`** (Dashboard: **Authentication → Providers → Email → Email OTP Expiration**). It applies to password recovery OTPs as well as magic links.

There is no `supabase/config.toml` in this repository; hosted project settings apply.

### 2. Can expiry be configured?

**Yes.**

- Dashboard: Authentication → Providers → Email → **Email OTP Expiration** (seconds).
- Self-hosted / CLI: `[auth.email] otp_expiry = <seconds>` in `config.toml`.
- Management API: `PATCH /v1/projects/{ref}/config/auth` with `{ "mailer_otp_expiration": N }`.

**Important:** Auth settings are **not** stored in SQL migrations. CLI environment sync can reset dashboard values to defaults — document and enforce via config or deployment script.

Maximum allowed by Supabase: **86400 seconds (24 hours)** — values above this are rejected to limit brute-force windows.

### 3. Are reset links single-use?

**Yes, in practice.**

- Recovery uses a one-time OTP / token hash.
- After successful `verifyOtp` + `updateUser({ password })`, the recovery token cannot be reused.
- A second attempt returns errors such as “Email link is invalid or has expired”.
- The application handles this on `/reset-password?error=invalid_or_expired`.

### 4. Should Keynetic target 15 / 30 / 60 minutes?

For a property transaction platform, **prefer shorter windows**:

| Option | Assessment |
|---|---|
| **15 minutes** | **Recommended for production.** Minimises exposure if email is compromised. Sufficient for user to open email and reset. |
| 30 minutes | Acceptable compromise if support burden from expired links is a concern. |
| 60 minutes | Current default; acceptable for dev/staging only. |

### 5. Is application-side validation required?

**Yes — defence in depth.**

Supabase enforces expiry and single-use server-side. The application must still:

- Exchange tokens only via server route (`/auth/confirm`) — implemented.
- Never reveal whether an email exists on forgot-password — implemented (generic success message).
- Validate password strength and confirmation — implemented (min 8 chars, match, different from current when changing in-app).
- Handle invalid/expired/reused tokens with clear recovery paths — implemented.
- Require current password for in-app changes — implemented via re-authentication.

### Recommended production configuration

```text
Email OTP Expiration (otp_expiry):     900   (15 minutes)
Secure password change:                true  (require recent login for updateUser)
Enable email confirmations:            true
Redirect URLs allow-list:              https://<production-domain>/auth/confirm
                                       https://<production-domain>/reset-password
Rate limit (max_frequency):            60s   (default — prevents reset spam)
```

Update the **Reset password** email template to PKCE format (see Supabase docs):

```html
<a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/reset-password">
  Reset password
</a>
```

---

## Part 7 — Future Security Roadmap (launch priority)

| Priority | Item | Rationale |
|---|---|---|
| **P0 — Launch** | Email verification enforcement on homeowner signup | Currently skips `/verify-email`; unverified accounts can sign in if confirmations disabled |
| **P0 — Launch** | Configure 15-minute OTP expiry + redirect URL allow-list | Password recovery security |
| **P0 — Launch** | Enable `secure_password_change` in Supabase | Prevents session-only password changes without re-auth |
| **P1 — Post-launch** | Email verification resend on `/verify-email` | Complete signup UX |
| **P1 — Post-launch** | Session list + device revocation | Supabase does not expose full session management UI; consider custom session tracking or periodic re-auth for sensitive actions |
| **P2 — Growth** | TOTP MFA (Supabase supports MFA) | High-value for EA accounts first |
| **P2 — Growth** | Account deletion workflow | GDPR / user trust; Legal section placeholder ready |
| **P3 — Later** | WebAuthn / passkeys | Convenience after MFA baseline |
| **P3 — Later** | Solicitor account type activation | Routing exists; product not built |

---

## Supabase configuration required

Before password recovery works end-to-end:

1. **Site URL** — set to production origin (e.g. `https://app.keynetic.co.uk`).
2. **Redirect URLs** — add:
   - `https://<domain>/auth/confirm`
   - `http://localhost:3000/auth/confirm` (dev)
3. **Email template** — update “Reset password” to use `token_hash` + `/auth/confirm` (PKCE/SSR pattern).
4. **Email OTP Expiration** — set to **900** (15 minutes) for production.
5. **SMTP** — configure custom SMTP for production deliverability (Supabase default rate limits apply on free tier).

---

## Files changed

### New

- `app/account/page.tsx`
- `app/forgot-password/page.tsx`
- `app/reset-password/page.tsx`
- `app/auth/confirm/route.ts`
- `components/account/AccountNav.tsx`
- `components/account/ProfileSection.tsx`
- `components/account/SecuritySection.tsx`
- `components/account/LegalPrivacySection.tsx`
- `components/account/ResetPasswordForm.tsx`
- `components/account/accountStyles.ts`
- `lib/auth/passwordPolicy.ts`
- `lib/auth/passwordReset.ts`
- `lib/auth/accountDisplay.ts`
- `docs/ACCOUNT_SECURITY.md`

### Modified

- `lib/auth/routes.ts` — new routes, `/account` gating
- `lib/auth/routeGuards.ts` — account settings allow all authenticated types
- `middleware.ts` — `/account` matcher
- `app/login/page.tsx` — Forgot password link
- `app/estate-agents/login/page.tsx` — Forgot password link
- `components/Navbar.tsx` — Account Settings link
- `components/agent/AgentShell.tsx` — Account Settings link

---

## Testing checklist

### Account settings

- [ ] Signed-in homeowner can open `/account` from navbar
- [ ] Profile shows name, email, account type (read-only)
- [ ] EA user sees Agent shell + Account Settings link
- [ ] Unauthenticated `/account` redirects to login

### In-app password change

- [ ] Wrong current password shows error
- [ ] New password < 8 chars rejected
- [ ] Mismatch on confirm rejected
- [ ] Same as current password rejected
- [ ] Success message on valid change
- [ ] Can sign in with new password after change

### Password recovery

- [ ] `/login` → Forgot password → `/forgot-password`
- [ ] Submit email shows generic success (no email enumeration)
- [ ] Reset email received (requires Supabase template + SMTP)
- [ ] Link lands on `/auth/confirm` → `/reset-password` with session
- [ ] Valid new password updates and Continue redirects correctly
- [ ] Expired link shows error + request new link
- [ ] Reused link shows error
- [ ] Direct visit to `/reset-password` without session shows error

### Middleware

- [ ] Homeowner can access `/account`
- [ ] EA can access `/account`
- [ ] EA cannot access `/dashboard` (unchanged)

---

## Launch recommendations

1. Apply Supabase auth configuration (redirect URLs, email template, 15-minute OTP expiry) **before** enabling forgot-password in production marketing.
2. Wire homeowner signup to `/verify-email` when email confirmations are enabled.
3. Enable `secure_password_change` in Supabase Auth settings.
4. Add custom SMTP before launch to avoid reset emails landing in spam.
5. Monitor GoTrue logs for repeated reset attempts (potential abuse).
