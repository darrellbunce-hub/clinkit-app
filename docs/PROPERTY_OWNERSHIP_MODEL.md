# Property Operational Ownership Model

This document supersedes generic `property_members` as the source of operational authority. It defines the **single-homeowner identity** model, delegate invitations, approved grant workflows, de-link operations, and a full audit of current violation paths.

Related: [Property Lifecycle Management](./PROPERTY_LIFECYCLE.md)

---

## Product principles (normative)

1. **One operational homeowner identity per live property** — never multiple unrelated homeowner identities on the same property record.
2. **Household members are delegates** — explicitly invited by the operational homeowner; not independent owners.
3. **Membership only via approved workflows** — no self-attach shortcuts.
4. **First-class de-link** — homeowner and estate agent can release operational association with audit and participant notification.
5. **Pre-launch audit** — all paths allowing multiple unrelated homeowner identities must be removed or gated.

---

## Terminology

| Term | Meaning |
|------|---------|
| **Operational homeowner** | The single user whose transaction this property record represents (seller on a sale row; buyer on a purchase row). |
| **Counterparty participant** | The user on the opposite side of the same property hop (buyer on a sale; seller on a purchase). A chain participant, **not** a second homeowner identity. |
| **Delegate** | Household member invited by the operational homeowner; limited permissions; never an owner. |
| **Estate agent association** | Branch assignment via `property_ea_assignments` — operational viewing/delegated editing, not homeowner identity. |
| **De-link** | Voluntary removal of operational association; releases property for lifecycle `released` state. |

### What is NOT a second homeowner

- Buyer joining a **sale** via access code (counterparty).
- Seller joining a **purchase** via access code (counterparty).
- EA branch member with delegated editing (assignment, not membership-as-owner).

### What IS a violation

- Two users both holding **owner-class** membership on the same property.
- Any user calling `ensure_property_membership` to attach as seller/buyer without workflow authorization.
- Direct `property_members` INSERT under RLS (`property_members_insert_own`).
- Second user claiming an already-claimed EA property (partially blocked today via `claim_status`).

---

## Ownership model

### Authority layers

```
┌─────────────────────────────────────────────────────────────┐
│  Layer 1: property_operational_identity (NEW)             │
│  Exactly one operational homeowner per property_id          │
└─────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
┌───────────────┐   ┌─────────────────┐   ┌──────────────────┐
│ Counterparty  │   │ Delegates       │   │ EA assignment    │
│ (0–1 typical) │   │ (0–n invited)   │   │ (branch link)    │
│ property_     │   │ property_       │   │ property_ea_     │
│ counterparty_ │   │ delegates       │   │ assignments      │
│ participants  │   │                 │   │                  │
└───────────────┘   └─────────────────┘   └──────────────────┘
```

### Identity record (proposed)

```typescript
type PropertyOperationalIdentity = {
  propertyId: number;
  homeownerUserId: string;
  /** seller | buyer — matches property relationship_type */
  operationalRole: "seller" | "buyer";
  grantedVia:
    | "start_move"
    | "claim_operational_property"
    | "ea_origination_claim"
    | "counterparty_join"  // only for purchase-row owner when joining own purchase
    | "convert_placeholder";
  grantedAt: string;
  status: "active" | "delinked" | "released";
};
```

### Delegate record (proposed)

```typescript
type PropertyDelegate = {
  propertyId: number;
  delegateUserId: string;
  invitedByUserId: string;
  permissions: ("view" | "update" | "invite")[];
  status: "pending" | "active" | "revoked";
  invitedAt: string;
  acceptedAt: string | null;
};
```

### Mapping from current `property_members.role`

| Current role | New classification | Owner? |
|--------------|-------------------|--------|
| `seller` on sale | Owner (if only one) or **violation** if multiple | Yes |
| `buyer` on purchase | Owner (if only one) or **violation** if multiple | Yes |
| `buyer` on sale | Counterparty | No |
| `seller` on purchase | Counterparty | No |
| `participant` | Legacy — migrate to delegate or remove | No |

---

## Workflow audit — violation paths (must fix before launch)

### Critical — remove or replace

| # | Path | Violation | Location |
|---|------|-----------|----------|
| V1 | `ensure_property_membership(property_id, role)` | Any authenticated user self-attaches to any property ID with seller/buyer role | `20260610215000_property_members_deduplicate_and_unique.sql`, `lib/ensurePropertyMembership.ts` |
| V2 | `property_members_insert_own` RLS | Direct INSERT as self without workflow check | `20260610220000_reconcile_phase5_homeowner_privacy_rls.sql` |
| V3 | `sync_property_claim_on_membership` trigger | Fires on **every** membership INSERT; conflates counterparty join with claim | `20260612000000_phase7a_ea_originated_properties.sql` |
| V4 | Client `ensurePropertyMembership` calls | Used from Start Move, searching placeholder, tests — bypasses single-owner enforcement | `app/start-move/page.tsx`, `lib/searchingPlaceholder.ts` |
| V5 | `get_property_operational_owner_user_id` | Returns **earliest** member, not authoritative owner | `20260612000000_phase7a_ea_originated_properties.sql` |

### High — gate through approved workflow

| # | Path | Issue | Required change |
|---|------|-------|-----------------|
| G1 | `join_chain_property` | Adds counterparty without verifying single owner exists | Grant counterparty via workflow RPC only; enforce owner row first |
| G2 | `claim_operational_property` | Correct invite gate; should also set `property_operational_identity` | Extend claim RPC |
| G3 | `convert_searching_placeholder_for_sale` | Inserts buyer membership directly | Grant via identity service; owner = caller or operational owner |
| G4 | Start Move property INSERT + membership | Creates owner correctly but via V1 helper | Replace with `grant_operational_homeowner` RPC |
| G5 | EA origination | EA is not homeowner; no owner until claim | Correct today; ensure no EA member gets owner-class membership |

### Medium — address / reservation abuse (ownership-adjacent)

| # | Path | Issue |
|---|------|-------|
| A1 | Duplicate address across chains | No global unique constraint |
| A2 | `property_exists_for_onboarding` | Advisory only in Start Move |
| A3 | Placeholder convert | Global dup enforced (good) |

### Currently acceptable (with model clarification)

| Path | Notes |
|------|-------|
| `claim_operational_property` duplicate block | `not_claimable` after first claim — keep |
| `UNIQUE (property_id, user_id)` | Prevents duplicate rows per user — keep |
| EA `property_ea_assignments` | Separate from homeowner identity — keep |
| Delegated EA editing (Phase 5A) | Assignment-scoped — keep |

---

## Required schema changes

### Phase 1 — Identity foundation (pre-launch)

**Migration:** `20260714140000_property_operational_identity_foundation.sql`

| Object | Purpose |
|--------|---------|
| `property_operational_identities` | One active homeowner per property (partial unique index) |
| `property_counterparty_participants` | At most one counterparty per property (optional strict) |
| `property_delegates` | Household delegates invited by owner |
| `property_delink_events` | Append-only audit for de-link operations |
| `grant_operational_homeowner()` | Approved workflow RPC — only path to create owner |
| `grant_counterparty_participation()` | Replaces raw join membership insert |
| `invite_property_delegate()` | Owner invites household member |
| `delink_homeowner_from_property()` | Homeowner de-link |
| `delink_estate_agent_from_property()` | EA branch release |

**Constraints:**

```sql
-- Exactly one ACTIVE operational homeowner per property
create unique index property_operational_identities_one_active_owner
  on property_operational_identities (property_id)
  where status = 'active';

-- Delegates cannot be owners
-- Enforced in RPC + trigger
```

**Backfill:**

```sql
-- Derive owner from earliest seller/buyer matching relationship_type
-- Flag properties with multiple owner-class members for manual review
```

### Phase 2 — Enforcement (pre-launch blocker)

| Change | Action |
|--------|--------|
| `ensure_property_membership` | **Revoke** from authenticated; replace with typed grant RPCs |
| `property_members_insert_own` | **Drop** or restrict to service-role only |
| `property_members_sync_claim` | Replace with `sync_claim_on_owner_grant` (owner inserts only) |
| `property_members` table | Deprecate as authority source; keep as denormalized cache or replace with view |

### Phase 3 — Lifecycle integration

- De-link → `property_lifecycle_states.released`
- Archive → remove counterparty + delegate rows
- Analytics snapshot before identity purge

---

## Workflow changes

### Approved grant workflows (only these may create identity)

| Workflow | Grants | RPC |
|----------|--------|-----|
| Start Move — selling | Owner (seller) | `grant_operational_homeowner` |
| Start Move — buying | Owner (buyer) on purchase row | `grant_operational_homeowner` |
| Join chain — counterparty | Counterparty only | `grant_counterparty_participation` |
| EA claim | Owner (seller/buyer per type) | `claim_operational_property` (extended) |
| Convert placeholder | Owner on converted purchase | `convert_searching_placeholder_for_sale` (extended) |
| Delegate invite | Delegate | `invite_property_delegate` |

### Client changes

| File | Change |
|------|--------|
| `lib/ensurePropertyMembership.ts` | **Deprecate** → `lib/ownership/grantOperationalHomeowner.ts` |
| `app/start-move/page.tsx` | Use grant RPC after property insert |
| `app/join-chain/page.tsx` | Use counterparty grant RPC |
| `lib/searchingPlaceholder.ts` | Placeholder owner grant via workflow RPC |
| `lib/propertyClaim/claimOperationalProperty.ts` | No change to surface; server RPC extended |
| `lib/operationalSubject.ts` | Resolve subject from `property_operational_identities`, not earliest member |

### Permission resolution (new)

```typescript
// lib/ownership/resolvePropertyAuthority.ts
resolvePropertyAuthority(propertyId, userId) → {
  isOperationalHomeowner: boolean;
  isCounterparty: boolean;
  isDelegate: boolean;
  isEaAssigned: boolean;
  canMutate: boolean;
}
```

Replace `is_property_member` checks for mutation gates with authority resolution where ownership matters.

---

## De-link architecture

### Homeowner de-link

**Trigger:** User chooses “Leave transaction” / “Remove my property from Keynetic”.

**RPC:** `delink_homeowner_from_property(p_property_id, p_reason)`

**Steps (transaction-scoped):**

1. Verify caller is active operational homeowner (or delegate with `delink` permission — product decision: owner only).
2. Insert `property_delink_events` (actor, reason, chain_id, notified_users).
3. Revoke delegate rows for property.
4. Revoke counterparty participation if sole owner leaving collapses hop (product rule TBD).
5. Remove / deactivate `property_operational_identities`.
6. Remove `property_members` rows for property (or mark inactive).
7. Reset `property_claim_metadata` toward `unclaimed` / releasable (EA-originated).
8. Revoke active `property_ea_assignments` if homeowner-initiated full release.
9. Transition lifecycle → `released` via `record_property_lifecycle_transition`.
10. Insert chain activity: “Homeowner left transaction” (notify participants).
11. Queue participant notifications (email/in-app — Phase 2 comms).

**Post de-link:** Property address eligible for new claim (Scenario C lifecycle).

### Estate agent de-link

**Trigger:** EA removes branch association / releases operational management.

**RPC:** `delink_estate_agent_from_property(p_property_id, p_branch_id, p_reason)`

**Steps:**

1. Verify caller is branch member with admin/delegation rights.
2. Revoke `property_ea_assignments` row (status → `revoked`).
3. Insert `property_delink_events` (actor_type = `estate_agent`).
4. **Does not** remove homeowner identity.
5. Notify homeowner + chain participants where EA was active contributor.
6. If unclaimed EA-originated property with no owner: transition lifecycle toward `dormant` / `released`.

### De-link vs lifecycle

| Operation | Lifecycle transition |
|-----------|---------------------|
| Homeowner de-link (active transaction) | `active` → `archived` → `released` |
| Homeowner de-link (post-completion) | `completed_grace` → `released` (skip re-archive) |
| EA de-link only | No lifecycle change unless no owner remains |
| Lifecycle worker release | System-initiated; same end state as de-link |

---

## Regression impact

### Database

| Area | Impact |
|------|--------|
| All RPCs using `ensure_property_membership` | Must migrate to grant RPCs |
| RLS policies using `is_property_member` | Review: counterparty/delegate still need read access |
| `chain_properties_participant` view | May need join to identity table for `is_own_property` |
| Triggers on `property_members` | Replace or narrow |
| Verification scripts | Update membership setup to use grant RPCs |
| Backfill | One-time job for existing chains; flag multi-owner anomalies |

### Application

| Area | Impact |
|------|--------|
| Start Move | Grant RPC instead of ensure |
| Join chain | Counterparty grant RPC |
| Claim flow | Extended server RPC; UI unchanged if errors stable |
| Chain page mutations | Authority from identity, not role heuristics |
| EA dashboard | Subject user from identity table |
| Convert onward purchase | Buyer grant via identity service |
| Operational summaries refresh | Include identity status |
| Property permissions (`canEditProperty`) | Integrate `resolvePropertyAuthority` |

### Tests / scripts

| Script | Impact |
|--------|--------|
| `verify-convert-searching-placeholder-for-sale.ts` | Use grant RPCs |
| `verify-searching-placeholder-resolution.ts` | Use grant RPCs |
| `verify-property-lifecycle.ts` | Add de-link scenario tests (Phase 2) |

### Risk if not fixed before launch

- Address reservation by malicious `ensure_property_membership` calls.
- Split-brain ownership (two sellers on one sale).
- Incorrect `claimed_by_user_id` from counterparty joins firing claim sync trigger.
- Support load from users unable to reclaim addresses after abandoned transactions.
- GDPR retention conflating operational members with historical analytics subjects.

---

## Implementation roadmap

### Phase 1 — Foundation (this sprint)

- [x] Ownership model documentation (this file)
- [ ] Schema migration: identity + delegate + delink audit tables
- [ ] `lib/ownership/` types and authority resolution stubs
- [ ] Violation path audit CI script (`scripts/audit-ownership-violations.ts`) — flags multi-owner properties in DB
- [ ] Backfill + anomaly report query

### Phase 2 — Pre-launch enforcement

- [ ] Implement grant RPCs; revoke bare `ensure_property_membership`
- [ ] Migrate Start Move, Join Chain, placeholder, convert RPCs
- [ ] Implement de-link RPCs + chain activity notifications
- [ ] Remove/restrict direct `property_members` INSERT policy
- [ ] Fix claim sync trigger scope
- [ ] Global address uniqueness policy (design decision)

### Phase 3 — Delegates + polish

- [ ] Delegate invite/accept UI
- [ ] Delegate permission matrix in workflow gates
- [ ] EA de-link from agent dashboard
- [ ] Lifecycle worker integration with de-link

---

## Verification

```bash
# After migration applied:
npx tsx scripts/audit-ownership-violations.ts

# Expect: zero properties with multiple owner-class members
```

```sql
-- Anomaly detection: multiple seller/buyer owners on same property
select pm.property_id, pm.role, count(distinct pm.user_id) as user_count
from public.property_members pm
inner join public.properties p on p.id = pm.property_id
where (p.relationship_type = 'sale' and pm.role = 'seller')
   or (p.relationship_type = 'purchase' and pm.role = 'buyer')
group by pm.property_id, pm.role
having count(distinct pm.user_id) > 1;
```

---

## Summary

Generic `property_members` treated every authenticated self-insert as valid operational authority. The new model introduces **`property_operational_identities`** as the sole source of homeowner truth, reduces `property_members` to a deprecated or derived artefact, routes all grants through **approved workflow RPCs**, and adds **de-link** as a first-class release path integrated with lifecycle `released` state.

**Pre-launch blockers:** V1–V5 and G1–G4 must be resolved before production launch.
