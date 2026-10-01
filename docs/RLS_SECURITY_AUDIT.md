# RLS Security Audit — Keynetic

**Date:** 2026-08-29  
**Scope:** Repository migrations through freeze lineage + known Production/Development catalog evidence  
**Authority:** Repository migrations are the source of truth. Do not hand-edit Supabase Dashboard policies.

---

## Executive summary

Dashboard-era **permissive policies** (`USING (true)` / `WITH CHECK (true)`, often on role `public`) still coexist with later scoped PR5 / participant policies on several core tables. PostgreSQL **OR-combines** permissive policies, so a single open policy nullifies otherwise correct scoped policies.

**Primary insecurity:** anonymous or any role matching `public` can INSERT/UPDATE/SELECT core chain/property data without membership checks.

**Fix:** Migration `20260829210000_rls_legacy_permissive_and_anon_hardening.sql` drops all known legacy permissive policies, revokes `anon`/`public` table privileges on core tables, enables RLS on two service-only tables that lacked it, and **aborts** if scoped PR5 policies are missing (so Production is not left with zero access policies).

---

## Access classification legend

| Code | Meaning |
|------|---------|
| A | Public/anonymous access genuinely required |
| B | Authenticated users only (any logged-in user) |
| C | Authenticated — own rows only (`auth.uid()`) |
| D | Authenticated — property/chain/company/branch scope |
| E | Server / `service_role` / SECURITY DEFINER RPC only |
| F | No client/API access required (deny via RLS + no policies / revoked grants) |

---

## Critical finding: legacy permissive policies

These names are **not** created by repository migrations. They come from early Dashboard / `remote_schema` setup. They appear on live catalogs (Production discovery and Development `chain_nodes` probes).

| Table | Policy name | Typical effect | Risk |
|-------|-------------|----------------|------|
| `activities` | Allow activity inserts | INSERT `WITH CHECK (true)` to `public` | **Critical** — anon IDOR insert |
| `activities` | Allow activity reads | SELECT `USING (true)` | **Critical** — cross-user read |
| `chains` | Allow chain inserts | INSERT true | **Critical** |
| `chains` | Allow chain reads | SELECT true | **Critical** |
| `properties` | Allow property inserts | INSERT true | **Critical** |
| `properties` | Allow property updates | UPDATE true | **Critical** |
| `properties` | Allow updates | UPDATE true | **Critical** |
| `properties` | Enable read access for all users | SELECT true | **Critical** |
| `property_members` | Allow property member inserts | INSERT true | **Critical** — self-join any property |
| `property_members` | Allow property member reads | SELECT true | **Critical** |
| `chain_nodes` | Authenticated users can view their chain nodes | Legacy SELECT (often open / weak) | **High** |
| `chain_nodes` | Authenticated users can insert chain nodes | Legacy INSERT | **High** |
| `chain_nodes` | Allow authenticated users to update own chain nodes | Legacy UPDATE | **High** |

Migration `20260610225000` only dropped the **four SELECT** policies on properties / members / activities / chains. **INSERT/UPDATE and all `chain_nodes` legacy policies were never dropped.**

---

## Table-by-table audit

### Core operational (browser under JWT + RLS)

| Table | RLS (repo) | Intended | Current risk | App depends on | Proposed |
|-------|------------|----------|--------------|----------------|----------|
| `profiles` | Enabled; own-row CRUD | C | Low if only own policies | Browser signup/onboarding | Keep own-row policies; revoke anon |
| `properties` | Enabled + scoped PR5 | D | **Critical** if legacy open policies remain | Heavy browser R/W | Drop legacy; keep PR5 select/insert/update |
| `property_members` | Enabled; SELECT own; INSERT via RPC | C / E writes | **Critical** if legacy INSERT/SELECT remain | RPC grants; SELECT own for UI | Drop legacy; keep SELECT own; no direct INSERT |
| `chains` | Enabled + scoped | D (+ B insert for bootstrap) | **Critical** if legacy remain | Browser + RPCs | Drop legacy; keep participant/viewer policies |
| `chain_nodes` | Enabled + scoped | D | **High** if legacy remain | Browser buyer-ready | Drop legacy; keep participant policies |
| `activities` | Enabled + scoped | D | **Critical** if legacy remain | Browser ChainContext | Drop legacy; keep participant policies |
| `operational_delays` | Enabled; SELECT scoped; mutate via RPC | D / E | Low | Browser select + RPCs | Keep |
| `chain_completion_events` | Enabled; participant | D | Low | Completion flows | Keep |

### Operational identity

| Table | RLS | Intended | Notes |
|-------|-----|----------|-------|
| `property_operational_identities` | SELECT own | C / E writes | Keep; mutations via RPC |
| `property_counterparty_participants` | SELECT own | C / E writes | Keep |
| `property_delegates` | SELECT involved | D / E writes | Keep |
| `property_delink_events` | SELECT involved | D / E writes | Keep |

### Estate agent

| Table | RLS | Intended | Notes |
|-------|-----|----------|-------|
| `ea_companies` / `ea_branches` / `ea_branch_members` | Enabled + scoped | D | Keep |
| `ea_branch_invitations` | SELECT admins | D / E | Keep; preview via RPC |
| `property_ea_assignments` | Scoped | D | Keep |
| `ea_branch_membership_events` | RLS, no policies | E | Intentional deny-all for clients |

### Billing / email / GDPR (service-oriented)

| Table | RLS | Intended | Gap |
|-------|-----|----------|-----|
| `ea_branch_subscriptions` / `ea_subscription_events` | SELECT member | D read / E write | OK |
| `ea_founding_slot_ledger`, `stripe_webhook_events`, `billing_ops_alert_state` | RLS, no policies | E | OK |
| `billing_customer_email_dispatches` | **RLS not enabled in migrations** | E | **Enable RLS** (no policies) |
| `email_events` | RLS, no policies | E | OK |
| `gdpr_*` (6), `platform_admins` | RLS, no policies | E | OK |
| `rpc_rate_limit_buckets` | RLS, no policies | E | OK |

### Lifecycle / claims

| Table | RLS | Intended | Gap |
|-------|-----|----------|-----|
| `property_claim_metadata` | SELECT scoped | D | OK |
| `property_claim_invitations` | RLS, no policies | E (RPC) | OK — claim resolve is RPC |
| `property_lifecycle_states` | SELECT participant | D | OK |
| `property_lifecycle_events` / `property_analytics_snapshots` | RLS, no policies | E | OK |
| `property_lifecycle_still_active_confirmations` | **RLS not enabled** | E | **Enable RLS** |
| Summaries (`property_`/`chain_operational_summary`) | SELECT viewer | D | OK |
| `legal_acceptances` | SELECT own | C | OK |

### Views

| Object | Notes |
|--------|-------|
| `chain_nodes_chain_summary` | Participant-safe view; `security_invoker = false`; grants to `authenticated` only — keep |

---

## Anonymous access (A) — deliberate product surfaces

| Surface | Table access? | Mechanism |
|---------|---------------|-----------|
| Health probe | Optional head on `chains` | Expect empty/deny under RLS |
| Claim invitation | **No base table** | RPC `resolve_claim_invitation_token` |
| EA join preview | **No base table** | RPC `preview_ea_branch_invitation` |
| Password recovery | Auth routes only | Not PostgREST table RLS |

**Conclusion:** No base-table anonymous INSERT/UPDATE/SELECT is required for product. All `public`/`anon` open table policies are unjustified.

---

## IDOR scenarios addressed by dropping legacy policies

| Attack | Before (legacy open) | After |
|--------|----------------------|-------|
| Anon insert property/chain/activity/member | Allowed | Denied |
| Auth user update any property | Allowed via OR with true | Only member/delegated editor |
| Auth user insert into any `property_members` | Allowed | Denied (RPC only) |
| Auth user read peer chain/property/activity | Allowed | Participant/viewer scoped |
| Auth user update peer `chain_nodes` | Possible via legacy | Participant/delegated only |
| Auth user read other EA company | Not via these legacy policies; EA policies already scoped | Unchanged |

---

## Deliberate remaining “broad” authenticated policies

| Policy | Expression | Why kept |
|--------|------------|----------|
| `chains_insert_authenticated` | `auth.uid() is not null` | Start-move / onboarding creates a chain before membership rows exist. Not `USING (true)` for world-readable data. |

---

## Business decisions (no code change in this pass)

1. Whether `chains_insert_authenticated` should later require a SECURITY DEFINER RPC only (narrower).  
2. Whether DELETE on core tables should ever be granted to clients (currently none — prefer RPC).  
3. Production catch-up order: **apply PR5 / participant RLS migrations before or with this hardening** if scoped policies are not yet present.

---

## Implementation artifacts

| Artifact | Purpose |
|----------|---------|
| `supabase/migrations/20260829210000_rls_legacy_permissive_and_anon_hardening.sql` | Drop legacy policies; revoke anon/public; enable missing RLS; guard PR5 presence |
| `scripts/verify-rls-security-catalog.sql` | Read-only catalog checks for open/true/public policies |

---

## Verification commands

```bash
# After applying the migration on the target Supabase project (SQL Editor or CLI):
# Run scripts/verify-rls-security-catalog.sql and expect zero FAIL rows for critical checks.

npx tsc --noEmit
npx eslint .
npm run build
# Optional live RLS behaviour (needs test users):
# node scripts/verify-participant-privacy-rls.mjs
```
