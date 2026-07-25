# Pre-Launch Workstream 2 — Staging Sentry Verification Record

**Status:** **`FOUNDER_VERIFIED_COMPLETE`** — temporary verification surface **removed**  
**Verified on:** Vercel Preview (July 2026)  
**Scope:** Preview/Staging only · **not** Production · **not** Phase 2

This document preserves the founder verification record. The temporary `/dev/sentry-verification` routes have been removed and are **not** available in Preview or Production.

---

## Founder verification results

| Check | Result | Identifier |
|-------|--------|------------|
| Client Sentry capture | **PASS** | `KEYNETIC_SENTRY_CLIENT_VERIFICATION` |
| Server Sentry capture | **PASS** | `KEYNETIC_SENTRY_SERVER_VERIFICATION` |
| Health endpoint (full probe) | **PASS** | `GET /api/health` → `status: healthy`, `app: ok`, `database: ok` |
| Health endpoint (app-only) | **PASS** | `GET /api/health?probe=app` → `database: skipped` |

Both Sentry events appeared in the Preview Sentry project with privacy scrubbing applied. Server capture required an explicit serverless flush fix during verification (see below).

---

## Server flush investigation (historical)

**Symptom:** Client verification reached Sentry; server verification did not (initial attempt).

**Root cause:** On Vercel **Node.js** serverless, Sentry's built-in `captureRequestError` schedules flush via `vercelWaitUntil`, which **only runs on Edge**. Queued events could be lost when the invocation ended before transmission.

**Verification fix (temporary):** The verification API route awaited `flushIfServerless()` after manual capture.

**Production architecture (after cleanup):**

| Path | Flush behaviour |
|------|-----------------|
| Thrown route/API errors | `instrumentation.ts` `onRequestError` → `captureRequestError` + `await flushIfServerless()` |
| Client error boundaries | `captureObservabilityException()` — browser sends asynchronously; no blocking flush |
| Cron/background handlers | Call `flushObservabilityEvents()` at invocation end when capturing without throw |

Global blocking flush was **not** retained on `captureObservabilityException()` — it would add latency to every manual capture and is unnecessary for client-only callers.

---

## Environment variables validated on Preview

| Variable | Preview value used |
|----------|-------------------|
| `NEXT_PUBLIC_SENTRY_DSN` | Set |
| `SENTRY_ENABLED` | `true` |
| `NEXT_PUBLIC_SENTRY_ENABLED` | `true` |
| `NEXT_PUBLIC_VERCEL_ENV` | `preview` |

See [ENVIRONMENTS.md](./ENVIRONMENTS.md) for the intended Production vs Preview model.

---

## Privacy checklist confirmed (founder review)

Each verification event confirmed **absent**:

- Authorization headers
- Cookies
- Request body / form data
- Email addresses / user PII
- Invitation, access, or reset tokens in URLs
- Passwords or API keys

Confirmed **present**: `environment: preview`, `sendDefaultPii: false` behaviour, runtime tag (`client` / `server`).

---

## Removed verification surface (cleanup complete)

The following were removed after founder sign-off:

- `/dev/sentry-verification` (UI)
- `GET /api/dev/sentry-verification` (API)
- Supporting components and constants

No debug/test Sentry endpoint remains reachable in Preview or Production.

**Post-cleanup redeploy:** Founder confirmed redeployed Preview returns **Page Not Found** for the removed verification route (expected).

---

*Historical record only — do not reintroduce verification routes without a new approved task.*
