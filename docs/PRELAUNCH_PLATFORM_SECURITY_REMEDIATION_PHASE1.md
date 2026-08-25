# Pre-Launch Platform Security Remediation — Phase 1

**Status:** `SECURITY_PHASE1_REMEDIATED_AND_VERIFIED_ON_DEVELOPMENT`  
**Date:** 25 July 2026 (post-apply sign-off)  
**Target:** Development only — `bbbsxzxcjkmpqsfvmhbo`  
**Production:** untouched — **not closed on Production**

---

## Authorisation semantics review (25 Jul 2026 — pre-apply)

The initial migration incorrectly used one predicate for read **and** write:

- `is_property_member()` — any `property_members` row (includes **counterparty** buyer/seller roles)
- `is_ea_assigned_to_property()` — **visibility**, not delegated edit authority

That would have allowed counterparty participants and view-only EAs to call `record_property_lifecycle_transition` directly — **broader than `canEditProperty()` and DB property UPDATE RLS**.

**Corrected in the same unapplied migration:**

| Helper | Predicate | Used for |
|--------|-----------|----------|
| `property_lifecycle_read_caller_authorized` | `service_role` OR `is_property_member` OR `is_ea_assigned_to_property` | `get_property_lifecycle_signals` (matches properties SELECT visibility) |
| `property_lifecycle_write_internal_caller_authorized` | `service_role` OR `is_property_operational_homeowner` OR `is_ea_assigned_to_property` | Body of `record_property_lifecycle_transition` (internal delink paths only) |
| EXECUTE on `record_property_lifecycle_transition` | **Revoked from authenticated** | Blocks all direct PostgREST lifecycle writes |

Lifecycle transitions are **system/worker-managed** (`record_property_lifecycle_transition_worker`, cron). Legitimate participant-facing changes use `confirm_transaction_still_active` or approved delink RPCs.

---

### `record_property_lifecycle_transition`

| Caller | Browser/Server | Auth | Intended actor | Scope | Client EXECUTE needed? |
|--------|----------------|------|----------------|-------|----------------------|
| `lib/lifecycle/service.ts` → `recordTransition()` | Server/worker path | User session or service role | Authorised participant (future) / not used from UI today | Target property | **No direct client requirement today** — not called from app components |
| `participation_delink` / `operational_identity` SQL | Internal SECURITY DEFINER | Homeowner in delink RPC | Verified operational homeowner | Own property | No — internal `PERFORM` |
| Attacker PostgREST | Client | Any authenticated | — | Arbitrary property | **Must deny** |

**Fix:** Membership/EA gate inside RPC + explicit anon revoke. Internal SQL callers retain access via function owner.

### `get_property_lifecycle_signals`

| Caller | Browser/Server | Auth | Intended actor | Scope | Client EXECUTE needed? |
|--------|----------------|------|----------------|-------|----------------------|
| `PropertyLifecycleService.loadContext()` | Cron worker (`lib/lifecycle/worker.ts`) | **service_role** | Worker | Batch candidates | No (service_role) |
| `execute_property_lifecycle_action` SQL | Internal | service_role | Worker | Property | No |
| Attacker / anon PostgREST | Client | anon or stranger | — | Arbitrary property | **Must deny** |

**Fix:** Wrapper gate using `property_lifecycle_read_caller_authorized()`; core renamed to `get_property_lifecycle_signals_core` (no client EXECUTE).

### SEC-004 helpers

| Function | Type | Client callers | Fix |
|----------|------|----------------|-----|
| `get_active_property_claim_invitation` | Internal helper | **None** — only SQL SECURITY DEFINER RPCs | Revoke authenticated/anon EXECUTE |
| `get_latest_property_claim_invitation` | Internal helper | **None** | Revoke authenticated/anon EXECUTE |
| `get_property_claim_invitation_status` | Authenticated app RPC | `lib/propertyClaim/propertyInvitations.ts` (EA panel) | **Unchanged** — already `is_ea_assigned_to_property` gate |
| `resolve_claim_invitation_token` | Public preview | Claim flow | **Unchanged** — token-based |

### `report_multiple_operational_homeowners`

| Caller | Auth | Fix |
|--------|------|-----|
| `scripts/audit-ownership-violations.ts` | Was anon (broken) → **service_role** | Revoke authenticated; grant service_role only |
| Attacker | authenticated stranger | Deny via revoke |

---

## 2. Migration

**File:** `supabase/migrations/20260725120000_platform_security_rpc_authorisation_hardening.sql`

### Functions changed

| Function | Change |
|----------|--------|
| `property_lifecycle_read_caller_authorized(bigint)` | **New** read helper (visibility-aligned) |
| `property_lifecycle_write_internal_caller_authorized(bigint)` | **New** internal write helper (operational homeowner / assigned EA / service_role) |
| `get_property_lifecycle_signals_core(bigint)` | Renamed from public wrapper (no client grants) |
| `get_property_lifecycle_signals(bigint)` | **New gated wrapper** |
| `record_property_lifecycle_transition(...)` | Internal write gate + **authenticated EXECUTE revoked** |
| `get_active_property_claim_invitation(bigint)` | Grants only (internal) |
| `get_latest_property_claim_invitation(bigint)` | Grants only (internal) |
| `report_multiple_operational_homeowners()` | Grants only (service_role) |

### Grant matrix (after — applied on Development)

| Function | PUBLIC | anon | authenticated | service_role |
|----------|--------|------|---------------|--------------|
| `property_lifecycle_read_caller_authorized` | revoked | revoked | revoked | revoked |
| `property_lifecycle_write_internal_caller_authorized` | revoked | revoked | revoked | revoked |
| `get_property_lifecycle_signals_core` | revoked | revoked | revoked | revoked |
| `get_property_lifecycle_signals` | revoked | revoked | **EXECUTE** | **EXECUTE** |
| `record_property_lifecycle_transition` | revoked | revoked | **revoked** | internal owner / delink `PERFORM` |
| `get_active_property_claim_invitation` | revoked | revoked | revoked | internal owner |
| `get_latest_property_claim_invitation` | revoked | revoked | revoked | internal owner |
| `report_multiple_operational_homeowners` | revoked | revoked | revoked | **EXECUTE** |

---

## 3. Remediation summary

| ID | Remediation | Legitimate flows preserved |
|----|-------------|----------------------------|
| SEC-001 | Internal write gate + **authenticated EXECUTE revoked** | Participation delink, EA-assigned paths; worker uses service_role |
| SEC-002 | Gated wrapper + anon revoke + forbidden before data load | Worker service_role; participant/EA read own scope |
| SEC-004 | Revoke client EXECUTE on internal helpers | EA panel via `get_property_claim_invitation_status`; claim via token RPC |
| SEC-101 | service_role-only EXECUTE | Ownership audit script (updated) |

---

## 4. Apply to Development

```bash
# Option A — Management API (add SUPABASE_ACCESS_TOKEN to .env.local)
npx tsx scripts/apply-development-migration.ts

# Option B — direct Postgres URL
# SUPABASE_DB_URL or SUPABASE_DB_PASSWORD in .env.local, then same command

# Option C — Supabase SQL Editor: paste migration file contents
```

**Preflight printed by apply script:**
- Project ref: `bbbsxzxcjkmpqsfvmhbo`
- Production: NOT targeted

---

## 5. Verification (after apply)

```bash
npx tsx scripts/verify-platform-security-development.ts
npx tsx scripts/verify-platform-security-development.ts --execute
npx tsx scripts/verify-ea-branch-access-revocation.ts
node scripts/verify-invitation-send-security.mjs
npx tsx scripts/verify-privacy-admin-security.ts
node scripts/verify-http-security-headers.mjs
```

---

## 6. Before / after (live verification)

| ID | Before remediation (25 Jul 2026) | After remediation (25 Jul 2026 — Development) | Development status |
|----|----------------------------------|-------------------------------------------------|-------------------|
| SEC-001 | Stranger persisted `dormant` + audit event | Permission denied on direct write; state unchanged | **CLOSED ON DEVELOPMENT** |
| SEC-002 | Anon + stranger read full context | `not_authenticated` / `forbidden` | **CLOSED ON DEVELOPMENT** |
| SEC-003 | Historical June probe only; live Dev **protected** | Base-table RLS remains protected | **CLOSED / PROTECTED ON DEVELOPMENT** |
| SEC-004 | Stranger read full invitation row | Permission denied | **CLOSED ON DEVELOPMENT** |
| SEC-101 | Stranger received 6 rows + user UUIDs | Permission denied | **CLOSED ON DEVELOPMENT** |
| SEC-105 | Already protected on Dev | RLS + revoked admin RPC EXECUTE unchanged | **CLOSED / PROTECTED ON DEVELOPMENT** |

**Live evidence (founder post-apply):**

| Verifier | Result |
|----------|--------|
| `npx tsx scripts/verify-platform-security-development.ts` | **13/13 PASS** |
| `npx tsx scripts/verify-platform-security-development.ts --execute` | **36/36 PASS** (includes fixture cleanup **PASS**) |

**Important:** These findings are **CLOSED ON DEVELOPMENT only**. Production parity remains **OPEN** (SEC-102).

---

## 7. Remaining Production blockers

- Apply same migration on Production (separate approved task)
- Production catalog pre-flight (SEC-102, SEC-105 parity)
- Application merge (`main` ← `staging-test`) SEC-103

---

## 8. EA 29/29 suite

**Not required for this phase.** Changes do not modify EA branch RPCs or shared `is_ea_assigned_to_property` / `is_property_member` semantics beyond reusing them. Static EA revocation verifier (5/5) sufficient unless invitation panel regressions appear in manual smoke.

---

## 9. Post-apply regression (25 Jul 2026)

| Command | Result |
|---------|--------|
| `npx tsc --noEmit` | **PASS** |
| `npm run build` | **PASS** |
| `npm run lint` | **58 / 22 / 36** (baseline drift +3 warnings; no new errors from Phase 1) |
| `npx tsx scripts/verify-ea-branch-access-revocation.ts` | **5/5 PASS** |
| `node scripts/verify-invitation-send-security.mjs` | **PASS** |
| `node scripts/verify-http-security-headers.mjs` | **PASS** |
| `npx tsx scripts/verify-privacy-admin-security.ts` | **62/62 PASS** |
| `npx tsx scripts/verify-property-lifecycle.ts` | **PASS** (pure TypeScript lifecycle evaluators) |

**Not run:** `verify-property-lifecycle-automation.ts` (service-role mutating suite — unnecessary after live adversarial verifier PASS). EA 29/29 mutating integration suite **not run** (per instructions).

### Development finding closure summary

| ID | Development status | Production status |
|----|-------------------|-------------------|
| SEC-001 | **CLOSED ON DEVELOPMENT** | **OPEN** — migration not applied |
| SEC-002 | **CLOSED ON DEVELOPMENT** | **OPEN** |
| SEC-003 | **CLOSED / PROTECTED ON DEVELOPMENT** | **OPEN** — SEC-102 catalog parity |
| SEC-004 | **CLOSED ON DEVELOPMENT** | **OPEN** |
| SEC-101 | **CLOSED ON DEVELOPMENT** | **OPEN** |
| SEC-105 | **CLOSED / PROTECTED ON DEVELOPMENT** | **OPEN** — parity check required |

**Overall Platform Security:** **NOT COMPLETE** — Production deployment and app merge remain open.

---

## 10. Operational summary refresh remediation (25 Jul 2026)

**Status:** `OPERATIONAL_SUMMARY_REFRESH_REMEDIATED_PENDING_DEV_APPLY` (code + migration ready; DB apply requires founder credentials in agent session)

### Root cause

`loadOperationalRefreshDataset()` selects `stage_entered_at` from `chain_properties_participant`, but the view was not updated when `properties.stage_entered_at` was added (`20260720100000`). PostgREST returned **42703** after successful stage mutations. **Not caused by Security Phase 1.**

### Migration

**File:** `supabase/migrations/20260725140000_chain_properties_participant_stage_entered_at.sql`

Adds `p.stage_entered_at` **appended to the end** of the existing participant view column list (PostgreSQL `CREATE OR REPLACE VIEW` cannot insert mid-list — see 42P16). Preserves address/postcode redaction, `is_chain_operational_viewer` filter, and grants.

**Privacy:** `stage_entered_at` is operational timing metadata; `stage` is already visible to chain viewers. Peer address/postcode redaction unchanged.

### Apply (Development only)

```bash
npx tsx scripts/apply-development-migration.ts supabase/migrations/20260725140000_chain_properties_participant_stage_entered_at.sql
```

Then:

```bash
npx tsx scripts/verify-operational-summary-refresh-development.ts
npx tsx scripts/verify-operational-summary-refresh-development.ts --execute
```

### Error-handling change

- `loadOperationalRefreshDataset` returns structured `{ ok, step, code, message }` — no `console.error`.
- `refreshOperationalSummary` propagates structured failures.
- `ChainContext.refreshOperationalSummariesForChain` reports refresh failure once via `captureObservabilityException` (no duplicate browser overlay). Primary mutations remain successful.

### Verification (code + security — pre-DB-apply)

| Check | Result |
|-------|--------|
| Platform security read-only | **13/13 PASS** |
| Platform security `--execute` | **36/36 PASS** |
| `verify-operational-summaries.ts` | **4/4 PASS** |
| Structured failure shape | **PASS** |
| View column on Dev DB | **PENDING APPLY** (42703 until migration applied) |

**Production:** untouched.

---

*End of Phase 1 remediation record.*
