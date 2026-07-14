# Participation De-link (Phase 2)

Controlled release of operational participation without deleting transaction history, analytics, or audit records.

**Migration:** `supabase/migrations/20260714160000_participation_delink.sql`  
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
    ├── lifecycle: record_property_lifecycle_transition (homeowner_self only)
    └── identity / EA / claim updates per operation
```

Legacy wrappers remain for compatibility:

- `delink_homeowner_from_property` → `homeowner_self`
- `delink_estate_agent_from_property` → `estate_agent_remove_branch`

No `DELETE` on properties, chains, activities, or analytics tables.

---

## Permission matrix

| Operation | Actor | Preconditions | Identity | EA assignment | Lifecycle | Chain notify |
|-----------|-------|---------------|----------|---------------|-----------|--------------|
| `homeowner_self` | Operational homeowner | Active identity for caller | Released | Revoked | → `released` | Yes |
| `homeowner_remove_ea` | Operational homeowner | Active EA assignment | Retained | Revoked | Unchanged | Yes |
| `estate_agent_remove_branch` | EA branch member | Active assignment for branch | Retained | Revoked | Unchanged | Yes |
| `estate_agent_remove_homeowner` | EA branch member | EA-originated property **and** (invitation pending **or** not meaningful participation) | Released if present | Retained | Unchanged (re-invitable) | Yes |

### Meaningful participation (EA remove homeowner guard)

`homeowner_has_meaningful_participation(property_id)` returns true when the active operational homeowner has:

- Any homeowner-authored activity, **or**
- Stage beyond `property_listed` / `searching`, **or**
- Active counterparty participation, **or**
- Both `buyer_connected` and `seller_connected`, **or**
- Identity granted more than 14 days ago (configurable via `app.lifecycle_meaningful_activity_days`)

If meaningful → `homeowner_actively_participating` error. An established transaction cannot have the homeowner removed by the EA.

### Invitation pending

`property_invitation_is_pending(property_id)` — EA-originated, claim `unclaimed` or `claim_invited`, no active operational identity.

---

## Operation effects (detail)

### 1. Homeowner → De-link themselves (`homeowner_self`)

- Revoke delegates and counterparty participants
- Release operational identity (`released`)
- Remove synced `property_members` rows
- Reset EA-originated claim metadata toward `unclaimed`
- Revoke EA assignments
- Disconnect chain flags on property (`buyer_connected` / `seller_connected`)
- Lifecycle → `released`
- Chain activity + audit event

### 2. Homeowner → Remove estate agent (`homeowner_remove_ea`)

- Revoke active `property_ea_assignments` (`revoked`)
- Homeowner identity retained
- Chain activity + audit event

### 3. Estate agent → Remove own branch (`estate_agent_remove_branch`)

- Same as homeowner remove EA, initiated by assigned branch member
- Homeowner retained

### 4. Estate agent → Remove homeowner (`estate_agent_remove_homeowner`)

**Restricted** — only when invitation pending or no meaningful participation.

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
- Homeowner self de-link + lifecycle released
- Homeowner remove EA
- EA remove branch
- EA remove homeowner when invitation pending
- Blocked EA remove when meaningful participation

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
