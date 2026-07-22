# Pre-Launch Workstream 2 — Staging Sentry Verification

**Status:** Verification surface implemented — awaiting founder Sentry event confirmation  
**Scope:** Preview/Staging only · **not** Production · **not** Phase 2

---

## Existing Sentry configuration audit (Phase 1)

| Component | Role |
|-----------|------|
| `instrumentation-client.ts` | Browser Sentry init |
| `instrumentation.ts` | Server/edge registration + `onRequestError` |
| `sentry.server.config.ts` | Node runtime init |
| `sentry.edge.config.ts` | Edge/middleware init |
| `lib/observability/environment.ts` | Enablement + environment resolution |
| `lib/observability/sentryShared.ts` | Shared init + safe capture |
| `lib/observability/sentryPrivacy.ts` | `beforeSend` scrubbing |
| `next.config.ts` | `withSentryConfig` (source maps gated on auth token) |

---

## Environment variable issue (fixed in this task)

| Variable | Server | Client bundle |
|----------|--------|---------------|
| `NEXT_PUBLIC_SENTRY_DSN` | ✓ | ✓ |
| `SENTRY_ENABLED=true` | ✓ | **✗ not exposed** |
| `NEXT_PUBLIC_SENTRY_ENABLED=true` | ✓ | ✓ |

**Before this task:** Preview with only `SENTRY_ENABLED=true` enabled **server** capture but **not browser** capture, because `isSentryEnabled()` read a non-public flag unavailable in the client bundle.

**After this task:** `isSentryEnabled()` reads **either** `SENTRY_ENABLED` or `NEXT_PUBLIC_SENTRY_ENABLED`. Preview must set **`NEXT_PUBLIC_SENTRY_ENABLED=true`** for browser verification.

**Environment tagging:** Client bundles do not receive `VERCEL_ENV`. Set **`NEXT_PUBLIC_VERCEL_ENV=preview`** on Preview so Sentry events show `environment: preview` (not mis-tagged as `development` or `production`).

Production controls unchanged: Production enables Sentry when DSN is present unless explicitly disabled; non-Production still requires explicit enable flags.

---

## Verification surface

| URL | Purpose |
|-----|---------|
| `/dev/sentry-verification` | UI with client + server trigger buttons |
| `GET /api/dev/sentry-verification` | Fixed server error |

### Production blocking

Returns **404** (`notFound()` / `{ error: "not_found" }`) when **any** of:

- `VERCEL_ENV=production`
- `NEXT_PUBLIC_VERCEL_ENV=production`
- `resolveKeyneticEnvironment() === "production"`
- Sentry not explicitly enabled (`isSentryEnabled()` false)

### Fixed identifiers

| Event | Message / tag |
|-------|----------------|
| Client | `KEYNETIC_SENTRY_CLIENT_VERIFICATION` |
| Server | `KEYNETIC_SENTRY_SERVER_VERIFICATION` |

No user input · no Supabase · no secrets displayed · privacy scrubber applies via existing `beforeSend`.

---

## Founder test instructions

### A. Deploy to Staging Preview

1. Merge/push this commit to `staging-test` (or your Preview branch)
2. Confirm Vercel Preview env vars:

| Variable | Preview value |
|----------|---------------|
| `NEXT_PUBLIC_SENTRY_DSN` | *(already set)* |
| `SENTRY_ENABLED` | `true` |
| **`NEXT_PUBLIC_SENTRY_ENABLED`** | **`true`** *(add if missing)* |
| **`NEXT_PUBLIC_VERCEL_ENV`** | **`preview`** *(recommended)* |

3. Redeploy Preview after adding any new variables

### B. Trigger client verification

1. Open `https://<preview-url>/dev/sentry-verification`
2. Click **Trigger client verification**
3. Confirm on-page success message (no stack trace shown)

### C. Trigger server verification

1. On the same page, click **Trigger server verification**
2. Expect a failed fetch / 500 — that is correct
3. Confirm on-page success message

### D. Find events in Sentry

1. Open your Sentry project → **Issues**
2. Filter by environment **`preview`** (or `development` if `NEXT_PUBLIC_VERCEL_ENV` not set)
3. Locate two issues/messages containing the fixed strings above

### E. Privacy checklist (each event)

Confirm **absent**:

- Authorization headers
- Cookies
- Request body / form data
- Email addresses / user PII
- Invitation, access, or reset tokens in URLs
- Passwords or API keys

Confirm **present**:

- `environment: preview` (after setting `NEXT_PUBLIC_VERCEL_ENV=preview`)
- `sendDefaultPii: false` behaviour (no automatic IP/user email enrichment)
- Runtime tag `client` or `server`
- Scrubbed URLs if any request context attached

**Source maps:** Readable stack traces in Sentry require `SENTRY_AUTH_TOKEN` + org/project at build time. Without them, stacks may show bundled paths only — error capture still works.

### F. Distinguish events

| Search in Sentry | Origin |
|----------------|--------|
| `KEYNETIC_SENTRY_CLIENT_VERIFICATION` | Browser button |
| `KEYNETIC_SENTRY_SERVER_VERIFICATION` | API route |

Tags: `error_code:sentry_verification_client` / `sentry_verification_server`

---

## After founder confirmation

Do **not** remove the verification surface yet. After both events pass privacy review, a **separate cleanup task** will remove or permanently disable `/dev/sentry-verification` before Production launch.

---

## Staging redeploy

**Yes** — required after this commit and after adding `NEXT_PUBLIC_SENTRY_ENABLED=true` (and optionally `NEXT_PUBLIC_VERCEL_ENV=preview`).
