# Keynetic — Environment configuration

Environment ↔ Supabase project mapping is documented in [KEYNETIC_ARCHITECTURE.md](./KEYNETIC_ARCHITECTURE.md).

---

## Observability (Workstream 2 Phase 1)

Phase 1 adds optional Sentry and a public health endpoint. **No observability env vars are required for local development or builds.**

### Health endpoint

Uses existing public Supabase variables:

| Variable | Required for DB probe |
|----------|----------------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes |

If either is missing, `/api/health` returns `"status":"degraded"` with `"database":"failed"`.

`GET /api/health?probe=app` returns `"database":"skipped"` and does not contact Supabase.

### Sentry (optional)

| Variable | Scope | Purpose |
|----------|-------|---------|
| `NEXT_PUBLIC_SENTRY_DSN` | Client + server | Enables Sentry when combined with enablement rules |
| `SENTRY_DSN` | Server | Alternative server-only DSN |
| `SENTRY_ENABLED` | All | `true` forces enable on Preview/dev; `false` disables even on Production |
| `NEXT_PUBLIC_SENTRY_ENABLED` | Client + server | Required for **browser** capture on Preview — mirrors `SENTRY_ENABLED` |
| `NEXT_PUBLIC_VERCEL_ENV` | Client + server | Set to `preview` on Preview so client Sentry events tag correctly |
| `SENTRY_TRACES_SAMPLE_RATE` | All | `0`–`1`; default **0** (error-only) |
| `SENTRY_ORG` | Build | Source map upload organisation slug |
| `SENTRY_PROJECT` | Build | Source map upload project slug |
| `SENTRY_AUTH_TOKEN` | Build secret | Source map upload — **never expose to browser** |
| `SENTRY_TUNNEL_ROUTE` | Server | Optional ad-blocker bypass route (default `/monitoring`) |

**Enablement rules** (`lib/observability/environment.ts`):

- No DSN → Sentry fully disabled; app behaves normally
- DSN + Production (`VERCEL_ENV=production`) → enabled by default
- DSN + Preview/development → disabled unless `SENTRY_ENABLED=true` **and/or** `NEXT_PUBLIC_SENTRY_ENABLED=true`

Full setup instructions: [PRELAUNCH_OBSERVABILITY_PHASE1_IMPLEMENTATION.md](./PRELAUNCH_OBSERVABILITY_PHASE1_IMPLEMENTATION.md)

Founder Staging verification record (routes removed): [PRELAUNCH_OBSERVABILITY_SENTRY_VERIFICATION.md](./PRELAUNCH_OBSERVABILITY_SENTRY_VERIFICATION.md)

### Recommended variable sets

| Variable | Production | Preview | Client-visible? |
|----------|------------|---------|-----------------|
| `NEXT_PUBLIC_SENTRY_DSN` | **Required** | Required for Sentry tests | Yes (DSN is public by design) |
| `SENTRY_ENABLED` | Optional (`false` to disable) | `true` to opt in | **No** — server-only |
| `NEXT_PUBLIC_SENTRY_ENABLED` | Omit (Production auto-enables with DSN) | `true` for browser capture | Yes |
| `NEXT_PUBLIC_VERCEL_ENV` | Omit — `VERCEL_ENV=production` is automatic | `preview` recommended for client bundle tagging | Yes |
| `SENTRY_TRACES_SAMPLE_RATE` | Omit (defaults to 0) | Omit | N/A |
| `SENTRY_AUTH_TOKEN` | Build secret when source maps desired | **Avoid on Preview** (volume/cost) | **Never** |
| `SENTRY_ORG` / `SENTRY_PROJECT` | Build-time when uploading maps | Avoid on Preview | **Never** |

**Minimise duplication:** Production needs only `NEXT_PUBLIC_SENTRY_DSN` (Sentry auto-enables). Preview needs explicit enable flags because non-Production defaults to disabled. Do **not** set `SENTRY_ENABLED=true` on Production unless you need an override.

**`NEXT_PUBLIC_VERCEL_ENV`:** Required only because client bundles cannot read server-only `VERCEL_ENV`. On Preview, set to `preview` so browser events tag correctly. On Production, omit it — server runtime reads `VERCEL_ENV` automatically; client Production builds infer production from `NODE_ENV`.

---

## Deployment branches

| Branch | Vercel | Supabase |
|--------|--------|----------|
| `main` | Production | Production project |
| `staging-test` | Preview | Development project |

Do not configure Production observability env vars until Staging verification is complete.
