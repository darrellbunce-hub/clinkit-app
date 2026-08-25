# Pre-Launch Provider Review — Supabase & Vercel

**Workstream:** Pre-Launch Operational Readiness (provider/infrastructure review)  
**Review date:** 22 July 2026  
**Status:** **`FOUNDER_VERIFIED`** — documentation record only  
**Scope:** Founder dashboard review · **no** application code changes · **no** provider setting changes in this task

Related: [Production Readiness Checklist §14.8](./PRODUCTION_READINESS_CHECKLIST.md) · [Phase 1 observability](./PRELAUNCH_OBSERVABILITY_PHASE1_IMPLEMENTATION.md) · [Sentry verification record](./PRELAUNCH_OBSERVABILITY_SENTRY_VERIFICATION.md)

---

## Executive summary

| Area | Status |
|------|--------|
| **Supabase provider review** | **FOUNDER_VERIFIED** — Pro plan, usage within quotas, spend cap enabled, daily DB backups verified |
| **Vercel provider review** | **FOUNDER_VERIFIED** — Hobby confirmed; Production plan/spend controls **open decision** |
| **External uptime monitoring** | **OPEN** — deferred until Production URL is ready |
| **Sentry Phase 1 (application-side)** | **`FOUNDER_VERIFIED_COMPLETE`** — Production Sentry config **open** |
| **Cost / unit economics** | **Partial evidence only** — no scale/performance proof |
| **Phase 2 observability** | **Not started** |

---

## 1. Supabase plan and current cost position

**Plan:** Supabase organisation is on **Pro** ($25/month base).

**Billing cycle observed:** 16 July 2026 – 16 August 2026.

| Line item | Observed |
|-----------|----------|
| Pro Plan | $25.00 |
| Micro Compute | 165 hours / $2.22 |
| Compute Credits | −$2.22 |
| Net main Micro compute | **$0** (credits offset) |
| Branching Compute | 165 hours / $2.22 |
| **Current Costs** | **$27.22** |
| **Projected Costs** | **$34.98** |

**Founder assessment:** The observed overage above the $25 base plan is attributable to **branching compute**, not evidence of excessive customer/application usage.

**Decision:** **Retain Development branching.** Environment isolation remains valuable while migrations, access-control changes and security work continue. **Do not recommend removing the Development branch** purely to save this small cost.

---

## 2. Supabase usage position

Founder-verified Usage dashboard figures (22 Jul 2026):

| Metric | Observed | Quota (Pro) |
|--------|----------|-------------|
| Monthly Active Users | 284 | 100,000 (<1%) |
| Egress | 0.018 GB | 250 GB (<1%) |
| Cached Egress | 0 | 250 GB |
| Monthly Active Third-Party Users | 0 | 100,000 |
| Monthly Active SSO Users | 0 | 50 |
| Storage Size | 0 | 100 GB |
| Storage Image Transformations | 0 | 100 |
| Realtime Concurrent Peak Connections | 0 | 500 |
| Realtime Messages | 0 | 5,000,000 |
| Edge Function Invocations | 0 | 2,000,000 |
| Log Drain Events | 0 | — |
| Branching Compute Hours | 165 h ($2.22) | — |
| Micro Compute Hours | 165 h ($2.22) | Offset by compute credits |

**Conclusion:** Current Keynetic usage is **comfortably within Supabase Pro included quotas**. There is **no evidence of uncontrolled usage-driven Supabase infrastructure cost** at present.

**Important limitation:** This does **not** prove Keynetic has been **performance-tested or proven at scale**. Performance, concurrency, database query efficiency, compute saturation, idle compute, memory leaks, blocking/event-loop behaviour and cost under realistic concurrent load remain **separate open workstreams** (§14.3 B–C in [Production Readiness Checklist](./PRODUCTION_READINESS_CHECKLIST.md)).

---

## 3. Spend cap

**Status:** Spend cap is **ENABLED**.

| Phase | Decision |
|-------|----------|
| **Development / pre-launch** | **Keep enabled** — protects against unexpected overage while the platform is still being tested |
| **Production go-live** | **Founder approval required** — assess trade-off between uncontrolled overage vs service degradation (read-only / unresponsive behaviour if included quotas are exceeded) |

**Do not automatically disable the spend cap.** Record as an explicit **Production go-live decision**.

---

## 4. Database backups

**Status:** Database backups **VERIFIED active**.

| Item | Status |
|------|--------|
| Scheduled physical backups | **Daily** (around midnight in project region, per Supabase) |
| Restore points observed | 15–22 July 2026 |
| Restore action available | **Yes** — Restore button visible per backup |
| **Restore drill performed** | **NOT YET** — no evidence in existing docs |

### Storage backup limitation (Supabase platform)

Supabase states **Storage objects are NOT included in database backups**. Database backups contain Storage **metadata** but do **not** restore deleted Storage API objects.

**Current position:** Usage dashboard showed **Storage Size = 0 / 100 GB**.

| Requirement | Status |
|-------------|--------|
| Storage backup policy before business-critical Storage use | **Future requirement** — define before relying on Supabase Storage for customer documents/images |
| Launch blocker (Storage backup) | **No** — Keynetic does not currently use Supabase Storage for business-critical objects |

---

## 5. Supabase organisation audit logs

Founder verified: **"Organization Audit Logs are not available on Free or Pro plans."** Supabase UI states **Team or Enterprise** is required.

**Decision:**

- **Do not upgrade** from Pro solely for Organisation Audit Logs at current early-stage scale
- Record as an **accepted observability limitation** at this stage
- Launch-level controls remain: **application audit events**, **Sentry**, **Supabase project/provider logs**, and **existing Keynetic audit tables**
- Reassess Team/Enterprise audit-log requirements as Keynetic scales or compliance/customer requirements change

**Distinction:** Supabase **Organisation Audit Logs** (provider) ≠ **Keynetic application-level audit records** (e.g. `email_events`, lifecycle events, GDPR tables).

---

## 6. Database connection logging

Founder verified both settings are currently **OFF**:

- Log connections
- Log disconnections

**Decision:** **Keep OFF** by default.

**Rationale:** Avoid unnecessary routine log volume/noise. Enable temporarily when diagnosing connection pooling, connection exhaustion, unexpected database connections or related incidents.

This is **intentional**, not an unresolved configuration failure.

---

## 7. Supabase usage / cost alerts

Founder searched available Supabase organisation/project settings and **could not find configurable Notifications, Alerts, or Usage Alerts** in the currently available dashboard.

**Recorded accurately:**

- No configurable usage/threshold alert controls were **identified** by the founder in the currently available Supabase dashboard
- Current cost protection is the **enabled spend cap**
- **Manual Usage dashboard review** remains required pre-launch
- **Reassess** available Supabase usage/billing alerting immediately before Production launch
- **Sentry does not replace** provider quota/billing monitoring

Do **not** state categorically that Supabase Pro provides no alerting unless provider evidence proves it — only that none were identified in this review.

---

## 8. Vercel position

**Plan:** Founder is currently on **Vercel Hobby**.

No useful spend-management configuration was available or required at this pre-launch stage.

**Decision:**

- **Do not upgrade** to Vercel Pro solely for spend controls while the application remains pre-launch
- Vercel plan / spend controls remain a **Production-readiness decision**
- Review Vercel plan requirements, limits, observability/log retention and spend controls **before Production go-live**

**Do not imply Vercel Hobby is approved as the final Production plan.**

---

## 9. External uptime monitoring

**Status:** **OPEN / PRODUCTION CONFIGURATION REQUIRED**

UptimeRobot (or equivalent) external Production uptime monitoring has **NOT** been configured because Keynetic Production is **not yet connected/deployed** as the live production service.

**Decision:** Defer external uptime monitor configuration until the **Production URL/environment is ready**.

**Mandatory Production monitors (when configured):**

| # | Target | Pass criteria |
|---|--------|---------------|
| 1 | `/` | HTTP 200 |
| 2 | `/login` | HTTP 200 |
| 3 | `/api/health` (full probe) | HTTP 200 **and** JSON `"status":"healthy"` with `"database":"ok"` |
| Optional | `/api/health?probe=app` | `"database":"skipped"` — no Supabase DB request |

---

## 10. Sentry / application Phase 1 status (preserved)

| Item | Status |
|------|--------|
| `GET /api/health` on Preview | **Founder verified** |
| Full health probe (`database: ok`) | **Verified** |
| App-only probe (`database: skipped`) | **Verified** |
| Sentry client capture on Preview | **Founder verified** |
| Sentry server capture on Preview | **Founder verified** (after serverless flush fix) |
| Temporary `/dev/sentry-verification` routes | **Removed** |
| Redeployed Preview — removed route | **Page Not Found** (expected) |
| Phase 1 application-side observability | **Ready for founder sign-off / complete** |
| Production Sentry configuration | **Open** — external Production work |
| Phase 2 observability | **Not started** |

Detail: [PRELAUNCH_OBSERVABILITY_SENTRY_VERIFICATION.md](./PRELAUNCH_OBSERVABILITY_SENTRY_VERIFICATION.md)

---

## 11. Cost / unit-economics conclusion (cautious)

At current observed usage, Supabase does **not** show evidence that ordinary Keynetic testing/user activity is producing material variable infrastructure cost. The main visible incremental Supabase cost is **Development branching compute**. This supports retaining isolated Development infrastructure while pre-launch work continues.

**However, a full Keynetic unit-economics assessment is NOT complete** until we assess:

- Vercel/serverless usage at realistic load
- Database query/read/write patterns
- Concurrent user performance
- Compute saturation · idle compute · memory leaks · blocking/event-loop behaviour
- Email volume/cost · Redis/Upstash usage
- Future Stripe costs · address lookup API cost · observability costs
- Realistic homeowner-to-paying-EA ratios

**Founder concern preserved:** Free homeowners, visitors and active non-paying users must not create infrastructure costs that make low numbers of paying EA branches economically unsustainable.

**No final £99/£129 pricing recommendation** in this document — pricing should be revisited after the cost/performance workstream provides evidence.

---

## 12. Provider review status summary

### Supabase provider review

| Item | Status |
|------|--------|
| Pro plan confirmed | **VERIFIED** |
| Usage reviewed | **VERIFIED** |
| Current cost reviewed | **VERIFIED** |
| Spend cap enabled | **VERIFIED** |
| Daily DB backups | **VERIFIED** |
| Restore availability | **VERIFIED** |
| Restore drill | **NOT PERFORMED** |
| Storage backup limitation | **DOCUMENTED** |
| Organisation Audit Logs (Pro) | **Unavailable — accepted at current stage** |
| Connection logging | **Intentionally disabled** |
| Configurable usage alerts | **Not identified in dashboard** |
| Production spend-cap decision | **OPEN — founder approval before go-live** |

### Vercel provider review

| Item | Status |
|------|--------|
| Hobby plan confirmed | **VERIFIED** |
| Production plan / spend-control review | **OPEN** |

### External uptime

| Item | Status |
|------|--------|
| Production monitor configuration | **OPEN — deferred until Production URL ready** |
| Mandatory at Production launch | **Yes** |

### Sentry

| Item | Status |
|------|--------|
| Preview client/server verification | **COMPLETE** |
| Temporary verification surface | **Removed** |
| Production configuration | **OPEN** |

---

## 13. Remaining Production configuration items (external)

1. Production Vercel deployment + approved Production URL
2. Production Supabase branch parity / migrations (separate workstream)
3. Production `NEXT_PUBLIC_SENTRY_DSN` (+ optional source map vars)
4. External uptime monitor on `/`, `/login`, `/api/health`
5. Production spend-cap decision (Supabase)
6. Vercel plan decision (Hobby vs Pro) for Production
7. Reassess Supabase usage/billing alerting before go-live
8. Optional: Supabase restore drill before Production cutover
9. Phase 2 alerting (not started — separate approval)

---

*End of provider review record.*
