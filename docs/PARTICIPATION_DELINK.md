# Participation De-link (Phase 2)

Controlled release of operational participation without deleting transaction history, analytics, or audit records.

**This is not GDPR Right to Erasure.** See [GDPR Right to Erasure Architecture](./GDPR_RIGHT_TO_ERASURE_ARCHITECTURE.md).

**Migration:** `supabase/migrations/20260714160000_participation_delink.sql` (authority rules: `20261005120000_operational_authority_enforcement.sql`)  
**Service:** `lib/ownership/participationDelink.ts`  
**UI:** Property page + Agent command centre cards

---

## Architecture

All four supported operations route through **one** database service:

```
Client UI
    ↓
get_participation_delink_options(property_id)   — permission discovery
execute_participation_delink(property_id, operation, reason_code, branch_id?)
    ↓
_execute_participation_delink(...)              — unified SECURITY DEFINER service
    ├── audit: property_delink_events.reason_code (enum only)
    ├── activities: _notify_chain_participants_of_delink
    ├── lifecycle: record_property_lifecycle_transition (mistake-only release)
    └── identity / EA / claim updates per operation
```

Legacy wrappers remain for compatibility:

- `delink_homeowner_from_property` → `homeowner_self`
- `delink_estate_agent_from_property` → `estate_agent_remove_branch`

No `DELETE` on properties, chains, activities, or analytics tables.

---

## Permission matrix

Since M3 (`20261005120000`) each operation removes **only the departing authority**. A row is released immediately only when it was added by mistake and nothing depends on it; otherwise it stays in its chain as an unrepresented placeholder and the [lifecycle](./PROPERTY_LIFECYCLE.md) decides what happens next. Every operation locks the property row (`FOR UPDATE`) first.

| Operation | Actor | Preconditions | Identity | EA assignment | Lifecycle | Chain notify |
|-----------|-------|---------------|----------|---------------|-----------|--------------|
| `homeowner_self` (sale) | Operational homeowner | Active identity for caller | Released | **Kept** (`unclaimed`, EA can invite a replacement) | `released` only if no EA, reason `wrong_property` and no dependants; else placeholder | Yes |
| `homeowner_self` (purchase, buyer leaving) | Operational homeowner | Active identity for caller | Released; own linking sale unlinked | — | `released` only if no seller side, no dependants, no open invitation and no counterparty; else placeholder | Yes |
| `homeowner_remove_ea` | Seller-side homeowner only | Active EA assignment | Retained | Revoked (`homeowner_removed_ea`) | Unchanged (still managed) | Yes |
| `estate_agent_remove_branch` | EA branch member | Active assignment for branch | Retained | Revoked (`branch_left`) | Homeowner remains: unchanged. Last seller-side representative: `released` only for `added_by_mistake` / `duplicate_property` with no dependants; else placeholder | Yes |
| `estate_agent_remove_homeowner` | Member of the branch actively assigned to this **sale** row | Homeowner came from the claim / invitation flow (or the row is EA-originated) **and** (invitation pending **or** not meaningful participation) | Released if present | Retained | Unchanged (re-invitable) | Yes |

**Dependants** (`_property_placeholder_has_dependants`): `buyer_connected` on a sale; an active identity or counterparty other than the leaver; a Buyer Ready node linked to the row (other than the leaver's); a represented row linking to it (other than the leaver's own sale); a represented onward row. Rows that merely share the chain do not count.

The result includes `lifecycle_state` (`released` or `active`) and `placeholder` (whether the row stays as an unrepresented placeholder).

### Meaningful participation (EA remove homeowner guard)

`homeowner_has_meaningful_participation(property_id)` returns true when the active operational homeowner has:

- Any homeowner-authored activity, **or**
- Stage beyond `property_listed` / `searching`, **or**
- Active counterparty participation, **or**
- Both `buyer_connected` and `seller_connected`, **or**
- Identity granted more than 14 days ago (configurable via `app.lifecycle_meaningful_activity_days`)

If meaningful → `homeowner_actively_participating` error. An established transaction cannot have the homeowner removed by the EA.

### Invitation pending

`property_invitation_is_pending(property_id)` — EA-originated, claim `unclaimed` or `claim_invited`, no active operational identity. The EA withdraw action uses the broader `invitation_pending` result of `_ea_homeowner_withdrawal_status` (also covers an invitation the assigned branch sent on a homeowner-created sale after the homeowner left).

---

## Operation effects (detail)

### 1. Homeowner → De-link themselves (`homeowner_self`)

Sale:

- Release the operational identity (`released`), the homeowner's `property_members` row and their delegates
- Claim metadata → `unclaimed` (any origin)
- **EA assigned:** the EA, counterparties, connected flags and links stay; the row is still managed by the EA, which can invite a replacement homeowner
- **No EA:** released now only for `wrong_property` with no dependants; otherwise the row stays as a placeholder (counterparties, links, flags and valid invitations kept)
- Chain activity + audit event

Purchase (the buyer leaving): the leaver's own linking sale is unlinked in the same transaction and does not count as a dependant. Released now only when the row has no seller side, no dependants, no open invitation and no counterparty; otherwise it stays as a placeholder.

### 2. Homeowner → Remove estate agent (`homeowner_remove_ea`)

- Seller-side homeowner only — a buyer on a purchase cannot remove the seller's EA
- Revoke the active assignment (`revocation_reason = 'homeowner_removed_ea'`)
- Homeowner identity retained; the row stays managed
- Chain activity + audit event

### 3. Estate agent → Remove own branch (`estate_agent_remove_branch`)

- Revoke the branch's assignment (`revocation_reason = 'branch_left'`)
- Homeowner still on the seller side: nothing else changes
- Branch was the last seller-side representative: released now only for `added_by_mistake` / `duplicate_property` with no dependants; otherwise the row stays in the chain as a placeholder waiting for its seller

### Returning EA branch (`reconnect_returning_ea_branch`)

A branch whose assignment ended only because the appointing homeowner left (`homeowner_left_cascade`) may put itself back when the row is not archived, released or anonymised, the seller side is unrepresented, no other branch has been assigned since, the branch does not act for the sale linking to the row, and the caller is a verified branch member. Rate limited and audited (`property_ea_reconnection_events`). No address or access code is accepted, so it is not a takeover path.

`branch_left` (the branch removed itself), `homeowner_removed_ea` and `replaced` never qualify. Because `homeowner_self` keeps the EA, the only path that writes `homeowner_left_cascade` today is the GDPR person-link removal (`_gdpr_remove_subject_property_links`) of the homeowner who appointed the branch. Live coverage: `scripts/verify-ea-reconnection-development.ts`.

**UI (`/agent/reconnect`).** The command centre shows a notice only when `list_reconnectable_ea_properties()` returns rows. That lookup takes no input, is read-only (STABLE, no writes) and returns only the caller's own branches' rows that the RPC would currently accept, with what the branch already held: property id, branch, address, postcode and when the assignment ended. It mirrors the RPC's conditions (latest assignment on the row is this branch's and ended by `homeowner_left_cascade`; not searching, archived, released or anonymised; seller side unrepresented; branch not acting for the linking sale) but grants nothing. **Reconnect** calls `reconnect_returning_ea_branch` with that property and branch only; the RPC re-checks every condition under lock and returns a generic refusal when anything has changed. There is no search, address or access-code input.

**Invariant:** an EA creating, previously managing, or being connected to Property A never gains seller-side operational authority over Property B merely because Property B is an onward purchase, buyer placeholder, connected property, or member of the same chain.

### 4. Estate agent → Remove homeowner (`estate_agent_remove_homeowner`)

**Restricted.** EA-originated is not EA-authorised: authority is the caller's branch holding the **active** assignment on this row today, decided by `_ea_homeowner_withdrawal_status` (shared by `execute_participation_delink` and `get_participation_delink_options`, so the UI only offers what the RPC allows).

| Result | Meaning |
|--------|---------|
| `not_assigned_ea` | Caller is not a member of the branch actively assigned to this row (buyer-side participants, other properties' EAs, unassigned branches of the same company) |
| `not_seller_side_row` | Row is a purchase; its identity holder is the buyer, never withdrawable by an EA |
| `invitation_pending` | No identity yet; open claim with an invitation (or EA-originated) — withdrawable |
| `homeowner_not_invited` | Homeowner created the transaction themselves (`start_move`, `convert_placeholder`, `backfill` on a row that is not EA-originated) |
| `homeowner_actively_participating` | Meaningful participation (above) |
| `removable` | Invited homeowner without meaningful participation |

- Revoke pending invitations
- Release identity if present; remove homeowner membership row only
- Reset claim to `claim_invited` for re-send
- EA assignment **retained**
- No lifecycle `released` (property stays EA-managed)

---

## UI locations

| Surface | Component | Operations shown |
|---------|-----------|------------------|
| `/property/[propertyId]` | `ParticipationDelinkPanel` | All options permitted for current user |
| Agent Command Centre cards | `ParticipationDelinkQuickActions` | EA branch release + withdraw homeowner (when permitted) |
| Confirmation | `ParticipationDelinkConfirmModal` | Required predefined reason code (radio) |

## Reason codes (no free text)

| Operation | Codes |
|-----------|-------|
| `homeowner_self` | `no_longer_moving`, `wrong_property`, `prefer_not_to_use_keynetic`, `other` |
| `homeowner_remove_ea` | `no_longer_need_agent`, `wrong_branch_assigned`, `other` |
| `estate_agent_remove_branch` | `added_by_mistake`, `branch_no_longer_instructed`, `duplicate_property`, `other` |
| `estate_agent_remove_homeowner` | `wrong_homeowner_invited`, `duplicate_invitation`, `invitation_no_longer_required`, `other` |

Analytics and audit store **reason_code only**. Migration: `20260714170000_participation_delink_reason_codes.sql`.

After `homeowner_self`, user is redirected to dashboard. Other operations refresh chain participant data in place.

---

## Regression verification

Apply migrations through `20260714160000`, then:

```bash
npx tsx scripts/verify-participation-delink.ts
```

Covers:

- Options discovery for homeowner
- Homeowner self de-link (mistake release / placeholder)
- Homeowner remove EA
- EA remove branch (homeowner remains / mistake release / placeholder)
- EA remove homeowner when invitation pending
- Blocked EA remove when meaningful participation

Static checks of the M3 rules: `npx tsx scripts/verify-operational-authority-migration.ts`.

---

## Analytics & history

- `property_delink_events.reason_code` — append-only audit (enum only)
- `activities` — de-link notices (including sibling chain properties)
- `property_lifecycle_events` — lifecycle transitions
- Property and chain rows **not deleted**
- Operational summaries refresh via existing `refreshParticipantData` after UI de-link

---

## Future (not Phase 2)

- Email notifications via `lib/communications` (`notification-emails` template category)
- Delegate-initiated de-link (product decision: owner-only today)
- Chain page aggregate “released participant” badge from `property_lifecycle_states`
