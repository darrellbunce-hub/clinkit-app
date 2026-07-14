# Operational Identity Migration Audit (P0)

Launch-blocking security migration: operational authority is granted only through typed workflow RPCs. `property_members` is an internal sync detail, not an authority source.

**Enforcement migration:** `supabase/migrations/20260714150000_operational_identity_enforcement.sql`  
**Foundation migration:** `supabase/migrations/20260714140000_property_operational_identity_foundation.sql`

---

## Part 1 — Complete audit

| Location | Purpose | Safe / Unsafe | Replacement workflow |
|----------|---------|---------------|---------------------|
| `ensure_property_membership()` — `20260610215000_property_members_deduplicate_and_unique.sql` | Any authenticated user self-attaches seller/buyer to any property ID | **Unsafe** (pre-P0) → **Revoked** | `establish_operational_homeowner()` or `grant_counterparty_participation()` |
| `property_members_insert_own` RLS — `20260610220000_reconcile_phase5_homeowner_privacy_rls.sql` | Direct client INSERT as self | **Unsafe** → **Dropped** | Typed grant RPCs (internal `_upsert_property_membership_row`) |
| `sync_property_claim_on_membership` trigger — `20260612000000_phase7a_ea_originated_properties.sql` | Claim sync on **any** membership INSERT | **Unsafe** → **Removed** | `_sync_property_claim_on_homeowner_grant()` on homeowner establish only |
| `get_property_operational_owner_user_id()` — phase7a | Earliest `property_members` row | **Unsafe** → **Fixed** | Reads `property_operational_identities` where `status = 'active'` |
| `lib/ensurePropertyMembership.ts` | Client wrapper for revoked RPC | **Unsafe** → **Deprecated** | `@/lib/ownership/grants` → `establishOperationalHomeowner()` |
| `app/start-move/page.tsx` | Seller/buyer membership after property create | **Unsafe** → **Migrated** | `establishOperationalHomeowner(..., start_move)` |
| `lib/searchingPlaceholder.ts` | Buyer membership on searching placeholder | **Unsafe** → **Migrated** | `establishOperationalHomeowner(..., start_move)` |
| `claim_operational_property()` — `20260712120000_invitation_rejection.sql` | EA-originated homeowner claim | **Unsafe** → **Migrated** | `establish_operational_homeowner(..., claim_operational_property)` |
| `join_chain_property()` — `20260610215000` | Counterparty join via access code | **Unsafe** → **Migrated** | `grant_counterparty_participation()` |
| `convert_searching_placeholder_for_sale()` — `20260713130000` | Direct `property_members` INSERT for buyer | **Unsafe** → **Migrated** | `_establish_operational_homeowner_core(..., convert_placeholder)` |
| `join_chain_property()` (legacy body) — `20260610200000_phase5` | Direct INSERT when not member | **Unsafe** → **Superseded** | Replaced by `20260714150000` join_chain body |
| `establish_connected_hop()` — phase5 | Topology via `property_members` buyer/seller | **Unsafe assumption** → **Fixed** | Operational identity + participant checks |
| `break_chain_connection()` — phase5 | Auth via `is_property_member` | **Acceptable (synced rows)** | Future: `is_property_operational_participant` |
| EA property creation (`finalizeOperationalSaleCreation`) | Creates property + claim metadata; no homeowner grant | **Safe** | Homeowner via claim invitation only |
| `property_ea_assignments` workflow | EA branch association | **Safe** | Existing EA workflow (no owner via membership) |
| `invite_property_delegate()` | Household delegate invite | **New (P0)** | Operational homeowner only |
| `accept_property_delegate()` | Delegate accepts invite | **New (P0)** | Pending → active delegate |
| `delink_homeowner_from_property()` | Homeowner release | **New (P0)** | Identity release + lifecycle `released` |
| `delink_estate_agent_from_property()` | EA branch release | **New (P0)** | Assignment release; lifecycle if no homeowner |
| Verify / trace scripts | Test setup via `ensure_property_membership` | **Unsafe** → **Updated** | `establish_operational_homeowner` in scripts |
| `report_multiple_operational_homeowners()` | Pre-launch anomaly audit | **Safe** | Still reports duplicate owner-class `property_members` drift |

---

## Part 2 — Single operational homeowner enforcement

- `property_operational_identities.property_id` is PK — one row per property.
- Partial unique index `property_operational_identities_one_active_per_property` enforces one **active** identity.
- `_establish_operational_homeowner_core`: if active identity exists for a **different** user → `{ ok: false, error: 'operational_homeowner_exists' }`.
- Same user → idempotent sync of membership row.
- After `delinked`/`released` → re-establish allowed (row UPDATE).

---

## Part 3 — Approved grant RPCs

| Workflow | RPC | Grant type |
|----------|-----|------------|
| Start Move | `establish_operational_homeowner(p_property_id, 'start_move')` | Operational homeowner |
| Claim invitation | `establish_operational_homeowner(..., 'claim_operational_property')` | Operational homeowner + claim sync |
| Onward convert | `_establish_operational_homeowner_core(..., 'convert_placeholder')` | Operational homeowner (internal from convert RPC) |
| Join chain | `grant_counterparty_participation(p_property_id)` | Counterparty only |
| Household invite | `invite_property_delegate(...)` | Delegate (pending) |
| EA assignment | Existing `property_ea_assignments` insert RPCs | EA authority (not homeowner) |

---

## Part 4 — Ownership assumption replacements

| Before | After |
|--------|-------|
| Earliest `property_members` row | `property_operational_identities.homeowner_user_id` |
| Claim on any membership INSERT | Claim sync on homeowner establish only |
| Convert auth: seller `property_members` | `is_property_operational_homeowner(sale_id)` |
| `establish_connected_hop` buyer lookup | Operational identity on purchase hop |
| Client membership after create | Typed establish RPC |

---

## Part 5 — RLS hardening

| Change | Effect |
|--------|--------|
| `DROP POLICY property_members_insert_own` | Clients cannot INSERT membership |
| `REVOKE INSERT ON property_members FROM authenticated` | Belt-and-braces |
| `REVOKE EXECUTE ON ensure_property_membership FROM authenticated` | RPC raises deprecation exception |
| Identity tables remain workflow-only writes (no client INSERT policies) | Grants via SECURITY DEFINER RPCs only |
| `property_members_select_own` retained | Users see synced rows for privacy RLS compatibility |

---

## Part 6 — Regression verification

Run after applying migrations `20260714140000` and `20260714150000`:

```bash
npx tsx scripts/verify-operational-identity-enforcement.ts
npx tsx scripts/verify-convert-searching-placeholder-for-sale.ts
```

### Supported workflows (verify script)

- Homeowner start move (establish seller)
- Second establish on same property (idempotent same user)
- Join chain counterparty (requires existing homeowner)
- Malicious: second homeowner → `operational_homeowner_exists`
- Malicious: `ensure_property_membership` → exception
- Malicious: direct `property_members` INSERT → RLS denial
- Malicious: counterparty grant when no homeowner → `no_operational_homeowner`

### Remaining legacy (later cleanup)

- `property_members` table and `is_property_member()` — retained as privacy RLS implementation detail until policies migrate to `is_property_operational_participant`.
- `lib/ensurePropertyMembership.ts` — deprecated re-export; remove in cleanup PR.
- `break_chain_connection` still uses `is_property_member`.
- Some RLS policies on `activities` / `properties` still reference `is_property_member` (works while membership is synced internally).
- Test scripts in `scripts/*.mjs` — updated but not all E2E paths re-run in CI.

---

## Deliverables checklist

- [x] Complete migration to Operational Identity (enforcement migration + TS grants layer)
- [x] Removal/internalisation of generic ownership helper (`ensure_property_membership` revoked)
- [x] Updated permission model helpers (`is_property_operational_homeowner`, `is_property_operational_participant`)
- [x] Regression verify script
- [x] Legacy code list (above)
