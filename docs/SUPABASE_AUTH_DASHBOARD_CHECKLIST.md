# Supabase Auth Dashboard Checklist

Settings that **cannot** be enforced through repository code and require manual configuration in the Supabase Dashboard (or Supabase CLI linked project config).

**Project:** Keynetic production Supabase project  
**Last reviewed:** 2026-07-17  
**Note:** Current Dashboard state is **not inspectable from this repository**. Mark each item verified after checking the live project.

---

## How to use this checklist

1. Open [Supabase Dashboard](https://supabase.com/dashboard) → your project
2. Navigate to **Authentication** sections listed below
3. Compare current value to **Recommended**
4. Record actual state in your runbook / tick when done

---

## Password security

| Setting | Location | Current state | Recommended | Required before launch |
|---|---|---|---|---|
| Minimum password length | Authentication → Providers → Email → Password requirements | **Manual verification** | **10** | **Yes** |
| Password character requirements | Same section (if available on your plan) | **Manual verification** | Require uppercase, lowercase, numbers, symbols | **Yes** |
| Leaked password protection (HIBP) | Authentication → Settings → Password Security | **Manual verification** | **Enabled** (Pro plan and above only) | **Yes** if plan supports it |
| Password strength meter | Authentication → Settings | **Manual verification** | Optional (app provides UX) | No |

**Code alignment:** `lib/auth/passwordPolicy.ts` enforces the same rules client-side before `signUp` / `updateUser`. Dashboard settings provide authoritative backend rejection.

---

## Email confirmation

| Setting | Location | Current state | Recommended | Required before launch |
|---|---|---|---|---|
| Enable email confirmations | Authentication → Providers → Email | **Manual verification** | **Enabled** | **Yes** |
| Confirm email template | Authentication → Email Templates → Confirm signup | **Manual verification** | Branded, correct redirect URL | **Yes** |
| Secure email change | Authentication → Settings | **Manual verification** | Enabled | Recommended |

**Redirect URLs:** Ensure production URL(s) are in **Authentication → URL Configuration → Redirect URLs**, including:

- `https://<production-domain>/auth/confirm`
- `https://<production-domain>/reset-password`

Also add staging/dev URLs as needed.

---

## Password recovery (OTP)

| Setting | Location | Current state | Recommended | Required before launch |
|---|---|---|---|---|
| Recovery OTP expiry | Authentication → Settings (or Email OTP settings) | **Manual verification** | **900 seconds (15 minutes)** | **Yes** |
| Reset password email template | Authentication → Email Templates → Reset password | **Manual verification** | Link points to `/auth/confirm?...` flow | **Yes** |

**Code reference:** `lib/auth/passwordReset.ts` → `buildPasswordRecoveryConfirmUrl()`.

---

## Rate limiting & abuse

| Setting | Location | Current state | Recommended | Required before launch |
|---|---|---|---|---|
| Auth rate limits (OTP, verify, token, email) | **Authentication → Rate Limits** | **Manual verification** | Record all values; see [Supabase rate limits docs](https://supabase.com/docs/guides/auth/rate-limits) | **Yes** |
| IP address forwarding (`Sb-Forwarded-For`) | Same section | **Manual verification** | Evaluate before high `/auth/confirm` volume | Verify |
| CAPTCHA (Turnstile / hCaptcha) | **Authentication → Bot and Abuse Protection** | **Manual verification** | **Disabled at launch** unless pen-test requires | No (defer) |

### Documented Supabase defaults (verify on live project — do not assume)

| Operation | Documented limit | Customizable? |
|-----------|------------------|---------------|
| Email sends (built-in SMTP) | 2/hour project-wide | Custom SMTP only |
| Password reset / signup resend per user | 60 seconds between requests | Yes |
| OTP sends | 30/hour project-wide | Yes |
| Token endpoint (password login + refresh) | 1800/hour per IP, burst 30 | No |
| Verify endpoint (OTP exchange) | 360/hour per IP, burst 30 | No |
| MFA challenge/verify | 15/hour per IP | No |

**Dashboard labelling caveat:** The slider labelled “Rate limit for sign-ups and sign-ins” may map to OTP limits, not password login. Password login uses the **Token** endpoint IP bucket. Record actual Dashboard field names during verification.

Keynetic does **not** duplicate Supabase auth rate limits in Redis for launch. See **`docs/SEC-104_AUTHENTICATION_ABUSE_RATE_LIMITING_AUDIT.md`** for full SEC-104 audit (2026-07-25).

---

## Session & JWT

| Setting | Location | Current state | Recommended | Required before launch |
|---|---|---|---|---|
| JWT expiry | Authentication → Settings | **Manual verification** | Default (1 hour) with refresh via SSR middleware | Verify |
| Refresh token rotation | Authentication → Settings | **Manual verification** | Enabled (Supabase default) | Verify |
| Site URL | Authentication → URL Configuration | **Manual verification** | Production canonical URL | **Yes** |

**Code:** Session cookies managed by `@supabase/ssr` in `middleware.ts` and `lib/supabase/server.ts`.

---

## SMTP / email delivery

| Setting | Location | Current state | Recommended | Required before launch |
|---|---|---|---|---|
| Custom SMTP | Project Settings → Auth → SMTP | **Manual verification** | Production SMTP (not Supabase default for prod volume) | **Yes** for production |
| Sender domain (SPF/DKIM) | DNS + SMTP provider | **Manual verification** | Verified sending domain | **Yes** |

---

## Multi-factor authentication

| Setting | Location | Current state | Recommended | Required before launch |
|---|---|---|---|---|
| MFA | Authentication → Providers | **Manual verification** | Not required for launch | No |

---

## Post-configuration verification

After applying settings, run on **staging**:

1. Attempt sign-up with password `short1!` → rejected
2. Attempt sign-up with `ValidPass1!` → accepted (or pending email)
3. Trigger forgot password → email received, link works
4. Use expired link → safe error on `/reset-password`
5. Change password in `/account` with weak password → rejected

```bash
npx tsx scripts/verify-auth-password-policy.ts
npm run build
```

---

## Related documentation

- `docs/AUTH_SECURITY_AUDIT.md` — full audit and risk summary
- `docs/ACCOUNT_SECURITY.md` — account settings architecture
