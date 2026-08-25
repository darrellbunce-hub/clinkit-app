# GDPR Phase 2 — Erasure Impact Report Implementation

**Migration:** `supabase/migrations/20260718100000_gdpr_erasure_impact_report.sql`  
**Status:** Read-only — apply manually to Development for verification  
**Related:** [Phase 2 Requirements](./GDPR_PHASE2_IMPACT_REPORT_REQUIREMENTS.md) · [Erasure Architecture](./GDPR_RIGHT_TO_ERASURE_ARCHITECTURE.md)

---

## Schema evidence reviewed

### Confirmed from repository migrations

| Table | User-linked columns used |
|-------|--------------------------|
| `auth.users` | `id`, `email`, `email_confirmed_at` |
| `profiles` | `id`, `account_type`, `contact_name` |
| `properties` | `created_by_user_id`, `chain_id`, `address`, `is_searching`, `buyer_connected`, `seller_connected` |
| `chains` | `created_by_user_id`, completion `*_user_id` fields |
| `property_operational_identities` | `homeowner_user_id`, `status` |
| `property_members` | `user_id` |
| `property_counterparty_participants` | `user_id`, `status` |
| `property_delegates` | `delegate_user_id`, `invited_by_user_id` |
| `property_ea_assignments` | `assigned_by_user_id`, `branch_id`, `status` |
| `property_claim_metadata` | `originated_by_user_id`, `claimed_by_user_id`, `invite_email` |
| `property_claim_invitations` | `created_by_user_id`, `invitation_rejection_acknowledged_by_user_id` |
| `property_delink_events` | `actor_user_id`, `metadata` |
| `property_lifecycle_states` | `operational_state`, `metadata` |
| `property_lifecycle_events` | `metadata` |
| `property_lifecycle_still_active_confirmations` | `user_id` |
| `property_analytics_snapshots` | `source_property_id`, `payload` |
| `chain_completion_events` | `actor_user_id`, `payload` |
| `email_events` | `recipient_email`, `sent_by`, `template` |
| `ea_companies` | `created_by_user_id` |
| `ea_branches` | via `ea_branch_members` |
| `ea_branch_members` | `user_id`, `branch_id` |
| `ea_branch_invitations` | `invite_email`, `created_by_user_id`, `accepted_by_user_id` |

### Schema gaps / uncertainties

| Item | Impact |
|------|--------|
| Base DDL for `profiles`, `properties`, `chains`, `activities`, `property_members` not in repo | Columns inferred from ALTER/INSERT/RPC usage only |
| `profiles.role` (legacy) | Not queried — `account_type` used instead |
| `activities.updated_by` | Text role label, not UUID — counted on linked properties only |
| `chain_nodes.user_id` | Referenced in app code; **not confirmed in migrations** — excluded |
| `email_events.provider_events` | Not text-scanned — flagged for manual review |
| `property_delink_events.reason` vs `reason_code` | Report uses `actor_user_id` only |

Verification script confirms column availability after migration apply.

---

## RPC security model

| Control | Implementation |
|---------|----------------|
| Function | `public.generate_erasure_impact_report(uuid)` |
| Language | `plpgsql` **`STABLE`** |
| Security | **`SECURITY DEFINER`** (required for `auth.users` read) |
| `search_path` | **`public`** (fixed) |
| Grants | **`service_role` only** |
| Revoked from | `public`, `anon`, `authenticated` |

---

## Read-only guarantee

Function body contains **only**:

- `SELECT` queries and subqueries
- `jsonb_build_object` / `jsonb_agg` assembly
- Variable assignment

**No** `INSERT`, `UPDATE`, `DELETE`, `MERGE`, `TRUNCATE`, DDL, or calls to:

- `execute_participation_delink`
- `execute_property_lifecycle_*`
- `confirm_transaction_still_active`
- Auth admin functions

Output includes:

```json
"read_only_guarantee": {
  "mutations_performed": false,
  "scope": "discovery_only"
}
```

---

## TypeScript integration

| File | Purpose |
|------|---------|
| `lib/gdpr/types.ts` | Report JSON types |
| `lib/gdpr/erasureImpactReport.ts` | `generateErasureImpactReport()` wrapper |
| `lib/gdpr/index.ts` | Public exports |

Requires **service-role** Supabase client.

---

## Verification

```bash
# After manually applying migration on Development (bbbsxzxcjkmpqsfvmhbo):
npx tsx scripts/verify-gdpr-erasure-impact-report.ts
```

Script validates:

- RPC existence
- Unknown user handling
- Sole vs shared transaction classification
- Email correlation counts (fixture via `create_email_event`)
- No raw PII in JSON output
- No DB footprint mutation across report calls
- `ready_for_auto_execution === false`

---

## Manual migration step

1. Open Supabase SQL Editor — **Development project only** (`bbbsxzxcjkmpqsfvmhbo`)
2. Apply contents of `supabase/migrations/20260718100000_gdpr_erasure_impact_report.sql`
3. Confirm: `grant execute ... to service_role` succeeded
4. Run verification command above

**Do not apply to Production without separate approval.**

---

## Explicit non-goals (Phase 2)

- No `execute_verified_erasure`
- No suppression ledger writes
- No Auth deletion
- No email redaction

Next approval gate: Development verification pass → Phase 3 destructive execution design.

---

*Technical implementation record — not legal advice.*
