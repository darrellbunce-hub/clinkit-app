# Production Readiness Checklist

**Audit date (§14 refresh):** 2026-07-22  
**Audit type (§14 refresh):** Staging smoke-test audit, EA navigation audit, EA access verification, **Workstream 2 observability audit** — no Production changes

---

## How to read this document

| Symbol | Meaning |
|--------|---------|
| **Verified** | Probed on Development via PostgREST / verification script |
| **Inferred** | Deduced from git history, architecture docs, or prior audit notes |
| **Unknown** | Requires Supabase Dashboard / SQL Editor on Production branch |

---

## 1. Current Production state

### Application code (`main` branch → Production Vercel)

**Inferred from git — Production deploys `main`, which is far behind `staging-test`.**

| Area | Production (`main`) state |
|------|---------------------------|
| Supabase migrations in repo | **None** — `supabase/migrations/` does not exist on `main` |
| `ChainContext` | Legacy — reads base `properties`; no `chain_properties_participant` |
| Dashboard / chain labels | **No PR5 privacy helpers** — peer addresses can render |
| Join / Start Move | Blind `property_members` inserts — **duplicate membership risk** |
| Route authorization | **None** — `/chain/{id}` open to any logged-in user |
| Estate Agent platform | **Not present** on `main` |
| Middleware / account-type guards | **Not present** or minimal vs `staging-test` |
| `ensurePropertyMembership` | **Not present** |
| Server layout gates | **Not present** |

**Commits on `staging-test` not on `main`:** 15+ commits including PR5 app work (`6fcb536`), EA PR1–PR2, topology, buyer-ready, completion lifecycle.

### Database (Production Supabase branch)

**Unknown — direct probe not possible without Production branch credentials.**

**Inferred from prior investigation (do not treat as verified):**

| Object | Likely Production state |
|--------|-------------------------|
| Core schema (chains, properties, etc.) | Present (production app historically ran) |
| Phase 4 / EA migrations | Partially or fully applied (EA features referenced in audits) |
| `20260610200000` PR5 | **Likely partial** — same failure mode as Dev before reconciliation |
| `20260610215000` dedup + UNIQUE | **Unknown** — probably **not applied** unless run manually on Production branch |
| `20260610220000` reconciliation | **Unknown** — probably **not applied** |
| `current_user_property_role` | **Unknown** — likely missing if reconciliation not run |
| `chain_properties_participant` (current def) | **Unknown** — may use legacy inline role subquery |
| Base-table RLS (`properties`, `activities`, `property_members`) | **Unknown** — likely missing if PR5 partial |
| `property_members` duplicates | **Unknown** — risk if UNIQUE constraint absent |

> **Note:** Early PR5 investigations accidentally ran SQL against the **Production Supabase branch** while the app used **Development**. Production may contain a **different partial-apply footprint** than Development — confirm via SQL Editor before deploying.

---

## 2. Current Development state

### Application code (`staging-test` branch + local uncommitted)

| Area | Development state |
|------|-------------------|
| Branch | `staging-test` @ `6fcb536` + **uncommitted** route-auth work |
| Migrations in repo | All 14 files under `supabase/migrations/` (Phase 1–5) |
| PR5 app privacy | **Present** — participant view, label helpers, idempotent membership |
| Route authorization | **Present locally, not committed** — see § Code differences |
| EA platform | **Present** |
| Build | **Passes** (`npm run build`) |

**Uncommitted files (route authorization — required for production parity):**

```
app/chain/[chainId]/layout.tsx
app/buyer-ready/[chainId]/layout.tsx
app/property/[propertyId]/layout.tsx
app/not-found.tsx
lib/auth/chainAccess.ts
lib/auth/propertyAccess.ts
lib/supabase/server.ts
lib/auth/index.ts (exports)
app/chain/[chainId]/page.tsx (auth cleanup)
app/buyer-ready/[chainId]/page.tsx (auth cleanup)
app/property/[propertyId]/page.tsx (auth cleanup)
docs/PR5_COMPLETION_REPORT.md
```

### Database (`bbbsxzxcjkmpqsfvmhbo`) — **Verified 2026-06-06**

User-confirmed applied: `20260610215000`, `20260610220000`.

#### Functions / RPCs — Verified callable

| Function / RPC | Status |
|----------------|--------|
| `is_chain_participant(p_chain_id)` | OK |
| `is_property_member(p_property_id)` | OK |
| `is_ea_assigned_to_property(p_property_id)` | OK |
| `current_user_property_role(p_property_id)` | OK |
| `ensure_property_membership(p_property_id, p_role)` | OK |
| `join_chain_property(...)` | OK |
| `resolve_chain_for_join(...)` | OK |
| `property_exists_for_onboarding(...)` | OK |
| `establish_connected_hop(...)` | OK |
| `break_chain_connection(...)` | OK |
| `get_next_chain_position(...)` | OK |

#### Views — Verified exist

| View | Status |
|------|--------|
| `chain_properties_participant` | OK — peer address redaction **works** |
| `chain_nodes_chain_summary` | OK |
| `agent_branch_property_summaries` | OK |

#### Membership integrity — Verified

| Check | Status |
|-------|--------|
| `UNIQUE (property_id, user_id)` | OK — duplicate insert → `23505` |
| `ensure_property_membership` idempotent | OK |
| Dashboard loads chains | OK (user confirmed) |

#### RLS — **Live verified 25 Jul 2026 (supersedes June probe)**

| Table | Expected (post-10220000) | Development live probe (`verify-platform-security-development.ts --execute`) |
|-------|--------------------------|-------------------------------------------------------------------------------|
| `properties` anon | Blocked | **OK** — empty/denied |
| `properties` authenticated stranger | 0 rows / blocked | **OK** — unrelated fixture property not readable |
| `properties` participant own row | Allowed | **OK** |
| `property_members` stranger | Blocked / scoped | **OK** — empty on unrelated fixture |
| `activities` stranger | Blocked / scoped | **OK** |
| `chains` stranger by ID | 0 rows | **OK** |
| `chain_properties_participant` privacy | Peer address null | **OK** (prior script) |

**Historical note:** June 2026 checklist probe and `verify-participant-privacy-rls.mjs` **10/11** reflected a **stale Development state**. Live verification **25 Jul 2026** shows base-table RLS **enforced** for stranger reads. Re-run privacy script optional; platform verifier is canonical for SEC-003.

**Catalog SQL:** `scripts/verify-platform-security-catalog.sql` — run in SQL Editor for grant/policy inventory snapshot.

---

## 3. Code differences (Development vs Production)

### Git branches

| | `main` (Production) | `staging-test` (Development) |
|--|---------------------|------------------------------|
| Migration files | 0 | 14 |
| PR5 privacy app layer | No | Yes |
| Route authorization layouts | No | Yes (uncommitted) |
| EA platform | No | Yes |
| `middleware.ts` account guards | Minimal/legacy | Full |
| Estimated diff size | — | ~18,000 insertions vs `main` |

### Behavioural impact if Production code deploys against a PR5-hardened DB

| Scenario | Risk |
|----------|------|
| App reads base `properties` without view | Peer addresses may leak if RLS absent; empty/error if RLS active |
| Blind membership inserts | `23505` errors if UNIQUE applied; duplicates if not |
| `/chain/{id}` without layout gate | URL enumeration / partial page render |
| Missing `ensure_property_membership` | Join/start-move failures under UNIQUE constraint |

### Required code merge before Production

1. Merge `staging-test` → `main` (or release branch).
2. **Commit and include** route authorization files (currently uncommitted).
3. Set Production Vercel env vars to **Production Supabase branch** URL + anon key.
4. Run `npm run build` on merged branch.

---

## 4. Database migration differences

### Full migration inventory (repository — on `staging-test` only)

| Migration | Purpose |
|-----------|---------|
| `20260608120000_phase2a_chain_nodes_chain_summary.sql` | Participant buyer-ready view |
| `20260609120000_phase3a_searching_placeholder_schema.sql` | Searching placeholder schema |
| `20260610120000_phase4a_completion_lifecycle_schema.sql` | Completion lifecycle columns |
| `20260610130000_phase4b_chains_completion_update_policy.sql` | Chains participant RLS |
| `20260610140000_phase4c_completion_date_amendment.sql` | Completion amendment |
| `20260610150000_phase1_ea_foundation_schema.sql` | EA foundation |
| `20260610160000_phase1_profiles_self_service_rls.sql` | Profiles RLS |
| `20260610170000_phase4_ea_property_assignments.sql` | EA assignments; `is_property_member`, `is_ea_assigned_to_property` |
| `20260610180000_fix_ea_companies_insert_founding_rls.sql` | EA companies RLS fix |
| `20260610190000_fix_ea_founder_select_during_onboarding.sql` | EA founder select fix |
| `20260610200000_phase5_homeowner_privacy_rls.sql` | Full PR5 (helpers, view, RLS, RPCs) |
| `20260610210000_fix_chain_properties_participant_role_subquery.sql` | View role fix (**superseded by 10220000**) |
| `20260610215000_property_members_deduplicate_and_unique.sql` | Dedup, UNIQUE, `ensure_property_membership` |
| `20260610220000_reconcile_phase5_homeowner_privacy_rls.sql` | PR5 reconciliation |
| `20260610225000_drop_legacy_permissive_rls_policies.sql` | Drop Dashboard-era permissive SELECT policies |
| `20260610226000_onboarding_bootstrap_rls.sql` | Chain onboarding RPC + property B′ bootstrap SELECT |
| `20260610227000_fix_property_bootstrap_rls_subquery.sql` | B′ fix: `property_has_any_member` (RLS-blind subquery) |

### Development vs Production (migrations required for parity)

**Assumption:** Production branch has core schema + some Phase 4/EA objects; lacks confirmed PR5 completion.

| Step | Migration | Required for Production? |
|------|-----------|--------------------------|
| Prerequisite check | `20260610170000` | Verify exists before PR5 |
| PR5 base (if never applied) | `20260610200000` | Apply **or** skip if objects exist — prefer reconciliation path |
| **Do not apply separately if using reconciliation** | `20260610210000` | Skip — superseded |
| Membership integrity | `20260610215000` | **Yes** — dedup before UNIQUE |
| PR5 reconciliation | `20260610220000` | **Yes** — completes RLS + view + helper |
| Legacy policy cleanup | `20260610225000` | **Yes** — before bootstrap; removes permissive SELECT |
| Onboarding bootstrap | `20260610226000` | **Yes** — with app deploy (Start Move RPC + B′) |

**Development-only (already applied per user):** `10215000`, `10220000`, `10225000`. **`10226000` + app changes pending apply.**

**Production parity minimum:** Run pre-flight SQL on Production branch, then apply missing migrations in §5 order (`10215000` → `10220000` → `10225000` → `10226000`).

---

## 5. RLS differences

### Expected post-parity policy set

| Table | Policies |
|-------|----------|
| `properties` | `properties_select_member_or_agent`, `properties_insert_creator`, `properties_update_member`; anon revoked |
| `property_members` | `property_members_select_own`, `property_members_insert_own`; anon revoked |
| `activities` | `activities_select_chain_participant`, `activities_insert_participant`; anon revoked |
| `chain_nodes` | `chain_nodes_select_participant`, `chain_nodes_insert_participant`, `chain_nodes_update_participant` |
| `chains` | `chains_select_participants`, `chains_update_participants`, `chains_insert_authenticated` |

### Development vs Production

| | Development (verified/inferred) | Production (inferred) |
|--|--------------------------------|------------------------|
| View-layer privacy | **Working** | Unknown |
| Base-table RLS | **Probe shows gaps** — verify catalog | Likely absent or partial |
| Anon `properties` revoke | **Working** | Unknown |
| EA assignment SELECT path | Designed in 10220000 | Unknown |

### Pre-production RLS verification SQL (run on each environment)

```sql
-- RLS enabled flags
select c.relname, c.relrowsecurity, c.relforcerowsecurity
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('properties','property_members','activities','chain_nodes','chains');

-- Policy inventory
select schemaname, tablename, policyname, cmd, roles
from pg_policies
where schemaname = 'public'
  and tablename in ('properties','property_members','activities','chain_nodes','chains')
order by tablename, policyname;

-- Duplicate memberships (must be 0 before UNIQUE)
select property_id, user_id, count(*)
from public.property_members
group by property_id, user_id
having count(*) > 1;
```

---

## 6. Functions / RPC differences

| Object | Dev | Production |
|--------|-----|------------|
| `is_chain_participant` | Verified | Unknown |
| `current_user_property_role` | Verified | Unknown — likely missing |
| `ensure_property_membership` | Verified | Unknown — likely missing |
| PR5 join/topology RPCs | Verified | Unknown |
| PR4 `is_property_member` / `is_ea_assigned_to_property` | Verified | Unknown |

**App dependency (route authorization):** `is_chain_participant(p_chain_id)` must exist on Production before deploying layout gates.

---

## 7. Views differences

| View | Dev | Production (inferred) |
|------|-----|------------------------|
| `chain_properties_participant` | Exists; uses `current_user_property_role()`; peer redaction OK | May exist with **legacy** inline role subquery |
| `chain_nodes_chain_summary` | Exists | Likely exists |
| `agent_branch_property_summaries` | Exists | Likely exists (EA) |

**Verify Production view definition:**

```sql
select pg_get_viewdef('public.chain_properties_participant'::regclass, true);
```

Expect `current_user_property_role(p.id)` — not `(select pm.role from property_members ...)`.

---

## 8. Migrations required to reach parity

### Production Supabase (database)

Execute on **Production branch** in Supabase SQL Editor (after pre-flight checks):

1. Confirm `20260610170000` helpers exist.
2. Audit + dedupe: run duplicate check; if duplicates exist → **`20260610215000`** (full file).
3. Apply **`20260610220000_reconcile_phase5_homeowner_privacy_rls.sql`** (idempotent).
4. **Do not** apply `20260610210000` if `10220000` is applied.
5. If Production never had any PR5 objects, alternative is full `10200000` then `10215000` then `10220000` — prefer reconciliation path if partial.

If `10200000` was never applied at all (greenfield PR5):

```
10170000 (prerequisite) → 10200000 → 10215000 → 10220000
```

### Production application (code)

1. Commit route authorization changes on `staging-test`.
2. Merge `staging-test` → `main`.
3. Deploy to Production Vercel.
4. Confirm env vars point to **Production** Supabase branch (not Development).

---

## 9. Recommended deployment order

### Phase A — Pre-flight (Production Supabase, read-only)

1. Export backup / confirm point-in-time recovery available.
2. Run duplicate membership query — document count.
3. Run RLS / policy inventory queries (§5).
4. Run `pg_get_viewdef` for `chain_properties_participant`.
5. Record which migrations already appear in `supabase_migrations.schema_migrations` (if using CLI history).

### Phase B — Database (Production Supabase, maintenance window)

1. **`20260610215000`** — only if duplicates exist OR UNIQUE constraint missing.
2. **`20260610220000`** — reconciliation (always run if PR5 incomplete).
3. Re-run catalog queries from Phase A — confirm RLS enabled + policies present.
4. Run `node scripts/verify-participant-privacy-rls.mjs` against **Production** credentials (temporarily point `.env.local` or use env vars).
5. Manual two-account privacy test on Production.

### Phase C — Resolve Development RLS gap (recommended before Production)

1. On Development, run catalog SQL — confirm `relrowsecurity = true` for `properties`, `property_members`, `activities`.
2. If RLS off or policies missing, re-run **`20260610220000`** (idempotent) or targeted `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`.
3. Confirm verify script **11/11 pass** including base-table peer block.

### Phase D — Application deploy

1. Commit route-auth + docs on `staging-test`.
2. Merge to `main`.
3. `npm run build` in CI.
4. Deploy Vercel Production.
5. Smoke test: participant chain access, non-participant `/chain/{id}` → 404, EA onboarding, join chain.

### Phase E — Post-deploy verification

| Check | Pass criteria |
|-------|---------------|
| Privacy script | 11/11 |
| Non-participant `/chain/999999` | 404, no chain UI |
| Dashboard two-account test | Peer = `Property N` |
| Join chain double-click | Single membership row |
| EA assignment | Unchanged |

---

## 10. Rollback plan

### Database rollback (manual — no automated down migrations)

Documented in `20260610215000` footer:

```sql
-- 1. DROP CONSTRAINT property_members_one_user_per_property;
-- 2. DROP FUNCTION public.ensure_property_membership(bigint, text);
-- 3. Restore join_chain_property from 20260610200000 if needed.
```

**PR5 reconciliation (`10220000`) rollback (high impact — avoid unless critical):**

```sql
-- Disable RLS (restores pre-RLS behaviour — SECURITY REGRESSION)
alter table public.properties disable row level security;
alter table public.property_members disable row level security;
alter table public.activities disable row level security;

-- Drop policies individually if selective rollback needed (see migration file for names)
-- Restore prior chain_properties_participant view definition only if view broken
```

**Recommended rollback strategy:**

| Failure | Action |
|---------|--------|
| App deploy breaks UX | **Revert Vercel deployment** to previous `main` build — fastest |
| UNIQUE constraint blocks legacy app | Revert app first; do not drop constraint unless emergency |
| RLS blocks legitimate reads | Fix policy — do not disable RLS in Production |
| View 21000 errors return | Re-run dedup + `10215000`; verify view uses `current_user_property_role` |
| Route 404 blocks participants | Revert app; check `is_chain_participant` RPC on Production |

**Do not** drop `property_members` dedup data or UNIQUE constraint without explicit DBA approval — duplicates will recur.

### Application rollback

- Vercel instant rollback to previous Production deployment.
- Route layout files can be reverted independently without DB changes.

---

## 11. Production readiness gate summary

| Gate | Development | Production | Blocker? |
|------|-------------|------------|----------|
| PR5 app code merged to `main` | On `staging-test` | **No** | **Yes** |
| Route authorization committed | Uncommitted | **No** | **Yes** |
| `10215000` applied | Yes | Unknown | **Yes** if duplicates |
| `10220000` applied | Yes (user confirmed) | Unknown | **Yes** |
| Base-table RLS enforced | **Live PASS** (25 Jul 2026) | Unknown | **Yes** — Production pre-flight still required |
| Privacy / platform security verifier | **`verify-platform-security-development.ts --execute`** | Not run | **Yes** — RPC P0s remain |
| EA flows tested | OK (user) | Unknown | Verify post-deploy |
| Production Supabase probed | N/A | **Not done** | **Yes** — Phase A required |
| Transactional email environment (§13) | Not verified | **Not done** | **Yes** — before Production launch |

### Verdict

**Not ready for Production deployment** until:

1. Ungated RPC remediation (SEC-001, 002, 004, 101) applied on Development and verified.
2. Production Supabase pre-flight + migrations applied (`10215000` → `10220000` minimum) with live catalog verification.
3. `staging-test` (including route authorization) merged to `main` and deployed.
4. Production verification script + manual privacy test complete.
5. **Transactional email Pre-Launch checks complete (§13)** — including `NEXT_PUBLIC_APP_URL`, Resend configuration, Supabase Auth templates, and FD-004 legal review outcome.

---

## 12. Environment reference

| Environment | Git branch | Supabase | Vercel |
|-------------|------------|----------|--------|
| Development | `staging-test` | `bbbsxzxcjkmpqsfvmhbo` (Development branch) | Preview |
| Production | `main` | Production branch (**ref not in repo**) | Production |

**To complete this audit:** Run §5 and §7 SQL on the Production Supabase branch in Dashboard and update the Unknown cells before go-live.

---

## 13. Transactional email & communications (Pre-Launch)

**Recorded at Stage 5 founder sign-off (21 Jul 2026).** See also [Stage 5 report](./LAUNCH_STAGE5_COMPLETION_REPORT.md) · **FD-040** · **FD-004**.

These are **configuration and legal verification** requirements — not Stage 5 implementation scope. Do **not** expose secret values in documentation.

### 13.1 Application origin (`NEXT_PUBLIC_APP_URL`)

| Check | Pass criteria |
|-------|---------------|
| Production Vercel env | `NEXT_PUBLIC_APP_URL` (or `APP_URL`) set to **approved Production Keynetic origin** (HTTPS, no trailing slash) |
| Link generation | All Resend transactional emails use `getAppBaseUrl()` — invitation, dormancy, asset URLs |
| Negative test | Send or render a sample invitation in Production-like config — **no** `localhost`, Development, or Preview hostnames in HTML/text links |
| Fallback awareness | Unset env falls back to `http://localhost:3000` in code — **must not occur in Production** |

### 13.2 Resend provider

| Check | Pass criteria |
|-------|---------------|
| `RESEND_API_KEY` | Present in Production Vercel env (value not documented in repo) |
| `EMAIL_SENDING_ENABLED` | Not set to `false` in Production unless intentionally disabled |
| `EMAIL_FROM` | Approved sender identity (default `Keynetic <notifications@keynetic.co.uk>`) |
| Resend domain | Sending domain verified in Resend Dashboard for Production |

### 13.3 Supabase Auth email templates (manual Dashboard)

Production Dashboard content must be verified **before launch** — not controlled by repository templates.

| Template | Verification |
|----------|--------------|
| **Reset password** | Aligns with `docs/AUTH_ARCHITECTURE.md` — uses `RedirectTo` + `TokenHash` + `type=recovery` |
| **Confirm signup** | Appropriate Keynetic branding and redirect when email verification enabled |

Keynetic `emails/templates/PasswordReset.tsx` is a **reference template only**; Supabase sends production password reset.

### 13.4 FD-004 — invitation address exposure (legal)

| Item | Status |
|------|--------|
| Body — full property address | **Founder-approved** — retain |
| Subject — full property address | **Retained for now** — **PENDING_LEGAL_REVIEW before Production launch** |
| Action | Do **not** change body or subject automatically without legal review outcome |

### 13.5 Active vs inactive templates

| Status | Templates |
|--------|-----------|
| **Active (Production sends when enabled)** | `homeowner-invitation` · `estate-agent-invitation` · `lifecycle-dormancy-warning` |
| **Inactive (unwired — do not describe as live)** | `welcome` · `property-claimed` (Property connected) |
| **Future / marketing (not transactional today)** | Registry placeholders — `marketing-emails`, `invitation-reminder`, etc. |

### 13.6 Pre-Production smoke (Development-safe)

1. `npx tsx scripts/verify-transactional-email-content.ts`
2. Dev preview: `/dev/emails` or `/api/dev/emails/render?template=homeowner-invitation`
3. Confirm CTA links use configured `NEXT_PUBLIC_APP_URL` for that environment

---

## 14. Pre-Launch Operational Readiness programme

**Recorded at Stage 6 founder sign-off (21 Jul 2026).**  
**Updated:** 25 Jul 2026 — **Platform Security Phase 1 `SECURITY_PHASE1_REMEDIATED_AND_VERIFIED_ON_DEVELOPMENT`** · **Supabase/Vercel provider review `FOUNDER_VERIFIED`** · Workstream 2 Phase 1 application-side **`FOUNDER_VERIFIED_COMPLETE`**

The **Launch Content programme** (Stages 3–6) is **FOUNDER_APPROVED_COMPLETE**. The **Pre-Launch Operational Readiness** programme is **in progress** — Workstream 1 complete; Workstream 2 Phase 1 **application-side founder verified**; **Supabase/Vercel provider review documented**; **external Production observability configuration not performed**.

**Implementation status (22 Jul 2026):**

| Workstream | Status |
|------------|--------|
| **Workstream 1 — EA branch access & ownership continuity** | **`FOUNDER_APPROVED_COMPLETE`** — [sign-off record](./PRELAUNCH_EA_ACCESS_FOUNDER_SIGNOFF.md) · Dev **29/29** · Staging manual **PASS** |
| **Workstream 2 — Production observability & incident alerting** | **Phase 1 application-side `FOUNDER_VERIFIED_COMPLETE`** — [audit](./PRELAUNCH_OBSERVABILITY_AUDIT_AND_ARCHITECTURE.md) **`AUDIT_FOUNDER_APPROVED`** · [Phase 1 report](./PRELAUNCH_OBSERVABILITY_PHASE1_IMPLEMENTATION.md) · [Sentry record](./PRELAUNCH_OBSERVABILITY_SENTRY_VERIFICATION.md) · **Production Sentry + uptime config open** |
| **Provider review — Supabase & Vercel** | **`FOUNDER_VERIFIED`** (22 Jul 2026) — [record](./PRELAUNCH_PROVIDER_REVIEW_SUPABASE_VERCEL_22JUL2026.md) · Pro + spend cap + backups verified · Hobby confirmed · alerts/uptime/Production plan decisions **open** |
| Monitoring / observability | **IN PROGRESS** — Phase 1 app-side complete; external uptime + Production Sentry **not configured**; Supabase usage alerts **not identified** (§14.8) |
| Cost / unit economics | **PARTIAL EVIDENCE** — Supabase usage/cost reviewed; full unit-economics model **not complete** (§14.3 B · §14.8) |
| Performance / concurrency | **OPEN** — not started (§14.3 C) |
| **Platform security architecture review** | **`SECURITY_PHASE1_REMEDIATED_AND_VERIFIED_ON_DEVELOPMENT`** — [Phase 1 remediation](./PRELAUNCH_PLATFORM_SECURITY_REMEDIATION_PHASE1.md) · Dev **13/13 + 36/36 PASS** · Production parity **OPEN** |
| Google OAuth assessment | **OPEN** — not implemented (§14.3 G) |
| Address lookup assessment | **IMPLEMENTED IN REPO (Ideal Postcodes)** — **not** Production-approved; DPA/subprocessor review **OPEN** (§14.3 H · [ADDRESS_LOOKUP_IDEAL_POSTCODES.md](./ADDRESS_LOOKUP_IDEAL_POSTCODES.md)) |
| Browser / brand assets | **OPEN** (§14.3 I) |
| Stripe / commercial readiness | **PARTIAL** — Billing Stage 1 schema/domain foundation; Checkout Stage 2 OPEN (§14.3 J) |
| Serverless vs containers review | **Future evidence-based review** (§14.3 K) |

### 14.1 Launch Content programme — complete

| Stage | Status |
|-------|--------|
| Stage 3 — Legal / privacy / content structure | **FOUNDER_APPROVED_COMPLETE** |
| Stage 3.5 — Chain Intelligence redesign | **FOUNDER_APPROVED_COMPLETE** |
| Stage 4 — Core content / value proposition | **FOUNDER_APPROVED_COMPLETE** |
| Stage 5 — Transactional email content | **FOUNDER_APPROVED_COMPLETE** |
| Stage 6 — Terminology / UX / brand polish | **FOUNDER_APPROVED_COMPLETE** — [Stage 6 report](./LAUNCH_STAGE6_COMPLETION_REPORT.md) |

### 14.2 Pre-Launch Operational Readiness — requirement register

| # | Requirement | Status |
|---|-------------|--------|
| 1 | Professional legal review and publication approval | **OPEN** — policies **DRAFT_FOR_LEGAL_REVIEW** |
| 2 | **FD-004** — invitation email address/subject legal review | **OPEN** — **PENDING_LEGAL_REVIEW** |
| 3 | **privacy@** mailbox operational verification | **OPEN** |
| 4 | Provider / DPA verification | **OPEN** |
| 5 | Production environment / secrets review | **OPEN** |
| 6 | **`NEXT_PUBLIC_APP_URL`** Production verification (§13.1) | **OPEN** |
| 7 | **Resend** Production configuration (§13.2) | **OPEN** |
| 8 | **Supabase Auth** Production email templates (§13.3) | **OPEN** |
| 9 | EA branch user access revocation | **`FOUNDER_APPROVED_COMPLETE`** — [sign-off](./PRELAUNCH_EA_ACCESS_FOUNDER_SIGNOFF.md) · Dev **29/29** · Staging manual **PASS** |
| 10 | EA owner transfer / continuity | **`FOUNDER_APPROVED_COMPLETE`** — remain Staff + leave branch verified (Dev + Staging) |
| 11 | Production observability and incident alerting | **IN PROGRESS** — Phase 1 app-side **founder verified** on Preview ([record](./PRELAUNCH_OBSERVABILITY_SENTRY_VERIFICATION.md)); `/api/health`, error boundaries, optional Sentry wired; **Production external config open** |
| 12 | Product / business operational metrics | **OPEN** — §14.3 A · design in Workstream 2 Part 7 (precomputed `platform_operational_metrics`) |
| 13 | Privacy-conscious website analytics decision | **OPEN** — §14.3 A · design in Workstream 2 Part 9 (defer invasive tracking; legal review for marketing analytics) |
| 14 | Run-cost monitoring and cost governance | **PARTIAL** — Supabase Pro usage/cost reviewed 22 Jul 2026; spend cap enabled; full unit-economics model **open** (§14.3 B · §14.8) |
| 15 | **Stripe / billing architecture** (FD-036) | **PARTIAL** — Stage 1 foundation (`EA_BILLING_STAGE1_ARCHITECTURE.md`); Stage 2 Checkout OPEN |
| 16 | Refund / cancellation / dispute procedures | **OPEN** — §14.3 J |
| 17 | Final security review | **Phase 1 RPC remediation COMPLETE ON DEVELOPMENT** — [audit §25](./PRELAUNCH_PLATFORM_SECURITY_ARCHITECTURE_AUDIT.md) · **SEC-104 Postgres RPC rate limiting IN REPO** (apply `20260729120000_sec104_rpc_rate_limiting.sql` + verifier) · **Production parity OPEN** (SEC-102, SEC-103, SEC-104) · SEC-201+ OPEN |
| 18 | Final Production launch checklist (§11 gates + Production Supabase pre-flight) | **OPEN** |
| 19 | Unwired email templates (Welcome · Property connected) | **OPEN** — documented inactive |
| 20 | Concurrent-user / performance validation | **OPEN** — §14.3 C |
| 21 | Google OAuth via Supabase Auth | **OPEN** — §14.3 G |
| 22 | UK address lookup provider | **IMPLEMENTED IN REPO** — Ideal Postcodes server-side; DPA/Production approval **OPEN** (§14.3 H) |
| 23 | Favicon / browser & social brand assets | **OPEN** — §14.3 I |
| 24 | Serverless vs containers architecture review (evidence-based) | **OPEN** — §14.3 K |
| 25 | **FD-042** — Existing-account invitation UX | **OPEN** — not an EA Access security blocker |
| 26 | **FD-043** — Wrong-email invitation UX (plain-English / switch account) | **OPEN** — security correct; UX follow-up |
| 27 | **FD-044** — Invitation timestamp / BST-GMT investigation | **OPEN** |
| 28 | **FD-045** — EA mobile/visual UX checks | **OPEN** — UX only; not access-control blockers |
| 29 | EA access Production migration & parity | **OPEN** — Development/Staging only; Production **not deployed** |

### 14.3 Expanded Pre-Launch scope (founder requirements — preserved)

#### A. Monitoring / observability

- Production application error tracking · proactive error alerts · failed API / database request monitoring
- Supabase usage visibility · Vercel function/runtime monitoring · transactional email delivery/failure monitoring
- Website traffic analytics (privacy decision required) · active homeowner / EA metrics · chain counts (live, fully vs partially connected)
- Operational dashboards · founder alerts before users report problems

**Status:** **IN PROGRESS** — Phase 1 repository implementation complete; external configuration pending

**Phase 1 delivered in repo (22 Jul 2026):**

| Item | Status |
|------|--------|
| `GET /api/health` with cached DB probe | **Implemented** |
| `app/error.tsx` + `app/global-error.tsx` | **Implemented** |
| `@sentry/nextjs@10.67.0` (optional when DSN absent) | **Implemented** |
| PII scrubbing / no Session Replay | **Implemented** |
| Static verifiers | **Added** |
| External uptime monitor | **Not configured** — deferred until Production URL ready (§14.8) |
| Sentry DSN in Production Vercel | **Not configured** — founder action |
| Supabase usage/billing alerts | **Not identified** in dashboard — spend cap enabled; manual review required |
| Vercel spend/budget alerts | **N/A on Hobby** — Production plan review open |

**Remaining P0 until external config:**

| Finding | Severity |
|---------|----------|
| No automated uptime monitor configured | **P0** |
| No Sentry DSN in Production | **P0** |
| No founder alert destinations configured | **P0** |

**Key audit findings still open at provider level:**

| Finding | Severity |
|---------|----------|
| No automated downtime/uptime monitoring | **P0** |
| No application error monitoring (Sentry or equivalent) | **P0** |
| No founder operational alerting configured | **P0** |
| Resend delivery/bounce webhooks not implemented | **P1** |
| Chain intelligence cron route exists but **not scheduled** in `vercel.json` | **P1** |
| No `/api/health` endpoint | ~~**P1**~~ **Resolved in repo** |
| Unstructured `console.error` only (~149 calls); no correlation IDs | **P2** |
| No React error boundaries (`error.tsx`) | ~~**P1**~~ **Resolved in repo** |
| `email_events` captures send attempts only; `provider_events` unused | **P1** |

**Recommended launch stack:** external uptime monitor + `/api/health` + Sentry (Production only) + Vercel/Supabase native dashboards + Phase 3 Resend webhooks. Expected cost **£0–35/month** at low traffic.

#### B. Cost / unit economics

Track/model: fixed + variable infrastructure cost · anonymous visitor cost · cost per active homeowner / chain / paying EA branch · attributable free-user activity · revenue per paying branch · infrastructure gross margin · break-even branch count · Vercel · Supabase · Resend · observability · address lookup · Stripe · bandwidth/egress.

**Pricing (Billing Stage 1 — founder-approved):** **£99 founding / £129 standard** per estate agent branch; first **20** founding branches. Historical scenarios £79/£99 retained in FD-007 audit trail only. **£129/month ≈ £4.30/day** — positioning note only. See [EA_BILLING_STAGE1_ARCHITECTURE.md](./EA_BILLING_STAGE1_ARCHITECTURE.md).

**Stripe / commercial readiness:** Stage 2 Checkout/Portal/webhook implemented for Sandbox; entitlement enforcement still OFF. See [EA_BILLING_STAGE2_ARCHITECTURE.md](./EA_BILLING_STAGE2_ARCHITECTURE.md).

**Status:** **PARTIAL EVIDENCE** — Supabase Pro usage and July 2026 billing reviewed ([provider record](./PRELAUNCH_PROVIDER_REVIEW_SUPABASE_VERCEL_22JUL2026.md)). Current usage is within Pro quotas; incremental cost is primarily Development branching compute. **Full unit-economics model remains open** — Vercel load, query patterns, concurrency, email/Stripe/address lookup costs and paying-EA ratios not yet assessed. **Do not infer scale readiness from current Supabase usage alone.**

#### C. Performance / scalability

Concurrent-user load testing · latency/error rate under load · DB/Supabase/Vercel behaviour · memory/CPU · event-loop blocking · sync/blocking handlers · long-running APIs · unresolved promises · unbounded concurrency · leaks · React/Realtime cleanup · N+1 · polling · idle compute · cron efficiency · repeated DB reads · cache effectiveness · single-endpoint degradation risk. **Do not over-architect for huge scale.**

**Status:** **OPEN**

#### D. Security architecture review

IDOR/BOLA · property/chain/branch ID manipulation · invitation/token manipulation · RPC auth · RLS coverage · anon/authenticated DB exposure · browser Supabase client inventory · server vs client DB requests · service-role usage/exposure · `NEXT_PUBLIC_*` audit · secrets in logs/source · rotation · Stripe/Resend/cron/address API key security.

**Status:** **`SECURITY_PHASE1_REMEDIATED_AND_VERIFIED_ON_DEVELOPMENT`** — [Phase 1 record](./PRELAUNCH_PLATFORM_SECURITY_REMEDIATION_PHASE1.md)

**Summary (25 Jul 2026 — Phase 1 applied and verified on Development):**

| Area | Verdict |
|------|---------|
| Ungated lifecycle/invitation RPCs (SEC-001, 002, 004, 101) | **REMEDIATED AND VERIFIED ON DEVELOPMENT** — 13/13 + 36/36 PASS |
| Operational summary refresh (view column drift) | **Migration ready** — `20260725140000` pending Development apply · [Phase 1 §10](./PRELAUNCH_PLATFORM_SECURITY_REMEDIATION_PHASE1.md) |
| Base-table RLS on Development (SEC-003) | **PROTECTED** — unchanged this phase |
| `email_events` on Development (SEC-105) | **PROTECTED** — unchanged this phase |
| Production DB parity (SEC-102) | **NOT PROVEN** — migration not applied on Production |
| Application merge (SEC-103) | **OPEN** — `main` lacks staging security code |

#### E. Authentication architecture

Supabase Auth-only confirmation · custom JWT usage · JWT claim trust · live DB membership re-check · session lifecycle · removed-user sessions · OAuth linking risks.

**Status:** **OPEN** (partial EA evidence)

#### F. URL / server trust boundaries

Server-generated URLs · `NEXT_PUBLIC_APP_URL` · Host/forwarded headers · redirects · callbacks · invitation/password-reset/OAuth URLs · user-controlled header trust.

**Status:** **OPEN**

#### G. Google authentication (assessment only)

Google OAuth via Supabase · retain email/password · linking · duplicate prevention · existing users · redirect security · callback config. **Do not implement yet.**

**Status:** **OPEN**

#### H. Address lookup

UK provider (Ideal Postcodes, UK PAF) · server-side suggest/resolve · `IDEAL_POSTCODES_API_KEY` · manual fallback · no schema change · no Redis required · cost controls (debounce, min length, resolve-on-select, in-process rate limits). See [ADDRESS_LOOKUP_IDEAL_POSTCODES.md](./ADDRESS_LOOKUP_IDEAL_POSTCODES.md).

**Status:** **IMPLEMENTED IN REPO** — **not** Production-approved (DPA / retention / subprocessor review required).

#### I. Browser / brand assets

Favicon · tab icon · remove Vercel default · app/bookmark/iOS icons · metadata · Open Graph.

**Status:** **OPEN**

#### J. Stripe / commercial readiness

Secret/webhook handling · signature verification · idempotency · subscription lifecycle · cancellation · failed payments · refunds · disputes · policies/procedures · access after non-payment.

**Stage 1 (done):** branch subscription schema, founding cohort ledger, webhook idempotency table, domain types, RLS — see [EA_BILLING_STAGE1_ARCHITECTURE.md](./EA_BILLING_STAGE1_ARCHITECTURE.md).

**Stage 2 (Sandbox implemented in repo):** Checkout + Portal + webhook reconciliation — see [EA_BILLING_STAGE2_ARCHITECTURE.md](./EA_BILLING_STAGE2_ARCHITECTURE.md). Requires founder `STRIPE_WEBHOOK_SECRET` + Portal Dashboard settings for full E2E. **Entitlement enforcement remains OFF.**

**Stage 3 (OPEN):** paid entitlement enforcement.

**Status:** **PARTIAL** (Stage 2 Sandbox code) · Live Production billing **OPEN**

#### K. Serverless vs containers (future)

Retain Vercel + Supabase for launch · measure post-launch · compare when sustained · move heavy workloads independently · measurable review thresholds. **Not a current migration.**

**Status:** **OPEN**

### 14.4 Staging deployment smoke test (22 Jul 2026)

**Repository:** `staging-test` @ `ca86ab2` — migrations `20260721100000` + `20260721110000` **git-tracked**.

**Architecture:** Staging Preview → Development Supabase (`bbbsxzxcjkmpqsfvmhbo`) per [KEYNETIC_ARCHITECTURE.md](./KEYNETIC_ARCHITECTURE.md).

| Surface | Evidence | Staging |
|---------|----------|---------|
| EA login / Command Centre / Team / Invite / Remove / Transfer UI | App routes + components | Founder manual (partial done) |
| Property access revocation | Layout gates + EA assignment RPCs | **Founder confirmed** |
| Chain / homepage / marketing / nav | Routes + shells | Founder manual |

**Nav fixes in repo (pending Staging redeploy):** EA marketing same-page anchors; AgentShell Account Settings on `/account`.

### 14.5 Prioritised Pre-Launch roadmap

| Priority | Items |
|----------|-------|
| **P0** | **Production Supabase/RLS parity** (SEC-102) · **Production Phase 1 migration apply** · Production email/app URL config · Legal/FD-004/privacy@ · EA access **Production migration** |
| **P1** | Production external observability config (Sentry + uptime) · Stripe/billing · Performance baseline · Favicon/brand assets · Full cost/unit-economics model |
| **P2** | Google OAuth assessment · Address lookup **Production DPA/approval** · Analytics decision · Unwired email template decision |
| **P3** | Serverless vs containers review · DPA completion (if parallel) |

**Recommended next workstream (25 Jul 2026):** **Production security parity** — founder-approved Production catalog pre-flight (SEC-102, SEC-105) + apply `20260725120000_platform_security_rpc_authorisation_hardening.sql` on Production + live verifier re-run — **after** SEC-103 merge path agreed. See [audit §25.6](./PRELAUNCH_PLATFORM_SECURITY_ARCHITECTURE_AUDIT.md). **Do not start without founder approval.**

External observability Production config and uptime monitoring remain **open** until Production URL is ready.

### 14.6 Technical baseline (22 Jul 2026)

| Check | Result |
|-------|--------|
| `npm run build` | **PASS** (Phase 1 — includes `/api/health`) |
| `npx tsc --noEmit` | **PASS** |
| `npm run lint` | **55 / 22 / 33** — baseline preserved |
| `verify-health-endpoint.ts` | **PASS** |
| `verify-observability-privacy.ts` | **PASS** |
| `verify-ea-branch-access-revocation.ts` | **5/5 PASS** (prior baseline) |
| Development EA integration suite | **29/29 PASS** · **`FOUNDER_APPROVED_COMPLETE`** |

### 14.7 Workstream 2 — Observability implementation phases (design only)

| Phase | Scope | DB migration? | Est. cost |
|-------|-------|---------------|-----------|
| **1 — MVP observability** | `/api/health`, error boundaries, optional Sentry | **Application-side founder verified** — Production external config open | No | £0–35/mo when configured |
| **2 — Incident alerting** | P0/P1 rules (Sentry + uptime + provider billing alerts) | No | £0 |
| **3 — Email delivery monitoring** | Resend webhooks → `email_events.provider_events` | Possibly | £0 |
| **4 — Business metrics** | Precomputed `platform_operational_metrics` + founder admin view | **Yes** | £0 |
| **5 — Privacy analytics** | Legal review; optional Vercel Web Analytics on public pages | No | £0–9/mo |
| **6 — Cost telemetry** | Usage snapshots + internal counters | Optional | £0 |
| **7 — Runbooks & verification** | Incident runbooks, chain-intelligence cron schedule, fire drill | No | £0 |

Full detail: [PRELAUNCH_OBSERVABILITY_AUDIT_AND_ARCHITECTURE.md](./PRELAUNCH_OBSERVABILITY_AUDIT_AND_ARCHITECTURE.md).

### 14.8 Founder provider review — Supabase & Vercel (22 Jul 2026)

**Status:** **`FOUNDER_VERIFIED`** — [full record](./PRELAUNCH_PROVIDER_REVIEW_SUPABASE_VERCEL_22JUL2026.md)

#### Supabase provider review

| Item | Status |
|------|--------|
| Pro plan confirmed | **VERIFIED** |
| Usage reviewed (22 Jul 2026) | **VERIFIED** — comfortably within Pro quotas |
| Current cost reviewed | **VERIFIED** — $27.22 current / $34.98 projected; branching compute is main incremental cost |
| Spend cap | **ENABLED** — keep during pre-launch; **Production go-live decision open** |
| Daily DB backups | **VERIFIED** |
| Restore availability | **VERIFIED** — restore points 15–22 Jul 2026 |
| Restore drill | **NOT PERFORMED** |
| Storage backup limitation | **DOCUMENTED** — Storage objects not in DB backups; Storage Size currently 0 GB |
| Organisation Audit Logs | **Unavailable on Pro** — accepted; do not upgrade solely for this |
| Connection/disconnection logging | **Intentionally OFF** |
| Configurable usage alerts | **Not identified** in dashboard — manual review + spend cap; reassess before Production |
| Development branching | **Retained** — isolation valuable; do not remove for small cost saving |

#### Vercel provider review

| Item | Status |
|------|--------|
| Current plan | **Hobby — VERIFIED** |
| Spend controls | **Not required at pre-launch stage** |
| Production plan decision | **OPEN** — review limits, log retention, spend controls before go-live; **Hobby not approved as final Production plan** |

#### External uptime monitoring

| Item | Status |
|------|--------|
| Configuration | **OPEN** — deferred until Production URL ready |
| Mandatory at Production launch | `/` · `/login` · `/api/health` (full probe: `status: healthy`, `database: ok`) |

#### Sentry / Phase 1 application-side

| Item | Status |
|------|--------|
| Preview health + Sentry client/server | **`FOUNDER_VERIFIED_COMPLETE`** |
| Temporary verification routes | **Removed** — redeployed Preview returns 404 |
| Production Sentry configuration | **OPEN** |
| Phase 2 | **Not started** |

---

*End of Production Readiness Checklist.*
