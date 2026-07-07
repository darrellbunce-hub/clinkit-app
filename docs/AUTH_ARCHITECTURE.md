# Keynetic Authentication Architecture

**Status:** Canonical — Phase 1 (password recovery) implemented  
**Last updated:** 7 July 2026

This document is the single source of truth for Keynetic authentication design. For account settings UI and launch checklists, see also `docs/ACCOUNT_SECURITY.md`.

---

## Canonical model: TokenHash + server `verifyOtp()`

Keynetic uses **Supabase Auth** with **`@supabase/ssr`** cookie sessions. Email-based authentication exchanges happen on the **server** via **`verifyOtp({ token_hash, type })`**.

We **do not** use `{{ .ConfirmationURL }}` for application email links.

We **do not** use `exchangeCodeForSession()` for email flows.

### Why TokenHash (and not ConfirmationURL)

| Topic | TokenHash + `verifyOtp()` | `ConfirmationURL` + `exchangeCodeForSession()` |
|-------|---------------------------|------------------------------------------------|
| SSR cookie write | Server route calls `verifyOtp`; `@supabase/ssr` sets cookies | Requires separate code-exchange callback |
| Email prefetch (Safe Links, etc.) | Token verified when user hits **our** route | Token often consumed at GoTrue **before** user clicks |
| Current implementation | **Implemented** (`/auth/confirm`) | **Not implemented** |
| Phase 1 scope | **Standard** | **Out of scope** |

Supabase email templates must link to the application with `token_hash` and `type` query parameters (Dashboard change — see manual steps below). That is **not** part of Phase 1 code but is required for end-to-end password reset.

---

## Session architecture

| Client | File | Role |
|--------|------|------|
| Browser | `lib/supabase.ts` | `createBrowserClient` — client pages |
| Server | `lib/supabase/server.ts` | `createServerSupabaseClient` — route handlers, RSC |
| Middleware | `middleware.ts` | `createServerClient` — session refresh on gated routes |

Sessions persist in **HTTP-only cookies** shared across browser, middleware, and server.

---

## Sign-in (unchanged — Phase 1)

Password sign-in only:

| Audience | Route | Method |
|----------|-------|--------|
| Homeowner | `/login` | `signInWithPassword` |
| Estate agent | `/estate-agents/login` | `signInWithPassword` |

No magic links. No OAuth. No `exchangeCodeForSession()` on sign-in.

---

## Password recovery (Phase 1)

### Flow

```
/login or /estate-agents/login
  → Forgot password → /forgot-password
  → resetPasswordForEmail(email, { redirectTo })
  → Email link (must use token_hash — see Dashboard)
  → GET /auth/confirm?token_hash=…&type=recovery&next=/reset-password
  → verifyOtp({ type: 'recovery', token_hash })  [server]
  → Session cookie established
  → Redirect to /reset-password (or approved `next` path)
  → updateUser({ password })
  → Continue → dashboard or agent home
```

### Code map

| Step | Location |
|------|----------|
| Request reset email | `app/forgot-password/page.tsx` |
| Build `redirectTo` | `lib/auth/passwordReset.ts` → `buildPasswordRecoveryConfirmUrl()` |
| Token exchange | `app/auth/confirm/route.ts` |
| Confirm helpers (errors, redirect allow-list) | `lib/auth/authConfirm.ts` |
| User-facing error copy | `lib/auth/passwordPolicy.ts` → `mapPasswordRecoveryError()` |
| Set new password | `components/account/ResetPasswordForm.tsx` |

### `/auth/confirm` behaviour

1. Rejects upstream GoTrue `error_code` query params (maps to internal codes).
2. Requires `token_hash` and `type=recovery` for password reset.
3. Calls `verifyOtp()` on the server.
4. Redirects to an **allow-listed** `next` path on success.
5. Redirects to `/reset-password?error=<code>` on failure (no provider internals exposed).

### Approved `next` destinations

Only these internal paths are accepted (open redirects rejected):

| Path | Purpose |
|------|---------|
| `/reset-password` | Default after recovery verify |
| `/dashboard` | Homeowner post-auth (future flows) |
| `/agent` | Estate agent home (+ subpaths) |
| `/estate-agents/onboarding` | EA onboarding (+ subpaths) |

Resolver: `resolveAuthConfirmDestination()` in `lib/auth/authConfirm.ts`.

### Recovery error codes

| Internal code | Meaning |
|---------------|---------|
| `missing_token` | No `token_hash` or `type` |
| `unsupported_type` | `type` is not `recovery` |
| `expired` | OTP expired |
| `invalid_or_expired` | Invalid or generic failure |
| `reused` | Link already consumed |
| `no_session` | No recovery session on reset page |
| `provider_error` | Unexpected upstream failure (generic message) |

`/reset-password` accepts both `error` (app) and `error_code` (GoTrue) query params and normalises them via `resolvePasswordRecoveryQueryError()`.

---

## Future phases (not implemented)

### Phase 2 — Signup email confirmation

- Extend `/auth/confirm` for `type=signup`
- Add `emailRedirectTo` on `signUp` calls
- Update **Confirm signup** Supabase email template

### OAuth (future only)

When social login is introduced:

- Add **`/auth/callback`** route handler
- Use **`exchangeCodeForSession(code)`** for OAuth **only**
- Email flows remain **TokenHash + `verifyOtp()`**

Do not merge OAuth code exchange into `/auth/confirm`.

---

## Manual Supabase Dashboard configuration

Required for password reset to work end-to-end (Phase 1 code + Dashboard):

### 1. Reset password email template

Replace `{{ .ConfirmationURL }}` with:

```html
<h2>Reset your password</h2>
<p>We received a request to reset your Keynetic password. Follow the link below to choose a new one.</p>
<p>
  <a href="{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=recovery">
    Reset password
  </a>
</p>
<p>If you didn't request this, you can safely ignore this email.</p>
```

`{{ .RedirectTo }}` matches the `redirectTo` passed from `resetPasswordForEmail()` (includes correct origin and `next=/reset-password`).

### 2. Redirect URLs (allow-list)

Include `/auth/confirm` for every environment origin, for example:

- `http://localhost:3000/auth/confirm`
- `https://*.vercel.app/auth/confirm` (Preview)
- `https://app.keynetic.co.uk/auth/confirm` (Production)

### 3. Site URL

Set to the canonical production origin on the Production Supabase project. Development/Preview rely primarily on `{{ .RedirectTo }}` from client `window.location.origin`.

### 4. Email OTP expiration

Recommended: **900 seconds (15 minutes)** for production (`docs/ACCOUNT_SECURITY.md`).

---

## Related documentation

- `docs/ACCOUNT_SECURITY.md` — account settings, security review, testing checklist
- `docs/ENVIRONMENTS.md` — environment ↔ Supabase project mapping

---

## Architecture guardrails

1. **Email OTP** → TokenHash + server `verifyOtp()` via `/auth/confirm`
2. **Never** use `{{ .ConfirmationURL }}` for SSR email links
3. **Never** call `verifyOtp()` from client components for session establishment
4. **OAuth only** → future `/auth/callback` + `exchangeCodeForSession()`
5. **Validate** `next` redirect targets against an allow-list
6. **Do not expose** GoTrue error messages to end users
