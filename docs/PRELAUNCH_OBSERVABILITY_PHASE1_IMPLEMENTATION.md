# Pre-Launch Workstream 2 — Phase 1 Implementation

**Workstream:** Production Observability & Incident Alerting  
**Phase:** 1 — Minimum Viable Production Observability  
**Status:** **`APPLICATION_SIDE_FOUNDER_VERIFIED`** — Supabase/Vercel provider review documented 22 Jul 2026 — awaiting external Production configuration only  
**Implementation date:** 22 July 2026  
**Health endpoint correction:** 22 July 2026 — `?probe=app` now returns `database:"skipped"` (see §2–3)  
**Staging verification:** **`FOUNDER_VERIFIED_COMPLETE`** — [Sentry record](./PRELAUNCH_OBSERVABILITY_SENTRY_VERIFICATION.md) (temporary routes removed)  
**Provider review:** **`FOUNDER_VERIFIED`** — [Supabase/Vercel record](./PRELAUNCH_PROVIDER_REVIEW_SUPABASE_VERCEL_22JUL2026.md)

**Audit basis:** [PRELAUNCH_OBSERVABILITY_AUDIT_AND_ARCHITECTURE.md](./PRELAUNCH_OBSERVABILITY_AUDIT_AND_ARCHITECTURE.md) — **`AUDIT_FOUNDER_APPROVED`**

**Not in scope for this phase:** Resend webhooks · business metrics migrations · marketing analytics · cost telemetry · external account configuration · Production env changes · Chain Intelligence cron scheduling

---

## 1. Phase 1 implementation summary

Repository-side foundations are in place for proactive Production failure detection:

| Deliverable | Status |
|-------------|--------|
| `GET /api/health` | Implemented |
| Database probe with 45s in-process cache | Implemented |
| `app/error.tsx` + `app/global-error.tsx` | Implemented |
| `@sentry/nextjs@10.67.0` integration (optional when DSN absent) | Implemented |
| PII scrubbing / conservative defaults | Implemented |
| Source map upload gated on `SENTRY_AUTH_TOKEN` | Implemented |
| Static verifiers | Added |
| External uptime / Sentry / Vercel / Supabase configuration | **Founder action required** |

---

## 2. Health endpoint architecture

**Route:** `GET /api/health`  
**File:** `app/api/health/route.ts`  
**Logic:** `lib/observability/healthCheck.ts`

### Behaviour

| Check | Method |
|-------|--------|
| Application | Route handler executes and returns JSON |
| Database | Anon Supabase client HEAD-style `select` on `chains` (`head: true`, `limit: 0`) — proves PostgREST + DB reachability without returning rows |

### Response shape

**Full probe** (`GET /api/health`):

```json
{
  "status": "healthy" | "degraded" | "unhealthy",
  "checks": { "app": "ok" | "failed", "database": "ok" | "failed" },
  "timestamp": "ISO-8601"
}
```

**App-only probe** (`GET /api/health?probe=app`):

```json
{
  "status": "healthy",
  "checks": { "app": "ok", "database": "skipped" },
  "timestamp": "ISO-8601"
}
```

`database:"skipped"` explicitly means **no Supabase/database request was made** on that request.

### HTTP status codes

| Status | HTTP | Meaning |
|--------|------|---------|
| `healthy` | **200** | App OK, database OK |
| `degraded` | **200** | App OK, database unreachable/misconfigured |
| `unhealthy` | **503** | App-level failure (reserved; app check currently always OK if handler runs) |

### Query parameter

| Parameter | Effect |
|-----------|--------|
| `?probe=app` | Skips database probe — **no Supabase request** — returns `database:"skipped"` |

### Security properties

- No authentication required (for external uptime tools)
- No environment variables, keys, stack traces, or raw DB errors in response
- `Cache-Control: no-store`
- Does not mutate data
- Does not use service-role key (anon key only, server-side)

---

## 3. Health endpoint DB request / cost implications

| Factor | Detail |
|--------|--------|
| Probe type | HEAD/count request — minimal payload |
| Full probe cost | **1 Supabase REST API call per request** (when cache miss) |
| App-only probe cost | **0 Supabase requests** |
| Cache TTL | **45 seconds** per warm serverless instance — caches **database probe result only**, not full HTTP responses |
| **Correct estimate: one monitor on `/api/health` every 5 minutes** | **12 checks/hour → ~12 Supabase API calls/hour** (interval 300s ≫ cache TTL 45s, so cache rarely helps at this interval) |
| Homepage/login monitors using `?probe=app` | **0 Supabase calls** from those monitors |
| Cost risk | Negligible at launch scale; avoid sub-minute polling on full `/api/health` |

### Serverless cache limitations

The 45-second cache is **in-process and instance-local only**:

- Each warm Vercel serverless instance maintains its own cache
- Cold starts reset the cache
- Concurrent instances do not share cache state
- It is **not** a globally reliable request-reduction mechanism
- It only reduces burst traffic to Supabase when the **same instance** receives multiple full probes within 45 seconds (e.g. manual retests, overlapping monitors)

**Do not rely on this cache for cost control at 5-minute monitoring intervals.** At that interval, assume **one DB call per full health check**.

---

## 4. Error boundaries added

| File | Scope |
|------|-------|
| `app/error.tsx` | Segment-level render errors — branded message, Try again + Back to dashboard |
| `app/global-error.tsx` | Root layout failures — includes `<html>`/`<body>`, Try again |

Both capture to Sentry via `captureObservabilityException` when Sentry is enabled (client-side only — no blocking server flush). No stack traces or technical messages shown to users.

**Server-side thrown errors** are captured via Next.js `onRequestError` in `instrumentation.ts`, which awaits `flushIfServerless()` on Node serverless invocations. **Cron/background handlers** that capture without throwing should call `flushObservabilityEvents()` at invocation end.

---

## 5. Sentry package / compatibility assessment

| Item | Assessment |
|------|------------|
| Package | **`@sentry/nextjs@10.67.0`** |
| Next.js | **16.2.6** (Turbopack) — supported |
| React | **19.2.4** — supported |
| App Router | Supported via `instrumentation-client.ts`, `instrumentation.ts`, `onRequestError` |
| Vercel | Standard serverless model; source maps via `withSentryConfig` at build time |
| `instrumentation.ts` | **Appropriate** for Next.js 16 — registers server + edge configs |
| Navigation hook | `onRouterTransitionStart` exported from `instrumentation-client.ts` (Sentry 10 requirement) |
| Middleware (edge) | Covered by `sentry.edge.config.ts` |
| Server Actions | Auto-capture partial; explicit `withServerActionInstrumentation` deferred |
| Compatibility concerns | None material; Turbopack deprecation warnings for some Sentry webpack options — non-blocking |

---

## 6. Sentry files / configuration added

| File | Purpose |
|------|---------|
| `instrumentation-client.ts` | Browser init + router transitions |
| `instrumentation.ts` | Server/edge registration + `onRequestError` with serverless flush |
| `sentry.server.config.ts` | Node.js runtime |
| `sentry.edge.config.ts` | Edge runtime (middleware) |
| `lib/observability/environment.ts` | Environment + enablement logic |
| `lib/observability/sentryPrivacy.ts` | `beforeSend` scrubbing |
| `lib/observability/sentryShared.ts` | Shared init + safe capture helper + `flushObservabilityEvents()` |
| `next.config.ts` | Wrapped with `withSentryConfig` |

---

## 7. Environment separation behaviour

Resolved via `resolveKeyneticEnvironment()`:

| Environment | Source | Sentry default |
|-------------|--------|----------------|
| `production` | `VERCEL_ENV=production` | **Enabled** when DSN present |
| `preview` | `VERCEL_ENV=preview` | Disabled unless `SENTRY_ENABLED=true` |
| `development` | Local / default | Disabled unless `SENTRY_ENABLED=true` |
| `test` | `NODE_ENV=test` | Disabled unless `SENTRY_ENABLED=true` |

All events tagged with `environment: <resolved>`.

---

## 8. Behaviour when Sentry is unconfigured

When `NEXT_PUBLIC_SENTRY_DSN` / `SENTRY_DSN` is absent or `SENTRY_ENABLED=false`:

- `Sentry.init()` is **not called**
- Build succeeds (source map upload disabled without `SENTRY_AUTH_TOKEN`)
- Local dev, Preview, and Production **continue normally**
- Error boundaries still show branded UI
- `captureObservabilityException` is a no-op

---

## 9. PII / privacy safeguards

| Setting | Value |
|---------|-------|
| `sendDefaultPii` | **false** |
| Session Replay | **Not installed** |
| Cookies | Stripped from events |
| Authorization headers | Redacted |
| Request body | Removed |
| User object | ID only (email removed) |
| Breadcrumb data | Cleared |

---

## 10. Sensitive URL / token scrubbing behaviour

`scrubSentryEvent` in `lib/observability/sentryPrivacy.ts`:

1. Redacts query keys: `token`, `invitation_token`, `access_token`, `refresh_token`, `code`, `password`, etc.
2. Strips query strings entirely on sensitive paths: `/claim`, `/auth/confirm`, `/reset-password`, `/forgot-password`, `/verify-email`, `/join-chain`, `/estate-agents/join`
3. Redacts `Authorization`, `Cookie`, `Set-Cookie`, Supabase auth headers

---

## 11. Source map security approach

| Control | Implementation |
|---------|------------------|
| Upload | Only when `SENTRY_AUTH_TOKEN` set at build time |
| Public exposure | Sentry SDK handles upload to Sentry — not deployed as public `.map` files by default |
| Build without token | `sourcemaps.disable: true` — build succeeds, stacks less readable until configured |
| Credentials | `SENTRY_AUTH_TOKEN` build-time only — never in client bundle |

---

## 12. Performance tracing configuration

| Setting | Default |
|---------|---------|
| `tracesSampleRate` | **0** (disabled) |
| Override | `SENTRY_TRACES_SAMPLE_RATE` env var (0–1) |
| Session Replay | Not enabled |
| Cost implication | Zero tracing cost at default; raising sample rate increases Sentry quota usage |

---

## 13. Risky existing console / error logging

No **new** high-risk logging introduced. Existing patterns reviewed:

| Area | Risk | Action |
|------|------|--------|
| `lib/communications/email.ts` | Generic exception objects to console | No change — may include recipient context in Error message from provider; monitor via Sentry scrubbing |
| `scripts/verify-ea-branch-access-dev-integration.ts` | Logs user email in dev script | Dev-only script — no change |
| Invitation/auth URLs | Not logged with tokens in production paths reviewed | No change required in Phase 1 |

No low-risk production code changes made for console cleanup in this phase.

---

## 14. Uptime monitor founder configuration instructions

**Do not create the account in this task.** After Staging/Production deploy:

### Recommended monitors

| # | URL | Interval | Pass criteria | Purpose |
|---|-----|----------|---------------|---------|
| A | `https://<production-domain>/` | **5 min** | HTTP 200 | Public site reachable |
| B | `https://<production-domain>/login` | **5 min** | HTTP 200 | Auth entry reachable |
| C | `https://<production-domain>/api/health` | **5 min** | HTTP 200 **and** JSON `"status":"healthy"` | App + database |

### Thresholds

| Setting | Recommendation |
|---------|----------------|
| Failure threshold | **2 consecutive** failures |
| Recovery threshold | **1** success |
| Alert destination | Founder email (independent of Resend) |
| DB cost control | Do **not** poll `/api/health` faster than every **3 minutes**; homepage/login monitors need not use health endpoint |

### Optional

- Monitor C with `"status":"degraded"` as **P1** (not P0) — database issue while app serves static/error pages
- Use `GET /api/health?probe=app` only if Supabase outage should not mark monitor failed

---

## 15. Recommended uptime provider options

| Provider | Cost | Notes |
|----------|------|-------|
| **Better Stack Uptime** (free tier) | £0 | JSON body check support, email alerts |
| **UptimeRobot** (free tier) | £0 | HTTP + keyword/JSON checks |
| **Freshping** (free tier) | £0 | Basic HTTP monitoring |

Recommendation: **Better Stack** or **UptimeRobot** with JSON check on `/api/health` for `"healthy"`.

---

## 16. Founder alert destination recommendation

| Severity | Channel | Notes |
|----------|---------|-------|
| **P0** | Dedicated alert email **+ optional SMS** | Must not be Resend-only |
| **P1** | Founder email | Sentry alert rules (Phase 2) |
| **P2/P3** | Email digest / dashboard | Weekly review |

Configure P0 SMS via mobile carrier email gateway or Better Stack SMS add-on.

---

## 17. Vercel native monitoring checklist

**Founder review (22 Jul 2026):** [Provider record](./PRELAUNCH_PROVIDER_REVIEW_SUPABASE_VERCEL_22JUL2026.md)

- [x] Confirm current Vercel plan — **Hobby verified**
- [ ] Enable **spend/budget alerts** in Billing — **N/A on Hobby at pre-launch; Production plan review open**
- [ ] Verify **deployment failure notifications** (email/Slack)
- [ ] Review **function log retention** period for Production — **requires Production plan decision**
- [ ] Review **runtime logs** access for `/api/*` and cron routes
- [ ] Check **observability / analytics** tab for error rates (plan-dependent)
- [ ] Document Production project URL and team access
- [ ] Optional later: log drain (Phase 2+)

**Decision:** Do not upgrade to Vercel Pro solely for spend controls during pre-launch. Review plan requirements before Production go-live. **Hobby is not approved as the final Production plan.**

---

## 18. Supabase native monitoring checklist

**Founder review (22 Jul 2026):** [Provider record](./PRELAUNCH_PROVIDER_REVIEW_SUPABASE_VERCEL_22JUL2026.md)

- [x] Confirm Supabase plan — **Pro verified**
- [x] Verify **daily backups** enabled — **verified; restore points 15–22 Jul 2026**
- [ ] Perform **restore drill** — **not yet performed**
- [ ] Enable **spend/usage alerts** if available — **none identified in dashboard; spend cap enabled; manual review required**
- [x] Review **Usage dashboard** — **verified 22 Jul 2026; within Pro quotas**
- [ ] Review **Database → Reports** for CPU, memory, connections
- [ ] Review **Auth logs** for login failure spikes
- [ ] Review **API logs** for elevated 4xx/5xx
- [x] Confirm **Postgres logs** availability — connection/disconnection logging **intentionally OFF**
- [x] Confirm **spend cap** — **ENABLED** (keep during pre-launch; Production go-live decision open)
- [ ] Document **Storage backup policy** before business-critical Storage use — **future requirement; Storage Size currently 0 GB**
- [ ] Set calendar reminder for monthly usage review

---

## 19. Chain Intelligence cron architecture finding

**Classification: B — Schedule recommended but not launch-critical**

### Architecture trace (read-only)

| Aspect | Finding |
|--------|---------|
| **Calculated on write** | `refreshOperationalSummary()` called after chain mutations (ChainContext), property claim, EA origination, invitation flows — persists `chain_operational_summary` + `property_operational_summary` |
| **Calculated on read (live)** | `app/chain/[chainId]/page.tsx` calls `computeChainIntelligence()` for chain detail display |
| **Persisted summaries** | `chain_operational_summary` includes `next_recalculation_at`, confidence bands, timing metadata |
| **Worker** | `lib/chainIntelligence/worker.ts` → `list_chain_intelligence_refresh_candidates` RPC → time-only refresh batch |
| **Schedule intent** | Route comment + migration RPC designed for daily cron; **not in `vercel.json`** |
| **Stale without cron?** | **Yes, partially** — EA Command Centre reads **cached** `confidence_score` / `health_status` via `agent_branch_property_summaries`; time-decayed confidence may lag until next write-triggered refresh or manual script. Chain detail page remains live-computed. |
| **Intentional omission?** | Appears **incomplete wiring**, not a deliberate permanent omission — route exists with schedule comment |

**Not scheduled in Phase 1** per task boundary. Recommend separate founder-approved task to add `vercel.json` cron after Staging verification.

---

## 20. Files changed

| File | Change |
|------|--------|
| `app/api/health/route.ts` | **Added** |
| `app/error.tsx` | **Added** |
| `app/global-error.tsx` | **Added** |
| `instrumentation.ts` | **Added** |
| `instrumentation-client.ts` | **Added** |
| `sentry.server.config.ts` | **Added** |
| `sentry.edge.config.ts` | **Added** |
| `lib/observability/environment.ts` | **Added** |
| `lib/observability/healthCheck.ts` | **Added** |
| `lib/observability/sentryPrivacy.ts` | **Added** |
| `lib/observability/sentryShared.ts` | **Added** |
| `next.config.ts` | **Modified** — Sentry wrapper |
| `package.json` / `package-lock.json` | **Modified** — `@sentry/nextjs` |
| `scripts/verify-health-endpoint.ts` | **Added** |
| `scripts/verify-observability-privacy.ts` | **Added** |
| `docs/PRELAUNCH_OBSERVABILITY_PHASE1_IMPLEMENTATION.md` | **Added** — this document |
| `docs/PRELAUNCH_OBSERVABILITY_AUDIT_AND_ARCHITECTURE.md` | **Updated** |
| `docs/PRODUCTION_READINESS_CHECKLIST.md` | **Updated** |
| `docs/ENVIRONMENTS.md` | **Updated** |

---

## 21. Dependencies changed

| Package | Version | Type |
|---------|---------|------|
| `@sentry/nextjs` | `10.67.0` | dependency |

---

## 22. Environment variables eventually required

| Variable | Required | Where | Purpose |
|----------|----------|-------|---------|
| `NEXT_PUBLIC_SENTRY_DSN` | For Sentry | Vercel Production | Browser + shared DSN |
| `SENTRY_DSN` | Optional alt | Server | Server DSN if split |
| `SENTRY_ENABLED` | Optional | Vercel | `true` to enable on Preview; `false` to disable on Production |
| `SENTRY_TRACES_SAMPLE_RATE` | Optional | Vercel | `0` default; increase only if needed |
| `SENTRY_ORG` | For source maps | Vercel build | Sentry organisation slug |
| `SENTRY_PROJECT` | For source maps | Vercel build | Sentry project slug |
| `SENTRY_AUTH_TOKEN` | For source maps | Vercel build **secret** | Upload maps at build — never expose to client |
| `SENTRY_TUNNEL_ROUTE` | Optional | Vercel | Default `/monitoring` — ad-blocker bypass |

Existing Supabase vars (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`) required for health DB probe.

---

## 23. Tests / verifiers added

| Script | Purpose |
|--------|---------|
| `scripts/verify-health-endpoint.ts` | Health route static checks + probe logic |
| `scripts/verify-observability-privacy.ts` | Sentry privacy/regression static checks |

Run:

```bash
npx tsx scripts/verify-health-endpoint.ts
npx tsx scripts/verify-observability-privacy.ts
```

---

## 24. Test results

| Suite | Result |
|-------|--------|
| `verify-health-endpoint.ts` | **PASS** (16 checks) |
| `verify-observability-privacy.ts` | **PASS** (24 checks) |

---

## 25. TypeScript result

`npx tsc --noEmit` — **PASS**

---

## 26. Build result

`npm run build` — **PASS** (includes `/api/health` route)

---

## 27. ESLint result vs baseline

| Metric | Baseline | After Phase 1 |
|--------|----------|---------------|
| Total | 55 | **55** |
| Errors | 22 | **22** |
| Warnings | 33 | **33** |

No unrelated ESLint cleanup performed.

---

## 28. Database migration confirmation

**No database migration created or applied.**

---

## 29. Development remote confirmation

**Development Supabase was not modified remotely.**

---

## 30. Production confirmation

**Production was not modified** (no Vercel Production env changes, no Production deploy performed in this task).

---

## 31. Exact founder actions required next

**Application-side Phase 1:** **`FOUNDER_VERIFIED_COMPLETE`** on Preview (health + Sentry client/server). Temporary verification routes removed.

**Still open (external configuration — not repo work):**

1. **Set Vercel Production environment variables** (DSN; see [ENVIRONMENTS.md](./ENVIRONMENTS.md))  
2. **Configure external uptime monitor** (§14) after Production URL confirmed  
3. **Optional:** `SENTRY_AUTH_TOKEN` + org/project for readable Production stack traces (§11)  
4. **Complete Vercel + Supabase checklists** (§17–18)  
5. **Approve Phase 2** (alert rules) after Production external config is in place  

---

## 32. Staging / external configuration readiness

| Gate | Ready? |
|------|--------|
| Repository implementation | **Yes** |
| Staging deploy + health check | **Founder verified** |
| Staging Sentry client + server capture | **Founder verified** |
| Temporary verification surface | **Removed** |
| Supabase Pro usage/cost/spend cap/backups | **Founder verified** — [provider record](./PRELAUNCH_PROVIDER_REVIEW_SUPABASE_VERCEL_22JUL2026.md) |
| Vercel Hobby plan | **Founder verified** |
| Sentry DSN in Production | **Founder action** |
| External uptime monitor | **Founder action** — deferred until Production URL ready |
| Production observability live | **No** — awaiting founder external configuration |
| Phase 2 alerting | **Not started** |

---

*End of Phase 1 implementation report.*
