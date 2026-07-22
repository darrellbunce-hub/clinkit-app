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

### Sentry (optional)

| Variable | Scope | Purpose |
|----------|-------|---------|
| `NEXT_PUBLIC_SENTRY_DSN` | Client + server | Enables Sentry when combined with enablement rules |
| `SENTRY_DSN` | Server | Alternative server-only DSN |
| `SENTRY_ENABLED` | All | `true` forces enable on Preview/dev; `false` disables even on Production |
| `SENTRY_TRACES_SAMPLE_RATE` | All | `0`–`1`; default **0** (error-only) |
| `SENTRY_ORG` | Build | Source map upload organisation slug |
| `SENTRY_PROJECT` | Build | Source map upload project slug |
| `SENTRY_AUTH_TOKEN` | Build secret | Source map upload — **never expose to browser** |
| `SENTRY_TUNNEL_ROUTE` | Server | Optional ad-blocker bypass route (default `/monitoring`) |

**Enablement rules** (`lib/observability/environment.ts`):

- No DSN → Sentry fully disabled; app behaves normally
- DSN + Production (`VERCEL_ENV=production`) → enabled by default
- DSN + Preview/development → disabled unless `SENTRY_ENABLED=true`

Full setup instructions: [PRELAUNCH_OBSERVABILITY_PHASE1_IMPLEMENTATION.md](./PRELAUNCH_OBSERVABILITY_PHASE1_IMPLEMENTATION.md)

---

## Deployment branches

| Branch | Vercel | Supabase |
|--------|--------|----------|
| `main` | Production | Production project |
| `staging-test` | Preview | Development project |

Do not configure Production observability env vars until Staging verification is complete.
