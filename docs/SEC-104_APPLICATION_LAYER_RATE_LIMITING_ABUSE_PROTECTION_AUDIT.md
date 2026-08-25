# SEC-104 — Application-Layer Rate Limiting & Abuse Protection Audit

**Workstream:** Pre-Launch Platform Security  
**Date:** 2026-07-29 (audit) · **Remediation drafted 2026-07-29**  
**Status:** **REMEDIATION IMPLEMENTED IN REPO — AWAITING DEVELOPMENT APPLY**  
Migration: `supabase/migrations/20260729120000_sec104_rpc_rate_limiting.sql`  
Verifier: `scripts/verify-sec104-rate-limiting-development.ts`  

**Do not mark SEC-104 CLOSED until** the migration is applied to Development (`bbbsxzxcjkmpqsfvmhbo`) and `verify-sec104-rate-limiting-development.ts --execute` passes.

**Prior art:** `docs/SEC-104_AUTHENTICATION_ABUSE_RATE_LIMITING_AUDIT.md` (2026-07-25, auth-focused).

**Development project:** `bbbsxzxcjkmpqsfvmhbo`  
**Production:** untouched (parity required before launch)

---

## 0. Remediation summary (minimum launch architecture)

### Architecture chosen: Hybrid (Option D)

| Layer | Role |
|-------|------|
| **Supabase Auth** | Authoritative for login / signup / reset / resend / token limits |
| **email_events invitation guards** | Unchanged — 3/15min + 60s idempotency |
| **Postgres `rpc_rate_limit_buckets`** | Authoritative for Keynetic RPC workflows callable via PostgREST |
| **Upstash** | Retained only for privacy-admin subject lookup — **not** expanded |

**No Redis product, no CAPTCHA, no auth proxy.**

### Verified Supabase Development Auth Rate Limits (founder, 2026-07-29)

| Setting | Value |
|---------|-------|
| Auth email sending | **2 emails/hour** |
| SMS | 30/hour |
| Token refresh | 150 / 5 min / IP |
| Token verification | 30 / 5 min / IP |
| Anonymous users | 30 / hour / IP |
| Signup + sign-in | 30 / 5 min / IP |
| Web3 signup + sign-in | 30 / 5 min / IP |
| IP address forwarding | **OFF** |

**AUTH EMAIL DELIVERY (launch-readiness — separate workstream):**  
Development Auth email limit = **2/hour**. Production Auth email delivery / custom SMTP **must be reviewed before launch**. Not changed in this remediation.

### Exact Postgres limits

| Scope | Limit | Window | Key | Counts | Public error |
|-------|-------|--------|-----|--------|--------------|
| `join_chain_failed` | **10** | 15 min | `user_id` | Failed attempts only | `join_details_not_matched` (oracle-safe) |
| `claim_property_failed` | **15** | 15 min | `user_id` | Failed attempts only | `too_many_attempts` (checked before token eval) |
| `create_chain_homeowner` | **10** | 1 hour | `user_id` | Successful creates | `too_many_attempts` |
| `create_chain_ea` | **40** | 1 hour | `user_id` | Successful creates | `too_many_attempts` |
| `upsert_operational_summaries` | **60** | 15 min | `user_id:chain_id` | Every upsert | exception `rate_limited` |
| `validate_onboarding_address` | — | — | — | **DEFERRED P3** | — |

### Privacy / concurrency / retention

- **Privacy:** subject keys are `user_id` (and `user_id:chain_id` for summaries). No access codes, tokens, passwords, raw IPs, or request bodies.
- **Concurrency:** `INSERT ... ON CONFLICT DO UPDATE SET attempt_count = attempt_count + 1` is atomic; concurrent callers cannot both read a stale pre-increment count for consume paths. Join uses check-then-increment-on-failure (bounded overshoot acceptable).
- **Retention:** opportunistic delete of stale windows for the subject + bounded 24h global trim (200 rows) on each write. No dedicated cron.

### Direct PostgREST bypass

Limits live **inside** SECURITY DEFINER RPCs → authenticated clients cannot bypass via PostgREST. Ledger table RLS enabled; anon/authenticated revoked.

**Helper EXECUTE hardening (20260729130000):** PostgreSQL grants `EXECUTE` to `PUBLIC` by default on `CREATE FUNCTION`, and Supabase default privileges typically also grant `EXECUTE` to `anon`/`authenticated`. The initial SEC-104 migration only `REVOKE`d from `PUBLIC`, which left helpers callable via PostgREST. Corrective migration revokes every internal helper from `PUBLIC`, `anon`, and `authenticated` with exact signatures. Workflow RPCs still call helpers as the SECURITY DEFINER owner.

### Deferred

- SEC-104D address validation soft throttle (P3)
- Production Auth Dashboard verification / custom SMTP
- Optional Upstash on `/auth/confirm`

---

## 1. Executive verdict (audit baseline)

**SEC-104 remains OPEN until Development migration apply + live verifier pass.** Design and repo remediation are complete for the minimum launch architecture.

Keynetic already has:

| Layer | What exists today |
|-------|-------------------|
| **Supabase Auth (GoTrue)** | Platform rate limits / email cooldowns for browser-direct `signIn` / `signUp` / `reset` / `resend` / `verify` / MFA (values **require founder Dashboard verification**) |
| **Authorisation hardening** | Chain join generic failure, revoked oracles, operational-identity grants, invitation token validation, RLS |
| **Email send guards** | Homeowner + EA invitation: **3 sends / 15 min** + **60s idempotency** via `email_events` (`invitationSendSecurity.ts`) |
| **Upstash primitive** | `@upstash/redis` + `consumeRateLimit` — used today **only** for privacy-admin subject lookup (fail-closed) |
| **Cron auth** | `CRON_SECRET` bearer for lifecycle / chain-intelligence workers |
| **Dev gating** | `/api/dev/*` gated to `NODE_ENV=development`; `/api/debug/environment` 404 in production |

**What is missing:**

1. **Authoritative app-layer limits on client-callable Postgres RPCs** that authenticated users can hammer directly via PostgREST (`join_chain_property`, `validate_onboarding_property_address`, claim RPCs, chain create, summary upsert, etc.).
2. **Founder-verified Production Supabase Auth Dashboard** configuration (P1 gate — not code).
3. **Per-user throttle on join / onboarding probes** (abuse + DB cost), without reintroducing code-validity oracles.
4. Optional **Upstash on `/auth/confirm`** (server-side recovery OTP) — only Keynetic-owned auth path that can see end-user traffic poorly under shared egress IP.

**Recommended architecture for launch: Option D (Hybrid)** — keep Supabase/provider protection for GoTrue; keep DB `email_events` guards for Resend invitations; add **Postgres-backed attempt limits at the RPC mutation boundary** only for high-risk authenticated business RPCs; **do not** introduce new paid infrastructure solely for auth login throttling.

---

## 2. Complete exposed-surface inventory

### 2.1 Next.js API routes

| SURFACE | ACTOR | OPERATION | AUTH | AUTHORISATION | RATE LIMIT | PLATFORM LIMIT | ABUSE CONSEQUENCE | RECOMMENDED CONTROL |
|---------|-------|-----------|------|---------------|------------|----------------|-------------------|---------------------|
| `POST /api/communications/homeowner-invitation` | authenticated | Send claim invitation email via Resend | Session | RPC `validate_property_claim_invitation_for_email_send` + EA/property authority | **3/15min per property** + 60s idempotency (`email_events`) | Resend plan | Email spam / cost / reputation | **Keep**; optionally add per-`user_id` cap |
| `POST /api/communications/estate-agent-invitation` | authenticated | Send EA branch invite email | Session | RPC `validate_ea_branch_invitation_for_email_send` | **3/15min per recipient email** + 60s idempotency | Resend plan | Same | **Keep**; optionally add per-`user_id` / `branch_id` |
| `GET/POST /api/cron/property-lifecycle` | cron / bearer | Lifecycle worker batch | `CRON_SECRET` | Secret only | None (scheduler) | Vercel Cron | Unauthorized batch if secret leaked | Secret hygiene; no public RL needed |
| `GET/POST /api/cron/chain-intelligence` | cron / bearer | CI refresh worker | `CRON_SECRET` | Secret only | None | Vercel Cron | Same | Same (not in vercel.json crons yet) |
| `GET /api/health` | anon | Health + optional DB probe | None | Public | None | Vercel edge | Mild cost amplification | Optional IP RL P3; keep lightweight |
| `GET /api/debug/environment` | anon | Env presence flags | None | **404 in production** | N/A | — | Config disclosure if mis-gated | Keep production 404 |
| `GET /api/dev/email-events` | authenticated | List email events (service role) | Session | **Dev-only** (`isDeveloperEmailToolsEnabled`) | None | — | PII leak if reachable in prod | Keep `NODE_ENV=development` gate |
| `GET /api/dev/emails/render` | — | Template render | Dev gate | Dev-only | None | — | Same | Keep gated |

### 2.2 Auth UI (browser → Supabase GoTrue direct)

| SURFACE | ACTOR | OPERATION | AUTH CONTROL | AUTHORISATION | KEYNETIC RL | SUPABASE RL (docs default) | ABUSE | RECOMMENDED |
|---------|-------|-----------|--------------|---------------|-------------|----------------------------|-------|-------------|
| `/login` password | anon | `signInWithPassword` | GoTrue | Account exists | **None** | Token IP bucket ~1800/hr burst 30 | Credential stuffing | Provider + Dashboard verify; no Redis on UI |
| `/login` signup | anon | `signUp` | GoTrue | Creates user | **None** | Signup cooldown ~60s/user; SMTP caps | Mass accounts / email | Provider; custom SMTP on prod |
| `/estate-agents/login` | anon | `signInWithPassword` | GoTrue | Same | **None** | Same | Same | Same |
| `/estate-agents/signup` | anon | `signUp` + EA profile | GoTrue + RPC | Creates EA | **None** | Same | EA spam accounts | Provider + EA onboarding gates |
| `/forgot-password` | anon | `resetPasswordForEmail` | GoTrue | Email queue | **None** | ~60s/user recover | Reset flooding | Provider |
| `/verify-email` resend | **anon** (email editable) | `resend({type:signup})` | GoTrue | Email queue | **None** | ~60s/user | Verification spam | Provider; monitor |
| `/auth/confirm` | anon (token) | Server `verifyOtp` recovery | Token | Creates recovery session | **None** | Verify IP ~360/hr — **may be Vercel egress** | Token brute / shared IP | Optional Upstash on this route only |
| `/reset-password` | recovery session | `updateUser` password | Session | Password hash | **None** | Authenticated update | Low | Password policy |
| Platform admin MFA | platform admin | `mfa.*` | Session + AAL | Admin | **None** | MFA 15/hr/IP | Low volume | Provider |
| Privacy admin subject lookup | platform admin | Server Action | AAL2 | Admin | **Upstash 20/min fail-closed** | — | Enumeration | **Keep** |

### 2.3 Client-callable business RPCs (authoritative boundary)

Authenticated users can call these **directly via PostgREST** — Next.js UI limits alone are **insufficient**.

| SURFACE | ACTOR | OPERATION | AUTHZ (summary) | CURRENT RL | ABUSE | RECOMMENDED CONTROL |
|---------|-------|-----------|-----------------|------------|-------|---------------------|
| `join_chain_property` | authenticated | Join counterparty | Email verified + code+address+postcode match | **None** | Guessing / flood | **Postgres attempt ledger** keyed by `user_id` (+ optional IP hash); generic error only |
| `validate_onboarding_property_address` | authenticated | Duplicate address check | Caller-owned chain | **None** | Address probing (scoped) | Soft per-`user_id` limit |
| `create_chain_for_onboarding` | authenticated | Create chain | Email gate | **None** | Chain spam | Per-`user_id` create cap |
| `establish_operational_homeowner_for_created_property` | authenticated | Start Move grant | `created_by_user_id` | **None** | Low if create capped | Rely on create cap |
| `claim_operational_property` | authenticated | Claim EA property | Invite email match / token | **None** | Claim spam | Per-`user_id` + per-`property_id` |
| Invitation create/resend RPCs | authenticated | Create invitation rows | Property/EA authority | Send API limited; **RPC create not** | Row spam before send | Cap invitation creates per property/branch |
| `upsert_operational_summaries` | authenticated | Persist summaries | Chain operational viewer | **None** | CPU/write amplification | Cap refresh per `chain_id`/`user_id` or move to service-only |
| EA originate RPCs | authenticated EA | Create chain/property | Branch membership | **None** | EA write spam | Per-branch create caps |
| Delink / delegate RPCs | authenticated | Mutate participation | Identity checks | **None** | Low likelihood | Soft per-user mutation cap P3 |
| GDPR / lifecycle / email_events RPCs | admin / service | Sensitive | Hardened grants | Admin Upstash where used | — | Keep revoked from strangers (platform 36/36) |

### 2.4 Middleware / proxy

`middleware.ts` — **session + route guards only**. No rate limiting. Matcher covers account-gated product routes; **does not** wrap `/api/communications/*` or GoTrue.

### 2.5 Contact forms

**None found** in application routes for public marketing contact submission.

---

## 3. Supabase Auth protection

### A. Known from architecture / public docs (not project-verified)

Source: [Supabase Auth rate limits](https://supabase.com/docs/guides/auth/rate-limits) + prior Keynetic auth audit.

| Endpoint class | Documented default | Customizable? |
|----------------|-------------------|---------------|
| Built-in SMTP email sends | 2/hour project-wide | Custom SMTP only |
| Signup / recover / confirmation resend per user | ~60s cooldown | Yes |
| OTP sends | ~30/hour project-wide | Yes |
| Token (password login + refresh) | ~1800/hour per IP, burst 30 | No |
| Verify (OTP exchange) | ~360/hour per IP, burst 30 | No |
| MFA challenge/verify | ~15/hour per IP | No |

### B. Development configuration verified from repository

| Item | Evidence |
|------|----------|
| Browser-direct auth clients | `lib/supabase.ts`, login/signup/forgot/verify pages |
| Password policy (client) | `lib/auth/passwordPolicy.ts` |
| Dashboard checklist exists | `docs/SUPABASE_AUTH_DASHBOARD_CHECKLIST.md` |
| Email confirmation required for transaction RPCs | `_require_verified_email_for_transaction` in migrations |

### C. Unknown — requires founder Dashboard verification

| Item | Why |
|------|-----|
| Exact Rate Limits slider values on Dev + Prod | Not in repo |
| Custom SMTP enabled on Production | Deliverability + email caps |
| Email confirmations enabled | Launch blocker if off |
| CAPTCHA / bot protection | Off recommended at launch unless pen-test |
| `Sb-Forwarded-For` / IP forwarding | Affects `/auth/confirm` IP identity |
| Leaked password protection (HIBP) | Plan-dependent |
| OTP expiry (recommend 900s) | Checklist |

**Application-layer rate limiting on top of GoTrue is NOT necessary for launch** for password login/signup/reset/resend **if** Dashboard settings are verified. It **cannot** be authoritative without auth proxying.

---

## 4. Abuse threat model (summary)

| # | Scenario | Likelihood | Impact | Existing mitigation | RL needed? | Dimension |
|---|----------|------------|--------|---------------------|------------|-----------|
| 1 | Credential stuffing | Medium | Account takeover | GoTrue IP token bucket; generic errors | **No** (provider) | IP (Supabase) |
| 2 | Mass signup | Medium | DB/user pollution; email cost | Signup cooldown; SMTP caps | **No** at launch | Email (Supabase) |
| 3 | Password-reset flooding | Medium | Annoyance; deliverability | 60s/user recover | **No** | Email (Supabase) |
| 4 | Verification resend flood | Medium | Same | 60s/user | **No**; monitor `/verify-email` | Email |
| 5 | Homeowner invitation email flood | Low–Med | Resend cost; reputation | **3/15min property** | **Already yes** | property_id (+ user_id optional) |
| 6 | EA invitation flood | Low–Med | Same | **3/15min recipient** | **Already yes** | recipient (+ branch) |
| 7 | Access-code guessing | Medium | DB load; no auth grant | Generic `join_details_not_matched`; auth required | **Yes** | `user_id` (+ optional IP hash) |
| 8 | `join_chain_property` flood | Medium | Write attempts / load | Authz + email gate | **Yes** | `user_id` |
| 9 | Address/postcode probing | Low–Med | Scoped oracle only | Chain-owned validation | Soft **Yes** | `user_id` |
| 10 | Duplicate-property probing | Low–Med | Same as 9 | Same | Soft **Yes** | `user_id` |
| 11 | Property claim attempts | Low | Claim noise | Token/email match | Soft **Yes** | `user_id`+`property_id` |
| 12 | Operational-summary refresh | Medium | CPU + writes | Viewer-scoped upsert | Soft **Yes** | `user_id`+`chain_id` |
| 13 | Comms API abuse | Low | Email | Guards + authz | Monitor | Already limited |
| 14 | RPC mutation flooding | Medium | DB growth | Authz per RPC | Selective **Yes** | `user_id` |
| 15 | Paid third-party (Resend) | Medium | Cost | Invitation guards | Keep | property/email |
| 16 | Large DB writes | Medium | Cost | Authz | Caps on create/join | `user_id` |
| 17 | Audit/event row spam | Low–Med | `email_events` / delink events | Invitation guards | Cap creates | property/user |
| 18 | EA signup/branch abuse | Low | Fake EA orgs | Signup cooldown | Soft EA create caps | `user_id`/branch |
| 19 | Dev/admin endpoints | Low | PII if misdeployed | NODE_ENV / CRON_SECRET / AAL2 | Keep gates | — |

---

## 5. Chain join after hardening (Phase 4)

**Authorisation (unchanged):** Access codes are identifiers. Join requires authenticated + verified email + matching code/address/postcode. Failures return **`join_details_not_matched`** only.

**Remaining abuse:** An authenticated attacker can call `join_chain_property` **unlimited times** via PostgREST. That cannot create authority for wrong details, but can:

- Amplify DB load
- Probe for timing differences (mitigated if work is constant-ish)
- Create noise if any logging is too detailed

**Rate limit recommendation:**

| Dimension | Why |
|-----------|-----|
| Primary: `auth.uid()` | Authenticated surface; IP alone bypassable via many accounts |
| Optional secondary: hashed IP | Slow multi-account from one egress |
| **Do not** key primarily on access-code candidate | Different codes → different buckets could leak “this code is interesting” if combined with other signals |

**Oracle safety rules for any join RL:**

1. Same public error for authz failure and rate limit **OR** a single generic “try again later” that is **independent of whether code/address matched**.
2. Prefer: on rate limit, return `{ ok: false, error: "join_details_not_matched" }` **or** a dedicated `too_many_attempts` that is returned for **all** join attempts after threshold — **never** only after a “near miss”.
3. Best practice: consume attempt **before** revealing success path differences; successful joins may reset or use a separate higher success quota.
4. Do **not** log plaintext access codes in rate-limit tables.

**`validate_onboarding_property_address`:** Already scoped to caller-owned chain — not a global oracle. Soft per-user limit still recommended for write/CPU hygiene.

---

## 6. Email abuse (Phase 5)

| Route / path | Caller | Auth | Authz | Recipient control | Idempotency | Cooldown/RL | Audit | Resend? |
|--------------|--------|------|-------|-------------------|-------------|-------------|-------|---------|
| Homeowner invitation API | Authenticated EA/HO workflow | Session | Token validation RPC | **No** — from claim metadata | 60s success idempotency | **3/15min/property** | `email_events` | Yes |
| EA invitation API | Branch admin | Session | Token validation RPC | **No** — from invitation row | 60s | **3/15min/email** | `email_events` | Yes |
| GoTrue signup/confirm/reset/resend | Anon/browser | GoTrue | N/A | Caller supplies email | Provider | Provider | GoTrue | Supabase SMTP/custom |
| Lifecycle dormancy warning | Cron + service role | Cron secret | Worker | System-selected recipients | Worker design | Cron schedule | Lifecycle tables | Yes (worker) |

**Do not weaken invitation controls.** Optional enhancement: per-`user_id` send cap across properties (e.g. 10/hour) to stop multi-property spray.

---

## 7. Cost amplification (Phase 6)

| Trigger | Amplification | Protect at |
|---------|---------------|------------|
| `refreshOperationalSummary` / `upsert_operational_summaries` | Multi-query derive + upserts | **RPC / app persist boundary** |
| `join_chain_property` success | Membership + counterparty + property update | RPC (attempts on failure too) |
| Invitation send | Resend API + `email_events` | **Already API** |
| Lifecycle / CI cron | Large batches | Cron secret + schedule |
| `/api/health?` DB probe | Light DB | Optional CDN/IP P3 |

Prefer **authoritative RPC/DB controls** over disabling UI buttons.

---

## 8. Architecture options (Phase 7)

| Option | Security | Complexity | Cost | Latency | Availability | Bypass resistance | Verdict |
|--------|----------|------------|------|---------|--------------|-------------------|---------|
| **A — Postgres attempt ledger** | High for RPCs | Medium | Low | Low | Same as DB | **Strong** (PostgREST cannot bypass) | **Primary for join/claim/create** |
| **B — Vercel/platform** | Good for HTTP | Low | Incl. | Edge | Platform | **Weak** for direct Supabase RPC | Secondary only |
| **C — Upstash Redis** | Good for Next routes | Low–Med | Usage | Low | Extra dep | **Weak** for RPC; **good** for `/auth/confirm` + privacy admin | Keep existing; expand sparingly |
| **D — Hybrid (recommended)** | Best fit | Medium | Low | Low | Minimal new deps | Strong where it matters | **Launch choice** |

### Option D detail

1. **Auth:** Supabase GoTrue limits (Dashboard-verified) — no auth proxy for launch.
2. **Invitation email:** Keep Postgres `email_events` guards.
3. **Join / onboarding / claim / chain create / summary upsert:** Postgres rate/attempt functions inside or wrapping SECURITY DEFINER RPCs.
4. **Privacy admin / optional `/auth/confirm`:** Existing Upstash primitive.
5. **No new Redis product required** for SEC-104 launch closure if Postgres ledgers cover RPC abuse.

---

## 9. Privacy / data design (Phase 8)

If storing attempt history:

| Prefer | Avoid |
|--------|-------|
| `user_id` UUID keys | Raw access codes |
| Short TTL (e.g. 15–60 min windows) | Indefinite attempt logs |
| Hashed IP (`sha256(ip + server_pepper)`) if needed | Raw IP long-term without policy |
| Counts + window_start only | Request bodies, passwords, tokens |
| Auto-expire / truncate | PII in application logs |

Access codes must **not** appear in rate-limit rows or structured logs in plaintext.

---

## 10. Concrete launch policy (Phase 9)

| Surface | Limit | Window | Key | Response | User UX | Provider handles? | Keynetic required? |
|---------|-------|--------|-----|----------|---------|-------------------|--------------------|
| Login | Supabase token defaults | 1h / burst | IP | Provider throttle | Generic login failure | **Yes** | No (verify Dashboard) |
| Signup | ~60s/user + SMTP | — | Email | Provider | “Check email” / wait | **Yes** | No |
| Password reset | ~60s/user | — | Email | Provider | Generic success copy | **Yes** | No |
| Verification resend | ~60s/user | — | Email | Provider | Wait message | **Yes** | No |
| Homeowner invite send | **3** | **15 min** | property_id | `rate_limited` | “Try again later” | No (Resend) | **Already** |
| EA invite send | **3** | **15 min** | recipient email | `rate_limited` | Same | No | **Already** |
| Join chain | **10 failed attempts** | **15 min** | user_id | Same generic error family | Soft message if `too_many_attempts` used consistently | No | **Yes (Postgres)** |
| Onboarding address validate | **30** | **15 min** | user_id | Generic fail / throttle | Mild | No | Soft **Yes** |
| Property claim | **10** | **15 min** | user_id | Generic | Mild | No | Soft **Yes** |
| Chain create | **5** | **1 hour** | user_id | Error | “Limit reached” | No | Soft **Yes** |
| Summary upsert/refresh | **20** | **15 min** | user_id+chain_id | Error | Background retry | No | Soft **Yes** |
| Comms routes | Existing | — | — | — | — | — | Keep |
| Expensive cron | Schedule + secret | — | — | 401 | N/A | Vercel | Keep |

Numbers chosen to allow legitimate Start Move (few address checks), one join, and retries without blocking normal chain activity; block automated guessing.

---

## 11. SEC-104 sub-findings (Phase 10)

| ID | Gap | Severity | Evidence | Attack | Impact | Mitigation today | Remediation | Layer | Migration? | External svc? | Launch blocker? |
|----|-----|----------|----------|--------|--------|------------------|-------------|-------|------------|---------------|-----------------|
| **SEC-104A** | Auth abuse (browser→GoTrue) | **P2** | Auth audit; no app RL on login | Stuffing / reset spam | Account / email | GoTrue defaults | Dashboard verify; defer proxy | Provider | No | No | **Dashboard verify = P1 gate** |
| **SEC-104B** | Email abuse (Resend) | **P2** (mostly closed) | invitationSendSecurity | Spray invites | Cost/reputation | 3/15min | Optional user_id cap | API+DB | Optional | No | No |
| **SEC-104C** | Chain join guessing | **P2** | join RPC authenticated unlimited | Automated join attempts | Load / probe | Generic errors; authz | Postgres attempt limit | RPC/DB | **Yes** | No | No (not auth bypass) |
| **SEC-104D** | Onboarding/address probing | **P3** | validate_onboarding scoped | Scoped probes | Low info leak | Chain ownership | Soft user limit | RPC/DB | Optional | No | No |
| **SEC-104E** | Mutation/cost amplification | **P2** | upsert_operational_summaries EXECUTE authenticated | Refresh spam | CPU/writes | Viewer authz | Cap or service-role-only persist | RPC | Optional | No | No |
| **SEC-104F** | Other (dev endpoints, health, cron) | **P3** | Gated routes | Misconfig | Disclosure | NODE_ENV / secrets | Hygiene | Platform | No | No | No |

**No new P0** identified in this audit that is unrelated to rate limiting. Chain join cannot grant access from code alone (40/40).

---

## 12. Minimum launch architecture (answer)

> **What is the minimum rate-limiting and abuse-protection architecture Keynetic actually needs for launch, given the protections Supabase already provides?**

**Minimum:**

1. **Founder-complete Supabase Auth Dashboard verification** on Production (rate limits, email confirmations, custom SMTP, OTP expiry, redirect allow-list) — **P1 gate**.
2. **Keep** invitation email guards (`email_events` 3/15min + idempotency).
3. **Add Postgres-backed attempt limiting** on `join_chain_property` (and preferably chain create / claim) at the **RPC boundary**, with oracle-safe responses — **no new Redis product required**.
4. **Keep** Upstash only where already used (privacy admin); optionally add to `/auth/confirm` later.
5. **Do not** build a full auth proxy or CAPTCHA for launch unless abuse is observed.

---

## 13. Expected change inventory (for future remediation — not done now)

| Area | Expected |
|------|----------|
| DB migrations | Yes — attempt ledger + join (and maybe claim/create) wrappers |
| Application | Soft UX for throttle; no auth rewrite |
| Supabase Dashboard | Verification + record values |
| Vercel | Ensure `CRON_SECRET`; Upstash env only if expanding Redis use |
| New third-party | **Not necessary** for minimum launch |

---

## 14. Files inspected

- `middleware.ts`, `vercel.json`, `package.json`
- `app/api/**` (health, cron, communications, debug, dev)
- `app/login`, `forgot-password`, `verify-email`, `auth/confirm`, `join-chain`, `start-move`, `claim`, EA login/signup
- `lib/cache/rateLimit.ts`, `redis.ts`, `cacheKeys.ts`
- `lib/communications/invitationSendSecurity.ts`, `config.ts`
- `lib/privacyAdmin/actions.ts`
- `lib/operationalSummary/refreshOperationalSummary.ts`
- `supabase/migrations/20260727100000_chain_join_security_remediation.sql` (+ prior auth/email migrations)
- Prior docs: `SEC-104_AUTHENTICATION_ABUSE_RATE_LIMITING_AUDIT.md`, `SUPABASE_AUTH_DASHBOARD_CHECKLIST.md`, `PRELAUNCH_PLATFORM_SECURITY_ARCHITECTURE_AUDIT.md` §26, `ACCOUNT_SECURITY.md`

## 15. Files changed

- `docs/SEC-104_APPLICATION_LAYER_RATE_LIMITING_ABUSE_PROTECTION_AUDIT.md` (this file)

## 16. Production

**Untouched.** Audit/design only.
