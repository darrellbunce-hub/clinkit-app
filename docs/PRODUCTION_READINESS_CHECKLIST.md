# Production Readiness Checklist

**Audit date:** 2026-06-06  
**Audit type:** Read-only — no changes made  
**Development Supabase:** `bbbsxzxcjkmpqsfvmhbo` (confirmed via `.env.local`)  
**Production Supabase:** Separate branch/project per `docs/KEYNETIC_ARCHITECTURE.md` — **not probeable from this workspace** (no Production credentials in repo)

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

#### RLS — **Mixed / gap identified**

| Table | Expected (post-10220000) | Development probe |
|-------|--------------------------|-------------------|
| `properties` anon | Blocked | **OK** — permission denied |
| `properties` authenticated non-participant | 0 rows / blocked | **FAIL** — stranger sees ~164 rows |
| `properties` peer read by participant | Blocked | **FAIL** — participant reads peer address via base table |
| `property_members` stranger | Own rows only | **FAIL** — stranger sees ~215 rows |
| `activities` stranger | Participant chains only | **FAIL** — stranger sees ~133 rows |
| `chains` stranger by ID | 0 rows | **FAIL** — stranger sees chain + access code |
| `chain_nodes` stranger | 0 rows | **OK** — count 0 |
| `chain_properties_participant` privacy | Peer address null | **OK** |

**Automated script:** `node scripts/verify-participant-privacy-rls.mjs` → **10/11 pass** (fails: peer base-table read).

**Implication:** UI privacy paths are safe via the participant **view**, but **base-table RLS may not be fully enforced** on Development despite migration apply claim. **Resolve before Production** via SQL Editor catalog check (`relrowsecurity`, `pg_policies`).

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
| Base-table RLS enforced | **Probe fail** | Unknown | **Yes** — fix Dev first |
| Privacy script 11/11 | **10/11** | Not run | **Yes** |
| EA flows tested | OK (user) | Unknown | Verify post-deploy |
| Production Supabase probed | N/A | **Not done** | **Yes** — Phase A required |
| Transactional email environment (§13) | Not verified | **Not done** | **Yes** — before Production launch |

### Verdict

**Not ready for Production deployment** until:

1. Development base-table RLS verified/fixed and privacy script passes 11/11.
2. Production Supabase pre-flight + migrations applied (`10215000` → `10220000` minimum).
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

The **Launch Content programme** (Stages 3–6) is **FOUNDER_APPROVED_COMPLETE**. The **next programme** is **Pre-Launch Operational Readiness**.

**Implementation status:** Workstream 1 (EA branch access) — **implementation complete, awaiting Development migration and founder sign-off**; other Pre-Launch items remain open.

### 14.1 Launch Content programme — complete

| Stage | Status |
|-------|--------|
| Stage 3 — Legal / privacy / content structure | **FOUNDER_APPROVED_COMPLETE** |
| Stage 3.5 — Chain Intelligence redesign | **FOUNDER_APPROVED_COMPLETE** |
| Stage 4 — Core content / value proposition | **FOUNDER_APPROVED_COMPLETE** |
| Stage 5 — Transactional email content | **FOUNDER_APPROVED_COMPLETE** |
| Stage 6 — Terminology / UX / brand polish | **FOUNDER_APPROVED_COMPLETE** — [Stage 6 report](./LAUNCH_STAGE6_COMPLETION_REPORT.md) |

### 14.2 Pre-Launch Operational Readiness — open requirements

These remain **open** until explicitly verified or implemented in the Pre-Launch programme. **None are marked resolved by Stage 6.**

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
| 9 | EA branch user access revocation | **IMPLEMENTATION_COMPLETE_AWAITING_DEVELOPMENT_MIGRATION** — [Workstream 1 audit](./PRELAUNCH_EA_ACCESS_AND_BRANCH_MEMBERSHIP_AUDIT.md) · [implementation report](./PRELAUNCH_EA_ACCESS_IMPLEMENTATION_REPORT.md) |
| 10 | EA owner transfer / continuity | **IMPLEMENTATION_COMPLETE_AWAITING_DEVELOPMENT_MIGRATION** — `transfer_ea_branch_ownership` RPC + one-Owner invariant |
| 11 | Production observability and incident alerting | **OPEN** |
| 12 | Product / business operational metrics | **OPEN** |
| 13 | Privacy-conscious website analytics decision | **OPEN** |
| 14 | Run-cost monitoring and cost governance | **OPEN** |
| 15 | **Stripe / billing architecture** (FD-036) | **OPEN** — separate gated workstream |
| 16 | Refund / cancellation / dispute procedures | **OPEN** |
| 17 | Final security review | **OPEN** |
| 18 | Final Production launch checklist (§11 gates + Production Supabase pre-flight) | **OPEN** |
| 19 | Unwired email templates (Welcome · Property connected) | **OPEN** — documented inactive; wire or remove before describing as live |

### 14.3 Stage 6 technical baseline (locked at sign-off)

| Check | Result |
|-------|--------|
| `npm run build` | **PASS** |
| `npx tsc --noEmit` | **PASS** |
| `npm run lint` | **55 total / 22 errors / 33 warnings** — matches pre-Stage-6 baseline |
| Stage 3 legal/content verification | **PASS** |
| Stage 3.5 refinement verification | **PASS** |
| Stage 3.5 critical scenarios | **PASS** |
| Command Centre presentation verification | **PASS** |
| Stage 5 transactional email verification | **PASS** |
| Stage 6 terminology verification | **PASS** (20/20) |

---

*End of Production Readiness Checklist.*
