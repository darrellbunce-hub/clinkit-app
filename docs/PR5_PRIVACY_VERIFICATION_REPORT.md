# PR5 Privacy Verification Report

**Date:** 2026-06-06  
**Migrations:**  
- `supabase/migrations/20260610200000_phase5_homeowner_privacy_rls.sql`  
- `supabase/migrations/20260610210000_fix_chain_properties_participant_role_subquery.sql`  
- `supabase/migrations/20260610220000_reconcile_phase5_homeowner_privacy_rls.sql` (reconciliation)

---

## 0. PR5 reconciliation audit (live dev — 2026-06-06)

Probed `bbbsxzxcjkmpqsfvmhbo` via PostgREST (authenticated behavioral tests). No service-role / direct SQL access.

### Comparison table

| Expected object | Exists in DB? | Matches migration definition? | Missing? | Outdated? |
|-----------------|---------------|-------------------------------|----------|-----------|
| `is_property_member(bigint)` (PR4 / 170000) | Yes | Yes (RPC works) | | |
| `is_ea_assigned_to_property(bigint)` (PR4) | Yes | Yes | | |
| `is_chain_participant(bigint)` | Yes | Yes | | |
| `current_user_property_role(bigint)` | **No** | — | **Yes** | |
| `chain_properties_participant` view | Yes | **No** — uses inline scalar `(SELECT pm.role …)` | | **Yes** |
| `properties` RLS + 3 policies | **No** — auth user reads 151 rows incl. id=1 | — | **Yes** | |
| `properties` anon revoke | Yes | Yes | | |
| `chains_insert_authenticated` | Yes | Yes (insert works) | | |
| `chain_nodes` RLS + 3 policies | Yes | Yes — user sees only own-chain nodes | | |
| `activities` RLS + 2 policies | **No** — auth user reads 132 rows | — | **Yes** | |
| `property_members` RLS + 2 policies | **No** — auth user reads 263 rows | — | **Yes** | |
| `resolve_chain_for_join` | Yes | Yes | | |
| `join_chain_property` | Yes | Yes | | |
| `property_exists_for_onboarding` | Yes | Yes | | |
| `establish_connected_hop` | Yes | Yes | | |
| `break_chain_connection` | Yes | Yes | | |
| `cleanup_abandoned_onboarding_chain` | Yes | Yes | | |
| `get_next_chain_position` | Yes | Yes | | |

**Partial-apply theory:** Migration stopped after view (old definition) + RPCs + `chain_nodes` RLS, before `current_user_property_role` and the `properties` / `activities` / `property_members` RLS blocks. `20260610210000` was never applied.

**Confirmed failure mode:** Duplicate `property_members` rows for same `(property_id, user_id)` → `chain_properties_participant` returns PostgreSQL **21000** (dashboard loads no chains).

### Minimum migration sequence

1. **Confirm prerequisite:** `20260610170000_phase4_ea_property_assignments.sql` in `supabase_migrations.schema_migrations`.
2. **Apply reconciliation (recommended):** run `20260610220000_reconcile_phase5_homeowner_privacy_rls.sql` in Supabase SQL Editor.  
   - Covers missing RLS + `current_user_property_role` + view fix.  
   - Idempotent with already-applied `chain_nodes` / RPC sections.
3. **Alternative (greenfield):** run full `20260610200000` then `20260610210000` only if PR5 was never applied at all.
4. **Do not re-run RPC block alone** if RPCs already exist — unnecessary.
5. **Record versions** in `schema_migrations` if applying manually outside CLI.
6. **Verify:** `node scripts/verify-participant-privacy-rls.mjs` + Account A/B manual test.

### Data impact before enabling RLS

Run in SQL Editor (service role):

```sql
-- Properties with no membership (hidden from base-table SELECT after RLS; still in participant view for chain peers)
select count(*) as unclaimed_properties
from public.properties p
where not exists (
  select 1 from public.property_members pm where pm.property_id = p.id
);

-- Duplicate memberships (21000 risk until view uses current_user_property_role)
select property_id, user_id, count(*), array_agg(role order by role)
from public.property_members
group by property_id, user_id
having count(*) > 1;

-- Activities on chains where no property member exists (edge-case orphans)
select count(*) as activity_count
from public.activities a
where a.property_id is not null
  and not exists (
    select 1
    from public.properties p
    inner join public.property_members pm on pm.property_id = p.id
    where p.id = a.property_id
  );
```

**Expected behavioral impact (not data loss):**

| Path | After reconciliation |
|------|----------------------|
| Homeowner global `properties` SELECT | Only own memberships + EA-assigned properties |
| `chain_properties_participant` | Chain topology with redacted peer addresses |
| `property_members` SELECT | Own rows only |
| `activities` SELECT | Chains where user is participant only |
| EA `agent_branch_property_summaries` | **Unchanged** — `security_invoker = false`, bypasses base RLS |
| EA via `is_ea_assigned_to_property` on `properties` | Still works |
| Security-definer RPCs | **Unchanged** — join, break, hop, cleanup |
| Property inserted without `property_members` row | Creator loses base-table SELECT until membership inserted (app flows insert membership) |
| Duplicate membership rows | View works after fix; consider deduping data separately |

---

## 1. Migration summary

Single migration implementing Phase A homeowner privacy enforcement:

| Component | Description |
|-----------|-------------|
| `is_chain_participant(chain_id)` | Helper — true when user is a member of any property in the chain |
| `chain_properties_participant` | Participant-safe view — redacts `address`/`postcode` for non-owned properties |
| `properties` RLS | SELECT: member or assigned EA; INSERT: creator; UPDATE: member |
| `chains` INSERT policy | Allows authenticated chain creation (start-move) |
| `chain_nodes` RLS | Participant SELECT/INSERT/UPDATE |
| `activities` RLS | Chain-participant SELECT; member/buyer-ready INSERT |
| `property_members` RLS | Own-row SELECT/INSERT only |
| RPCs | Join, onboarding, topology, cleanup workflows (see §3) |

**Apply before testing:**

If PR5 was partially applied (see §0), run:

`supabase/migrations/20260610220000_reconcile_phase5_homeowner_privacy_rls.sql`

Otherwise run `20260610200000` then `20260610210000`.

Then run: `node scripts/verify-participant-privacy-rls.mjs`

---

## 2. RLS policy summary

### `public.properties`

| Policy | Operation | Rule |
|--------|-----------|------|
| `properties_select_member_or_agent` | SELECT | `is_property_member(id)` OR `is_ea_assigned_to_property(id)` |
| `properties_insert_creator` | INSERT | `created_by_user_id = auth.uid()` |
| `properties_update_member` | UPDATE | `is_property_member(id)` |
| Anon access | — | **Revoked** |

### `public.chains`

| Policy | Operation | Rule |
|--------|-----------|------|
| `chains_select_participants` | SELECT | Existing — chain participant |
| `chains_update_participants` | UPDATE | Existing — chain participant |
| `chains_insert_authenticated` | INSERT | **New** — authenticated users |

### `public.chain_nodes`

| Policy | Operation | Rule |
|--------|-----------|------|
| `chain_nodes_select_participant` | SELECT | `is_chain_participant(chain_id)` |
| `chain_nodes_insert_participant` | INSERT | Participant OR empty chain bootstrap |
| `chain_nodes_update_participant` | UPDATE | `is_chain_participant(chain_id)` |

### `public.activities`

| Policy | Operation | Rule |
|--------|-----------|------|
| `activities_select_chain_participant` | SELECT | Property/node in participant chain |
| `activities_insert_participant` | INSERT | Property member OR buyer-ready chain participant |

### `public.property_members`

| Policy | Operation | Rule |
|--------|-----------|------|
| `property_members_select_own` | SELECT | `user_id = auth.uid()` |
| `property_members_insert_own` | INSERT | `user_id = auth.uid()` |

### Unchanged (EA)

- `property_ea_assignments` RLS
- `agent_branch_property_summaries` view (assignment-scoped, `security_invoker = false`)
- `is_ea_assigned_to_property` on base `properties` SELECT

---

## 3. RPC summary

| RPC | Purpose |
|-----|---------|
| `resolve_chain_for_join(access_code)` | Pre-membership chain lookup by access code |
| `join_chain_property(access_code, address, postcode)` | Join workflow: validate, connect, insert membership |
| `property_exists_for_onboarding(address, postcode, exclude_id?)` | Boolean duplicate check without row leak |
| `establish_connected_hop(purchase_property_id)` | Seller-join topology linking |
| `break_chain_connection(property_id, break_reason)` | Cross-property connection break |
| `cleanup_abandoned_onboarding_chain(chain_id)` | Remove abandoned start-move chain (incl. empty chains) |
| `get_next_chain_position(chain_id)` | Chain position for placeholder insert |

All RPCs: `SECURITY DEFINER`, granted to `authenticated` only.

---

## 4. Views created

### `public.chain_properties_participant`

- **Filter:** `is_chain_participant(chain_id)`
- **Own property:** full `address`, `postcode`, `is_own_property = true`
- **Peer properties:** `address = NULL`, `postcode = NULL`
- **Also exposes:** operational fields, `current_user_role`, `has_members`
- **Does not expose:** other participants' membership rows

---

## 5. Files changed

| File | Change |
|------|--------|
| `supabase/migrations/20260610200000_phase5_homeowner_privacy_rls.sql` | **New** — full Phase A DB layer |
| `context/ChainContext.tsx` | Participant view + scoped activities/chains/nodes; break RPC |
| `app/dashboard/page.tsx` | Uses ChainContext; Property N labels; no raw address leak |
| `lib/operationalPosition.ts` | `getParticipantPropertyLabel`, `getDashboardChainTitle`; chain tile Property N |
| `lib/propertyPermissions.ts` | Re-exports new label helpers |
| `app/join-chain/page.tsx` | `join_chain_property` + cleanup RPC |
| `app/start-move/page.tsx` | Onboarding existence RPC; `getNextChainPosition` |
| `lib/chainConnection.ts` | `establish_connected_hop` RPC |
| `lib/searchingPlaceholder.ts` | RPC for position + duplicate check |
| `scripts/verify-participant-privacy-rls.mjs` | **New** — automated privacy checks |
| `supabase/migrations/20260610220000_reconcile_phase5_homeowner_privacy_rls.sql` | **New** — completes partial PR5 apply |
| `docs/PR5_PRIVACY_VERIFICATION_REPORT.md` | **New** — this report |

---

## 6. TypeScript result

```
npx tsc --noEmit
Exit code: 0
```

---

## 7. Build result

```
npm run build
Exit code: 0
Next.js 16.2.6 — compiled successfully
```

---

## 8. Manual verification checklist

After applying the migration:

| # | Test | Expected |
|---|------|----------|
| 1 | Account A views dashboard / chain | Sees **own** address only |
| 2 | Account A views peer property | **Property N** label; no address/postcode |
| 3 | Account B views Account A's property | **Property N**; address NULL in network tab |
| 4 | Account B views own property | Full address visible |
| 5 | Chain topology | Both users see all chain properties (redacted) |
| 6 | Start Move | Creates chain + properties |
| 7 | Join Chain | Access code + address join succeeds |
| 8 | Break connection | Works via RPC from property page |
| 9 | Buyer Ready | Load + stage update on chain node |
| 10 | EA assignment | Homeowner can assign branch on own property |
| 11 | EA dashboard | Shows assigned property addresses only |

### Automated script

```bash
node scripts/verify-participant-privacy-rls.mjs
```

### Manual verification results (post-reconciliation audit)

| Check | Status | Notes |
|-------|--------|-------|
| Live DB audit | **Partial PR5** | See §0 — RLS gaps + outdated view confirmed |
| Reconciliation migration | **Ready** | `20260610220000_reconcile_phase5_homeowner_privacy_rls.sql` |
| Automated script | **Pending apply** | Run after reconciliation SQL |
| Anon base table read | **Pass** | Already revoked |
| tsc / build | **Pass** | Application code ready |

**Action required:** Apply `20260610220000_reconcile_phase5_homeowner_privacy_rls.sql` to Supabase dev, then re-run verification with Account A / Account B on a shared chain.

---

## 9. Privacy model (post-apply)

```
Homeowner SELECT paths:
  chain_properties_participant  → topology + redacted peers
  properties (base)             → own properties + EA assigned only

Never:
  Global properties SELECT
  Client-side chain_id filtering as privacy control
  Dashboard H2 showing peer address
```
